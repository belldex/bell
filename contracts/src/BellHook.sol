// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHook} from "../lib/openzeppelin-uniswap-hooks/src/base/BaseHook.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {
    AssetDescriptor,
    HealthView,
    CalendarLeaf,
    Anchor,
    SourceSample,
    PoolConfig,
    PoolState,
    Buckets,
    PolicyView,
    Lifecycle,
    Mode,
    PoolClass,
    LiquidityMode,
    ReasonBits
} from "./types/ProtocolTypes.sol";
import {IBellEvents, IBellErrors} from "./interfaces/ProtocolEvents.sol";
import {
    IBellHook,
    IAssetRegistry,
    ISessionRegistry,
    ICalendarRegistry,
    ISafetyController
} from "./interfaces/IBellProtocol.sol";
import {PolicyConstants} from "./libraries/PolicyConstants.sol";
import {ModePolicy} from "./libraries/ModePolicy.sol";
import {BellModeEvaluator} from "./BellModeEvaluator.sol";
import {CalendarProof} from "./libraries/CalendarProof.sol";
import {SeedAccounting} from "./libraries/SeedAccounting.sol";
import {AssetPolicy} from "./libraries/AssetPolicy.sol";
import {IMsgSender} from "../lib/v4-periphery/src/interfaces/IMsgSender.sol";

/// @title BellHook
/// @notice Immutable single-pool hook template for BELL.
/// @dev M05-02 adds one canonical lifecycle/health evaluator shared by `getPolicy`, `refreshState` and
/// `beforeSwap`. M05-03 extends the same evaluator with planned closure, per-asset anchors, the one-shot closure
/// latch and the 60-second joint recovery path. M05-04/M06 implement request-bound seed capture and
/// post-settlement activation. Swap pre/post enforcement and budget commit (M05-05) remain unimplemented;
/// swaps therefore remain blocked even after activation.
///
/// The hook is not upgradeable and has no proxy, delegatecall, owner or configuration setter. The only mutable
/// state is the per-pool state/accounting checkpoint that the evaluator updates.
contract BellHook is BaseHook, IBellHook, IBellEvents, IBellErrors {
    /// @notice Protocol API version, independent of the document draft number.
    uint32 public constant override apiVersion = 1;

    int24 private constant REQUIRED_TICK_SPACING = 60;

    /// @dev M05-05 owns swap reference pinning, price-path checks and budget commit. Until that enforcement is
    /// implemented, even a synthetic LIVE/healthy evaluation must not advertise swap capability. Flip this only
    /// together with the M05-05 implementation; `getPolicy`, `refreshState` and `beforeSwap` share the gate.
    bool private constant SWAP_EXECUTION_READY = false;

    BellModeEvaluator public immutable modeEvaluator;

    bytes4 private constant PROTOCOL_FEE_CONTROLLER_SELECTOR = bytes4(keccak256("protocolFeeController()"));

    bytes32 private constant ERR_POOL_MANAGER = keccak256("POOL_MANAGER");
    bytes32 private constant ERR_POSITION_MANAGER = keccak256("POSITION_MANAGER");
    bytes32 private constant ERR_FACTORY = keccak256("FACTORY");
    bytes32 private constant ERR_ASSET_REGISTRY = keccak256("ASSET_REGISTRY");
    bytes32 private constant ERR_CALENDAR_REGISTRY = keccak256("CALENDAR_REGISTRY");
    bytes32 private constant ERR_SAFETY_CONTROLLER = keccak256("SAFETY_CONTROLLER");
    bytes32 private constant ERR_SESSION_REGISTRY = keccak256("SESSION_REGISTRY");
    bytes32 private constant ERR_TREASURY_ADAPTER = keccak256("TREASURY_ADAPTER");
    bytes32 private constant ERR_TOKENS = keccak256("TOKENS");
    bytes32 private constant ERR_ASSETS = keccak256("ASSETS");
    bytes32 private constant ERR_CAPS = keccak256("CAPS");
    bytes32 private constant ERR_POOL_KEY = keccak256("POOL_KEY");
    bytes32 private constant ERR_POOL_FEE = keccak256("POOL_FEE");
    bytes32 private constant ERR_TICK_SPACING = keccak256("TICK_SPACING");
    bytes32 private constant ERR_POOL_CLASS = keccak256("POOL_CLASS");
    bytes32 private constant ERR_LIQUIDITY_MODE = keccak256("LIQUIDITY_MODE");
    bytes32 private constant ERR_POLICY_ID = keccak256("POLICY_ID");
    bytes32 private constant ERR_TEMPLATE_CODE_HASH = keccak256("TEMPLATE_CODE_HASH");

    // Immutable PoolConfig mirror. Solidity does not allow structs to be immutable, so each field is bound
    // once in the constructor and can never be written again.
    address private immutable _token0;
    address private immutable _token1;
    bytes32 private immutable _asset0;
    bytes32 private immutable _asset1;
    address private immutable _positionManager;
    address private immutable _factory;
    address private immutable _assetRegistry;
    address private immutable _calendarRegistry;
    address private immutable _safetyController;
    address private immutable _treasuryAdapter;
    /// @notice Session/health registry dependency. `PoolConfig` has no session-registry field, so M06's
    /// deploy manifest must bind this address alongside the normative config hash.
    address public immutable sessionRegistry;
    uint8 private immutable _poolClass;
    uint8 private immutable _liquidityMode;
    uint8 private immutable _referenceMode;
    int24 private immutable _tickSpacing;
    uint24 private immutable _poolFee;
    uint128 private immutable _tradeCap0;
    uint128 private immutable _tradeCap1;
    uint128 private immutable _windowCap0;
    uint128 private immutable _windowCap1;
    uint128 private immutable _closureCap0;
    uint128 private immutable _closureCap1;
    bytes32 private immutable _policyId;

    /// @notice The canonical pool id derived from the bound PoolKey (including this hook address).
    bytes32 public immutable override poolId;

    /// @notice Hash of the template creation bytecode without constructor arguments.
    /// @dev A template cannot read its own creation code. The deploying factory computes
    /// `keccak256(type(BellHook).creationCode)` and passes it here; the value is exposed for deploy-manifest and
    /// config-hash verification. It is never recomputed from runtime code, which would create a CREATE2 cycle.
    /// This is a deterministic binding, not proof of template authenticity: the official factory/manifest is the
    /// trust boundary (M02/M06). A rogue direct deployment can supply any non-zero hash.
    bytes32 public immutable templateCodeHash;

    /// @notice keccak256(abi.encode(chainId, templateCodeHash, PoolConfig)).
    bytes32 public immutable configHash;

    PoolState private _state;
    Buckets private _buckets;
    mapping(uint64 closureNonce => uint128[2] gross) private _episodeGross;

    struct SeedContext {
        bytes32 requestHash;
        int24 tickLower;
        int24 tickUpper;
        bytes32 salt;
        uint128 liquidity;
        address provider;
        uint128[2] principal;
        bool initialized;
        bool modificationPending;
        bool captured;
        bool activated;
    }

    SeedContext private _seed;

    /// @dev Internal result of the canonical evaluator. `PolicyView` is the public projection; the extra
    /// fields let `refreshState` checkpoint the pool pause nonce, closure transitions and recovery vector without
    /// a second dependency read.
    struct PolicyEvaluation {
        PolicyView policy;
        ModePolicy.Decision decision;
        PoolState nextState;
    }

    /// @dev Per-asset reasons, session context and closure data collected by `_evaluateAsset`.
    struct AssetEvaluation {
        uint256 reasons;
        uint64 validUntil;
        uint8 phase;
        bool phaseSet;
        bool isStock;
        uint64 healthySince;
        bool plannedClosed;
        bool activeHealthy;
        bool legHealthy;
        bool closureContextOk;
        bool unexpectedClosed;
        uint64 observation;
        bytes32 observationHash;
    }

    /// @dev Aggregated dependency result. Keeping this in memory avoids a stack-too-deep policy builder while
    /// preserving one read per dependency per evaluation.
    struct DependencyEvaluation {
        uint256 reasons;
        uint64 validUntil;
        uint8 phase;
        bool phaseSet;
        bool anyPlannedClosed;
        bool allLegsHealthy;
        bool closureContextValid;
        bool unexpectedClosed;
        uint8 stockMask;
        uint64[2] observations;
        uint64[2] healthySince;
        uint64 poolPauseNonce;
        bool poolPauseOk;
        bytes32 dependencyHash;
    }

    /// @dev Observation hashes consumed for one asset. Grouping them keeps the evaluator below the stack limit.
    struct AssetObservations {
        bytes32 pauseState;
        bytes32 descriptor;
        bytes32 calendar;
        bytes32 anchor;
        bytes32 health;
        bytes32 closedReport;
    }

    constructor(PoolConfig memory config_, PoolKey memory key_, bytes32 templateCodeHash_, address sessionRegistry_)
        BaseHook(IPoolManager(config_.poolManager))
    {
        if (templateCodeHash_ == bytes32(0)) revert BadConfig(ERR_TEMPLATE_CODE_HASH);
        _validateDependencies(config_);
        _requireContract(sessionRegistry_, ERR_SESSION_REGISTRY);
        _validateConfig(config_, key_);
        // Reject malformed/unbounded dependencies before paying to construct the immutable calculator.
        modeEvaluator = new BellModeEvaluator();

        _token0 = config_.token0;
        _token1 = config_.token1;
        _asset0 = config_.asset0;
        _asset1 = config_.asset1;
        _positionManager = config_.positionManager;
        _factory = config_.factory;
        _assetRegistry = config_.assetRegistry;
        _calendarRegistry = config_.calendarRegistry;
        _safetyController = config_.safetyController;
        _treasuryAdapter = config_.treasuryAdapter;
        sessionRegistry = sessionRegistry_;
        _poolClass = config_.poolClass;
        _liquidityMode = config_.liquidityMode;
        _referenceMode = config_.referenceMode;
        _tickSpacing = config_.tickSpacing;
        _poolFee = key_.fee;
        _tradeCap0 = config_.tradeCap[0];
        _tradeCap1 = config_.tradeCap[1];
        _windowCap0 = config_.windowCap[0];
        _windowCap1 = config_.windowCap[1];
        _closureCap0 = config_.closureCap[0];
        _closureCap1 = config_.closureCap[1];
        _policyId = config_.policyId;

        poolId = PoolId.unwrap(PoolIdLibrary.toId(poolKey()));
        templateCodeHash = templateCodeHash_;
        configHash = keccak256(abi.encode(block.chainid, templateCodeHash_, config_));

        // Only the request-bound post-settlement activation route can leave DEPLOYED/SEEDING.
        // The evaluator treats every non-LIVE lifecycle as SETUP, so this initial state cannot trade.
        _state.lifecycle = uint8(Lifecycle.DEPLOYED);
        _state.mode = uint8(Mode.SETUP);
    }

    // -------------------------------------------------------------------------
    // Hook permissions and callback gates
    // -------------------------------------------------------------------------

    /// @notice Exact normative mask 0x2cc0. All return-delta flags are false.
    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.beforeAddLiquidity = true;
        permissions.afterAddLiquidity = true;
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
    }

    /// @notice Factory-only request prebinding performed before PoolManager.initialize.
    /// @dev The factory must perform this in the same transaction as initialization, seeding, settlement,
    /// post-settlement verification and activatePool. A reverted transaction rolls this context back atomically.
    function beginSeed(bytes32 requestHash, int24 tickLower, int24 tickUpper, bytes32 salt, uint128 liquidity)
        external
    {
        if (msg.sender != _factory) revert Unauthorized();
        if (_state.lifecycle != uint8(Lifecycle.DEPLOYED) || _seed.requestHash != bytes32(0)
            || requestHash == bytes32(0) || liquidity == 0 || tickLower >= tickUpper
            || tickLower % _tickSpacing != 0 || tickUpper % _tickSpacing != 0) revert BadSeed();
        _seed.requestHash = requestHash;
        _seed.tickLower = tickLower;
        _seed.tickUpper = tickUpper;
        _seed.salt = salt;
        _seed.liquidity = liquidity;
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal override returns (bytes4) {
        _requireBoundKey(key);
        if (sender != _factory) revert Unauthorized();
        if (_state.lifecycle != uint8(Lifecycle.DEPLOYED) || _seed.requestHash == bytes32(0) || _seed.initialized) {
            revert BadSeed();
        }
        _seed.initialized = true;
        _state.lifecycle = uint8(Lifecycle.SEEDING);
        _state.mode = uint8(Mode.SETUP);
        return IHooks.beforeInitialize.selector;
    }

    function _beforeAddLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4)
    {
        _requireBoundKey(key);
        if (_state.lifecycle == uint8(Lifecycle.LIVE)) {
            _validatePublicIncrease(sender, hookData);
            return IHooks.beforeAddLiquidity.selector;
        }
        if (_seed.modificationPending) revert BadSeed();
        _validateSeedModification(sender, params);
        _seed.provider = sender;
        _seed.modificationPending = true;
        return IHooks.beforeAddLiquidity.selector;
    }

    function _afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta delta,
        BalanceDelta feesAccrued,
        bytes calldata
    ) internal override returns (bytes4, BalanceDelta) {
        _requireBoundKey(key);
        if (_state.lifecycle == uint8(Lifecycle.LIVE)) {
            // Pinned core calls afterAdd only after the matching beforeAdd succeeded in this unlock.
            // LIVE cannot transition back to SEEDING; no state from a PUBLIC add is seed accounting.
            return (IHooks.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
        }
        if (!_seed.modificationPending || _seed.provider != sender || _seed.captured) revert BadSeed();
        _validateSeedModification(sender, params);
        uint128[2] memory principal = SeedAccounting.seedPrincipal(delta, feesAccrued);
        _seed.principal = principal;
        _seed.modificationPending = false;
        _seed.captured = true;
        emit SeedCaptured(poolId, principal[0], principal[1]);
        return (IHooks.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function _validateSeedModification(address sender, ModifyLiquidityParams calldata params) private view {
        if (_state.lifecycle != uint8(Lifecycle.SEEDING) || !_seed.initialized || _seed.captured
            || !_trustedSeedProvider(sender) || params.liquidityDelta <= 0
            || params.liquidityDelta != int256(uint256(_seed.liquidity)) || params.tickLower != _seed.tickLower
            || params.tickUpper != _seed.tickUpper || params.salt != _seed.salt) revert BadSeed();
    }

    function _trustedSeedProvider(address sender) private view returns (bool) {
        if (_liquidityMode == uint8(LiquidityMode.TREASURY_ONLY)) return sender == _treasuryAdapter;
        // Constructor rejects unknown liquidity modes.
        return sender == _positionManager && _positionManagerCaller() == _factory;
    }

    /// @dev LIVE PUBLIC liquidity uses the canonical PM's protected locker context. The pinned PM owns
    /// tokenId->PoolKey/ticks/salt derivation, ERC721 owner/approval checks and caller-funded settlement;
    /// hookData cannot impersonate any of them. New explicit mints are legitimate PUBLIC deposits too.
    /// Never re-enter seed accounting, read oracle policy or modify activation/caps on this path.
    /// TREASURY_ONLY stays closed here pending M06-03's separately reviewed adapter integration.
    function _validatePublicIncrease(address sender, bytes calldata hookData)
        private view
    {
        // LIVE is reachable only through successful one-shot activation. Core invokes beforeAdd only
        // for positive liquidity; the pinned PM validates the position and its uint128 liquidity bounds.
        if (hookData.length != 0 || _liquidityMode != uint8(LiquidityMode.PUBLIC) || sender != _positionManager
            || _positionManagerCaller() == address(0)) revert Unauthorized();
    }

    function _positionManagerCaller() private view returns (address initiator) {
        bytes4 selector = IMsgSender.msgSender.selector;
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        address positionManager = _positionManager;
        assembly ("memory-safe") {
            // The selector and single return word fit entirely in Solidity's scratch space.
            mstore(0, selector)
            let success := staticcall(gasLimit, positionManager, 0, 4, 0, 32)
            let word := mload(0)
            if and(and(success, eq(returndatasize(), 32)), iszero(shr(160, word))) { initiator := word }
        }
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requireBoundKey(key);
        // References/policy are protocol inputs, never executable or user-substitutable hookData.
        if (hookData.length != 0) revert ContextMismatch();
        // The exact PoolKey and onlyPoolManager gates above stay first. Then use the same canonical evaluator
        // as getPolicy/refreshState: pre-LIVE, failed dependencies and invalid/unknown states are blocked with
        // the full reason mask (the lowest set bit is the dominant reason).
        PolicyEvaluation memory evaluation = _evaluatePolicy(false);
        if (!evaluation.policy.canSwap) revert PolicyBlocked(evaluation.policy.reasonBits);
        // The policy is healthy, but reference pinning, price-path checks and budget commit belong to M05-05.
        // Never let a synthetic/healthy evaluation become an execution bypass in this milestone.
        revert HookNotImplemented();
    }

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4, int128)
    {
        _requireBoundKey(key);
        if (hookData.length != 0) revert ContextMismatch();
        // Swap post-checks and budget commit belong to M05-05.
        revert HookNotImplemented();
    }

    function _requireBoundKey(PoolKey calldata key) private view {
        if (
            address(key.hooks) != address(this) || Currency.unwrap(key.currency0) != _token0
                || Currency.unwrap(key.currency1) != _token1 || key.fee != _poolFee || key.tickSpacing != _tickSpacing
        ) revert ContextMismatch();
    }

    // -------------------------------------------------------------------------
    // Immutable read views
    // -------------------------------------------------------------------------

    function config() external view override returns (PoolConfig memory result) {
        result.token0 = _token0;
        result.token1 = _token1;
        result.asset0 = _asset0;
        result.asset1 = _asset1;
        result.poolManager = address(poolManager);
        result.positionManager = _positionManager;
        result.factory = _factory;
        result.assetRegistry = _assetRegistry;
        result.calendarRegistry = _calendarRegistry;
        result.safetyController = _safetyController;
        result.treasuryAdapter = _treasuryAdapter;
        result.poolClass = _poolClass;
        result.liquidityMode = _liquidityMode;
        result.referenceMode = _referenceMode;
        result.tickSpacing = _tickSpacing;
        result.tradeCap = [_tradeCap0, _tradeCap1];
        result.windowCap = [_windowCap0, _windowCap1];
        result.closureCap = [_closureCap0, _closureCap1];
        result.policyId = _policyId;
    }

    function poolKey() public view returns (PoolKey memory key) {
        key.currency0 = Currency.wrap(_token0);
        key.currency1 = Currency.wrap(_token1);
        key.fee = _poolFee;
        key.tickSpacing = _tickSpacing;
        key.hooks = IHooks(address(this));
    }

    function state() external view override returns (PoolState memory) {
        return _state;
    }

    function buckets() external view override returns (Buckets memory) {
        return _buckets;
    }

    function episodeGross(uint64 nonce) external view override returns (uint128[2] memory) {
        return _episodeGross[nonce];
    }

    /// @notice Principal measured in the single trusted seed callback, in raw currency units.
    function seedPrincipal() external view returns (uint128[2] memory) {
        return _seed.principal;
    }

    function seedCaptured() external view returns (bool) {
        return _seed.captured;
    }

    /// @notice Factory-only post-settlement activation. The factory is responsible for verifying the position
    /// owner/liquidity or treasury receipt after settlement, then calling this once with its bound request hash.
    function activatePool(bytes32 requestHash, uint256 tokenId) external override {
        if (msg.sender != _factory) revert Unauthorized();
        if (_state.lifecycle != uint8(Lifecycle.SEEDING) || !_seed.initialized || !_seed.captured || _seed.activated
            || _seed.modificationPending || requestHash == bytes32(0) || requestHash != _seed.requestHash) {
            revert BadSeed();
        }
        if ((_liquidityMode == uint8(LiquidityMode.PUBLIC) && tokenId == 0)
            || (_liquidityMode == uint8(LiquidityMode.TREASURY_ONLY) && tokenId != 0)) revert BadSeed();

        uint128[2] memory tradeCaps = [_tradeCap0, _tradeCap1];
        uint128[2] memory windowCaps = [_windowCap0, _windowCap1];
        uint128[2] memory maximumClosure = modeEvaluator.maximumClosureCap(tradeCaps, windowCaps, _seed.principal);
        if (_closureCap0 > maximumClosure[0] || _closureCap1 > maximumClosure[1]) revert BadSeed();

        if (block.timestamp > type(uint64).max || block.timestamp < PolicyConstants.REOPEN_MINIMUM_SEPARATION_SECONDS) {
            revert BadSeed();
        }
        DependencyEvaluation memory bootstrap = _evaluateDependencies();
        if (bootstrap.reasons != 0 || !bootstrap.phaseSet || bootstrap.phase == PolicyConstants.PHASE_CLOSED
            || !bootstrap.allLegsHealthy || bootstrap.validUntil <= block.timestamp || bootstrap.stockMask == 0) {
            revert BadSeed();
        }
        for (uint256 i; i < 2; ++i) {
            // forge-lint: disable-next-line(incorrect-shift)
            if ((bootstrap.stockMask & uint8(1 << i)) == 0) continue;
            if (bootstrap.healthySince[i] == 0 || uint256(bootstrap.healthySince[i]) + PolicyConstants.REOPEN_MINIMUM_SEPARATION_SECONDS > block.timestamp
                || bootstrap.observations[i] == 0) revert BadSeed();
        }

        _seed.activated = true;
        uint64 activationTime = uint64(block.timestamp);
        _state.lifecycle = uint8(Lifecycle.LIVE);
        // Until M05-05 installs the swap guard/cap/reference path, the production gate remains HALTED/SETUP.
        _state.mode = uint8(Mode.HALTED);
        _state.bellStart = activationTime;
        _state.oldValidUntil = bootstrap.validUntil;
        _state.lastOpenObservations = bootstrap.observations;
        _state.reopenBaseObservations = bootstrap.observations;
    }

    // -------------------------------------------------------------------------
    // Policy evaluator
    // -------------------------------------------------------------------------

    /// @notice View evaluation used by routers, API and callbacks. It never writes state and never releases a
    /// latched closure; only `refreshState` may commit a recovery transition.
    function getPolicy() external view override returns (PolicyView memory) {
        return _evaluatePolicy(false).policy;
    }

    /// @notice Permissionless checkpoint. It stores the mode, pause nonce, one-shot closure latch and recovery
    /// vector produced by the same evaluator as `getPolicy`. It never touches `_buckets` or `_episodeGross`, so
    /// pause/fault checkpoints cannot reset or refill accounting.
    function refreshState() external override returns (PolicyView memory policy) {
        PolicyEvaluation memory evaluation = _evaluatePolicy(true);
        policy = evaluation.policy;
        _state = evaluation.nextState;
        if (evaluation.decision.beginLatch) emit ClosureStarted(poolId, _state.closureNonce);
        if (evaluation.decision.releaseLatch) emit ClosureEnded(poolId, _state.closureNonce);
        emit ModeCheckpoint(poolId, policy.mode, policy.reasonBits, policy.closureNonce, _state.reopenCandidateAt);
    }

    /// @dev Single canonical evaluator. Dependency reads are bounded staticcalls; a failed read is a recorded
    /// blocking reason, never a healthy default. `ModePolicy` owns the lifecycle/mode/closure decision so
    /// `getPolicy`, `refreshState` and `beforeSwap` cannot diverge. `checkpoint` only controls whether the view
    /// projection may expose a latch release that has not been committed yet.
    function _evaluatePolicy(bool checkpoint) private view returns (PolicyEvaluation memory evaluation) {
        PoolState memory snapshot = _state;
        DependencyEvaluation memory deps = _evaluateDependencies();

        ModePolicy.Context memory context;
        context.lifecycle = snapshot.lifecycle;
        context.previousMode = snapshot.mode;
        context.activationCommitted = snapshot.bellStart != 0;
        context.phase = deps.phase;
        context.phaseSet = deps.phaseSet;
        context.closedLatched = snapshot.closedLatched;
        context.closureNonce = snapshot.closureNonce;
        context.reopenCandidateAt = snapshot.reopenCandidateAt;
        context.oldValidUntil = snapshot.oldValidUntil;
        context.reopenBaseObservations = snapshot.reopenBaseObservations;
        context.lastOpenObservations = snapshot.lastOpenObservations;
        context.anyPlannedClosed = deps.anyPlannedClosed;
        context.allLegsHealthy = deps.allLegsHealthy;
        context.closureContextValid = deps.closureContextValid;
        context.unexpectedClosed = deps.unexpectedClosed;
        context.dependencyReasons = deps.reasons;
        context.validUntil = deps.validUntil;
        context.observations = deps.observations;
        context.stockMask = deps.stockMask;
        context.nowTime = block.timestamp > type(uint64).max ? type(uint64).max : uint64(block.timestamp);
        context.executionReady = SWAP_EXECUTION_READY;

        ModePolicy.Decision memory decision = modeEvaluator.decide(context);

        PolicyView memory policy;
        policy.mode = decision.mode;
        policy.canSwap = decision.canSwap;
        policy.reasonBits = decision.reasons;
        if (!checkpoint && (decision.releaseLatch || decision.releaseRecovery)) {
            // The latch/candidate is still stored until the checkpoint commits the release. Do not advertise
            // the post-checkpoint mode or execution gate before that write.
            policy.mode = uint8(Mode.RECOVERING);
            policy.canSwap = false;
            policy.reasonBits = deps.reasons | ReasonBits.RECOVERY_PENDING;
        }
        // A pre-live pool has no actionable phase. Report the session phase only once LIVE so callers cannot
        // mistake a SETUP view for a tradable session.
        policy.phase =
            snapshot.lifecycle == uint8(Lifecycle.LIVE) && deps.phaseSet ? deps.phase : PolicyConstants.PHASE_UNKNOWN;
        policy.flags = 0;
        policy.lpFeeUnits = 0;
        policy.bandBps = 0;
        policy.effectiveTradeCap = [_tradeCap0, _tradeCap1];
        policy.effectiveWindowCap = [_windowCap0, _windowCap1];
        policy.rollingRemaining = [
            _rollingRemaining(_windowCap0, _buckets.currentGross[0], _buckets.previousGross[0]),
            _rollingRemaining(_windowCap1, _buckets.currentGross[1], _buckets.previousGross[1])
        ];
        policy.closureRemaining =
            [_closureRemaining(0, snapshot.closureNonce), _closureRemaining(1, snapshot.closureNonce)];
        policy.referencePrice18 = [uint128(0), uint128(0)];
        policy.validUntil =
            snapshot.lifecycle == uint8(Lifecycle.LIVE) && deps.validUntil != type(uint64).max ? deps.validUntil : 0;
        policy.closureNonce = snapshot.closureNonce;
        policy.configHash = configHash;

        PoolState memory nextState = _copyState(snapshot);
        nextState.mode = decision.mode;
        nextState.closedLatched = decision.latch;
        nextState.closureNonce = decision.closureNonce;
        nextState.reopenCandidateAt = decision.reopenCandidateAt;
        nextState.oldValidUntil = decision.oldValidUntil;
        nextState.reopenBaseObservations = decision.reopenBaseObservations;
        nextState.lastOpenObservations = decision.lastOpenObservations;
        if (deps.poolPauseOk) nextState.pauseNonce = deps.poolPauseNonce;

        // Hash the evaluated view (mode + live pool pause nonce) plus the consumed dependency snapshot, not just
        // the last persisted checkpoint, so a view before the next checkpoint is consistent with the policy it
        // returns and dependency changes are observable.
        PoolState memory hashState = snapshot;
        if (checkpoint) {
            hashState = nextState;
            policy.closureNonce = nextState.closureNonce;
        } else if (!decision.releaseLatch && !decision.releaseRecovery) {
            hashState.mode = policy.mode;
            hashState.reopenCandidateAt = decision.reopenCandidateAt;
            hashState.oldValidUntil = decision.oldValidUntil;
            hashState.reopenBaseObservations = decision.reopenBaseObservations;
            hashState.lastOpenObservations = decision.lastOpenObservations;
        }
        // A view-only release still hashes the persisted pre-release state: the projected RECOVERING mode with
        // already-cleared candidate fields is not a state that exists before `refreshState` commits it.
        if (deps.poolPauseOk) hashState.pauseNonce = deps.poolPauseNonce;
        policy.stateHash = _stateHash(hashState, deps.dependencyHash);

        evaluation.policy = policy;
        evaluation.decision = decision;
        evaluation.nextState = nextState;
    }

    /// @dev Read every dependency once and aggregate the reasons, phase, validity and observation hash. Failed
    /// reads contribute fixed sentinels, never uninitialized/partial returndata.
    function _evaluateDependencies() private view returns (DependencyEvaluation memory deps) {
        deps.validUntil = type(uint64).max;
        deps.phase = PolicyConstants.PHASE_UNKNOWN;
        bytes32 poolPauseObservation;

        // Internal times are uint64 UTC seconds. A timestamp outside that domain is a setup failure.
        if (block.timestamp > type(uint64).max) deps.reasons |= ReasonBits.SETUP;

        {
            (bool ok, bool paused, uint64 nonce) = _readPauseState(ModePolicy.targetId(1, address(this)));
            if (!ok) {
                deps.reasons |= ReasonBits.SETUP;
            } else {
                deps.poolPauseOk = true;
                deps.poolPauseNonce = nonce;
                poolPauseObservation = keccak256(abi.encode(paused, nonce));
                if (paused) deps.reasons |= ReasonBits.MANUAL_PAUSE;
            }
        }

        AssetEvaluation memory assetEvaluation0 = _evaluateAsset(_asset0, _token0);
        AssetEvaluation memory assetEvaluation1 = _evaluateAsset(_asset1, _token1);
        deps.reasons |= assetEvaluation0.reasons | assetEvaluation1.reasons;

        deps.stockMask =
            (assetEvaluation0.isStock ? uint8(1) : uint8(0)) | (assetEvaluation1.isStock ? uint8(2) : uint8(0));
        deps.observations[0] = assetEvaluation0.observation;
        deps.observations[1] = assetEvaluation1.observation;
        deps.healthySince[0] = assetEvaluation0.healthySince;
        deps.healthySince[1] = assetEvaluation1.healthySince;
        deps.anyPlannedClosed = assetEvaluation0.plannedClosed || assetEvaluation1.plannedClosed;
        deps.unexpectedClosed = assetEvaluation0.unexpectedClosed || assetEvaluation1.unexpectedClosed;
        deps.allLegsHealthy = assetEvaluation0.legHealthy && assetEvaluation1.legHealthy;
        deps.closureContextValid =
            deps.anyPlannedClosed && assetEvaluation0.closureContextOk && assetEvaluation1.closureContextOk;

        // A CLOSED stock next to a supported-active stock is a partial closure, not a phase conflict. Two
        // different supported-active phases remain a conflict.
        if (assetEvaluation0.isStock && assetEvaluation0.phaseSet) {
            deps.phase = assetEvaluation0.phase;
            deps.phaseSet = true;
        }
        if (assetEvaluation1.isStock && assetEvaluation1.phaseSet) {
            if (!deps.phaseSet) {
                deps.phase = assetEvaluation1.phase;
                deps.phaseSet = true;
            } else if (deps.phase != assetEvaluation1.phase) {
                if (
                    deps.phase == PolicyConstants.PHASE_CLOSED || assetEvaluation1.phase == PolicyConstants.PHASE_CLOSED
                ) {
                    deps.phase = PolicyConstants.PHASE_CLOSED;
                } else {
                    deps.reasons |= ReasonBits.CALENDAR_CONFLICT;
                }
            }
        }
        if (assetEvaluation0.validUntil < deps.validUntil) deps.validUntil = assetEvaluation0.validUntil;
        if (assetEvaluation1.validUntil < deps.validUntil) deps.validUntil = assetEvaluation1.validUntil;

        // A BELL pool without a stock session has no legitimate ACTIVE phase. Blocking is safer than inferring
        // a session from a quote asset.
        if (deps.stockMask == 0) deps.reasons |= ReasonBits.CALENDAR_MISSING;

        deps.dependencyHash = keccak256(
            abi.encode(assetEvaluation0.observationHash, assetEvaluation1.observationHash, poolPauseObservation)
        );
    }

    /// @dev Collect pause, fingerprint, calendar, anchor and health reasons for one configured asset. Every
    /// dependency read is a bounded staticcall and every failure becomes a normative blocking reason. A stock
    /// leg whose current leaf is a committed CLOSED interval is evaluated through its frozen anchor instead of
    /// the active-session freshness limits; all other live checks (pause, fingerprint, corporate, getter
    /// integrity) still apply.
    function _evaluateAsset(bytes32 assetId, address token) private view returns (AssetEvaluation memory result) {
        result.validUntil = type(uint64).max;
        AssetObservations memory observations;

        (bool pauseOk, bool paused, uint64 pauseNonce) = _readPauseState(ModePolicy.targetId(2, token));
        if (!pauseOk) {
            _addReason(result, ReasonBits.SETUP);
        } else {
            observations.pauseState = keccak256(abi.encode(paused, pauseNonce));
            if (paused) _addReason(result, ReasonBits.ASSET_PAUSE);
        }

        (bool descriptorOk, AssetDescriptor memory descriptor_) = _readDescriptor(assetId);
        if (descriptorOk) observations.descriptor = keccak256(abi.encode(descriptor_));
        if (!descriptorOk || descriptor_.id == bytes32(0) || descriptor_.token == address(0)) {
            // Missing descriptor data is a setup/dependency failure, not proof that the asset is healthy.
            _addReason(result, ReasonBits.SETUP);
        } else if (descriptor_.id != assetId || descriptor_.token != token) {
            _addReason(result, ReasonBits.FINGERPRINT_CHANGED);
        } else {
            result.isStock = descriptor_.isStock;
            result.closureContextOk = !descriptor_.isStock;
            if (
                descriptor_.expectedCodeHash != token.codehash || descriptor_.implementationFingerprint == bytes32(0)
                    || descriptor_.evidenceHash == bytes32(0)
            ) {
                _addReason(result, ReasonBits.FINGERPRINT_CHANGED);
            }

            if (descriptor_.isStock) {
                _evaluateStockCalendar(result, assetId, descriptor_, observations);
            }
        }

        if (descriptorOk && AssetPolicy.oraclelessCounterasset(descriptor_, _poolClass)) {
            // This leg has no price-health requirement. Its descriptor/fingerprint and token-pause
            // reasons above still block; only stock observations participate in bootstrap/recovery.
            result.legHealthy = true;
        } else {
            _evaluateAssetHealth(result, assetId, observations);
        }

        result.observationHash = keccak256(
            abi.encode(
                assetId,
                token,
                observations.pauseState,
                observations.descriptor,
                observations.calendar,
                observations.anchor,
                observations.health,
                observations.closedReport
            )
        );
    }

    /// @dev Calendar/anchor branch for a stock leg. A CLOSED leaf is evaluated as planned only through the
    /// canonical leaf hash and the stored anchor; every other branch retains the M05-02 capability checks.
    function _evaluateStockCalendar(
        AssetEvaluation memory result,
        bytes32 assetId,
        AssetDescriptor memory descriptor_,
        AssetObservations memory observations
    ) private view {
        (uint8 calendarStatus, CalendarLeaf memory interval) = _readCalendar(assetId);
        observations.calendar =
            calendarStatus == 0 ? keccak256(abi.encode(interval)) : keccak256(abi.encode(calendarStatus));
        if (calendarStatus == 1) {
            _addReason(result, ReasonBits.CALENDAR_MISSING);
            result.validUntil = 0;
            return;
        }
        if (calendarStatus == 2) {
            _addReason(result, ReasonBits.CALENDAR_CONFLICT);
            result.validUntil = 0;
            return;
        }

        result.phase = interval.phase;
        result.phaseSet = true;
        if (interval.phase == PolicyConstants.PHASE_CLOSED) {
            observations.anchor = _evaluatePlannedClosure(result, assetId, interval);
            return;
        }
        // forge-lint: disable-next-line(incorrect-shift)
        uint8 phaseBit = uint8(1 << interval.phase);
        if ((descriptor_.capabilityMask & phaseBit) == 0) {
            _addReason(result, ReasonBits.CALENDAR_CONFLICT);
            result.validUntil = 0;
            return;
        }
        result.closureContextOk = true;
        if (interval.end < result.validUntil) result.validUntil = interval.end;
    }

    /// @dev Active-session health read. A proven planned-closed stock is expected to have stale active data and
    /// its anchor status already re-read the live corporate getters, so that leg skips this read intentionally.
    function _evaluateAssetHealth(AssetEvaluation memory result, bytes32 assetId, AssetObservations memory observations)
        private
        view
    {
        bool skipHealth = result.isStock && result.phaseSet && result.phase == PolicyConstants.PHASE_CLOSED;
        if (skipHealth) return;

        (bool healthOk, HealthView memory health_) = _readHealth(assetId);
        if (!healthOk) {
            _addReason(result, ReasonBits.REPORT_INVALID_OR_STALE);
            result.validUntil = 0;
            return;
        }

        observations.health = keccak256(abi.encode(health_));
        _addReason(result, health_.reasonBits);
        if (ModePolicy.hasUnknownReason(health_.reasonBits)) {
            _addReason(result, ReasonBits.REPORT_INVALID_OR_STALE);
        }
        if (!health_.ready) {
            if (health_.reasonBits == 0) _addReason(result, ReasonBits.REPORT_INVALID_OR_STALE);
            result.validUntil = 0;
            return;
        }
        if (
            health_.reasonBits != 0 || health_.healthySince == 0 || health_.validUntil <= block.timestamp
                || health_.healthySince > block.timestamp || health_.baselineObservation == 0
                || health_.latestObservation == 0 || health_.baselineObservation > block.timestamp
                || health_.latestObservation > block.timestamp
        ) {
            _addReason(result, ReasonBits.REPORT_INVALID_OR_STALE);
        }
        if (health_.validUntil < result.validUntil) result.validUntil = health_.validUntil;
        if (result.reasons != 0) return;

        result.activeHealthy = true;
        result.legHealthy = true;
        result.healthySince = health_.healthySince;
        result.observation = health_.latestObservation;
        if (result.isStock) {
            _rejectUnexpectedClosedReport(result, assetId, health_.latestObservation, observations);
        }
    }

    /// @dev A fresh CLOSED report while the committed calendar says supported active is an unexpected closure,
    /// never permission to create an anchor or a new episode.
    function _rejectUnexpectedClosedReport(
        AssetEvaluation memory result,
        bytes32 assetId,
        uint64 activeObservation,
        AssetObservations memory observations
    ) private view {
        (bool sampleOk, SourceSample memory closedSample) = _readLatestSample(assetId, PolicyConstants.PHASE_CLOSED);
        observations.closedReport = keccak256(abi.encode(sampleOk, closedSample));
        if (!sampleOk) {
            _addReason(result, ReasonBits.REPORT_INVALID_OR_STALE);
            result.activeHealthy = false;
            result.legHealthy = false;
            return;
        }
        if (
            closedSample.phase == PolicyConstants.PHASE_CLOSED && closedSample.observedAt != 0
                && closedSample.observedAt <= block.timestamp
                && block.timestamp - closedSample.observedAt < PolicyConstants.MAX_REPORT_AGE_SECONDS
                && closedSample.observedAt >= activeObservation
        ) {
            result.unexpectedClosed = true;
            result.activeHealthy = false;
            result.legHealthy = false;
            _addReason(result, ReasonBits.UNEXPECTED_CLOSED);
        }
    }

    /// @dev Evaluate a CLOSED calendar leaf as a planned closure only when the stored anchor is bound to the
    /// canonical leaf hash, is still within its 96-hour input-age limit, has not crossed the close, and the
    /// committed neighbour is contiguous. Otherwise the leg is UNEXPECTED_CLOSED and cannot create a latch.
    function _evaluatePlannedClosure(AssetEvaluation memory result, bytes32 assetId, CalendarLeaf memory interval)
        private
        view
        returns (bytes32 anchorObservation)
    {
        bytes32 boundary = CalendarProof.hashLeaf(block.chainid, _calendarRegistry, interval);
        (bool anchorOk, uint256 anchorReasons, uint64 anchorValidUntil, Anchor memory anchor) =
            _readAnchorStatus(assetId, boundary);
        anchorObservation = keccak256(abi.encode(anchorOk, anchorReasons, anchorValidUntil, anchor));

        bool contextOk = anchorOk && anchorReasons == 0 && anchor.assetId == assetId && anchor.boundaryHash == boundary
            && anchor.price18 != 0 && anchor.multiplier18 != 0 && anchor.sourceHash != bytes32(0)
            && anchor.closureStart == interval.start && anchor.capturedAt < anchor.closureStart
            && anchor.observedAt <= anchor.capturedAt && anchor.inputAt <= anchor.capturedAt
            && anchor.inputAt <= block.timestamp && anchor.observedAt <= block.timestamp
            && anchorValidUntil > block.timestamp;

        if (contextOk) {
            (uint8 nextStatus, CalendarLeaf memory next) = _readNextCalendar(assetId);
            if (
                nextStatus == 2
                    || (nextStatus == 0
                        && (next.assetId != assetId
                            || next.start != interval.end
                            || next.end <= next.start
                            || next.phase < PolicyConstants.PHASE_PRE
                            || next.phase > PolicyConstants.PHASE_CLOSED
                            || next.provenanceHash == bytes32(0)))
            ) {
                contextOk = false;
                _addReason(result, ReasonBits.CALENDAR_CONFLICT);
            }
        }

        if (contextOk) {
            result.plannedClosed = true;
            result.closureContextOk = true;
            result.legHealthy = true;
            if (anchorValidUntil < result.validUntil) result.validUntil = anchorValidUntil;
            if (interval.end < result.validUntil) result.validUntil = interval.end;
        } else {
            result.unexpectedClosed = true;
            result.closureContextOk = false;
            _addReason(result, ReasonBits.UNEXPECTED_CLOSED);
            _addReason(result, anchorReasons == 0 ? ReasonBits.ANCHOR_MISSING_OR_EXPIRED : anchorReasons);
            result.validUntil = 0;
        }
    }

    function _addReason(AssetEvaluation memory result, uint256 reason) private pure {
        result.reasons |= reason;
    }

    /// @dev Bounded `pauseState(bytes32)` read. A malformed response (non-boolean paused word, out-of-range
    /// nonce, or paused with nonce zero) is a failed dependency read.
    function _readPauseState(bytes32 target) private view returns (bool success, bool paused, uint64 nonce) {
        bytes memory callData = abi.encodeWithSelector(ISafetyController.pauseState.selector, target);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        uint256 pausedWord;
        uint256 nonceWord;
        address controller = _safetyController;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(0x40, add(ptr, 64))
            success := staticcall(gasLimit, controller, add(callData, 32), mload(callData), ptr, 64)
            if iszero(eq(returndatasize(), 64)) { success := 0 }
            if success {
                pausedWord := mload(ptr)
                nonceWord := mload(add(ptr, 32))
            }
        }
        if (!success || pausedWord > 1 || nonceWord > type(uint64).max) return (false, false, 0);
        paused = pausedWord == 1;
        // SafetyController increments the pause nonce before setting paused=true.
        // forge-lint: disable-next-line(unsafe-typecast)
        nonce = uint64(nonceWord);
        if (paused && nonce == 0) return (false, false, 0);
    }

    /// @dev Bounded `descriptor(bytes32)` read into a fixed 13-word buffer. Malformed ABI/range values fail the
    /// read; well-formed identity mismatches are handled by `_evaluateAsset` as FINGERPRINT_CHANGED.
    function _readDescriptor(bytes32 assetId) private view returns (bool success, AssetDescriptor memory descriptor_) {
        bytes memory callData = abi.encodeWithSelector(IAssetRegistry.descriptor.selector, assetId);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        address registry = _assetRegistry;
        assembly ("memory-safe") {
            descriptor_ := mload(0x40)
            mstore(0x40, add(descriptor_, 416))
            success := staticcall(gasLimit, registry, add(callData, 32), mload(callData), descriptor_, 416)
            if iszero(eq(returndatasize(), 416)) { success := 0 }
            if success {
                if shr(160, mload(add(descriptor_, 32))) { success := 0 }
                if or(gt(mload(add(descriptor_, 64)), 1), gt(mload(add(descriptor_, 96)), 18)) { success := 0 }
                if and(mload(add(descriptor_, 128)), not(0x1e)) { success := 0 }
            }
        }
    }

    /// @dev Bounded `health(bytes32)` read into a fixed 6-word buffer. Unknown reason bits are retained by the
    /// caller but also force REPORT_INVALID_OR_STALE, so an unknown enum can never become healthy.
    function _readHealth(bytes32 assetId) private view returns (bool success, HealthView memory health_) {
        bytes memory callData = abi.encodeWithSelector(ISessionRegistry.health.selector, assetId);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        address registry = sessionRegistry;
        assembly ("memory-safe") {
            health_ := mload(0x40)
            mstore(0x40, add(health_, 192))
            success := staticcall(gasLimit, registry, add(callData, 32), mload(callData), health_, 192)
            if iszero(eq(returndatasize(), 192)) { success := 0 }
            if success {
                if or(
                    gt(mload(health_), 1),
                    or(
                        gt(mload(add(health_, 64)), 0xffffffffffffffff),
                        or(
                            gt(mload(add(health_, 96)), 0xffffffffffffffff),
                            or(
                                gt(mload(add(health_, 128)), 0xffffffffffffffff),
                                gt(mload(add(health_, 160)), 0xffffffffffffffff)
                            )
                        )
                    )
                ) { success := 0 }
            }
        }
    }

    /// @dev Bounded `currentInterval(bytes32)` read into a fixed 7-word buffer.
    /// @return status 0 = usable leaf, 1 = missing/expired coverage, 2 = conflict/malformed identity.
    function _readCalendar(bytes32 assetId) private view returns (uint8 status, CalendarLeaf memory interval) {
        bytes memory callData = abi.encodeWithSelector(ICalendarRegistry.currentInterval.selector, assetId);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        address registry = _calendarRegistry;
        bool success;
        assembly ("memory-safe") {
            interval := mload(0x40)
            mstore(0x40, add(interval, 224))
            success := staticcall(gasLimit, registry, add(callData, 32), mload(callData), interval, 224)
            if iszero(eq(returndatasize(), 224)) { success := 0 }
            if success {
                if or(
                    gt(mload(add(interval, 32)), 0xffffffff),
                    or(
                        gt(mload(add(interval, 64)), 0xffffffff),
                        or(
                            gt(mload(add(interval, 96)), 0xffffffffffffffff),
                            gt(mload(add(interval, 128)), 0xffffffffffffffff)
                        )
                    )
                ) { success := 0 }
                if gt(mload(add(interval, 160)), 0xff) { success := 0 }
            }
        }
        if (!success) return (1, interval);
        // CalendarRegistry returns a zero leaf when coverage is absent/expired.
        if (interval.assetId == bytes32(0) || interval.end <= interval.start) return (1, interval);
        if (interval.assetId != assetId) return (2, interval);
        if (interval.start > block.timestamp || interval.end <= block.timestamp) return (1, interval);
        if (interval.phase < PolicyConstants.PHASE_PRE || interval.phase > PolicyConstants.PHASE_CLOSED) {
            return (2, interval);
        }
        if (interval.provenanceHash == bytes32(0)) return (2, interval);
        return (0, interval);
    }

    /// @dev Bounded `nextInterval(bytes32)` read used to prove that a CLOSED leaf is followed by a contiguous
    /// committed interval. A zero leaf means coverage ends at the current leaf and is not itself a conflict.
    /// @return status 0 = usable neighbour, 1 = no neighbour/coverage end, 2 = malformed or non-contiguous.
    function _readNextCalendar(bytes32 assetId) private view returns (uint8 status, CalendarLeaf memory interval) {
        bytes memory callData = abi.encodeWithSelector(ICalendarRegistry.nextInterval.selector, assetId);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        address registry = _calendarRegistry;
        bool success;
        assembly ("memory-safe") {
            interval := mload(0x40)
            mstore(0x40, add(interval, 224))
            success := staticcall(gasLimit, registry, add(callData, 32), mload(callData), interval, 224)
            if iszero(eq(returndatasize(), 224)) { success := 0 }
            if success {
                if or(
                    gt(mload(add(interval, 32)), 0xffffffff),
                    or(
                        gt(mload(add(interval, 64)), 0xffffffff),
                        or(
                            gt(mload(add(interval, 96)), 0xffffffffffffffff),
                            gt(mload(add(interval, 128)), 0xffffffffffffffff)
                        )
                    )
                ) { success := 0 }
                if gt(mload(add(interval, 160)), 0xff) { success := 0 }
            }
        }
        if (!success) return (2, interval);
        if (interval.assetId == bytes32(0)) return (1, interval);
        if (
            interval.assetId != assetId || interval.end <= interval.start || interval.phase < PolicyConstants.PHASE_PRE
                || interval.phase > PolicyConstants.PHASE_CLOSED || interval.provenanceHash == bytes32(0)
        ) return (2, interval);
        return (0, interval);
    }

    /// @dev Bounded `anchorStatus(bytes32,bytes32)` read. `Anchor` is the first ABI return, so the fixed 384-byte
    /// buffer is a valid in-memory Anchor followed by the bool/reasons/validUntil words. A malformed or
    /// unavailable response is a failed read, never a valid zero anchor.
    function _readAnchorStatus(bytes32 assetId, bytes32 boundaryHash)
        private
        view
        returns (bool success, uint256 reasons, uint64 validUntil, Anchor memory anchor)
    {
        bytes memory callData = abi.encodeWithSelector(ISessionRegistry.anchorStatus.selector, assetId, boundaryHash);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        address registry = sessionRegistry;
        uint256 validWord;
        uint256 validUntilWord;
        assembly ("memory-safe") {
            anchor := mload(0x40)
            mstore(0x40, add(anchor, 384))
            success := staticcall(gasLimit, registry, add(callData, 32), mload(callData), anchor, 384)
            if iszero(eq(returndatasize(), 384)) { success := 0 }
            if success {
                validWord := mload(add(anchor, 288))
                reasons := mload(add(anchor, 320))
                validUntilWord := mload(add(anchor, 352))
                if or(
                    gt(validWord, 1),
                    or(
                        gt(validUntilWord, 0xffffffffffffffff),
                        or(
                            gt(mload(add(anchor, 64)), 0xffffffffffffffffffffffffffffffff),
                            or(
                                gt(mload(add(anchor, 96)), 0xffffffffffffffffffffffffffffffff),
                                or(
                                    gt(mload(add(anchor, 128)), 0xffffffffffffffff),
                                    or(
                                        gt(mload(add(anchor, 160)), 0xffffffffffffffff),
                                        or(
                                            gt(mload(add(anchor, 192)), 0xffffffffffffffff),
                                            gt(mload(add(anchor, 224)), 0xffffffffffffffff)
                                        )
                                    )
                                )
                            )
                        )
                    )
                ) { success := 0 }
            }
        }
        if (!success) return (false, 0, 0, anchor);
        // The trailing words were range-checked above.
        // forge-lint: disable-next-line(unsafe-typecast)
        validUntil = uint64(validUntilWord);
        success = validWord == 1;
    }

    /// @dev Bounded `latestSample(bytes32,uint8)` read used only to detect a fresh CLOSED report while the
    /// committed calendar still says supported active. A zero sample is a valid "no report" result.
    function _readLatestSample(bytes32 assetId, uint8 phase)
        private
        view
        returns (bool success, SourceSample memory sample)
    {
        bytes memory callData = abi.encodeWithSelector(ISessionRegistry.latestSample.selector, assetId, phase);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        address registry = sessionRegistry;
        assembly ("memory-safe") {
            sample := mload(0x40)
            mstore(0x40, add(sample, 320))
            success := staticcall(gasLimit, registry, add(callData, 32), mload(callData), sample, 320)
            if iszero(eq(returndatasize(), 320)) { success := 0 }
            if success {
                if or(
                    gt(mload(add(sample, 64)), 0xff),
                    gt(mload(add(sample, 96)), 0xffffffffffffffffffffffffffffffff)
                ) { success := 0 }
                if or(
                    or(
                        gt(mload(add(sample, 128)), 0xffffffffffffffff),
                        gt(mload(add(sample, 160)), 0xffffffffffffffff)
                    ),
                    or(
                        gt(mload(add(sample, 192)), 0xffffffffffffffff),
                        or(
                            gt(mload(add(sample, 224)), 0xffffffffffffffff),
                            gt(mload(add(sample, 256)), 0xffffffffffffffff)
                        )
                    )
                ) { success := 0 }
            }
        }
    }

    function _stateHash(PoolState memory snapshot, bytes32 dependencyHash) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                configHash, sessionRegistry, snapshot, _buckets, _episodeGross[snapshot.closureNonce], dependencyHash
            )
        );
    }

    /// @dev Explicit deep copy. Memory-to-memory struct assignment creates a reference in Solidity, so mutating
    /// `nextState` would otherwise corrupt the pre-release snapshot used by a view-only release hash.
    function _copyState(PoolState memory source) private pure returns (PoolState memory copy) {
        copy.lifecycle = source.lifecycle;
        copy.mode = source.mode;
        copy.closedLatched = source.closedLatched;
        copy.closureNonce = source.closureNonce;
        copy.reopenCandidateAt = source.reopenCandidateAt;
        copy.oldValidUntil = source.oldValidUntil;
        copy.reopenBaseObservations = source.reopenBaseObservations;
        copy.lastOpenObservations = source.lastOpenObservations;
        copy.pauseNonce = source.pauseNonce;
        copy.bellStart = source.bellStart;
        copy.corporateUntil = source.corporateUntil;
    }

    function _rollingRemaining(uint128 cap, uint128 currentGross, uint128 previousGross)
        private
        pure
        returns (uint128)
    {
        uint256 used = uint256(currentGross) + uint256(previousGross);
        if (used >= cap) return 0;
        // The branch above proves `used < cap <= type(uint128).max`, so this narrowing cast is safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        return cap - uint128(used);
    }

    function _closureRemaining(uint8 currency, uint64 nonce) private view returns (uint128) {
        if (nonce == 0) return 0;
        uint128 cap = currency == 0 ? _closureCap0 : _closureCap1;
        uint128 used = _episodeGross[nonce][currency];
        return used >= cap ? 0 : cap - used;
    }

    // -------------------------------------------------------------------------
    // Constructor validation
    // -------------------------------------------------------------------------

    function _validateDependencies(PoolConfig memory config_) private view {
        address manager = config_.poolManager;
        if (manager == address(0) || manager.code.length == 0) revert BadConfig(ERR_POOL_MANAGER);
        // A canonical PoolManager must answer the pinned IProtocolFees getter. A contract that merely has code
        // is not enough; an EOA or an unrelated dependency is rejected.
        _probeProtocolFeeController(manager);

        _requireContract(config_.positionManager, ERR_POSITION_MANAGER);
        _requireContract(config_.factory, ERR_FACTORY);
        _requireContract(config_.assetRegistry, ERR_ASSET_REGISTRY);
        _requireContract(config_.calendarRegistry, ERR_CALENDAR_REGISTRY);
        _requireContract(config_.safetyController, ERR_SAFETY_CONTROLLER);
        // PUBLIC pools may deliberately omit treasury routing. TREASURY_ONLY must point at executable code.
        // A configured non-zero adapter is still a dependency and must be a contract in either mode.
        if (config_.liquidityMode == uint8(LiquidityMode.TREASURY_ONLY)) {
            _requireContract(config_.treasuryAdapter, ERR_TREASURY_ADAPTER);
        } else if (config_.treasuryAdapter != address(0)) {
            _requireContract(config_.treasuryAdapter, ERR_TREASURY_ADAPTER);
        }
    }

    /// @dev Bounded interface probe. The staticcall is capped at MAX_STATIC_CALL_GAS and writes into a fixed
    /// 32-byte buffer; returndatasize must be exactly one canonical ABI address word. In particular, a manager
    /// returning a large payload must not force an unbounded Solidity bytes copy during construction.
    function _probeProtocolFeeController(address manager) private view {
        bool success;
        uint256 returnSize;
        uint256 controller;
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        bytes4 selector = PROTOCOL_FEE_CONTROLLER_SELECTOR;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, selector)
            success := staticcall(gasLimit, manager, ptr, 4, ptr, 32)
            returnSize := returndatasize()
            controller := mload(ptr)
            mstore(0x40, add(ptr, 32))
        }
        // This proves only that the configured manager answers the pinned getter with one canonical address
        // word. Canonical manager authenticity is an M06 deployment-manifest trust boundary, not something a
        // constructor can prove from an arbitrary address.
        if (!success || returnSize != 32 || controller >> 160 != 0) revert BadConfig(ERR_POOL_MANAGER);
    }

    function _validateConfig(PoolConfig memory config_, PoolKey memory key_) private view {
        // Token/asset identity, spacing and cap shape are immutable constructor invariants. Economic admission
        // (health, phase, activation bounds) remains an M06 check.
        if (config_.token0 == address(0) || config_.token1 == address(0) || config_.token0 >= config_.token1) {
            revert BadConfig(ERR_TOKENS);
        }
        if (config_.token0.code.length == 0 || config_.token1.code.length == 0) revert BadConfig(ERR_TOKENS);
        if (config_.tickSpacing != REQUIRED_TICK_SPACING) revert BadConfig(ERR_TICK_SPACING);
        if (config_.asset0 == bytes32(0) || config_.asset1 == bytes32(0)) revert BadConfig(ERR_ASSETS);
        // Non-zero is a structural check only. Policy/template authenticity is established by the official
        // factory/manifest (M02/M06), not by a non-zero bytes32 value.
        if (config_.policyId == bytes32(0)) revert BadConfig(ERR_POLICY_ID);
        if (config_.poolClass > uint8(PoolClass.SESSION_ONLY)) revert BadConfig(ERR_POOL_CLASS);
        if (config_.liquidityMode > uint8(LiquidityMode.TREASURY_ONLY)) revert BadConfig(ERR_LIQUIDITY_MODE);
        // referenceMode has no numeric enum in the pinned normative tables; M05-01 binds but does not interpret it.

        for (uint256 i; i < 2; ++i) {
            uint256 trade = config_.tradeCap[i];
            uint256 window = config_.windowCap[i];
            uint256 closure = config_.closureCap[i];
            if (trade == 0 || window == 0 || closure == 0 || trade > window) revert BadConfig(ERR_CAPS);
            // Widen before doubling: 2 * type(uint128).max does not fit uint128.
            uint256 maximumClosure = trade * 2;
            if (window < maximumClosure) maximumClosure = window;
            if (closure > maximumClosure) revert BadConfig(ERR_CAPS);
        }

        if (key_.fee != LPFeeLibrary.DYNAMIC_FEE_FLAG) revert BadConfig(ERR_POOL_FEE);
        // The template binds its own address; a pre-bound hooks field would create a CREATE2 prediction cycle.
        if (address(key_.hooks) != address(0)) revert BadConfig(ERR_POOL_KEY);
        if (
            Currency.unwrap(key_.currency0) != config_.token0 || Currency.unwrap(key_.currency1) != config_.token1
                || key_.tickSpacing != config_.tickSpacing
        ) revert BadConfig(ERR_POOL_KEY);
    }

    function _requireContract(address dependency, bytes32 reason) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert BadConfig(reason);
    }
}
