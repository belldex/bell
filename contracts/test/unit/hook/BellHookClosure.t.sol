// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHook} from "../../../src/BellHook.sol";
import {BellPolicyOracle} from "../../../src/BellPolicyOracle.sol";
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
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IBellErrors} from "../../../src/interfaces/ProtocolEvents.sol";

interface VmClosure {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function warp(uint256 newTimestamp) external;
    function store(address target, bytes32 slot, bytes32 value) external;
    function load(address target, bytes32 slot) external view returns (bytes32);
    function getNonce(address account) external view returns (uint64);
    function setNonce(address account, uint64 nonce) external;
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
}

contract ClosureToken {
    /// @dev The swap path reads token decimals; an empty mock would fail for the wrong reason.
    function decimals() external pure returns (uint8) {
        return 18;
    }
}

contract ClosureDependency {}

contract MockClosureSafety {
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

contract MockClosureAssets {
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

contract MockClosureCalendar {
    mapping(bytes32 assetId => CalendarLeaf leaf) private _current;
    mapping(bytes32 assetId => CalendarLeaf leaf) private _next;
    bool public nextReverts;

    function setCurrent(CalendarLeaf calldata leaf) external {
        _current[leaf.assetId] = leaf;
    }

    function setNext(CalendarLeaf calldata leaf) external {
        _next[leaf.assetId] = leaf;
    }

    function clearCurrent(bytes32 assetId) external {
        delete _current[assetId];
    }

    function clearNext(bytes32 assetId) external {
        delete _next[assetId];
    }

    function setNextReverts(bool value) external {
        nextReverts = value;
    }

    function currentInterval(bytes32 assetId) external view returns (CalendarLeaf memory) {
        return _current[assetId];
    }

    function nextInterval(bytes32 assetId) external view returns (CalendarLeaf memory) {
        if (nextReverts) revert("NEXT");
        return _next[assetId];
    }
}

contract MockClosureSessions {
    struct AnchorStatus {
        bool valid;
        uint256 reasons;
        uint64 validUntil;
        Anchor anchor;
    }

    mapping(bytes32 assetId => HealthView health) private _health;
    mapping(bytes32 assetId => mapping(uint8 phase => SourceSample sample)) private _samples;
    mapping(bytes32 assetId => mapping(bytes32 boundary => AnchorStatus status)) private _anchors;
    bool public anchorReverts;
    bool public sampleReverts;
    bool public malformedAnchor;
    uint64 public maxAnchorAge = PolicyConstants.MAX_ANCHOR_AGE_SECONDS;

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

    function setAnchorReverts(bool value) external {
        anchorReverts = value;
    }

    function setSampleReverts(bool value) external {
        sampleReverts = value;
    }

    function setMalformedAnchor(bool value) external {
        malformedAnchor = value;
    }

    function health(bytes32 assetId) external view returns (HealthView memory) {
        return _health[assetId];
    }

    function latestSample(bytes32 assetId, uint8 phase) external view returns (SourceSample memory) {
        if (sampleReverts) revert("SAMPLE");
        return _samples[assetId][phase];
    }

    function anchorStatus(bytes32 assetId, bytes32 boundary)
        external
        view
        returns (Anchor memory anchor, bool valid, uint256 reasons, uint64 validUntil)
    {
        if (anchorReverts) revert("ANCHOR");
        if (malformedAnchor) {
            // A well-formed anchor whose price18 word exceeds uint128. A caller that ignores the range check
            // would truncate it back to the stored (valid) price and wrongly accept the closure.
            AnchorStatus storage malformed = _anchors[assetId][boundary];
            bytes memory encoded = abi.encode(malformed.anchor, true, uint256(0), uint256(malformed.validUntil));
            assembly ("memory-safe") {
                mstore(add(encoded, 96), or(shl(128, 1), 100000000000000000000))
                return(add(encoded, 32), 384)
            }
        }
        AnchorStatus storage status = _anchors[assetId][boundary];
        anchor = status.anchor;
        if (anchor.assetId == bytes32(0)) {
            return (anchor, false, ReasonBits.ANCHOR_MISSING_OR_EXPIRED, 0);
        }
        if (anchor.inputAt == 0 || block.timestamp < anchor.inputAt || block.timestamp - anchor.inputAt > maxAnchorAge)
        {
            return (anchor, false, ReasonBits.ANCHOR_MISSING_OR_EXPIRED, 0);
        }
        valid = status.valid;
        reasons = status.reasons;
        validUntil = status.validUntil;
        if (validUntil == 0) {
            uint256 deadline = uint256(anchor.inputAt) + maxAnchorAge + 1;
            validUntil = deadline > type(uint64).max ? type(uint64).max : uint64(deadline);
        }
        if (validUntil <= block.timestamp) {
            valid = false;
            reasons |= ReasonBits.ANCHOR_MISSING_OR_EXPIRED;
        }
    }
}

/// @dev Unit tests for M05-03 planned closure and joint recovery.
/// All post-activation state is written with Foundry storage cheatcodes. This is a control-flow proof only:
/// it is not a legitimate M05-04/M06 LIVE activation route and the mocks do not prove calendar or source truth.
contract BellHookClosureTest {
    VmClosure private constant vm = VmClosure(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint160 private constant HOOK_FLAG_MASK = 0x3fff;
    uint160 private constant EXPECTED_HOOK_FLAGS = 0x2cc0;

    uint256 private constant STATE_SLOT = 0;
    uint256 private constant AUX_STATE_SLOT = 3;
    uint256 private constant BUCKETS_EPOCH_SLOT = 4;
    uint256 private constant BUCKETS_CURRENT_SLOT = 5;
    uint256 private constant BUCKETS_PREVIOUS_SLOT = 6;
    uint256 private constant EPISODE_GROSS_SLOT = 7;

    bytes32 private constant CLOSURE_STARTED = keccak256("ClosureStarted(bytes32,uint64)");
    bytes32 private constant CLOSURE_ENDED = keccak256("ClosureEnded(bytes32,uint64)");
    bytes32 private constant MODE_CHECKPOINT = keccak256("ModeCheckpoint(bytes32,uint8,uint256,uint64,uint64)");

    PoolManager private manager;
    address private token0;
    address private token1;
    bytes32 private asset0;
    bytes32 private asset1;
    address private factory;
    address private positionManager;
    address private treasuryAdapter;
    MockClosureSafety private safety;
    MockClosureAssets private assets;
    MockClosureCalendar private calendar;
    MockClosureSessions private sessions;
    bytes32 private templateCodeHash;
    BellHook private hook;
    BellPolicyOracle private oracle;

    function setUp() external {
        vm.warp(1_700_000_000);
        manager = new PoolManager(address(this));
        address tokenA = address(new ClosureToken());
        address tokenB = address(new ClosureToken());
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        asset0 = keccak256("ASSET_0");
        asset1 = keccak256("ASSET_1");
        factory = address(new ClosureDependency());
        positionManager = address(new ClosureDependency());
        treasuryAdapter = address(new ClosureDependency());
        safety = new MockClosureSafety();
        assets = new MockClosureAssets();
        calendar = new MockClosureCalendar();
        sessions = new MockClosureSessions();
        templateCodeHash = keccak256(type(BellHook).creationCode);
        oracle = new BellPolicyOracle();
        _installBaseState();
        hook = _deployHook();
    }

    // -------------------------------------------------------------------------
    // Planned closure / anchor
    // -------------------------------------------------------------------------

    function testPlannedClosureLatchesOnceAndUsesCanonicalBoundary() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        bytes32 boundary = _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);

        CalendarLeaf memory current = calendar.currentInterval(asset0);
        require(boundary == CalendarProof.hashLeaf(block.chainid, address(calendar), current), "boundary convention");

        PolicyView memory projected = hook.getPolicy();
        require(projected.mode == uint8(Mode.CLOSED), "view mode");
        require(!projected.canSwap, "view canSwap");
        require(!hook.state().closedLatched, "view wrote latch");
        require(hook.state().closureNonce == 0, "view wrote nonce");

        vm.recordLogs();
        PolicyView memory policy = hook.refreshState();
        VmClosure.Log[] memory logs = vm.getRecordedLogs();
        require(policy.mode == uint8(Mode.CLOSED), "closed mode");
        require(policy.canSwap, "valid closure canSwap");
        require(policy.reasonBits == 0, "closed reasons");
        require(policy.closureNonce == 1, "nonce");
        require(hook.state().closedLatched, "latch");
        require(hook.episodeGross(1)[0] == 0 && hook.episodeGross(1)[1] == 0, "episode not empty");
        require(_hasEvent(logs, CLOSURE_STARTED), "ClosureStarted");
        require(_hasEvent(logs, MODE_CHECKPOINT), "ModeCheckpoint");

        vm.recordLogs();
        hook.refreshState();
        logs = vm.getRecordedLogs();
        require(hook.state().closureNonce == 1, "nonce refilled");
        require(hook.episodeGross(1)[0] == 0 && hook.episodeGross(1)[1] == 0, "episode refilled");
        require(!_hasEvent(logs, CLOSURE_STARTED), "duplicate ClosureStarted");

        PolicyView memory viewAfterLatch = hook.getPolicy();
        require(viewAfterLatch.mode == uint8(Mode.CLOSED), "latched view mode");
        require(viewAfterLatch.closureNonce == 1, "latched view nonce");
        require(hook.state().closureNonce == 1, "latched view wrote nonce");
        PolicyView memory refreshedAgain = hook.refreshState();
        require(viewAfterLatch.stateHash == refreshedAgain.stateHash, "closure view/checkpoint hash parity");
    }

    function testUnexpectedClosedReportWhileCalendarActiveHaltsWithoutLatch() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        sessions.setClosedSample(asset0, nowTime - 5);

        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "halted");
        require(policy.reasonBits & ReasonBits.UNEXPECTED_CLOSED != 0, "unexpected closed");
        require(!hook.state().closedLatched, "latch created");
        require(hook.state().closureNonce == 0, "nonce created");
        require(hook.episodeGross(0)[0] == 0 && hook.episodeGross(0)[1] == 0, "episode created");
    }

    function testMissingAnchorBlocksThenLatchesWhenAnchorAppears() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        CalendarLeaf memory closed = _closedLeaf(asset0, nowTime, nowTime + 1000);
        calendar.setCurrent(closed);
        calendar.setNext(_activeLeaf(asset0, PolicyConstants.PHASE_REGULAR, nowTime + 1000, nowTime + 2000));

        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "halted");
        require(policy.reasonBits & ReasonBits.ANCHOR_MISSING_OR_EXPIRED != 0, "anchor reason");
        require(policy.reasonBits & ReasonBits.UNEXPECTED_CLOSED != 0, "unexpected closed");
        require(!hook.state().closedLatched, "latch created");
        require(hook.state().closureNonce == 0, "nonce created");

        bytes32 boundary = CalendarProof.hashLeaf(block.chainid, address(calendar), closed);
        _setAnchor(asset0, boundary, nowTime - 10, nowTime, nowTime + 345600);
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.CLOSED), "closed after anchor");
        require(policy.reasonBits == 0, "reasons after anchor");
        require(hook.state().closedLatched, "latch after anchor");
        require(hook.state().closureNonce == 1, "nonce after anchor");
    }

    function testExpiredAnchorBlocksAndPreservesExistingLatch() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        uint64 inputAt = nowTime - 10;
        bytes32 boundary = _setClosedContext(asset0, nowTime, nowTime + 400_000, inputAt);
        hook.refreshState();
        require(hook.state().closedLatched && hook.state().closureNonce == 1, "initial latch");

        _setEpisodeGross(1, 11, 13);
        vm.warp(uint256(inputAt) + PolicyConstants.MAX_ANCHOR_AGE_SECONDS + 1);
        _setQuoteHealthy();

        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "halted after expiry");
        require(policy.reasonBits & ReasonBits.ANCHOR_MISSING_OR_EXPIRED != 0, "expired anchor reason");
        require(hook.state().closedLatched, "latch cleared");
        require(hook.state().closureNonce == 1, "nonce changed");
        require(hook.episodeGross(1)[0] == 11 && hook.episodeGross(1)[1] == 13, "episode changed");
        require(boundary != bytes32(0), "boundary");
    }

    // -------------------------------------------------------------------------
    // Dependency read failures
    // -------------------------------------------------------------------------

    function testAnchorReadFailureBlocksClosureWithoutLatch() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);
        sessions.setAnchorReverts(true);

        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "anchor read halted");
        require(policy.reasonBits & ReasonBits.ANCHOR_MISSING_OR_EXPIRED != 0, "anchor read reason");
        require(!hook.state().closedLatched, "anchor read latch");
        require(hook.state().closureNonce == 0, "anchor read nonce");
    }

    function testMalformedAnchorReadIsAFailedDependency() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);
        sessions.setMalformedAnchor(true);

        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "malformed anchor halted");
        require(policy.reasonBits & ReasonBits.ANCHOR_MISSING_OR_EXPIRED != 0, "malformed anchor reason");
        require(!hook.state().closedLatched, "malformed anchor latch");
        require(hook.state().closureNonce == 0, "malformed anchor nonce");
    }

    function testNextCalendarReadFailureBlocksPlannedClosure() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);
        calendar.setNextReverts(true);

        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "next read halted");
        require(policy.reasonBits & ReasonBits.CALENDAR_CONFLICT != 0, "next read reason");
        require(!hook.state().closedLatched, "next read latch");
        require(hook.state().closureNonce == 0, "next read nonce");
    }

    function testClosedReportReadFailureBlocksActiveLeg() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        sessions.setSampleReverts(true);

        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "sample read halted");
        require(policy.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "sample read reason");
        require(!hook.state().closedLatched, "sample read latch");
        require(hook.state().closureNonce == 0, "sample read nonce");
    }

    // -------------------------------------------------------------------------
    // Two-stock overlap / partial reopen / flicker
    // -------------------------------------------------------------------------

    function testTwoStockOverlapTracksAnchorsIndependently() external {
        _enableSecondStock();
        _setLive();
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset1, nowTime - 10, nowTime + 500);
        _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);

        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.CLOSED), "first closed");
        require(policy.reasonBits == 0, "first reasons");
        require(hook.state().closureNonce == 1, "first nonce");

        vm.warp(nowTime + 10);
        _setActiveContext(asset1, nowTime + 5, nowTime + 500);
        bytes32 boundary1 = _setClosedContext(asset1, nowTime + 10, nowTime + 1010, nowTime);
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.CLOSED), "overlap closed");
        require(hook.state().closureNonce == 1, "overlap refilled");

        sessions.setAnchor(
            asset1,
            boundary1,
            0,
            1e18,
            nowTime,
            nowTime,
            nowTime + 10,
            nowTime,
            false,
            ReasonBits.CORPORATE_INCONSISTENT,
            nowTime + 345600
        );
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "corporate halted");
        require(policy.reasonBits & ReasonBits.CORPORATE_INCONSISTENT != 0, "corporate reason");
        require(hook.state().closedLatched, "latch cleared");
        require(hook.state().closureNonce == 1, "nonce changed");
    }

    function testPartialReopenStaysClosedAndCancelsCandidateOnFault() external {
        _enableSecondStock();
        _setLive();
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset1, nowTime - 10, nowTime + 500);
        _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);
        hook.refreshState();

        vm.warp(nowTime + 20);
        _setActiveContext(asset0, nowTime + 10, nowTime + 500);
        _setClosedContext(asset1, nowTime + 20, nowTime + 1020, nowTime + 10);
        hook.refreshState();
        require(hook.state().closedLatched && hook.state().closureNonce == 1, "both closed latch");

        // asset0 reopens, asset1 remains closed: still CLOSED and no recovery candidate.
        vm.warp(nowTime + 30);
        _setActiveContext(asset0, nowTime + 30, nowTime + 600);
        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.CLOSED), "partial closed");
        require(hook.state().closedLatched, "partial latch");
        require(hook.state().reopenCandidateAt == 0, "partial candidate");

        // A fault on the open leg cancels the candidate but keeps latch/nonce.
        sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "fault halted");
        require(hook.state().closedLatched, "fault latch");
        require(hook.state().closureNonce == 1, "fault nonce");
        require(hook.state().reopenCandidateAt == 0, "fault candidate");

        vm.warp(nowTime + 40);
        _setActiveContext(asset0, nowTime + 40, nowTime + 600);
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.CLOSED), "restored closed");
        require(hook.state().closedLatched, "restored latch");
    }

    function testRecoveryRequiresSixtySecondsAndNewObservations() external {
        _enableSecondStock();
        _setLive();
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset1, nowTime - 10, nowTime + 500);
        _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);
        hook.refreshState();
        vm.warp(nowTime + 20);
        _setClosedContext(asset1, nowTime + 20, nowTime + 1020, nowTime + 10);
        hook.refreshState();
        require(hook.state().closureNonce == 1, "latch nonce");

        uint64 t = nowTime + 30;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 500);
        _setActiveContext(asset1, t, t + 500);
        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.RECOVERING), "candidate mode");
        require(policy.reasonBits & ReasonBits.RECOVERY_PENDING != 0, "candidate reasons");
        require(hook.state().closedLatched, "candidate latch");
        require(hook.state().reopenCandidateAt == t, "candidate time");
        require(hook.state().reopenBaseObservations[0] == t && hook.state().reopenBaseObservations[1] == t, "baseline");
        require(hook.state().lastOpenObservations[0] == t && hook.state().lastOpenObservations[1] == t, "last open");
        require(hook.state().oldValidUntil == t + 500, "candidate old deadline");

        vm.warp(t + 30);
        _setActiveContext(asset0, t + 30, t + 530);
        _setActiveContext(asset1, t, t + 500);
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.RECOVERING), "not yet sixty");
        require(hook.state().reopenCandidateAt == t, "candidate reset early");

        vm.warp(t + 60);
        _setActiveContext(asset0, t + 60, t + 560);
        _setActiveContext(asset1, t, t + 500);
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.RECOVERING), "one stock did not advance");
        require(hook.state().reopenCandidateAt == t, "candidate reset on non-advance");

        vm.warp(t + 61);
        _setActiveContext(asset0, t + 61, t + 561);
        _setActiveContext(asset1, t + 61, t + 561);
        require(hook.getPolicy().mode == uint8(Mode.RECOVERING), "release projected before checkpoint");
        require(hook.state().closedLatched, "release wrote before checkpoint");

        vm.recordLogs();
        policy = hook.refreshState();
        VmClosure.Log[] memory logs = vm.getRecordedLogs();
        // M05-05 wired the gate: the released pool now reports its real mode.
        require(policy.mode != uint8(Mode.RECOVERING), "execution gate after release");
        require(!hook.state().closedLatched, "latch not released");
        require(hook.state().closureNonce == 1, "nonce changed on release");
        require(hook.state().reopenCandidateAt == 0, "candidate not cleared");
        require(
            hook.state().lastOpenObservations[0] == t + 61 && hook.state().lastOpenObservations[1] == t + 61,
            "last open not advanced"
        );
        require(_hasEvent(logs, CLOSURE_ENDED), "ClosureEnded");

        // A genuine later planned closure starts a new episode.
        vm.warp(t + 70);
        bytes32 boundary = _setClosedContext(asset0, t + 70, t + 1070, t + 60);
        require(boundary != bytes32(0), "new boundary");
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.CLOSED), "second closure");
        require(hook.state().closureNonce == 2, "second nonce");
        require(hook.state().closedLatched, "second latch");
    }

    function testRecoveryValidityGapResetsCandidateButKeepsEpisode() external {
        _enableSecondStock();
        _setLive();
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset1, nowTime - 10, nowTime + 500);
        _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);
        hook.refreshState();
        vm.warp(nowTime + 20);
        _setClosedContext(asset1, nowTime + 20, nowTime + 1020, nowTime + 10);
        hook.refreshState();
        _setEpisodeGross(1, 21, 23);

        uint64 t = nowTime + 30;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 100);
        _setActiveContext(asset1, t, t + 100);
        hook.refreshState();
        require(hook.state().reopenCandidateAt == t, "candidate start");
        require(hook.state().oldValidUntil == t + 100, "old deadline");

        vm.warp(t + 101);
        _setActiveContext(asset0, t + 101, t + 201);
        _setActiveContext(asset1, t + 101, t + 201);
        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.RECOVERING), "gap recovering");
        require(hook.state().reopenCandidateAt == t + 101, "gap candidate reset");
        require(hook.state().reopenBaseObservations[0] == t + 101, "gap baseline");
        require(hook.state().closedLatched, "gap latch");
        require(hook.episodeGross(1)[0] == 21 && hook.episodeGross(1)[1] == 23, "gap episode");

        vm.warp(t + 161);
        _setActiveContext(asset0, t + 161, t + 261);
        _setActiveContext(asset1, t + 161, t + 261);
        policy = hook.refreshState();
        require(policy.mode != uint8(Mode.RECOVERING), "released after reset");
        require(!hook.state().closedLatched, "latch after reset release");
        require(hook.episodeGross(1)[0] == 21 && hook.episodeGross(1)[1] == 23, "release refilled");
    }

    // -------------------------------------------------------------------------
    // Pause, counters and root rollover
    // -------------------------------------------------------------------------

    function testPauseLatchesPassivelyButCannotRefillOrClearCounters() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);
        hook.refreshState();
        require(hook.state().closureNonce == 1, "latch");

        _setEpisodeGross(1, 31, 37);
        _setBuckets(77, 10, 20, 30, 40);
        safety.setPause(ModePolicy.targetId(1, address(hook)), true, 1);

        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "paused halted");
        require(policy.reasonBits & ReasonBits.MANUAL_PAUSE != 0, "manual pause");
        require(!policy.canSwap, "paused canSwap");
        require(hook.state().closedLatched, "paused latch");
        require(hook.state().closureNonce == 1, "paused nonce");
        require(hook.episodeGross(1)[0] == 31 && hook.episodeGross(1)[1] == 37, "paused episode");
        _requireBuckets(77, 10, 20, 30, 40);

        safety.setPause(ModePolicy.targetId(1, address(hook)), false, 1);
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.CLOSED), "resumed closed");
        require(hook.state().closureNonce == 1, "resumed nonce");

        // Start recovery, then pause: candidate cancels, latch and counters stay.
        vm.warp(nowTime + 20);
        _setActiveContext(asset0, nowTime + 20, nowTime + 520);
        _setQuoteHealthy();
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.RECOVERING), "recovery start");
        require(hook.state().reopenCandidateAt == nowTime + 20, "recovery candidate");

        safety.setPause(ModePolicy.targetId(1, address(hook)), true, 2);
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "pause cancels candidate");
        require(hook.state().reopenCandidateAt == 0, "candidate retained");
        require(hook.state().closedLatched, "pause cleared latch");
        require(hook.state().closureNonce == 1, "pause changed nonce");
        require(hook.episodeGross(1)[0] == 31 && hook.episodeGross(1)[1] == 37, "pause changed episode");
        _requireBuckets(77, 10, 20, 30, 40);
    }

    function testPassiveLatchBeginsUnderPauseAndKeepsEpisode() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        safety.setPause(ModePolicy.targetId(1, address(hook)), true, 1);
        _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);

        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "paused close halted");
        require(policy.reasonBits & ReasonBits.MANUAL_PAUSE != 0, "paused close reason");
        require(hook.state().closedLatched, "passive latch");
        require(hook.state().closureNonce == 1, "passive nonce");

        _setEpisodeGross(1, 51, 53);
        hook.refreshState();
        require(hook.state().closureNonce == 1, "passive nonce refilled");
        require(hook.episodeGross(1)[0] == 51 && hook.episodeGross(1)[1] == 53, "passive episode refilled");

        safety.setPause(ModePolicy.targetId(1, address(hook)), false, 1);
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.CLOSED), "unpaused closed");
        require(hook.state().closureNonce == 1, "unpaused nonce");
    }

    function testFlickerAndRootRolloverNeverResetLatchOrCounters() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        _setClosedContext(asset0, nowTime, nowTime + 1000, nowTime - 10);
        hook.refreshState();
        _setEpisodeGross(1, 41, 43);

        // Flicker open then closed again: latch stays, candidate is cancelled, nonce does not move.
        vm.warp(nowTime + 20);
        _setActiveContext(asset0, nowTime + 20, nowTime + 520);
        _setQuoteHealthy();
        hook.refreshState();
        require(hook.state().closedLatched, "flicker latch");
        require(hook.state().reopenCandidateAt == nowTime + 20, "flicker candidate");

        _setClosedContext(asset0, nowTime + 20, nowTime + 1020, nowTime + 10);
        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.CLOSED), "flicker closed");
        require(hook.state().reopenCandidateAt == 0, "flicker candidate not cancelled");
        require(hook.state().closureNonce == 1, "flicker nonce");

        // Root rollover changes the closed leaf hash: the old anchor no longer matches.
        uint64 rolloverStart = nowTime + 20;
        CalendarLeaf memory rolled = _closedLeaf(asset0, rolloverStart, rolloverStart + 1000);
        rolled.provenanceHash = keccak256("ROOT_ROLLOVER");
        calendar.setCurrent(rolled);
        calendar.setNext(_activeLeaf(asset0, PolicyConstants.PHASE_REGULAR, rolled.end, rolled.end + 1000));
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "rollover halted");
        require(policy.reasonBits & ReasonBits.ANCHOR_MISSING_OR_EXPIRED != 0, "rollover anchor");
        require(hook.state().closedLatched, "rollover cleared latch");
        require(hook.state().closureNonce == 1, "rollover nonce");
        require(hook.episodeGross(1)[0] == 41 && hook.episodeGross(1)[1] == 43, "rollover episode");

        // Restoring the committed leaf proves the latch was preserved rather than recreated.
        _setClosedContext(asset0, rolloverStart, rolloverStart + 1000, nowTime + 10);
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.CLOSED), "restored closed");
        require(hook.state().closureNonce == 1, "restored nonce");
        require(hook.episodeGross(1)[0] == 41 && hook.episodeGross(1)[1] == 43, "restored episode");
    }

    function testCalendarConflictAndNoncontiguousContextBlockClosure() external {
        _setLive();
        _setQuoteHealthy();
        uint64 nowTime = uint64(block.timestamp);
        CalendarLeaf memory closed = _closedLeaf(asset0, nowTime, nowTime + 1000);
        calendar.setCurrent(closed);
        calendar.setNext(_activeLeaf(asset0, PolicyConstants.PHASE_REGULAR, nowTime + 1001, nowTime + 2000));
        bytes32 boundary = CalendarProof.hashLeaf(block.chainid, address(calendar), closed);
        _setAnchor(asset0, boundary, nowTime - 10, nowTime, nowTime + 345600);

        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "noncontiguous halted");
        require(policy.reasonBits & ReasonBits.CALENDAR_CONFLICT != 0, "noncontiguous reason");
        require(!hook.state().closedLatched, "noncontiguous latch");
        require(hook.state().closureNonce == 0, "noncontiguous nonce");

        // Missing next coverage is allowed, but a zero provenance leaf is not a committed context.
        calendar.clearNext(asset0);
        CalendarLeaf memory zeroProvenance = closed;
        zeroProvenance.provenanceHash = bytes32(0);
        calendar.setCurrent(zeroProvenance);
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "zero provenance halted");
        require(policy.reasonBits & ReasonBits.CALENDAR_CONFLICT != 0, "zero provenance reason");
        require(!hook.state().closedLatched, "zero provenance latch");

        calendar.clearCurrent(asset0);
        policy = hook.refreshState();
        require(policy.mode == uint8(Mode.HALTED), "missing calendar halted");
        require(policy.reasonBits & ReasonBits.CALENDAR_MISSING != 0, "missing calendar reason");
        require(!hook.state().closedLatched, "missing calendar latch");
    }

    // -------------------------------------------------------------------------
    // Ordinary fault recovery (no closure latch)
    // -------------------------------------------------------------------------

    /// @dev A committed fault checkpoint must not jump straight back to the steady state. The next healthy
    /// checkpoint opens a RECOVERING candidate with the fresh joint vector. The stored ACTIVE mode is a synthetic
    /// pre-fault fixture written with vm.store; it is not an activation route.
    function testOrdinaryFaultRecoveryEntersRecoveringWithBaseline() external {
        _setLive();
        _setMode(uint8(Mode.ACTIVE));
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        _setQuoteHealthy();

        sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        PolicyView memory faulted = hook.refreshState();
        require(faulted.mode == uint8(Mode.HALTED), "fault halted");
        require(hook.state().reopenCandidateAt == 0, "fault candidate");
        require(hook.state().oldValidUntil == 0, "fault deadline");

        uint64 t = nowTime + 10;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 500);
        _setQuoteHealthy();

        PolicyView memory projected = hook.getPolicy();
        require(projected.mode == uint8(Mode.RECOVERING), "view recovering");
        require(projected.reasonBits & ReasonBits.RECOVERY_PENDING != 0, "view reasons");
        require(hook.state().reopenCandidateAt == 0, "view wrote candidate");

        PolicyView memory recovering = hook.refreshState();
        require(recovering.mode == uint8(Mode.RECOVERING), "recovering");
        require(recovering.reasonBits & ReasonBits.RECOVERY_PENDING != 0, "recovering reasons");
        _expectPolicyBlocked(recovering.reasonBits);
        require(projected.stateHash == recovering.stateHash, "candidate view/checkpoint hash parity");
        require(hook.state().reopenCandidateAt == t, "candidate");
        require(hook.state().reopenBaseObservations[0] == t, "baseline0");
        require(hook.state().oldValidUntil == t + 500, "old deadline");
    }

    function testOrdinaryRecoveryRequiresSixtySecondsAndEveryStockAdvance() external {
        _enableSecondStock();
        _setLive();
        _setMode(uint8(Mode.ACTIVE));
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        _setActiveContext(asset1, nowTime - 10, nowTime + 500);

        sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        hook.refreshState();
        require(hook.state().mode == uint8(Mode.HALTED), "fault mode");

        uint64 t = nowTime + 10;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 500);
        _setActiveContext(asset1, t, t + 500);
        hook.refreshState();
        require(hook.state().reopenCandidateAt == t, "candidate");
        require(hook.state().reopenBaseObservations[0] == t, "baseline0");
        require(hook.state().reopenBaseObservations[1] == t, "baseline1");

        vm.warp(t + 30);
        _setActiveContext(asset0, t + 30, t + 530);
        _setActiveContext(asset1, t, t + 500);
        hook.refreshState();
        require(hook.state().mode == uint8(Mode.RECOVERING), "not yet sixty");
        require(hook.state().reopenCandidateAt == t, "candidate reset early");

        vm.warp(t + 60);
        _setActiveContext(asset0, t + 60, t + 560);
        _setActiveContext(asset1, t, t + 500);
        hook.refreshState();
        require(hook.state().mode == uint8(Mode.RECOVERING), "one stock did not advance");
        require(hook.state().reopenCandidateAt == t, "candidate reset on non-advance");

        vm.warp(t + 61);
        _setActiveContext(asset0, t + 61, t + 561);
        _setActiveContext(asset1, t + 61, t + 561);
        require(hook.getPolicy().mode == uint8(Mode.RECOVERING), "release projected");
        require(hook.state().reopenCandidateAt == t, "release wrote candidate");

        vm.recordLogs();
        PolicyView memory released = hook.refreshState();
        VmClosure.Log[] memory logs = vm.getRecordedLogs();
        require(released.mode != uint8(Mode.RECOVERING), "gate after recovery");
        require(released.reasonBits & ReasonBits.SETUP == 0, "gate reason");
        require(hook.state().reopenCandidateAt == 0, "candidate cleared");
        require(hook.state().oldValidUntil == t + 561, "old deadline updated");
        require(!_hasEvent(logs, CLOSURE_STARTED), "ordinary recovery closure start");
        require(!_hasEvent(logs, CLOSURE_ENDED), "ordinary recovery closure end");

        // Once recovered but execution-gated, a continuously valid vector stays in the gate instead of
        // starting a new 60-second recovery every checkpoint.
        vm.warp(t + 62);
        _setActiveContext(asset0, t + 62, t + 562);
        _setActiveContext(asset1, t + 62, t + 562);
        PolicyView memory steady = hook.refreshState();
        // M05-05 wired the gate, so a steady pool reports its real mode.
        require(steady.mode != uint8(Mode.RECOVERING), "steady gate");
        require(hook.state().reopenCandidateAt == 0, "steady candidate");
    }

    function testOrdinaryRecoveryFaultCancelsCandidateAndPreservesCounters() external {
        _setLive();
        _setMode(uint8(Mode.ACTIVE));
        _setClosureNonce(1);
        _setEpisodeGross(1, 61, 63);
        _setBuckets(77, 10, 20, 30, 40);
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        _setQuoteHealthy();

        sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        hook.refreshState();
        uint64 t = nowTime + 10;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 500);
        _setQuoteHealthy();
        hook.refreshState();
        require(hook.state().reopenCandidateAt == t, "candidate");

        safety.setPause(ModePolicy.targetId(1, address(hook)), true, 1);
        PolicyView memory paused = hook.refreshState();
        require(paused.mode == uint8(Mode.HALTED), "pause halted");
        require(paused.reasonBits & ReasonBits.MANUAL_PAUSE != 0, "pause reason");
        require(hook.state().reopenCandidateAt == 0, "pause candidate");
        require(hook.state().oldValidUntil == 0, "pause deadline");
        require(hook.state().closureNonce == 1, "pause nonce");
        require(hook.episodeGross(1)[0] == 61 && hook.episodeGross(1)[1] == 63, "pause episode");
        _requireBuckets(77, 10, 20, 30, 40);

        vm.warp(t + 20);
        safety.setPause(ModePolicy.targetId(1, address(hook)), false, 1);
        _setActiveContext(asset0, t + 20, t + 520);
        _setQuoteHealthy();
        PolicyView memory restarted = hook.refreshState();
        require(restarted.mode == uint8(Mode.RECOVERING), "restart recovering");
        require(hook.state().reopenCandidateAt == t + 20, "restart candidate");
        require(hook.state().closureNonce == 1, "restart nonce");
        require(hook.episodeGross(1)[0] == 61 && hook.episodeGross(1)[1] == 63, "restart episode");
        _requireBuckets(77, 10, 20, 30, 40);
    }

    function testOrdinaryRecoveryOldDeadlineGapRestartsCandidate() external {
        _setLive();
        _setMode(uint8(Mode.ACTIVE));
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        _setQuoteHealthy();

        sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        hook.refreshState();
        uint64 t = nowTime + 10;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 100);
        _setQuoteHealthy();
        hook.refreshState();
        require(hook.state().reopenCandidateAt == t, "candidate");
        require(hook.state().oldValidUntil == t + 100, "old deadline");

        vm.warp(t + 101);
        _setActiveContext(asset0, t + 101, t + 201);
        _setQuoteHealthy();
        PolicyView memory policy = hook.refreshState();
        require(policy.mode == uint8(Mode.RECOVERING), "gap recovering");
        require(hook.state().reopenCandidateAt == t + 101, "gap candidate");
        require(hook.state().reopenBaseObservations[0] == t + 101, "gap baseline");
    }

    function testOrdinaryRecoveryDoesNotEndClosureEpisodeAndLatchStillWorks() external {
        _setLive();
        _setMode(uint8(Mode.ACTIVE));
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        _setQuoteHealthy();

        sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        hook.refreshState();
        uint64 t = nowTime + 10;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 500);
        _setQuoteHealthy();
        hook.refreshState();
        require(hook.state().reopenCandidateAt == t, "candidate");

        vm.warp(t + 60);
        _setActiveContext(asset0, t + 60, t + 560);
        _setQuoteHealthy();
        vm.recordLogs();
        PolicyView memory released = hook.refreshState();
        VmClosure.Log[] memory logs = vm.getRecordedLogs();
        require(released.mode != uint8(Mode.RECOVERING), "gate after ordinary recovery");
        require(released.reasonBits & ReasonBits.SETUP == 0, "gate reason");
        require(!_hasEvent(logs, CLOSURE_ENDED), "ordinary recovery emitted ClosureEnded");

        // A genuine planned closure after ordinary recovery still starts exactly one episode.
        vm.warp(t + 70);
        bytes32 boundary = _setClosedContext(asset0, t + 70, t + 1070, t + 60);
        require(boundary != bytes32(0), "boundary");
        vm.recordLogs();
        PolicyView memory closed = hook.refreshState();
        logs = vm.getRecordedLogs();
        require(closed.mode == uint8(Mode.CLOSED), "planned closed");
        require(hook.state().closureNonce == 1, "closure nonce");
        require(hook.state().closedLatched, "closure latch");
        require(_hasEvent(logs, CLOSURE_STARTED), "ClosureStarted");
    }

    // -------------------------------------------------------------------------
    // Review regressions: activation, missed deadline, fingerprint, stock mask, hash
    // -------------------------------------------------------------------------

    function testActiveMissedOldDeadlineStartsOrdinaryRecovery() external {
        _setLive();
        _setMode(uint8(Mode.ACTIVE));
        uint64 nowTime = uint64(block.timestamp);
        _setOldValidUntil(nowTime - 1);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        _setQuoteHealthy();

        PolicyView memory projected = hook.getPolicy();
        require(projected.mode == uint8(Mode.RECOVERING), "missed deadline recovering");
        require(projected.reasonBits & ReasonBits.RECOVERY_PENDING != 0, "missed deadline pending");
        require(hook.state().reopenCandidateAt == 0, "view wrote candidate");

        PolicyView memory recovering = hook.refreshState();
        require(recovering.mode == uint8(Mode.RECOVERING), "checkpoint recovering");
        require(hook.state().reopenCandidateAt == nowTime, "candidate at now");
        require(hook.state().reopenBaseObservations[0] == nowTime - 10, "baseline");

        vm.warp(nowTime + 60);
        _setActiveContext(asset0, nowTime + 60, nowTime + 560);
        _setQuoteHealthy();
        PolicyView memory released = hook.refreshState();
        require(released.mode != uint8(Mode.RECOVERING), "gate after release");
        require(released.reasonBits & ReasonBits.SETUP == 0, "gate reason");
        require(hook.state().reopenCandidateAt == 0, "released candidate");
    }

    function testLiveWithoutActivationMarkerStaysBlocked() external {
        _setLiveUnactivated();
        _setMode(uint8(Mode.ACTIVE));
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        _setQuoteHealthy();

        PolicyView memory healthy = hook.refreshState();
        require(healthy.mode == uint8(Mode.HALTED), "unactivated healthy");
        require(healthy.reasonBits & ReasonBits.SETUP != 0, "unactivated healthy setup");
        require(hook.state().reopenCandidateAt == 0, "unactivated healthy candidate");

        sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        PolicyView memory faulted = hook.refreshState();
        require(faulted.mode == uint8(Mode.HALTED), "unactivated fault");
        require(faulted.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "unactivated fault reason");
        require(hook.state().reopenCandidateAt == 0, "unactivated fault candidate");

        vm.warp(nowTime + 10);
        _setActiveContext(asset0, nowTime + 10, nowTime + 510);
        _setQuoteHealthy();
        PolicyView memory afterFault = hook.refreshState();
        require(afterFault.mode == uint8(Mode.HALTED), "unactivated after fault");
        require(afterFault.reasonBits & ReasonBits.SETUP != 0, "unactivated after fault setup");
        require(hook.state().reopenCandidateAt == 0, "unactivated after fault candidate");
        require(!afterFault.canSwap, "unactivated canSwap");
    }

    function testOrdinaryRecoveryAfterFingerprintChange() external {
        _setLive();
        _setMode(uint8(Mode.ACTIVE));
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        _setQuoteHealthy();

        AssetDescriptor memory rotated = _descriptor(asset0, token0, true);
        rotated.expectedCodeHash = keccak256("ROTATED_CODE");
        assets.setDescriptor(rotated);
        PolicyView memory faulted = hook.refreshState();
        require(faulted.mode == uint8(Mode.HALTED), "fingerprint halted");
        require(faulted.reasonBits & ReasonBits.FINGERPRINT_CHANGED != 0, "fingerprint reason");
        require(hook.state().reopenCandidateAt == 0, "fingerprint candidate");

        assets.setDescriptor(_descriptor(asset0, token0, true));
        uint64 t = nowTime + 10;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 500);
        _setQuoteHealthy();
        PolicyView memory recovering = hook.refreshState();
        require(recovering.mode == uint8(Mode.RECOVERING), "fingerprint recovery");
        require(hook.state().reopenCandidateAt == t, "fingerprint recovery candidate");
        require(hook.state().reopenBaseObservations[0] == t, "fingerprint recovery baseline");
    }

    function testOrdinaryRecoveryUsesSecondStockObservationOnly() external {
        assets.setDescriptor(_descriptor(asset0, token0, false));
        assets.setDescriptor(_descriptor(asset1, token1, true));
        _setLive();
        _setMode(uint8(Mode.ACTIVE));
        uint64 nowTime = uint64(block.timestamp);
        sessions.setHealth(asset0, _healthyHealth(nowTime - 10, nowTime + 500));
        _setActiveContext(asset1, nowTime - 10, nowTime + 500);

        sessions.setHealth(asset1, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        hook.refreshState();

        uint64 t = nowTime + 10;
        vm.warp(t);
        sessions.setHealth(asset0, _healthyHealth(t - 10, t + 500));
        _setActiveContext(asset1, t, t + 500);
        hook.refreshState();
        require(hook.state().reopenCandidateAt == t, "second stock candidate");
        require(hook.state().reopenBaseObservations[1] == t, "second stock baseline");

        // The quote observation advances but the stock does not: still recovering.
        vm.warp(t + 60);
        sessions.setHealth(asset0, _healthyHealth(t + 50, t + 560));
        _setActiveContext(asset1, t, t + 500);
        hook.refreshState();
        require(hook.state().mode == uint8(Mode.RECOVERING), "quote cannot substitute");
        require(hook.state().reopenCandidateAt == t, "second stock candidate retained");

        vm.warp(t + 61);
        sessions.setHealth(asset0, _healthyHealth(t + 51, t + 561));
        _setActiveContext(asset1, t + 61, t + 561);
        hook.refreshState();
        require(hook.state().mode != uint8(Mode.RECOVERING), "second stock gate");
        require(hook.state().reopenCandidateAt == 0, "second stock released");
    }

    function testQuoteObservationDoesNotSatisfyStockRecovery() external {
        _setLive();
        _setMode(uint8(Mode.ACTIVE));
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        _setQuoteHealthy();
        sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        hook.refreshState();

        uint64 t = nowTime + 10;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 500);
        _setQuoteHealthy();
        hook.refreshState();
        require(hook.state().reopenCandidateAt == t, "stock candidate");
        require(hook.state().reopenBaseObservations[0] == t, "stock baseline");

        // Only the quote advances: the stock observation still gates the release.
        vm.warp(t + 60);
        _setActiveContext(asset0, t, t + 500);
        _setQuoteHealthy();
        hook.refreshState();
        require(hook.state().mode == uint8(Mode.RECOVERING), "quote cannot satisfy stock");
        require(hook.state().reopenCandidateAt == t, "stock candidate retained");

        vm.warp(t + 61);
        _setActiveContext(asset0, t + 61, t + 561);
        _setQuoteHealthy();
        hook.refreshState();
        require(hook.state().mode != uint8(Mode.RECOVERING), "stock gate");
    }

    function testViewOnlyReleaseKeepsPersistedStateAndStableHash() external {
        _setLive();
        _setMode(uint8(Mode.ACTIVE));
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 500);
        _setQuoteHealthy();
        sessions.setHealth(asset0, _unhealthyHealth(ReasonBits.REPORT_INVALID_OR_STALE));
        hook.refreshState();

        uint64 t = nowTime + 10;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 500);
        _setQuoteHealthy();
        hook.refreshState();

        vm.warp(t + 61);
        _setActiveContext(asset0, t + 61, t + 561);
        _setQuoteHealthy();

        PoolState memory before = hook.state();
        PolicyView memory view1 = hook.getPolicy();
        PolicyView memory view2 = hook.getPolicy();
        require(view1.mode == uint8(Mode.RECOVERING), "view release projected");
        require(view1.stateHash == view2.stateHash, "view hash stable");
        require(keccak256(abi.encode(before)) == keccak256(abi.encode(hook.state())), "view wrote state");
        require(hook.state().reopenCandidateAt == t, "view cleared candidate");

        PolicyView memory committed = hook.refreshState();
        require(committed.mode != uint8(Mode.RECOVERING), "checkpoint gate");
        require(committed.stateHash != view1.stateHash, "checkpoint hash changed");
        require(hook.state().reopenCandidateAt == 0, "checkpoint cleared candidate");
    }

    // -------------------------------------------------------------------------
    // Deployment and fixtures
    // -------------------------------------------------------------------------

    function deployHook(PoolConfig calldata config, PoolKey calldata key, bytes32 templateHash, address sessionRegistry)
        external
        returns (address)
    {
        return address(new BellHook(config, key, templateHash, sessionRegistry, oracle));
    }

    function testSyntheticStateHelpersWritePackedFields() external {
        _setLiveUnactivated();
        require(hook.state().bellStart == 0, "bellStart default");
        _setBellStart(123);
        require(hook.state().bellStart == 123, "bellStart write");
        _setOldValidUntil(456);
        require(hook.state().oldValidUntil == 456, "oldValidUntil write");
    }

    function _swapParams() internal pure returns (SwapParams memory params) {
        params.zeroForOne = true;
        params.amountSpecified = -1e18;
        params.sqrtPriceLimitX96 = 0;
    }

    function _expectPolicyBlocked(uint256 reasons) internal {
        PoolKey memory key = hook.poolKey();
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.PolicyBlocked.selector, reasons));
        vm.prank(address(manager));
        hook.beforeSwap(factory, key, _swapParams(), "");
    }

    function _deployHook() internal returns (BellHook) {
        (uint64 nonce, address predicted) = _nextValidAddress();
        vm.setNonce(address(this), nonce);
        BellHook deployed = BellHook(this.deployHook(_config(), _key(), templateCodeHash, address(sessions)));
        require(address(deployed) == predicted, "hook address prediction");
        return deployed;
    }

    function _nextValidAddress() internal view returns (uint64 nonce, address predicted) {
        nonce = vm.getNonce(address(this));
        while (true) {
            predicted = vm.computeCreateAddress(address(this), nonce);
            if (uint160(predicted) & HOOK_FLAG_MASK == EXPECTED_HOOK_FLAGS) return (nonce, predicted);
            ++nonce;
        }
    }

    function _installBaseState() internal {
        assets.setDescriptor(_descriptor(asset0, token0, true));
        assets.setDescriptor(_descriptor(asset1, token1, false));
        uint64 nowTime = uint64(block.timestamp);
        calendar.setCurrent(_activeLeaf(asset0, PolicyConstants.PHASE_REGULAR, nowTime - 100, nowTime + 1000));
        calendar.setNext(_activeLeaf(asset0, PolicyConstants.PHASE_REGULAR, nowTime + 1000, nowTime + 2000));
        sessions.setHealth(asset0, _healthyHealth(nowTime - 10, nowTime + 500));
        sessions.setHealth(asset1, _healthyHealth(nowTime - 10, nowTime + 500));
    }

    function _enableSecondStock() internal {
        assets.setDescriptor(_descriptor(asset1, token1, true));
        sessions.setHealth(asset1, _healthyHealth(uint64(block.timestamp) - 10, uint64(block.timestamp) + 500));
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
        config.referenceAdapter0 = address(0);
        config.referenceAdapter1 = address(0);
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

    function _activeLeaf(bytes32 assetId, uint8 phase, uint64 start, uint64 end)
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
        leaf.provenanceHash = keccak256(abi.encode("ACTIVE", assetId, start, end));
    }

    function _closedLeaf(bytes32 assetId, uint64 start, uint64 end) internal pure returns (CalendarLeaf memory leaf) {
        leaf.assetId = assetId;
        leaf.year = 2026;
        leaf.index = 1;
        leaf.start = start;
        leaf.end = end;
        leaf.phase = PolicyConstants.PHASE_CLOSED;
        leaf.provenanceHash = keccak256(abi.encode("CLOSED", assetId, start, end));
    }

    function _setClosedContext(bytes32 assetId, uint64 start, uint64 end, uint64 inputAt)
        internal
        returns (bytes32 boundary)
    {
        CalendarLeaf memory closed = _closedLeaf(assetId, start, end);
        calendar.setCurrent(closed);
        calendar.setNext(_activeLeaf(assetId, PolicyConstants.PHASE_REGULAR, end, end + 1000));
        boundary = CalendarProof.hashLeaf(block.chainid, address(calendar), closed);
        _setAnchor(assetId, boundary, inputAt, start, inputAt + 345_600 + 1);
    }

    function _setAnchor(bytes32 assetId, bytes32 boundary, uint64 inputAt, uint64 closureStart, uint64 validUntil)
        internal
    {
        sessions.setAnchor(
            assetId, boundary, 100e18, 1e18, inputAt, inputAt, closureStart, inputAt, true, 0, validUntil
        );
    }

    function _setActiveContext(bytes32 assetId, uint64 observation, uint64 validUntil) internal {
        uint64 nowTime = uint64(block.timestamp);
        calendar.setCurrent(_activeLeaf(assetId, PolicyConstants.PHASE_REGULAR, nowTime - 100, nowTime + 1000));
        sessions.setHealth(assetId, _healthyHealth(observation, validUntil));
    }

    function _setQuoteHealthy() internal {
        uint64 nowTime = uint64(block.timestamp);
        sessions.setHealth(asset1, _healthyHealth(nowTime - 10, nowTime + 500));
    }

    function _healthyHealth(uint64 observation, uint64 validUntil) internal view returns (HealthView memory health_) {
        health_.ready = true;
        health_.reasonBits = 0;
        health_.healthySince = uint64(block.timestamp - 100);
        health_.validUntil = validUntil;
        health_.baselineObservation = observation > 50 ? observation - 50 : observation;
        health_.latestObservation = observation;
    }

    function _unhealthyHealth(uint256 reasons) internal pure returns (HealthView memory health_) {
        health_.ready = false;
        health_.reasonBits = reasons;
        health_.validUntil = 0;
    }

    function _setLive() internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        word = (word & ~uint256(0xff)) | uint256(Lifecycle.LIVE);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
        // A genuinely activated fixture also commits the normative bellStart marker. Tests that model an
        // unactivated LIVE pool use `_setLiveUnactivated` instead.
        _setBellStart(1);
    }

    function _setLiveUnactivated() internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        word = (word & ~uint256(0xff)) | uint256(Lifecycle.LIVE);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
    }

    function _setBellStart(uint64 value) internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(AUX_STATE_SLOT)));
        uint256 mask = uint256(0xffffffffffffffff) << 64;
        word = (word & ~mask) | (uint256(value) << 64);
        vm.store(address(hook), bytes32(AUX_STATE_SLOT), bytes32(word));
    }

    function _setOldValidUntil(uint64 value) internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        uint256 mask = uint256(0xffffffffffffffff) << 152;
        word = (word & ~mask) | (uint256(value) << 152);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
    }

    function _setMode(uint8 mode_) internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        word = (word & ~(uint256(0xff) << 8)) | (uint256(mode_) << 8);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
    }

    function _setClosureNonce(uint64 nonce) internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        uint256 mask = uint256(0xffffffffffffffff) << 24;
        word = (word & ~mask) | (uint256(nonce) << 24);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
    }

    function _setEpisodeGross(uint64 nonce, uint128 gross0, uint128 gross1) internal {
        bytes32 valueSlot = keccak256(abi.encode(uint256(nonce), EPISODE_GROSS_SLOT));
        vm.store(address(hook), valueSlot, bytes32(uint256(gross0) | (uint256(gross1) << 128)));
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

    function _requireBuckets(uint64 epoch, uint128 current0, uint128 current1, uint128 previous0, uint128 previous1)
        internal
        view
    {
        Buckets memory buckets = hook.buckets();
        require(buckets.epoch == epoch, "epoch");
        require(buckets.currentGross[0] == current0 && buckets.currentGross[1] == current1, "current");
        require(buckets.previousGross[0] == previous0 && buckets.previousGross[1] == previous1, "previous");
    }

    function _hasEvent(VmClosure.Log[] memory logs, bytes32 topic) internal pure returns (bool) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length != 0 && logs[i].topics[0] == topic) return true;
        }
        return false;
    }
}
