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
import {BellPolicyOracle} from "./BellPolicyOracle.sol";
import {IBellSwapEvaluator} from "./types/SwapEvaluation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
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

    /// @dev Swap enforcement is wired in `_beforeSwap`/`_afterSwap`. The policy evaluation lives in the
    /// immutable `BellPolicyOracle` so the hook itself stays inside the EIP-170 limit.
    bool private constant SWAP_EXECUTION_READY = true;

    BellModeEvaluator public immutable modeEvaluator;

    /// @notice Immutable per-pool policy evaluator. STATICCALL only: it can answer, never mutate or authorize.
    BellPolicyOracle public immutable policyOracle;

    bytes4 private constant PROTOCOL_FEE_CONTROLLER_SELECTOR = bytes4(keccak256("protocolFeeController()"));

    bytes32 private constant ERR_POLICY_ORACLE = keccak256("POLICY_ORACLE");
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

    /// @dev The in-flight swap snapshot, bound by `_beforeSwap` and consumed by `_afterSwap`. The callback
    /// hash is stored separately so a settled swap cannot be replayed and a stale snapshot cannot be reused.
    IBellSwapEvaluator.Snapshot private _swapSnapshot;
    bytes32 private _swapCallbackHash;

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

    constructor(
        PoolConfig memory config_,
        PoolKey memory key_,
        bytes32 templateCodeHash_,
        address sessionRegistry_,
        BellPolicyOracle policyOracle_
    ) BaseHook(IPoolManager(config_.poolManager)) {
        if (templateCodeHash_ == bytes32(0)) revert BadConfig(ERR_TEMPLATE_CODE_HASH);
        _validateDependencies(config_);
        _requireContract(sessionRegistry_, ERR_SESSION_REGISTRY);
        _validateConfig(config_, key_);
        // Reject malformed/unbounded dependencies before paying to construct the immutable calculator.
        modeEvaluator = new BellModeEvaluator();
        // One shared oracle per deployment keeps the hook initcode inside the EIP-3860 limit.
        if (address(policyOracle_).code.length == 0) revert BadConfig(ERR_POLICY_ORACLE);
        policyOracle = policyOracle_;
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

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requireBoundKey(key);
        if (hookData.length != 0) revert ContextMismatch();
        bytes32 callbackHash = keccak256(abi.encode(msg.sender, key, params));
        (uint160 preSqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, key.toId());
        _swapSnapshot = policyOracle.prepareSwap(
            _policyInput(),
            preSqrtPriceX96,
            [_readDecimals(_token0), _readDecimals(_token1)],
            callbackHash,
            params.zeroForOne,
            params.amountSpecified,
            address(modeEvaluator)
        );
        _swapCallbackHash = callbackHash;
        return (
            IHooks.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            _swapSnapshot.lpFeeUnits | LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }

    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        _requireBoundKey(key);
        if (hookData.length != 0) revert ContextMismatch();
        bytes32 callbackHash = _swapCallbackHash;
        if (callbackHash == bytes32(0)) revert ContextMismatch();
        _settleSwap(key, callbackHash, delta);
        return (IHooks.afterSwap.selector, 0);
    }

    /// @dev Split out so the callback frame stays shallow: the settlement arithmetic lives in the evaluator,
    /// reached through the oracle. The hook performs both storage writes itself.
    function _settleSwap(PoolKey calldata key, bytes32 callbackHash, BalanceDelta delta) private {
        IBellSwapEvaluator.Snapshot memory snapshot = _swapSnapshot;
        (uint160 postSqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, key.toId());
        (Buckets memory nextBuckets, uint128[2] memory nextEpisode,) = policyOracle.settleSwap(
            snapshot,
            callbackHash,
            uint64(block.timestamp),
            postSqrtPriceX96,
            delta.amount0(),
            delta.amount1(),
            _buckets,
            _episodeGross[snapshot.context.closureNonce],
            address(modeEvaluator)
        );
        _buckets = nextBuckets;
        if (snapshot.context.closedLatched) {
            _episodeGross[snapshot.context.closureNonce] = nextEpisode;
        }
        delete _swapSnapshot;
        _swapCallbackHash = bytes32(0);
    }

    function _readDecimals(address token) private view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || data.length != 32) revert BadConfig(ERR_TOKENS);
        uint256 value = abi.decode(data, (uint256));
        if (value > PolicyConstants.MAX_TOKEN_DECIMALS) revert BadConfig(ERR_TOKENS);
        return uint8(value);
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
        BellPolicyOracle.DependencyEvaluation memory bootstrap = policyOracle.bootstrap(_policyInput());
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
    /// @dev Single canonical evaluator, delegated to the immutable BellPolicyOracle via STATICCALL.
    /// The hook still owns every write: the oracle only aggregates dependency reasons and the ModePolicy
    /// decision, and this function still decides the checkpoint projection and the state hash.
    function _evaluatePolicy(bool checkpoint) private view returns (PolicyEvaluation memory evaluation) {
        PoolState memory snapshot = _state;
        BellPolicyOracle.Output memory o = _runOracle(snapshot);

        evaluation.policy = _projectPolicy(o, checkpoint);
        evaluation.decision = _projectDecision(o);
        evaluation.nextState = _projectState(snapshot, o, evaluation.decision);
        evaluation.policy.stateHash = _stateHash(
            _hashState(snapshot, evaluation.nextState, o, evaluation.policy, evaluation.decision, checkpoint),
            o.dependencyHash
        );
        if (checkpoint) evaluation.policy.closureNonce = evaluation.nextState.closureNonce;
    }

    function _runOracle(PoolState memory snapshot) private view returns (BellPolicyOracle.Output memory) {
        return policyOracle.evaluate(
            _policyInput(), _buckets.currentGross, _buckets.previousGross, _episodeGross[snapshot.closureNonce]
        );
    }

    /// @dev View projection. A view-only latch/recovery release is reported as RECOVERING with the execution gate
    /// closed, because the post-checkpoint mode does not exist until `refreshState` commits it.
    function _projectPolicy(BellPolicyOracle.Output memory o, bool checkpoint)
        private
        pure
        returns (PolicyView memory policy)
    {
        policy.mode = o.mode;
        policy.canSwap = o.canSwap;
        policy.reasonBits = o.reasonBits;
        if (!checkpoint && (o.releaseLatch || o.releaseRecovery)) {
            policy.mode = uint8(Mode.RECOVERING);
            policy.canSwap = false;
            policy.reasonBits = o.reasonBits | ReasonBits.RECOVERY_PENDING;
        }
        policy.phase = o.phase;
        policy.flags = o.flags;
        policy.lpFeeUnits = o.lpFeeUnits;
        policy.bandBps = o.bandBps;
        policy.effectiveTradeCap = o.effectiveTradeCap;
        policy.effectiveWindowCap = o.effectiveWindowCap;
        policy.rollingRemaining = o.rollingRemaining;
        policy.closureRemaining = o.closureRemaining;
        policy.referencePrice18 = o.referencePrice18;
        policy.validUntil = o.validUntil;
        policy.closureNonce = o.closureNonce;
        policy.configHash = o.configHash;
    }

    function _projectDecision(BellPolicyOracle.Output memory o) private pure returns (ModePolicy.Decision memory decision) {
        decision.mode = o.decisionMode;
        decision.canSwap = o.canSwap;
        decision.reasons = o.reasonBits;
        decision.latch = o.latch;
        decision.closureNonce = o.decisionClosureNonce;
        decision.beginLatch = o.beginLatch;
        decision.releaseLatch = o.releaseLatch;
        decision.releaseRecovery = o.releaseRecovery;
        decision.reopenCandidateAt = o.reopenCandidateAt;
        decision.oldValidUntil = o.oldValidUntil;
        decision.reopenBaseObservations = o.reopenBaseObservations;
        decision.lastOpenObservations = o.lastOpenObservations;
    }

    function _projectState(
        PoolState memory snapshot,
        BellPolicyOracle.Output memory o,
        ModePolicy.Decision memory decision
    ) private pure returns (PoolState memory nextState) {
        nextState = _copyState(snapshot);
        nextState.mode = decision.mode;
        nextState.closedLatched = decision.latch;
        nextState.closureNonce = decision.closureNonce;
        nextState.reopenCandidateAt = decision.reopenCandidateAt;
        nextState.oldValidUntil = decision.oldValidUntil;
        nextState.reopenBaseObservations = decision.reopenBaseObservations;
        nextState.lastOpenObservations = decision.lastOpenObservations;
        if (o.poolPauseOk) nextState.pauseNonce = o.pauseNonce;
    }

    /// @dev The hash binds the state that will be persisted after a checkpoint, or the projected pre-release
    /// state for a view. A view-only release keeps the persisted candidate fields, matching the reference FSM.
    function _hashState(
        PoolState memory snapshot,
        PoolState memory nextState,
        BellPolicyOracle.Output memory o,
        PolicyView memory policy,
        ModePolicy.Decision memory decision,
        bool checkpoint
    ) private pure returns (PoolState memory hashState) {
        if (checkpoint) {
            // The checkpoint persists nextState, so the hash must bind what is actually written.
            hashState = nextState;
            return hashState;
        }
        hashState = snapshot;
        if (!decision.releaseLatch && !decision.releaseRecovery) {
            hashState.mode = policy.mode;
            hashState.reopenCandidateAt = decision.reopenCandidateAt;
            hashState.oldValidUntil = decision.oldValidUntil;
            hashState.reopenBaseObservations = decision.reopenBaseObservations;
            hashState.lastOpenObservations = decision.lastOpenObservations;
        }
        if (o.poolPauseOk) hashState.pauseNonce = o.pauseNonce;
    }

    /// @dev Builds the immutable-input envelope the oracle needs. The hook's own state is read here so the
    /// oracle never reads storage it does not own.
    function _policyInput() private view returns (BellPolicyOracle.Input memory input) {
        input.configHash = configHash;
        input.poolId = poolId;
        input.hook = address(this);
        input.token0 = _token0;
        input.token1 = _token1;
        input.asset0 = _asset0;
        input.asset1 = _asset1;
        input.assetRegistry = _assetRegistry;
        input.calendarRegistry = _calendarRegistry;
        input.safetyController = _safetyController;
        input.sessionRegistry = sessionRegistry;
        input.poolClass = _poolClass;
        input.referenceMode = _referenceMode;
        input.executionReady = SWAP_EXECUTION_READY;
        input.nowTime = block.timestamp > type(uint64).max ? type(uint64).max : uint64(block.timestamp);
        input.bellStart = _state.bellStart;
        input.corporateUntil = _state.corporateUntil;
        input.tradeCap = [_tradeCap0, _tradeCap1];
        input.windowCap = [_windowCap0, _windowCap1];
        input.closureCap = [_closureCap0, _closureCap1];
        input.state = _state;
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
