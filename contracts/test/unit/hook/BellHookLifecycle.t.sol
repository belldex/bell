// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHook} from "../../../src/BellHook.sol";
import {SafetyController} from "../../../src/SafetyController.sol";
import {ModePolicy} from "../../../src/libraries/ModePolicy.sol";
import {PolicyConstants} from "../../../src/libraries/PolicyConstants.sol";
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
import {IBellErrors} from "../../../src/interfaces/ProtocolEvents.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface VmBellHookLifecycle {
    function warp(uint256 newTimestamp) external;
    function store(address target, bytes32 slot, bytes32 value) external;
    function load(address target, bytes32 slot) external view returns (bytes32);
    function getNonce(address account) external view returns (uint64);
    function setNonce(address account, uint64 nonce) external;
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function expectRevert(bytes calldata data) external;
    function prank(address sender) external;
}

contract MockHookToken {}

contract MockHookDependency {}

contract MockHookPositionManager {
    address public originalSender;

    function setOriginalSender(address sender) external { originalSender = sender; }
    function msgSender() external view returns (address) { return originalSender; }
}

contract MockSafetyController {
    mapping(bytes32 target => bool paused) private _paused;
    mapping(bytes32 target => uint64 nonce) private _nonce;
    mapping(bytes32 target => uint8 mode) private _malformed;
    bool public revertReads;

    function setPause(bytes32 target, bool paused_, uint64 nonce_) external {
        _paused[target] = paused_;
        _nonce[target] = nonce_;
    }

    function setMalformed(bytes32 target, uint8 mode) external {
        _malformed[target] = mode;
    }

    function setRevertReads(bool value) external {
        revertReads = value;
    }

    function pauseState(bytes32 target) external view returns (bool, uint64) {
        if (revertReads) revert("SAFETY_READ");
        uint8 mode = _malformed[target];
        if (mode == 1) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(0, 0x20)
            }
        }
        if (mode == 2) {
            assembly ("memory-safe") {
                mstore(0, 2)
                mstore(32, 1)
                return(0, 0x40)
            }
        }
        if (mode == 3) {
            assembly ("memory-safe") {
                mstore(0, 0)
                mstore(32, shl(64, 1))
                return(0, 0x40)
            }
        }
        return (_paused[target], _nonce[target]);
    }
}

contract MockAssetRegistry {
    mapping(bytes32 assetId => AssetDescriptor descriptor) private _descriptors;
    mapping(bytes32 assetId => uint8 mode) private _malformed;
    bool public revertReads;

    function setDescriptor(AssetDescriptor calldata descriptor_) external {
        _descriptors[descriptor_.id] = descriptor_;
    }

    function setMalformed(bytes32 assetId, uint8 mode) external {
        _malformed[assetId] = mode;
    }

    function setRevertReads(bool value) external {
        revertReads = value;
    }

    function descriptor(bytes32 assetId) external view returns (AssetDescriptor memory) {
        if (revertReads) revert("ASSET_READ");
        uint8 mode = _malformed[assetId];
        if (mode == 1) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(0, 0x20)
            }
        }
        if (mode == 2) {
            assembly ("memory-safe") {
                let ptr := mload(0x40)
                mstore(add(ptr, 64), 2)
                return(ptr, 416)
            }
        }
        if (mode == 3) {
            assembly ("memory-safe") {
                let ptr := mload(0x40)
                mstore(add(ptr, 32), shl(160, 1))
                return(ptr, 416)
            }
        }
        return _descriptors[assetId];
    }
}

contract MockCalendarRegistry {
    mapping(bytes32 assetId => CalendarLeaf leaf) private _leaves;
    mapping(bytes32 assetId => uint8 mode) private _malformed;
    bool public revertReads;

    function setLeaf(CalendarLeaf calldata leaf) external {
        _leaves[leaf.assetId] = leaf;
    }

    function clearLeaf(bytes32 assetId) external {
        delete _leaves[assetId];
    }

    function setMalformed(bytes32 assetId, uint8 mode) external {
        _malformed[assetId] = mode;
    }

    function setRevertReads(bool value) external {
        revertReads = value;
    }

    function currentInterval(bytes32 assetId) external view returns (CalendarLeaf memory) {
        if (revertReads) revert("CALENDAR_READ");
        uint8 mode = _malformed[assetId];
        if (mode == 1) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(0, 0x20)
            }
        }
        if (mode == 2) {
            assembly ("memory-safe") {
                let ptr := mload(0x40)
                mstore(add(ptr, 160), 0x100)
                return(ptr, 224)
            }
        }
        if (mode == 3) {
            assembly ("memory-safe") {
                let ptr := mload(0x40)
                mstore(add(ptr, 96), shl(64, 1))
                return(ptr, 224)
            }
        }
        return _leaves[assetId];
    }
}

contract MockSessionRegistry {
    mapping(bytes32 assetId => HealthView health) private _health;
    bool public revertReads;
    bool public malformedReads;

    function setHealth(bytes32 assetId, HealthView calldata health_) external {
        _health[assetId] = health_;
    }

    function setRevertReads(bool value) external {
        revertReads = value;
    }

    function setMalformedReads(bool value) external {
        malformedReads = value;
    }

    function health(bytes32 assetId) external view returns (HealthView memory) {
        if (revertReads) revert("HEALTH_READ");
        if (malformedReads) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(0, 0x20)
            }
        }
        return _health[assetId];
    }

    function latestSample(bytes32, uint8) external pure returns (SourceSample memory sample) {
        return sample;
    }

    function anchorStatus(bytes32, bytes32)
        external
        pure
        returns (Anchor memory anchor, bool valid, uint256 reasons, uint64 validUntil)
    {
        return (anchor, false, ReasonBits.ANCHOR_MISSING_OR_EXPIRED, 0);
    }
}

/// @dev Unit tests for M05-02 lifecycle/health priority.
/// The healthy mocks are deterministic unit fixtures, not evidence of live source readiness. Post-activation
/// states are written with Foundry storage cheatcodes only to exercise evaluator branches; they are not a
/// seed/settlement/activation route and do not claim that M05-04/M06 can activate a pool yet.
contract BellHookLifecycleTest {
    VmBellHookLifecycle private constant vm =
        VmBellHookLifecycle(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint160 private constant HOOK_FLAG_MASK = 0x3fff;
    uint160 private constant EXPECTED_HOOK_FLAGS = 0x2cc0;

    // Verified with `forge inspect BellHook storageLayout`.
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
    MockSafetyController private safety;
    MockAssetRegistry private assets;
    MockCalendarRegistry private calendar;
    MockSessionRegistry private sessions;
    bytes32 private templateCodeHash;
    BellHook private hook;

    function setUp() external {
        vm.warp(1_700_000_000);
        manager = new PoolManager(address(this));
        address tokenA = address(new MockHookToken());
        address tokenB = address(new MockHookToken());
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        asset0 = keccak256("ASSET_0");
        asset1 = keccak256("ASSET_1");
        factory = address(new MockHookDependency());
        MockHookPositionManager positionManagerMock = new MockHookPositionManager();
        positionManager = address(positionManagerMock);
        treasuryAdapter = address(new MockHookDependency());
        positionManagerMock.setOriginalSender(factory);
        safety = new MockSafetyController();
        assets = new MockAssetRegistry();
        calendar = new MockCalendarRegistry();
        sessions = new MockSessionRegistry();
        templateCodeHash = keccak256(type(BellHook).creationCode);
        _installHealthyState();
        hook = _deployHook();
    }

    // -------------------------------------------------------------------------
    // Pre-LIVE and evaluator parity
    // -------------------------------------------------------------------------

    function testSetupSwapBlockedWithSameEvaluatorBits() external {
        PolicyView memory policy = hook.getPolicy();
        require(policy.mode == uint8(Mode.SETUP), "mode");
        require(policy.reasonBits == ReasonBits.SETUP, "reasons");
        require(!policy.canSwap, "canSwap");
        require(policy.phase == PolicyConstants.PHASE_UNKNOWN, "phase");
        require(policy.validUntil == 0, "validUntil");
        _expectPolicyBlocked(policy.reasonBits);
    }

    function testUnknownLifecycleNeverHealthy() external {
        _setLifecycle(3);
        PolicyView memory policy = hook.getPolicy();
        require(policy.mode == uint8(Mode.SETUP), "mode");
        require(policy.reasonBits & ReasonBits.SETUP != 0, "setup");
        require(!policy.canSwap, "canSwap");
        _expectPolicyBlocked(policy.reasonBits);
    }

    function testUnknownPhaseNeverHealthy() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        calendar.setLeaf(_leaf(asset0, 6, uint64(block.timestamp - 100), uint64(block.timestamp + 1000)));
        PolicyView memory policy = hook.getPolicy();
        require(policy.mode == uint8(Mode.HALTED), "mode");
        require(policy.reasonBits & ReasonBits.CALENDAR_CONFLICT != 0, "conflict");
        require(!policy.canSwap, "canSwap");
        _expectPolicyBlocked(policy.reasonBits);
    }

    function testViewAndCallbackParityUnderCombinedFaults() external {
        _activate();
        safety.setPause(ModePolicy.targetId(1, address(hook)), true, 1);
        safety.setPause(ModePolicy.targetId(2, token0), true, 1);
        sessions.setHealth(asset1, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));

        PolicyView memory policy = hook.getPolicy();
        require(policy.mode == uint8(Mode.HALTED), "mode");
        require(policy.reasonBits & ReasonBits.MANUAL_PAUSE != 0, "manual");
        require(policy.reasonBits & ReasonBits.ASSET_PAUSE != 0, "asset");
        require(policy.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "report");
        require(ModePolicy.dominantReason(policy.reasonBits) == ReasonBits.MANUAL_PAUSE, "dominant");
        require(!policy.canSwap, "canSwap");
        _expectPolicyBlocked(policy.reasonBits);

        PolicyView memory refreshed = hook.refreshState();
        require(keccak256(abi.encode(refreshed)) == keccak256(abi.encode(policy)), "checkpoint parity");
        require(hook.state().mode == uint8(Mode.HALTED), "stored mode");
        require(hook.state().pauseNonce == 1, "pause nonce checkpoint");
    }

    // -------------------------------------------------------------------------
    // Typed pause namespaces
    // -------------------------------------------------------------------------

    function testPoolPauseMapsToManualPause() external {
        safety.setPause(ModePolicy.targetId(1, address(hook)), true, 1);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.MANUAL_PAUSE != 0, "manual");
        require(policy.reasonBits & ReasonBits.ASSET_PAUSE == 0, "asset leak");
        require(ModePolicy.dominantReason(policy.reasonBits) == ReasonBits.SETUP, "dominant");
        require(!policy.canSwap, "canSwap");
    }

    function testAssetPauseChecksBothTokenNamespaces() external {
        safety.setPause(ModePolicy.targetId(2, token0), true, 1);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.ASSET_PAUSE != 0, "token0");
        require(policy.reasonBits & ReasonBits.MANUAL_PAUSE == 0, "manual leak");

        safety.setPause(ModePolicy.targetId(2, token0), false, 1);
        safety.setPause(ModePolicy.targetId(2, token1), true, 1);
        policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.ASSET_PAUSE != 0, "token1");
        require(policy.reasonBits & ReasonBits.MANUAL_PAUSE == 0, "manual leak 2");
    }

    function testIssuerPauseComesFromHealthAndIsNotAssetPause() external {
        sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.ISSUER_PAUSE));
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.ISSUER_PAUSE != 0, "issuer");
        require(policy.reasonBits & ReasonBits.ASSET_PAUSE == 0, "asset leak");
    }

    function testPauseTargetIdsMatchSafetyControllerNamespaces() external {
        SafetyController controller = new SafetyController(address(0x1111), address(0x2222), address(0x3333));
        require(ModePolicy.targetId(1, address(hook)) == controller.targetId(1, address(hook)), "pool");
        require(ModePolicy.targetId(2, token0) == controller.targetId(2, token0), "token0");
        require(ModePolicy.targetId(2, token1) == controller.targetId(2, token1), "token1");
    }

    // -------------------------------------------------------------------------
    // Fingerprint, calendar and health priority
    // -------------------------------------------------------------------------

    function testFingerprintChangeBlocks() external {
        AssetDescriptor memory descriptor_ = _descriptor(asset0, token0, true);
        descriptor_.expectedCodeHash = keccak256("WRONG_CODEHASH");
        assets.setDescriptor(descriptor_);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.FINGERPRINT_CHANGED != 0, "codehash");
        require(!policy.canSwap, "canSwap");
    }

    function testDescriptorTokenMismatchBlocks() external {
        AssetDescriptor memory descriptor_ = _descriptor(asset0, token0, true);
        descriptor_.token = token1;
        assets.setDescriptor(descriptor_);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.FINGERPRINT_CHANGED != 0, "token");
        require(!policy.canSwap, "canSwap");
    }

    function testCalendarMissingAndConflict() external {
        calendar.clearLeaf(asset0);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.CALENDAR_MISSING != 0, "missing");

        calendar.setLeaf(_leaf(asset0, 6, uint64(block.timestamp - 100), uint64(block.timestamp + 1000)));
        policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.CALENDAR_CONFLICT != 0, "bad phase");

        AssetDescriptor memory descriptor_ = _descriptor(asset0, token0, true);
        descriptor_.capabilityMask = 0x0e;
        assets.setDescriptor(descriptor_);
        calendar.setLeaf(
            _leaf(
                asset0, PolicyConstants.PHASE_OVERNIGHT, uint64(block.timestamp - 100), uint64(block.timestamp + 1000)
            )
        );
        policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.CALENDAR_CONFLICT != 0, "capability");
    }

    function testClosedPhaseIsUnexpectedUntilM05_03() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        calendar.setLeaf(
            _leaf(asset0, PolicyConstants.PHASE_CLOSED, uint64(block.timestamp - 100), uint64(block.timestamp + 1000))
        );
        PolicyView memory policy = hook.getPolicy();
        require(policy.mode == uint8(Mode.HALTED), "mode");
        require(policy.reasonBits & ReasonBits.UNEXPECTED_CLOSED != 0, "closed");
        require(!policy.canSwap, "canSwap");
        _expectPolicyBlocked(policy.reasonBits);
    }

    function testTwoStocksPhaseConflict() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        assets.setDescriptor(_descriptor(asset1, token1, true));
        calendar.setLeaf(
            _leaf(asset1, PolicyConstants.PHASE_PRE, uint64(block.timestamp - 100), uint64(block.timestamp + 1000))
        );
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.CALENDAR_CONFLICT != 0, "conflict");
        require(!policy.canSwap, "canSwap");
    }

    function testHealthDependencyFailureBlocksAndCheckpoints() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        sessions.setRevertReads(true);
        PolicyView memory policy = hook.getPolicy();
        require(policy.mode == uint8(Mode.HALTED), "mode");
        require(policy.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "health");
        require(!policy.canSwap, "canSwap");
        _expectPolicyBlocked(policy.reasonBits);

        PolicyView memory refreshed = hook.refreshState();
        require(refreshed.mode == uint8(Mode.HALTED), "refresh mode");
        require(refreshed.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "refresh reason");
    }

    function testMalformedHealthReturnBlocks() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        sessions.setMalformedReads(true);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "malformed health");
        require(!policy.canSwap, "canSwap");
    }

    function testMalformedPauseStateBlocks() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        // paused=true with nonce=0 is not a state SafetyController can produce; treat it as a failed read.
        safety.setPause(ModePolicy.targetId(1, address(hook)), true, 0);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.SETUP != 0, "malformed pause");
        require(!policy.canSwap, "canSwap");
    }

    function testHealthNotReadyWithoutReasonsBlocks() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        HealthView memory health_ = _healthyHealth();
        health_.ready = false;
        health_.reasonBits = 0;
        health_.validUntil = 0;
        sessions.setHealth(asset0, health_);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "not ready");
        require(!policy.canSwap, "canSwap");
    }

    function testHealthExpiredBlocks() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        HealthView memory health_ = _healthyHealth();
        health_.validUntil = uint64(block.timestamp - 1);
        sessions.setHealth(asset0, health_);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "expired");
        require(!policy.canSwap, "canSwap");
    }

    function testHealthZeroObservationBlocks() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        HealthView memory health_ = _healthyHealth();
        health_.latestObservation = 0;
        sessions.setHealth(asset0, health_);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "zero observation");
        require(!policy.canSwap, "canSwap");
    }

    function testUnknownHealthReasonRetainedAndBlocks() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        uint256 unknown = uint256(1) << 40;
        HealthView memory health_ = _healthyHealth();
        health_.ready = false;
        health_.reasonBits = unknown;
        health_.validUntil = 0;
        sessions.setHealth(asset0, health_);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & unknown != 0, "retained");
        require(policy.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "blocked");
        require(!policy.canSwap, "canSwap");
    }

    function testDependencyFailuresNeverHealthy() external {
        _setLifecycle(uint8(Lifecycle.LIVE));

        assets.setRevertReads(true);
        PolicyView memory policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.SETUP != 0, "asset");
        require(!policy.canSwap, "asset canSwap");

        assets.setRevertReads(false);
        safety.setRevertReads(true);
        policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.SETUP != 0, "safety");
        require(!policy.canSwap, "safety canSwap");

        safety.setRevertReads(false);
        calendar.setRevertReads(true);
        policy = hook.getPolicy();
        require(policy.reasonBits & ReasonBits.CALENDAR_MISSING != 0, "calendar");
        require(!policy.canSwap, "calendar canSwap");
    }

    // -------------------------------------------------------------------------
    // Synthetic post-activation evaluator branches and accounting preservation
    // -------------------------------------------------------------------------

    function testHealthySyntheticLiveDoesNotAdvertiseSwap() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        PolicyView memory policy = hook.getPolicy();
        require(policy.mode == uint8(Mode.HALTED), "mode");
        require(!policy.canSwap, "canSwap");
        require(policy.reasonBits == ReasonBits.SETUP, "execution gate reason");
        require(policy.phase == PolicyConstants.PHASE_REGULAR, "phase");
        require(policy.validUntil == uint64(block.timestamp + 500), "validUntil");
        _expectPolicyBlocked(policy.reasonBits);

        PolicyView memory refreshed = hook.refreshState();
        require(refreshed.mode == uint8(Mode.HALTED), "refresh mode");
        require(!refreshed.canSwap, "refresh canSwap");
        require(refreshed.reasonBits == ReasonBits.SETUP, "refresh reason");
        require(keccak256(abi.encode(refreshed)) == keccak256(abi.encode(policy)), "view/checkpoint parity");
        require(hook.state().mode == uint8(Mode.HALTED), "stored mode");
    }

    function testCountersPreservedAcrossPauseAndFaultCheckpoints() external {
        _activate();
        _setClosureNonce(1);
        _setBuckets(123, 10, 20, 30, 40);
        _setEpisodeGross(1, 50, 60);

        PolicyView memory policy = hook.getPolicy();
        require(policy.mode == uint8(Mode.HALTED), "gate halted");
        require(policy.reasonBits == ReasonBits.SETUP, "gate reason");
        require(!policy.canSwap, "gate canSwap");
        require(policy.closureNonce == 1, "nonce");
        require(policy.rollingRemaining[0] == 10_000_000 - 40, "rolling0");
        require(policy.rollingRemaining[1] == 20_000_000 - 60, "rolling1");
        require(policy.closureRemaining[0] == 500_000 - 50, "closure0");
        require(policy.closureRemaining[1] == 1_000_000 - 60, "closure1");

        safety.setPause(ModePolicy.targetId(1, address(hook)), true, 1);
        sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        PolicyView memory halted = hook.refreshState();
        require(halted.mode == uint8(Mode.HALTED), "halted");
        require(halted.reasonBits & ReasonBits.MANUAL_PAUSE != 0, "manual");
        require(halted.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "report");
        require(hook.state().pauseNonce == 1, "pause nonce checkpoint");
        _requireCounters(123, 10, 20, 30, 40, 50, 60, 1);

        safety.setPause(ModePolicy.targetId(1, address(hook)), false, 1);
        sessions.setHealth(asset0, _healthyHealth());
        PolicyView memory recovering = hook.refreshState();
        require(recovering.mode == uint8(Mode.RECOVERING), "recovery after fault");
        require(recovering.reasonBits & ReasonBits.RECOVERY_PENDING != 0, "recovery reasons");
        require(!recovering.canSwap, "recovery canSwap");
        require(hook.state().pauseNonce == 1, "pause nonce retained");
        require(hook.state().reopenCandidateAt == block.timestamp, "recovery candidate");
        _requireCounters(123, 10, 20, 30, 40, 50, 60, 1);

        // Ordinary recovery must finish its 60-second joint interval; only then does the M05-05 execution
        // gate block the checkpoint. The ledger is untouched by either transition.
        vm.warp(block.timestamp + PolicyConstants.REOPEN_MINIMUM_SEPARATION_SECONDS + 1);
        sessions.setHealth(asset0, _healthyHealth());
        PolicyView memory recovered = hook.refreshState();
        require(recovered.mode == uint8(Mode.HALTED), "gate after recovery");
        require(recovered.reasonBits == ReasonBits.SETUP, "gate after recovery reason");
        require(!recovered.canSwap, "gate after recovery canSwap");
        require(hook.state().reopenCandidateAt == 0, "candidate cleared");
        _requireCounters(123, 10, 20, 30, 40, 50, 60, 1);
    }

    // -------------------------------------------------------------------------
    // State-hash dependency binding
    // These prove the consumed dependency observations are bound. They do not claim the full §20.A accepted
    // report/anchor/reference hash; that data belongs to M05-03/M05-05.
    // -------------------------------------------------------------------------

    function testStateHashChangesWhenHealthChanges() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        bytes32 before = hook.getPolicy().stateHash;

        HealthView memory health_ = _healthyHealth();
        health_.latestObservation = uint64(block.timestamp - 5);
        sessions.setHealth(asset0, health_);
        bytes32 afterHash = hook.getPolicy().stateHash;
        require(before != afterHash, "health observation");

        health_ = _healthyHealth();
        health_.ready = false;
        health_.validUntil = 0;
        sessions.setHealth(asset0, health_);
        bytes32 unhealthy = hook.getPolicy().stateHash;
        require(afterHash != unhealthy, "health status");
    }

    function testStateHashChangesWhenCalendarChanges() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        bytes32 before = hook.getPolicy().stateHash;
        calendar.setLeaf(
            _leaf(asset0, PolicyConstants.PHASE_REGULAR, uint64(block.timestamp - 100), uint64(block.timestamp + 1001))
        );
        bytes32 afterHash = hook.getPolicy().stateHash;
        require(before != afterHash, "calendar leaf");
    }

    function testStateHashChangesWhenTokenAndPoolPauseNoncesChange() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        bytes32 before = hook.getPolicy().stateHash;

        safety.setPause(ModePolicy.targetId(2, token0), false, 1);
        bytes32 tokenPause = hook.getPolicy().stateHash;
        require(before != tokenPause, "token pause nonce");

        safety.setPause(ModePolicy.targetId(1, address(hook)), false, 1);
        bytes32 poolPause = hook.getPolicy().stateHash;
        require(tokenPause != poolPause, "pool pause nonce");
    }

    function testStateHashChangesWhenDescriptorChanges() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        bytes32 before = hook.getPolicy().stateHash;

        AssetDescriptor memory descriptor_ = _descriptor(asset0, token0, true);
        descriptor_.implementationFingerprint = keccak256("NEW_IMPLEMENTATION");
        assets.setDescriptor(descriptor_);
        bytes32 afterHash = hook.getPolicy().stateHash;
        require(before != afterHash, "descriptor");

        AssetDescriptor memory quoteDescriptor = _descriptor(asset1, token1, false);
        quoteDescriptor.implementationFingerprint = keccak256("NEW_QUOTE_IMPLEMENTATION");
        assets.setDescriptor(quoteDescriptor);
        bytes32 quoteAfter = hook.getPolicy().stateHash;
        require(afterHash != quoteAfter, "quote descriptor");
    }

    function testStateHashChangesWhenQuoteHealthChanges() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        bytes32 before = hook.getPolicy().stateHash;

        HealthView memory health_ = _healthyHealth();
        health_.latestObservation = uint64(block.timestamp - 4);
        sessions.setHealth(asset1, health_);
        bytes32 afterHash = hook.getPolicy().stateHash;
        require(before != afterHash, "quote health");
    }

    function testStateHashChangesWhenSecondStockCalendarChanges() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        assets.setDescriptor(_descriptor(asset1, token1, true));
        calendar.setLeaf(
            _leaf(asset1, PolicyConstants.PHASE_REGULAR, uint64(block.timestamp - 100), uint64(block.timestamp + 1000))
        );
        bytes32 before = hook.getPolicy().stateHash;

        calendar.setLeaf(
            _leaf(asset1, PolicyConstants.PHASE_REGULAR, uint64(block.timestamp - 100), uint64(block.timestamp + 1001))
        );
        bytes32 afterHash = hook.getPolicy().stateHash;
        require(before != afterHash, "second stock calendar");
    }

    function testStateHashBindsSessionRegistryAddress() external {
        MockSessionRegistry second = new MockSessionRegistry();
        second.setHealth(asset0, _healthyHealth());
        second.setHealth(asset1, _healthyHealth());
        BellHook other = _deployHookWithSession(address(second));

        bytes32 firstHash = hook.getPolicy().stateHash;
        bytes32 secondHash = other.getPolicy().stateHash;
        require(firstHash != secondHash, "session registry bound");
    }

    function testStateHashStableAcrossViewAndCheckpoint() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        PolicyView memory before = hook.getPolicy();
        PolicyView memory refreshed = hook.refreshState();
        require(before.stateHash == refreshed.stateHash, "hash parity");
        require(keccak256(abi.encode(before)) == keccak256(abi.encode(refreshed)), "view parity");
    }

    // -------------------------------------------------------------------------
    // Fixed-buffer decoder failures
    // -------------------------------------------------------------------------

    function testMalformedPauseStateFixedBuffersFailClosed() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        bytes32 healthyHash = hook.getPolicy().stateHash;
        bytes32 poolTarget = ModePolicy.targetId(1, address(hook));

        // SETUP is shared with the M05-05 execution gate. The changed dependency hash is what proves this
        // specific pauseState read failed; the hook still stores a blocking mode/reason.
        safety.setMalformed(poolTarget, 1); // wrong exact length
        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "length mode");
        require(policy.reasonBits & ReasonBits.SETUP != 0, "length reason");
        require(!policy.canSwap, "length canSwap");
        require(policy.stateHash != healthyHash, "length observation");

        safety.setMalformed(poolTarget, 2); // invalid bool word
        policy = hook.refreshState();
        require(policy.reasonBits & ReasonBits.SETUP != 0, "bool reason");
        require(!policy.canSwap, "bool canSwap");

        safety.setMalformed(poolTarget, 3); // nonce high bits
        policy = hook.refreshState();
        require(policy.reasonBits & ReasonBits.SETUP != 0, "nonce reason");
        require(!policy.canSwap, "nonce canSwap");
        require(hook.state().mode == uint8(Mode.HALTED), "stored mode");
    }

    function testMalformedDescriptorFixedBuffersFailClosed() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        // Keep a second healthy stock session so a failed asset0 descriptor is isolated to SETUP, not also
        // CALENDAR_MISSING (no stock session).
        assets.setDescriptor(_descriptor(asset1, token1, true));
        calendar.setLeaf(
            _leaf(asset1, PolicyConstants.PHASE_REGULAR, uint64(block.timestamp - 100), uint64(block.timestamp + 1000))
        );

        bytes32 healthyHash = hook.getPolicy().stateHash;
        assets.setMalformed(asset0, 1); // wrong exact length
        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "length mode");
        require(policy.reasonBits & ReasonBits.SETUP != 0, "length reason");
        require(policy.reasonBits & ReasonBits.CALENDAR_MISSING == 0, "length session isolated");
        require(!policy.canSwap, "length canSwap");
        require(policy.stateHash != healthyHash, "length observation");

        assets.setMalformed(asset0, 2); // invalid isStock bool word
        policy = hook.refreshState();
        require(policy.reasonBits & ReasonBits.SETUP != 0, "bool reason");
        require(!policy.canSwap, "bool canSwap");

        assets.setMalformed(asset0, 3); // dirty token high bits
        policy = hook.refreshState();
        require(policy.reasonBits & ReasonBits.SETUP != 0, "token reason");
        require(!policy.canSwap, "token canSwap");
        require(hook.state().mode == uint8(Mode.HALTED), "stored mode");
    }

    function testMalformedCalendarFixedBuffersFailClosed() external {
        _setLifecycle(uint8(Lifecycle.LIVE));
        bytes32 healthyHash = hook.getPolicy().stateHash;

        calendar.setMalformed(asset0, 1); // wrong exact length
        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "length mode");
        require(policy.reasonBits & ReasonBits.CALENDAR_MISSING != 0, "length reason");
        require(!policy.canSwap, "length canSwap");
        require(policy.stateHash != healthyHash, "length observation");

        calendar.setMalformed(asset0, 2); // phase high bits
        policy = hook.refreshState();
        require(policy.reasonBits & ReasonBits.CALENDAR_MISSING != 0, "phase reason");
        require(!policy.canSwap, "phase canSwap");

        calendar.setMalformed(asset0, 3); // start high bits
        policy = hook.refreshState();
        require(policy.reasonBits & ReasonBits.CALENDAR_MISSING != 0, "start reason");
        require(!policy.canSwap, "start canSwap");
        require(hook.state().mode == uint8(Mode.HALTED), "stored mode");
    }

    // -------------------------------------------------------------------------
    // Pure ModePolicy checks
    // -------------------------------------------------------------------------

    function testModePolicyDominantReasonIsLowestBit() external pure {
        uint256 bits = ReasonBits.SETUP | ReasonBits.MANUAL_PAUSE | ReasonBits.ASSET_PAUSE;
        require(ModePolicy.dominantReason(bits) == ReasonBits.SETUP, "lowest");
        require(
            ModePolicy.dominantReason(ReasonBits.ASSET_PAUSE | ReasonBits.ISSUER_PAUSE) == ReasonBits.ASSET_PAUSE,
            "next lowest"
        );
        require(ModePolicy.dominantReason(0) == 0, "zero");
        require(!ModePolicy.hasUnknownReason(ReasonBits.PRICE_PATH_REJECTED), "known 16");
        require(ModePolicy.hasUnknownReason(uint256(1) << 17), "unknown 17");
    }

    function testModePolicyEvaluateBranches() external pure {
        ModePolicy.Evaluation memory evaluation =
            ModePolicy.evaluate(uint8(Lifecycle.LIVE), PolicyConstants.PHASE_REGULAR, false, 0, true);
        require(evaluation.mode == uint8(Mode.ACTIVE), "active mode");
        require(evaluation.canSwap, "active swap");
        require(evaluation.reasons == 0, "active reasons");

        evaluation = ModePolicy.evaluate(
            uint8(Lifecycle.LIVE), PolicyConstants.PHASE_REGULAR, false, ReasonBits.MANUAL_PAUSE, true
        );
        require(evaluation.mode == uint8(Mode.HALTED), "halted mode");
        require(!evaluation.canSwap, "halted swap");
        require(evaluation.reasons == ReasonBits.MANUAL_PAUSE, "halted reasons");

        evaluation = ModePolicy.evaluate(uint8(Lifecycle.DEPLOYED), PolicyConstants.PHASE_REGULAR, false, 0, true);
        require(evaluation.mode == uint8(Mode.SETUP), "setup mode");
        require(!evaluation.canSwap, "setup swap");
        require(evaluation.reasons == ReasonBits.SETUP, "setup reasons");

        evaluation = ModePolicy.evaluate(3, PolicyConstants.PHASE_REGULAR, false, 0, true);
        require(evaluation.mode == uint8(Mode.SETUP), "unknown lifecycle mode");
        require(evaluation.reasons == ReasonBits.SETUP, "unknown lifecycle reasons");

        evaluation = ModePolicy.evaluate(uint8(Lifecycle.LIVE), PolicyConstants.PHASE_CLOSED, false, 0, true);
        require(evaluation.mode == uint8(Mode.HALTED), "closed mode");
        require(evaluation.reasons == ReasonBits.UNEXPECTED_CLOSED, "closed reasons");

        evaluation = ModePolicy.evaluate(uint8(Lifecycle.LIVE), PolicyConstants.PHASE_REGULAR, true, 0, true);
        require(evaluation.mode == uint8(Mode.CLOSED), "latched mode");
        require(!evaluation.canSwap, "latched swap");

        evaluation = ModePolicy.evaluate(uint8(Lifecycle.LIVE), PolicyConstants.PHASE_UNKNOWN, false, 0, true);
        require(evaluation.mode == uint8(Mode.HALTED), "unknown phase mode");
        require(evaluation.reasons == ReasonBits.CALENDAR_CONFLICT, "unknown phase reasons");

        evaluation = ModePolicy.evaluate(uint8(Lifecycle.LIVE), 6, false, 0, true);
        require(evaluation.mode == uint8(Mode.HALTED), "bad phase mode");
        require(evaluation.reasons == ReasonBits.CALENDAR_CONFLICT, "bad phase reasons");
    }

    function testModePolicyExecutionReadinessGate() external pure {
        ModePolicy.Evaluation memory ready =
            ModePolicy.evaluate(uint8(Lifecycle.LIVE), PolicyConstants.PHASE_REGULAR, false, 0, true);
        require(ready.mode == uint8(Mode.ACTIVE), "ready mode");
        require(ready.canSwap, "ready swap");
        require(ready.reasons == 0, "ready reasons");

        ModePolicy.Evaluation memory notReady =
            ModePolicy.evaluate(uint8(Lifecycle.LIVE), PolicyConstants.PHASE_REGULAR, false, 0, false);
        require(notReady.mode == uint8(Mode.HALTED), "gate mode");
        require(!notReady.canSwap, "gate swap");
        require(notReady.reasons == ReasonBits.SETUP, "gate reason");

        ModePolicy.Evaluation memory faulted = ModePolicy.evaluate(
            uint8(Lifecycle.LIVE), PolicyConstants.PHASE_REGULAR, false, ReasonBits.MANUAL_PAUSE, false
        );
        require(faulted.mode == uint8(Mode.HALTED), "fault mode");
        require(faulted.reasons == ReasonBits.MANUAL_PAUSE, "fault reason not masked");
    }

    function testModePolicyOrdinaryFaultRecoveryPurePath() external pure {
        ModePolicy.Context memory context = _openContext();
        ModePolicy.Decision memory decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.RECOVERING), "first proof");
        require(decision.reopenCandidateAt == 100, "candidate");
        require(decision.reopenBaseObservations[0] == 100, "baseline0");
        require(decision.reopenBaseObservations[1] == 100, "baseline1");
        require(decision.reasons & ReasonBits.RECOVERY_PENDING != 0, "first proof pending");
        require(!decision.releaseRecovery, "premature recovery release");
        require(!decision.releaseLatch, "ordinary recovery released a latch");

        context = _apply(context, decision);
        context.nowTime = 159;
        context.observations = [uint64(159), uint64(159)];
        context.validUntil = 1_059;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.RECOVERING), "59s");
        require(decision.reopenCandidateAt == 100, "59s candidate");
        require(decision.reasons & ReasonBits.RECOVERY_PENDING != 0, "59s pending");

        context = _apply(context, decision);
        context.nowTime = 160;
        context.observations = [uint64(160), uint64(100)];
        context.validUntil = 1_060;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.RECOVERING), "one stock did not advance");
        require(decision.reopenCandidateAt == 100, "stale candidate");
        require(decision.reasons & ReasonBits.RECOVERY_PENDING != 0, "stale pending");

        context = _apply(context, decision);
        context.observations = [uint64(160), uint64(160)];
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.ACTIVE), "active after sixty");
        require(decision.canSwap, "active canSwap");
        require(decision.releaseRecovery, "release recovery");
        require(!decision.releaseLatch, "ordinary recovery latch");
        require(decision.reopenCandidateAt == 0, "released candidate");
        require(decision.reasons == 0, "release reasons");

        context = _apply(context, decision);
        context.nowTime = 200;
        context.observations = [uint64(200), uint64(200)];
        context.validUntil = 1_100;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.ACTIVE), "steady active");

        // A release that was execution-gated is a steady state: once the gate opens, the continuously valid
        // vector returns ACTIVE without a second 60-second interval.
        ModePolicy.Context memory gated = _openContext();
        gated.reopenCandidateAt = 0;
        gated.oldValidUntil = 900;
        gated.nowTime = 200;
        gated.validUntil = 1_000;
        gated.executionReady = true;
        decision = ModePolicy.decide(gated);
        require(decision.mode == uint8(Mode.ACTIVE), "gated steady resumes active");
    }

    function testModePolicyOrdinaryRecoveryGapAndFaultReset() external pure {
        ModePolicy.Context memory context = _openContext();
        ModePolicy.Decision memory decision = ModePolicy.decide(context);
        context = _apply(context, decision);

        // Crossing the old deadline is a validity gap: restart the candidate from the new vector.
        context.nowTime = 1_000;
        context.observations = [uint64(1_000), uint64(1_000)];
        context.validUntil = 2_000;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.RECOVERING), "gap recovering");
        require(decision.reopenCandidateAt == 1_000, "gap candidate");
        require(decision.reopenBaseObservations[0] == 1_000, "gap baseline");

        // A pause/fault checkpoint cancels the candidate and the old deadline.
        context = _apply(context, decision);
        context.nowTime = 1_010;
        context.dependencyReasons = ReasonBits.MANUAL_PAUSE;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.HALTED), "fault halted");
        require(decision.reopenCandidateAt == 0, "fault candidate");
        require(decision.oldValidUntil == 0, "fault deadline");

        // The next healthy checkpoint starts a fresh candidate, never an immediate ACTIVE.
        context = _apply(context, decision);
        context.dependencyReasons = 0;
        context.nowTime = 1_020;
        context.observations = [uint64(1_020), uint64(1_020)];
        context.validUntil = 2_020;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.RECOVERING), "restart after fault");
        require(decision.reopenCandidateAt == 1_020, "restart candidate");
    }

    function testModePolicyActiveMissedDeadlineStartsRecovery() external pure {
        ModePolicy.Context memory context = _openContext();
        context.previousMode = uint8(Mode.ACTIVE);
        context.oldValidUntil = 99;
        context.nowTime = 100;
        context.validUntil = 1_000;
        context.observations = [uint64(100), uint64(100)];
        ModePolicy.Decision memory decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.RECOVERING), "missed deadline recovering");
        require(decision.reopenCandidateAt == 100, "missed deadline candidate");
        require(decision.reopenBaseObservations[0] == 100, "missed deadline baseline");
        require(decision.reasons & ReasonBits.RECOVERY_PENDING != 0, "missed deadline pending");
        require(!decision.canSwap, "missed deadline canSwap");

        // A missing committed deadline is also not proof of continuity.
        ModePolicy.Context memory noDeadline = _openContext();
        noDeadline.previousMode = uint8(Mode.ACTIVE);
        noDeadline.oldValidUntil = 0;
        decision = ModePolicy.decide(noDeadline);
        require(decision.mode == uint8(Mode.RECOVERING), "no deadline recovering");
        require(decision.reopenCandidateAt == 100, "no deadline candidate");

        // A still-valid deadline keeps the steady ACTIVE path.
        ModePolicy.Context memory valid = _openContext();
        valid.previousMode = uint8(Mode.ACTIVE);
        valid.oldValidUntil = 101;
        decision = ModePolicy.decide(valid);
        require(decision.mode == uint8(Mode.ACTIVE), "valid deadline active");
    }

    function testModePolicyActivationGuardIsSticky() external pure {
        ModePolicy.Context memory context = _openContext();
        context.activationCommitted = false;
        context.previousMode = uint8(Mode.SETUP);
        ModePolicy.Decision memory decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.HALTED), "unactivated halted");
        require(decision.reasons & ReasonBits.SETUP != 0, "unactivated setup");
        require(!decision.canSwap, "unactivated canSwap");

        context.previousMode = uint8(Mode.HALTED);
        context.dependencyReasons = ReasonBits.REPORT_INVALID_OR_STALE;
        context.nowTime = 110;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.HALTED), "unactivated fault");
        require(decision.reopenCandidateAt == 0, "unactivated fault candidate");

        context.dependencyReasons = 0;
        context.nowTime = 120;
        context.observations = [uint64(120), uint64(120)];
        context.validUntil = 1_120;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.HALTED), "unactivated healthy");
        require(decision.reopenCandidateAt == 0, "unactivated healthy candidate");
        require(decision.reasons & ReasonBits.SETUP != 0, "unactivated healthy setup");
        require(!decision.canSwap, "unactivated healthy canSwap");
    }

    function testModePolicyLatchedClosureRecoveryReleasesWithExecutionReady() external pure {
        ModePolicy.Context memory context = _openContext();
        context.closedLatched = true;
        context.closureNonce = 7;
        context.previousMode = uint8(Mode.CLOSED);
        context.anyPlannedClosed = false;
        context.closureContextValid = false;
        context.reopenCandidateAt = 0;
        context.oldValidUntil = 0;
        context.observations = [uint64(100), uint64(100)];
        context.nowTime = 100;
        context.validUntil = 1_000;
        context.executionReady = true;

        ModePolicy.Decision memory decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.RECOVERING), "latched recovering");
        require(decision.latch, "latched");
        require(decision.closureNonce == 7, "nonce preserved");
        require(decision.reasons & ReasonBits.RECOVERY_PENDING != 0, "latched pending");
        require(!decision.releaseLatch, "premature latch release");

        context = _apply(context, decision);
        context.nowTime = 160;
        context.observations = [uint64(160), uint64(160)];
        context.validUntil = 1_060;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.ACTIVE), "latched active");
        require(decision.canSwap, "latched canSwap");
        require(!decision.latch, "latch released");
        require(decision.releaseLatch, "ClosureEnded transition");
        require(!decision.releaseRecovery, "not ordinary recovery");
        require(decision.closureNonce == 7, "nonce preserved on release");
        require(decision.reasons == 0, "release reasons");
    }

    function testModePolicyStockMaskIgnoresQuoteObservation() external pure {
        ModePolicy.Context memory context = _openContext();
        context.stockMask = 1; // only asset0 is a stock
        ModePolicy.Decision memory decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.RECOVERING), "single stock candidate");
        context = _apply(context, decision);

        context.nowTime = 160;
        context.observations = [uint64(100), uint64(160)]; // only the quote advanced
        context.validUntil = 1_060;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.RECOVERING), "quote did not satisfy stock");
        require(decision.reopenCandidateAt == 100, "single stock candidate retained");

        context = _apply(context, decision);
        context.observations = [uint64(160), uint64(160)];
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.ACTIVE), "single stock released");
        require(decision.releaseRecovery, "single stock release");
    }

    function testModePolicySecondStockOnlyAdvances() external pure {
        ModePolicy.Context memory context = _openContext();
        context.stockMask = 2; // only asset1 is a stock
        ModePolicy.Decision memory decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.RECOVERING), "second stock candidate");
        require(decision.reopenBaseObservations[1] == 100, "second stock baseline");
        context = _apply(context, decision);

        context.nowTime = 160;
        context.observations = [uint64(160), uint64(100)]; // only the quote advanced
        context.validUntil = 1_060;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.RECOVERING), "quote did not satisfy second stock");

        context = _apply(context, decision);
        context.observations = [uint64(160), uint64(160)];
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.ACTIVE), "second stock released");
        require(decision.releaseRecovery, "second stock release");
    }

    function testModePolicySetupAndExecutionGateStayFailClosed() external pure {
        ModePolicy.Context memory context = _openContext();
        context.previousMode = uint8(Mode.SETUP);
        ModePolicy.Decision memory decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.HALTED), "setup halted");
        require(decision.reasons == ReasonBits.SETUP, "setup reason");
        require(!decision.canSwap, "setup canSwap");

        context = _openContext();
        context.previousMode = uint8(Mode.ACTIVE);
        context.oldValidUntil = 1_000;
        context.executionReady = false;
        decision = ModePolicy.decide(context);
        require(decision.mode == uint8(Mode.HALTED), "gate halted");
        require(decision.reasons == ReasonBits.SETUP, "gate reason");
        require(!decision.canSwap, "gate canSwap");
    }

    /// @dev Minimal healthy open-session context. `previousMode = HALTED` models a committed fault checkpoint;
    /// `executionReady = true` proves the pure policy would release ordinary recovery into ACTIVE once M05-05
    /// supplies the execution path. The hook still runs with SWAP_EXECUTION_READY = false.
    function _openContext() internal pure returns (ModePolicy.Context memory context) {
        context.lifecycle = uint8(Lifecycle.LIVE);
        context.previousMode = uint8(Mode.HALTED);
        context.activationCommitted = true;
        context.phase = PolicyConstants.PHASE_REGULAR;
        context.phaseSet = true;
        context.allLegsHealthy = true;
        context.stockMask = 3;
        context.validUntil = 1_000;
        context.observations = [uint64(100), uint64(100)];
        context.nowTime = 100;
        context.executionReady = true;
    }

    function _apply(ModePolicy.Context memory context, ModePolicy.Decision memory decision)
        internal
        pure
        returns (ModePolicy.Context memory)
    {
        context.previousMode = decision.mode;
        context.closedLatched = decision.latch;
        context.reopenCandidateAt = decision.reopenCandidateAt;
        context.reopenBaseObservations = decision.reopenBaseObservations;
        context.oldValidUntil = decision.oldValidUntil;
        context.lastOpenObservations = decision.lastOpenObservations;
        return context;
    }

    // -------------------------------------------------------------------------
    // Constructor dependency binding
    // -------------------------------------------------------------------------

    function testConstructorRejectsMissingSessionRegistry() external {
        (uint64 nonce,) = _nextValidAddress();
        vm.setNonce(address(this), nonce);
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadConfig.selector, keccak256("SESSION_REGISTRY")));
        this.deployHook(_config(), _key(), templateCodeHash, address(0));

        (nonce,) = _nextValidAddress();
        vm.setNonce(address(this), nonce);
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadConfig.selector, keccak256("SESSION_REGISTRY")));
        this.deployHook(_config(), _key(), templateCodeHash, address(0xDEAD));
    }

    // -------------------------------------------------------------------------
    // Deployment and fixtures
    // -------------------------------------------------------------------------

    function deployHook(PoolConfig calldata config, PoolKey calldata key, bytes32 templateHash, address sessionRegistry)
        external
        returns (address)
    {
        return address(new BellHook(config, key, templateHash, sessionRegistry));
    }

    function _deployHook() internal returns (BellHook) {
        return _deployHookWithSession(address(sessions));
    }

    function _deployHookWithSession(address sessionRegistry_) internal returns (BellHook deployed) {
        return _deployHookConfigWithSession(_config(), sessionRegistry_);
    }

    function _deployHookConfig(PoolConfig memory config) internal returns (BellHook deployed) {
        return _deployHookConfigWithSession(config, address(sessions));
    }

    function _deployHookConfigWithSession(PoolConfig memory config, address sessionRegistry_)
        internal returns (BellHook deployed)
    {
        (uint64 nonce, address predicted) = _nextValidAddress();
        vm.setNonce(address(this), nonce);
        deployed = BellHook(this.deployHook(config, _key(), templateCodeHash, sessionRegistry_));
        require(address(deployed) == predicted, "hook address prediction");
    }

    function _nextValidAddress() internal view returns (uint64 nonce, address predicted) {
        nonce = vm.getNonce(address(this));
        while (true) {
            predicted = vm.computeCreateAddress(address(this), nonce);
            if (uint160(predicted) & HOOK_FLAG_MASK == EXPECTED_HOOK_FLAGS) return (nonce, predicted);
            ++nonce;
        }
    }

    function _installHealthyState() internal {
        assets.setDescriptor(_descriptor(asset0, token0, true));
        assets.setDescriptor(_descriptor(asset1, token1, false));
        calendar.setLeaf(
            _leaf(asset0, PolicyConstants.PHASE_REGULAR, uint64(block.timestamp - 100), uint64(block.timestamp + 1000))
        );
        sessions.setHealth(asset0, _healthyHealth());
        sessions.setHealth(asset1, _healthyHealth());
    }

    function _config() internal view returns (PoolConfig memory config) {
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
        config.policyId = keccak256("POLICY_V1");
    }

    function _key() internal view returns (PoolKey memory key) {
        key.currency0 = Currency.wrap(token0);
        key.currency1 = Currency.wrap(token1);
        key.fee = LPFeeLibrary.DYNAMIC_FEE_FLAG;
        key.tickSpacing = 60;
        key.hooks = IHooks(address(0));
    }

    function _descriptor(bytes32 assetId, address token, bool isStock)
        internal
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

    function _leaf(bytes32 assetId, uint8 phase, uint64 start, uint64 end)
        internal
        pure
        returns (CalendarLeaf memory leaf)
    {
        leaf.assetId = assetId;
        leaf.year = 2026;
        leaf.index = 0;
        leaf.start = start;
        leaf.end = end;
        leaf.phase = phase;
        leaf.provenanceHash = keccak256("PROVENANCE");
    }

    function _healthyHealth() internal view returns (HealthView memory health_) {
        health_.ready = true;
        health_.reasonBits = 0;
        health_.healthySince = uint64(block.timestamp - 100);
        health_.validUntil = uint64(block.timestamp + 500);
        health_.baselineObservation = uint64(block.timestamp - 50);
        health_.latestObservation = uint64(block.timestamp - 10);
    }

    function _unhealthyHealth(uint256 reasons) internal pure returns (HealthView memory health_) {
        health_.ready = false;
        health_.reasonBits = reasons;
        health_.validUntil = 0;
    }

    function _swapParams() internal pure returns (SwapParams memory params) {
        params.zeroForOne = true;
        params.amountSpecified = -1e18;
        params.sqrtPriceLimitX96 = 0;
    }

    function _seedParams() internal pure returns (ModifyLiquidityParams memory params) {
        params.tickLower = -60;
        params.tickUpper = 60;
        params.liquidityDelta = 1e18;
        params.salt = bytes32(0);
    }

    function _expectPolicyBlocked(uint256 reasons) internal {
        PoolKey memory key = hook.poolKey();
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.PolicyBlocked.selector, reasons));
        vm.prank(address(manager));
        hook.beforeSwap(factory, key, _swapParams(), "");
    }

    // -------------------------------------------------------------------------
    // M05-04 seed principal callback path
    // -------------------------------------------------------------------------

    function testSeedCallbacksSubtractAccruedFeesAndBindFactoryRequest() external {
        bytes32 requestHash = keccak256("BELL_CREATE_REQUEST");
        bytes32 salt = keccak256("INITIAL_POSITION");
        uint128 liquidity = 5e18;
        vm.prank(factory);
        hook.beginSeed(requestHash, -60, 60, salt, liquidity);

        PoolKey memory key = hook.poolKey();
        vm.prank(address(manager));
        require(hook.beforeInitialize(factory, key, 1) == IHooks.beforeInitialize.selector, "init selector");
        require(hook.state().lifecycle == uint8(Lifecycle.SEEDING), "seeding transition");

        ModifyLiquidityParams memory params = _seedParams();
        params.liquidityDelta = int256(uint256(liquidity));
        params.salt = salt;
        vm.prank(address(manager));
        require(hook.beforeAddLiquidity(positionManager, key, params, "untrusted-hook-data") == IHooks.beforeAddLiquidity.selector, "add selector");

        BalanceDelta delta = toBalanceDelta(-9_999_997, -19_999_995);
        BalanceDelta feesAccrued = toBalanceDelta(3, 5);
        vm.prank(address(manager));
        (bytes4 selector, BalanceDelta hookDelta) = hook.afterAddLiquidity(
            positionManager, key, params, delta, feesAccrued, "different-hook-data"
        );
        require(selector == IHooks.afterAddLiquidity.selector, "after add selector");
        require(hookDelta == BalanceDeltaLibrary.ZERO_DELTA, "hook changed core delta");
        uint128[2] memory principal = hook.seedPrincipal();
        require(principal[0] == 10_000_000 && principal[1] == 20_000_000, "fees counted as principal");
        require(hook.seedCaptured() && hook.state().lifecycle == uint8(Lifecycle.SEEDING), "seed capture state");

        vm.prank(address(manager));
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadSeed.selector));
        hook.afterAddLiquidity(positionManager, key, params, delta, feesAccrued, "");

        vm.prank(factory);
        hook.activatePool(requestHash, 1);
        require(hook.state().lifecycle == uint8(Lifecycle.LIVE), "activation state");
        require(hook.state().bellStart == block.timestamp, "bell start");
    }

    function testSeedRejectsUntrustedInitiatorWrongRequestAndSecondModification() external {
        bytes32 requestHash = keccak256("BELL_CREATE_REQUEST");
        bytes32 salt = keccak256("INITIAL_POSITION");
        uint128 liquidity = 5e18;
        vm.prank(factory);
        hook.beginSeed(requestHash, -60, 60, salt, liquidity);
        PoolKey memory key = hook.poolKey();
        vm.prank(address(manager));
        hook.beforeInitialize(factory, key, 1);

        ModifyLiquidityParams memory params = _seedParams();
        params.liquidityDelta = int256(uint256(liquidity));
        params.salt = salt;
        MockHookPositionManager(positionManager).setOriginalSender(address(0xBAD));
        vm.prank(address(manager));
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadSeed.selector));
        hook.beforeAddLiquidity(positionManager, key, params, "");

        MockHookPositionManager(positionManager).setOriginalSender(factory);
        vm.prank(address(manager));
        hook.beforeAddLiquidity(positionManager, key, params, "");
        vm.prank(address(manager));
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadSeed.selector));
        hook.beforeAddLiquidity(positionManager, key, params, "");

        vm.prank(factory);
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadSeed.selector));
        hook.activatePool(keccak256("WRONG_REQUEST"), 1);
    }

    function testSeedRejectsWrongLiquidityTicksSaltAndZeroPrincipal() external {
        bytes32 requestHash = keccak256("BELL_CREATE_REQUEST");
        bytes32 salt = keccak256("INITIAL_POSITION");
        uint128 liquidity = 5e18;
        vm.prank(factory);
        hook.beginSeed(requestHash, -60, 60, salt, liquidity);
        PoolKey memory key = hook.poolKey();
        vm.prank(address(manager));
        hook.beforeInitialize(factory, key, 1);

        ModifyLiquidityParams memory params = _seedParams();
        params.liquidityDelta = int256(uint256(liquidity));
        params.salt = salt;
        params.tickUpper = 120;
        vm.prank(address(manager));
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadSeed.selector));
        hook.beforeAddLiquidity(positionManager, key, params, "");

        params.tickUpper = 60;
        params.salt = bytes32(uint256(9));
        vm.prank(address(manager));
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadSeed.selector));
        hook.beforeAddLiquidity(positionManager, key, params, "");

        params.salt = salt;
        vm.prank(address(manager));
        hook.beforeAddLiquidity(positionManager, key, params, "");
        vm.prank(address(manager));
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadSeed.selector));
        hook.afterAddLiquidity(positionManager, key, params, toBalanceDelta(0, -1), BalanceDeltaLibrary.ZERO_DELTA, "");
    }

    // -------------------------------------------------------------------------
    // Storage-cheatcode helpers for synthetic post-activation state
    // -------------------------------------------------------------------------

    function _setLifecycle(uint8 lifecycle) internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        word = (word & ~uint256(0xff)) | uint256(lifecycle);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
    }

    /// @dev Models a genuinely activated LIVE pool by committing the normative non-zero `bellStart` marker.
    /// Tests that intentionally model an unactivated LIVE pool keep using `_setLifecycle(LIVE)`.
    function _activate() internal {
        _setLifecycle(uint8(Lifecycle.LIVE));
        uint256 word = uint256(vm.load(address(hook), bytes32(AUX_STATE_SLOT)));
        uint256 mask = uint256(0xffffffffffffffff) << 64;
        word = (word & ~mask) | (uint256(1) << 64);
        vm.store(address(hook), bytes32(AUX_STATE_SLOT), bytes32(word));
    }

    function _setClosureNonce(uint64 nonce) internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        uint256 mask = uint256(0xffffffffffffffff) << 24;
        word = (word & ~mask) | (uint256(nonce) << 24);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
    }

    function _setBuckets(uint64 epoch, uint128 current0, uint128 current1, uint128 previous0, uint128 previous1)
        internal
    {
        vm.store(address(hook), bytes32(BUCKETS_EPOCH_SLOT), bytes32(uint256(epoch)));
        vm.store(address(hook), bytes32(BUCKETS_CURRENT_SLOT), bytes32(uint256(current0) | (uint256(current1) << 128)));
        vm.store(
            address(hook), bytes32(BUCKETS_PREVIOUS_SLOT), bytes32(uint256(previous0) | (uint256(previous1) << 128))
        );
    }

    function _setEpisodeGross(uint64 nonce, uint128 gross0, uint128 gross1) internal {
        bytes32 valueSlot = keccak256(abi.encode(uint256(nonce), EPISODE_GROSS_SLOT));
        vm.store(address(hook), valueSlot, bytes32(uint256(gross0) | (uint256(gross1) << 128)));
    }

    function _requireCounters(
        uint64 epoch,
        uint128 current0,
        uint128 current1,
        uint128 previous0,
        uint128 previous1,
        uint128 gross0,
        uint128 gross1,
        uint64 nonce
    ) internal view {
        Buckets memory buckets = hook.buckets();
        require(buckets.epoch == epoch, "epoch preserved");
        require(buckets.currentGross[0] == current0 && buckets.currentGross[1] == current1, "current preserved");
        require(buckets.previousGross[0] == previous0 && buckets.previousGross[1] == previous1, "previous preserved");
        uint128[2] memory gross = hook.episodeGross(nonce);
        require(gross[0] == gross0 && gross[1] == gross1, "episode preserved");
        require(hook.state().closureNonce == nonce, "nonce preserved");
    }
}
