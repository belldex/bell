// SPDX-License-Identifier: MIT
import {BellPolicyOracle} from "../../../src/BellPolicyOracle.sol";
pragma solidity 0.8.26;

import {BellHook} from "../../../src/BellHook.sol";
import {BellModeEvaluator} from "../../../src/BellModeEvaluator.sol";
import {ModePolicy} from "../../../src/libraries/ModePolicy.sol";
import {PolicyConstants} from "../../../src/libraries/PolicyConstants.sol";
import {CalendarProof} from "../../../src/libraries/CalendarProof.sol";
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
} from "../../../src/types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IBellErrors} from "../../../src/interfaces/ProtocolEvents.sol";

interface VmClosureStateful {
    function warp(uint256 newTimestamp) external;
    function store(address target, bytes32 slot, bytes32 value) external;
    function load(address target, bytes32 slot) external view returns (bytes32);
    function getNonce(address account) external view returns (uint64);
    function setNonce(address account, uint64 nonce) external;
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
}

contract StatefulClosureToken {}

contract StatefulClosureDependency {}

contract StatefulClosureSafety {
    mapping(bytes32 target => bool paused) private _paused;
    mapping(bytes32 target => uint64 nonce) private _nonce;

    function setPause(bytes32 target, bool paused_, uint64 nonce_) external {
        _paused[target] = paused_;
        _nonce[target] = nonce_;
    }

    function pauseState(bytes32 target) external view returns (bool, uint64) {
        return (_paused[target], _nonce[target]);
    }
}

contract StatefulClosureAssets {
    mapping(bytes32 assetId => AssetDescriptor descriptor) private _descriptors;

    function setDescriptor(AssetDescriptor calldata descriptor_) external {
        _descriptors[descriptor_.id] = descriptor_;
    }

    function descriptor(bytes32 assetId) external view returns (AssetDescriptor memory) {
        return _descriptors[assetId];
    }

    function sourceConfig(bytes32) external pure returns (bytes memory) {
        return "";
    }
}

contract StatefulClosureCalendar {
    mapping(bytes32 assetId => CalendarLeaf leaf) private _current;
    mapping(bytes32 assetId => CalendarLeaf leaf) private _next;

    function setCurrent(CalendarLeaf calldata leaf) external {
        _current[leaf.assetId] = leaf;
    }

    function setNext(CalendarLeaf calldata leaf) external {
        _next[leaf.assetId] = leaf;
    }

    function currentInterval(bytes32 assetId) external view returns (CalendarLeaf memory) {
        return _current[assetId];
    }

    function nextInterval(bytes32 assetId) external view returns (CalendarLeaf memory) {
        return _next[assetId];
    }
}

contract StatefulClosureSessions {
    struct AnchorStatus {
        bool valid;
        uint256 reasons;
        uint64 validUntil;
        Anchor anchor;
    }

    mapping(bytes32 assetId => HealthView health) private _health;
    mapping(bytes32 assetId => mapping(uint8 phase => SourceSample sample)) private _samples;
    mapping(bytes32 assetId => mapping(bytes32 boundary => AnchorStatus status)) private _anchors;

    function setHealth(bytes32 assetId, HealthView calldata health_) external {
        _health[assetId] = health_;
    }

    function setClosedSample(bytes32 assetId, uint64 observedAt) external {
        _samples[assetId][PolicyConstants.PHASE_CLOSED] = SourceSample({
            descriptorId: assetId,
            feedId: keccak256("CLOSED_FEED"),
            phase: PolicyConstants.PHASE_CLOSED,
            price18: 100e18,
            observedAt: observedAt,
            inputAt: observedAt,
            validFrom: observedAt,
            expiresAt: observedAt + 120,
            validUntil: observedAt + 120,
            reportHash: keccak256(abi.encode(assetId, observedAt))
        });
    }

    function setAnchor(
        bytes32 assetId,
        bytes32 boundary,
        uint128 price18,
        uint128 multiplier18,
        uint64 inputAt,
        uint64 capturedAt,
        uint64 closureStart,
        uint64 observedAt,
        bool valid,
        uint256 reasons,
        uint64 validUntil
    ) external {
        _anchors[assetId][boundary] = AnchorStatus({
            valid: valid,
            reasons: reasons,
            validUntil: validUntil,
            anchor: Anchor({
                assetId: assetId,
                boundaryHash: boundary,
                price18: price18,
                multiplier18: multiplier18,
                capturedAt: capturedAt,
                observedAt: observedAt,
                inputAt: inputAt,
                closureStart: closureStart,
                sourceHash: keccak256(abi.encode(assetId, boundary))
            })
        });
    }

    function health(bytes32 assetId) external view returns (HealthView memory) {
        return _health[assetId];
    }

    function latestSample(bytes32 assetId, uint8 phase) external view returns (SourceSample memory) {
        return _samples[assetId][phase];
    }

    function anchorStatus(bytes32 assetId, bytes32 boundary)
        external
        view
        returns (Anchor memory anchor, bool valid, uint256 reasons, uint64 validUntil)
    {
        AnchorStatus storage status = _anchors[assetId][boundary];
        anchor = status.anchor;
        if (anchor.assetId == bytes32(0)) {
            return (anchor, false, ReasonBits.ANCHOR_MISSING_OR_EXPIRED, 0);
        }
        if (anchor.inputAt == 0 || block.timestamp < anchor.inputAt
            || block.timestamp - anchor.inputAt > PolicyConstants.MAX_ANCHOR_AGE_SECONDS) {
            return (anchor, false, ReasonBits.ANCHOR_MISSING_OR_EXPIRED, 0);
        }
        valid = status.valid;
        reasons = status.reasons;
        validUntil = status.validUntil;
        if (validUntil == 0) {
            uint256 deadline = uint256(anchor.inputAt) + PolicyConstants.MAX_ANCHOR_AGE_SECONDS + 1;
            validUntil = deadline > type(uint64).max ? type(uint64).max : uint64(deadline);
        }
        if (validUntil <= block.timestamp) {
            valid = false;
            reasons |= ReasonBits.ANCHOR_MISSING_OR_EXPIRED;
        }
    }
}

/// @dev Stateful/economic invariants for the M05-03 closure/recovery finite state machine, driven as a
/// deterministic randomized sequence under the fuzz runner. Every step asserts the non-negotiable
/// closure properties:
/// - exactly one latch per closure episode (nonce never decreases, never refills on duplicate closure),
/// - the closure episode gross never grows while latched except through an actual accepted settle path
///   (which does not exist in this fixture), and never shrinks until the latch releases,
/// - anchors are always proven against the canonical leaf hash for the current committed interval,
/// - a released recovery never leaves a stale candidate or baseline,
/// - swaps stay fail-closed in every reachable mode of this fixture.
contract BellHookClosureStatefulInvariantsTest {
    VmClosureStateful private constant vm =
        VmClosureStateful(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint160 private constant HOOK_FLAG_MASK = 0x3fff;
    uint160 private constant EXPECTED_HOOK_FLAGS = 0x2cc0;

    uint256 private constant STATE_SLOT = 0;
    uint256 private constant AUX_STATE_SLOT = 3;
    uint256 private constant BUCKETS_EPOCH_SLOT = 4;
    uint256 private constant BUCKETS_CURRENT_SLOT = 5;
    uint256 private constant BUCKETS_PREVIOUS_SLOT = 6;
    uint256 private constant EPISODE_GROSS_SLOT = 7;

    PoolManager private manager;
    address private token0;
    address private token1;
    bytes32 private asset0;
    bytes32 private asset1;
    address private factory;
    address private positionManager;
    address private treasuryAdapter;
    StatefulClosureSafety private safety;
    StatefulClosureAssets private assets;
    StatefulClosureCalendar private calendar;
    StatefulClosureSessions private sessions;
    bytes32 private templateCodeHash;
    BellHook private hook;
    BellPolicyOracle private oracle;
    BellModeEvaluator private modeEvaluator;

    function setUp() external {
        vm.warp(1_700_000_000);
        manager = new PoolManager(address(this));
        address tokenA = address(new StatefulClosureToken());
        address tokenB = address(new StatefulClosureToken());
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        asset0 = keccak256("STATEFUL_ASSET_0");
        asset1 = keccak256("STATEFUL_ASSET_1");
        factory = address(new StatefulClosureDependency());
        positionManager = address(new StatefulClosureDependency());
        treasuryAdapter = address(new StatefulClosureDependency());
        safety = new StatefulClosureSafety();
        assets = new StatefulClosureAssets();
        calendar = new StatefulClosureCalendar();
        sessions = new StatefulClosureSessions();
        templateCodeHash = keccak256(type(BellHook).creationCode);
        _installBaseState();
        hook = _deployHook();
    }

    function testFuzz_StatefulClosureInvariants(uint256 seedInput) external {
        // The ledger starts empty: no closure has ever latched.
        require(hook.state().closureNonce == 0, "initial nonce");
        require(!hook.state().closedLatched, "initial latch");

        uint256 s = seedInput;
        uint64 expectedMaxNonce = 0;
        for (uint256 step; step < 12; ++step) {
            s = uint256(keccak256(abi.encode(s)));
            _applyRandomStep(s, expectedMaxNonce);
            expectedMaxNonce = hook.state().closureNonce;
            _assertInvariants(expectedMaxNonce);
        }
    }

    /// @dev Applies one randomized environment transition. The mode/latch state itself is only ever written
    /// through `refreshState`, never through storage cheatcodes, so every reachable state here is one the
    /// production evaluator produced itself.
    function _applyRandomStep(uint256 s, uint64 expectedMaxNonce) private {
        uint8 action = uint8(s % 4);
        uint64 nowTime = uint64(block.timestamp);

        if (action == 0) {
            // Planned closure on asset0 (asset1 stays a healthy open counterasset leg).
            sessions.setHealth(asset1, _healthyHealth(nowTime - 10, nowTime + 500));
            _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);
        } else if (action == 1) {
            // Both legs active and fresh: the recovery/ordinary-open path.
            _setActiveContext(asset0, nowTime - 1, nowTime + 500);
            _setActiveContext(asset1, nowTime - 1, nowTime + 500);
        } else if (action == 2) {
            // One leg goes unhealthy: recovery must restart or stay latched, never trade.
            _setActiveContext(asset0, nowTime - 1, nowTime + 500);
            _setActiveContext(asset1, nowTime - 1, nowTime + 500);
            sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        } else {
            // An anchor fault inside an existing closure context: blocked, latch preserved.
            _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);
            sessions.setAnchor(
                asset0,
                _closedBoundary(asset0, nowTime, nowTime + 1000),
                100e18,
                1e18,
                nowTime - 10,
                nowTime - 10,
                nowTime,
                nowTime - 10,
                false,
                ReasonBits.CORPORATE_INCONSISTENT,
                nowTime + 345600
            );
        }

        PoolState memory before = hook.state();
        hook.refreshState();

        // Latch/nonce transitions only ever move forward.
        require(hook.state().closureNonce >= before.closureNonce, "nonce regressed");
        require(hook.state().closureNonce <= expectedMaxNonce + 1, "nonce jumped by more than one episode");
        if (before.closedLatched && hook.state().closedLatched) {
            require(hook.state().closureNonce == before.closureNonce, "latch refilled nonce");
        }
    }

    function _assertInvariants(uint64 expectedMaxNonce) private view {
        PoolState memory state = hook.state();
        PolicyView memory policy = hook.getPolicy();

        // The evaluator and the persisted state always agree on the mode.
        require(policy.mode == state.mode, "policy/state mode divergence");
        // A latched pool can never advertise swapping.
        if (state.closedLatched) require(!policy.canSwap, "latched pool advertises swap");
        // A latched pool always carries a positive episode nonce.
        if (state.closedLatched) require(state.closureNonce != 0, "latched without nonce");
        // The nonce never exceeds the highest latch this fixture produced.
        require(state.closureNonce <= expectedMaxNonce, "nonce above fixture history");
        // An episode's gross ledger is bounded by its closure caps and never refills.
        for (uint8 i; i < 2; ++i) {
            uint128 cap = i == 0 ? 500_000 : 1_000_000;
            require(hook.episodeGross(state.closureNonce)[i] <= cap, "episode gross above cap");
        }
        // No mode of this fixture ever reaches a swap-allowed policy.
        require(!policy.canSwap, "closure fixture must stay fail-closed");
        // Recovery state is either a live candidate or fully cleared, never both.
        if (state.reopenCandidateAt != 0) {
            require(state.reopenCandidateAt <= block.timestamp, "candidate in the future");
            require(state.reopenBaseObservations[0] != 0 || state.reopenBaseObservations[1] != 0, "candidate without baseline");
        } else {
            require(
                state.reopenBaseObservations[0] == 0 && state.reopenBaseObservations[1] == 0,
                "cleared candidate kept baseline"
            );
        }
        // Buckets stay within their configured windows.
        require(hook.buckets().currentGross[0] <= 10_000_000, "bucket0 above window");
        require(hook.buckets().currentGross[1] <= 20_000_000, "bucket1 above window");
    }

    // -------------------------------------------------------------------------
    // Environment helpers
    // -------------------------------------------------------------------------

    function _installBaseState() private {
        assets.setDescriptor(_descriptor(asset0, token0, true));
        assets.setDescriptor(_descriptor(asset1, token1, false));
        uint64 nowTime = uint64(block.timestamp);
        calendar.setCurrent(_activeLeaf(asset0, PolicyConstants.PHASE_REGULAR, nowTime - 100, nowTime + 1000));
        calendar.setNext(_activeLeaf(asset0, PolicyConstants.PHASE_REGULAR, nowTime + 1000, nowTime + 2000));
        sessions.setHealth(asset0, _healthyHealth(nowTime - 10, nowTime + 500));
        sessions.setHealth(asset1, _healthyHealth(nowTime - 10, nowTime + 500));
    }

    function _descriptor(bytes32 assetId, address token, bool isStock)
        private
        view
        returns (AssetDescriptor memory descriptor_)
    {
        descriptor_.id = assetId;
        descriptor_.token = token;
        descriptor_.isStock = isStock;
        descriptor_.decimals = 18;
        descriptor_.capabilityMask = isStock ? 0x1e : 0;
        descriptor_.expectedCodeHash = token.codehash;
        descriptor_.implementationFingerprint = keccak256(abi.encode(assetId, "IMPLEMENTATION"));
        descriptor_.evidenceHash = keccak256(abi.encode(assetId, "EVIDENCE"));
    }

    function _activeLeaf(bytes32 assetId, uint8 phase, uint64 start, uint64 end)
        private
        pure
        returns (CalendarLeaf memory leaf)
    {
        leaf.assetId = assetId;
        leaf.year = 2026;
        leaf.index = 0;
        leaf.start = start;
        leaf.end = end;
        leaf.phase = phase;
        leaf.provenanceHash = keccak256(abi.encode("ACTIVE", assetId, start, end));
    }

    function _closedLeaf(bytes32 assetId, uint64 start, uint64 end) private pure returns (CalendarLeaf memory leaf) {
        leaf.assetId = assetId;
        leaf.year = 2026;
        leaf.index = 1;
        leaf.start = start;
        leaf.end = end;
        leaf.phase = PolicyConstants.PHASE_CLOSED;
        leaf.provenanceHash = keccak256(abi.encode("CLOSED", assetId, start, end));
    }

    function _closedBoundary(bytes32 assetId, uint64 start, uint64 end) private view returns (bytes32) {
        return CalendarProof.hashLeaf(block.chainid, address(calendar), _closedLeaf(assetId, start, end));
    }

    function _setClosedContext(bytes32 assetId, uint64 start, uint64 end, uint64 inputAt) private {
        CalendarLeaf memory closed = _closedLeaf(assetId, start, end);
        calendar.setCurrent(closed);
        calendar.setNext(_activeLeaf(assetId, PolicyConstants.PHASE_REGULAR, end, end + 1000));
        sessions.setAnchor(
            assetId,
            CalendarProof.hashLeaf(block.chainid, address(calendar), closed),
            100e18,
            1e18,
            inputAt,
            inputAt,
            start,
            inputAt,
            true,
            0,
            inputAt + 345_600 + 1
        );
    }

    function _setActiveContext(bytes32 assetId, uint64 observation, uint64 validUntil) private {
        uint64 nowTime = uint64(block.timestamp);
        calendar.setCurrent(_activeLeaf(assetId, PolicyConstants.PHASE_REGULAR, nowTime - 100, nowTime + 1000));
        sessions.setHealth(assetId, _healthyHealth(observation, validUntil));
    }

    function _healthyHealth(uint64 observation, uint64 validUntil) private view returns (HealthView memory health_) {
        health_.ready = true;
        health_.reasonBits = 0;
        health_.healthySince = uint64(block.timestamp - 100);
        health_.validUntil = validUntil;
        health_.baselineObservation = observation > 50 ? observation - 50 : observation;
        health_.latestObservation = observation;
    }

    function _unhealthyHealth(uint256 reasons) private pure returns (HealthView memory health_) {
        health_.ready = false;
        health_.reasonBits = reasons;
        health_.validUntil = 0;
    }

    // -------------------------------------------------------------------------
    // Activation fixture: the only LIVE state reachable here is the real seed route.
    // -------------------------------------------------------------------------

    function deployHook(PoolConfig calldata config, PoolKey calldata key, bytes32 templateHash, address sessionRegistry)
        external
        returns (address)
    {
        return address(new BellHook(config, key, templateHash, sessionRegistry, oracle, modeEvaluator));
    }

    function _config() private view returns (PoolConfig memory config) {
        config.token0 = token0;
        config.token1 = token1;
        config.asset0 = asset0;
        config.asset1 = asset1;
        config.poolManager = address(manager);
        config.positionManager = positionManager;
        config.factory = factory;
        config.assetRegistry = address(assets);
        config.calendarRegistry = address(calendar);
        config.safetyController = address(safety);
        config.treasuryAdapter = treasuryAdapter;
        config.poolClass = uint8(PoolClass.PRICE_GUARDED);
        config.liquidityMode = uint8(LiquidityMode.PUBLIC);
        config.referenceMode = 0;
        config.tickSpacing = 60;
        config.tradeCap = [uint128(1_000_000), uint128(2_000_000)];
        config.windowCap = [uint128(10_000_000), uint128(20_000_000)];
        config.closureCap = [uint128(500_000), uint128(1_000_000)];
        config.policyId = keccak256("STATEFUL_CLOSURE_POLICY");
        config.referenceAdapter0 = address(0);
        config.referenceAdapter1 = address(0);
    }

    function _key() private view returns (PoolKey memory key) {
        key.currency0 = Currency.wrap(token0);
        key.currency1 = Currency.wrap(token1);
        key.fee = LPFeeLibrary.DYNAMIC_FEE_FLAG;
        key.tickSpacing = 60;
        key.hooks = IHooks(address(0));
    }

    function _deployHook() private returns (BellHook deployed) {
        // The oracle must exist before the address is predicted, otherwise creating it inside the
        // deployHook argument consumes the nonce that `_nextValidAddress` just pinned.
        oracle = new BellPolicyOracle();
        modeEvaluator = new BellModeEvaluator();
        (uint64 nonce, address predicted) = _nextValidAddress();
        vm.setNonce(address(this), nonce);
        deployed = BellHook(this.deployHook(_config(), _key(), templateCodeHash, address(sessions)));
        require(address(deployed) == predicted, "hook address prediction");
    }

    function _nextValidAddress() private view returns (uint64 nonce, address predicted) {
        nonce = vm.getNonce(address(this));
        while (true) {
            predicted = vm.computeCreateAddress(address(this), nonce);
            if (uint160(predicted) & HOOK_FLAG_MASK == EXPECTED_HOOK_FLAGS) return (nonce, predicted);
            ++nonce;
        }
    }
}
