// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HaltRegistry, IHaltHybridAuth} from "../src/registries/HaltRegistry.sol";

interface VmHalt {
    function warp(uint256 timestamp) external;
}

/// @dev Stands in for HybridAuth: accepts only when both signature fields are non-empty, and counts leaves and actions.
contract MockHaltAuth {
    uint32 public leaves;
    bytes32 public lastAction;
    bytes32 public lastRole;

    function authorize(bytes32 role, bytes32 action, bytes32, uint256 deadline, bytes calldata ecdsaSignature, bytes calldata pqSignature)
        external
        returns (uint32)
    {
        require(block.timestamp <= deadline, "deadline");
        require(ecdsaSignature.length != 0 && pqSignature.length != 0, "hybrid signature missing");
        lastAction = action;
        lastRole = role;
        return ++leaves;
    }
}

contract HaltClock { function now_() external view returns (uint256) { return block.timestamp; } }

contract HaltRegistryTest {
    VmHalt private constant vm = VmHalt(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant ASSET = keccak256("ANT");
    bytes32 private constant ROLE = keccak256("REPORTER");
    bytes32 private constant REASON = keccak256("LULD");
    uint256 private constant T0 = 1_800_000_000;

    HaltClock private clock = new HaltClock();
    MockHaltAuth private auth;
    HaltRegistry private reg;

    function _now() internal view returns (uint256) { return clock.now_(); }

    function _setUp() internal {
        vm.warp(T0);
        auth = new MockHaltAuth();
        reg = new HaltRegistry(IHaltHybridAuth(address(auth)), ROLE);
    }

    function _halt(uint64 id, uint64 startTs) internal returns (bool ok) {
        (ok,) = address(reg).call(abi.encodeCall(reg.halt, (ASSET, id, startTs, REASON, _now() + 600, hex"01", hex"02")));
    }

    function _resume(uint64 id, uint64 ts, bytes memory pq) internal returns (bool ok) {
        (ok,) = address(reg).call(abi.encodeCall(reg.resume, (ASSET, id, ts, _now() + 600, hex"01", pq)));
    }

    function testAHaltNeedsBothSignaturesSoAnEcdsaOnlyHaltRevertsV3() external {
        _setUp();
        (bool ok,) = address(reg).call(abi.encodeCall(reg.halt, (ASSET, 1, uint64(_now() - 120), REASON, _now() + 600, hex"01", bytes(""))));
        require(!ok, "ecdsa-only halt accepted");
        require(reg.phase(ASSET) == HaltRegistry.Phase.NORMAL, "state changed on a refused halt");
        require(auth.leaves() == 0, "leaf spent on a refused halt");
    }

    function testAHybridHaltMakesTheAssetHaltedAndSpendsOneReporterLeafV1() external {
        _setUp();
        require(_halt(1, uint64(_now() - 180)), "halt refused");
        require(reg.phase(ASSET) == HaltRegistry.Phase.HALTED, "not halted");
        require(auth.leaves() == 1 && reg.leavesUsed() == 1, "wrong leaf count");
        require(auth.lastAction() == reg.HALT_ACTION() && auth.lastRole() == ROLE, "wrong action or role");
        require(reg.reportDelay(ASSET) == 180, "report delay not recorded");
    }

    function testHaltIdsMustCountUpAndAHaltCannotBeStackedOrBackdatedOrFuture() external {
        _setUp();
        require(!_halt(2, uint64(_now())), "skipped halt id accepted");
        require(!_halt(1, uint64(_now() + 1)), "future start accepted");
        require(!_halt(1, uint64(_now() - 2 days)), "start older than a day accepted");
        require(_halt(1, uint64(_now())), "valid halt refused");
        require(!_halt(2, uint64(_now())), "second halt accepted while halted");
    }

    function testAHaltExpiresOnItsOwnSoThePoolCanNeverBeStuckV4() external {
        _setUp();
        require(_halt(1, uint64(_now())), "halt refused");
        vm.warp(T0 + 2 hours - 1);
        require(reg.phase(ASSET) == HaltRegistry.Phase.HALTED, "expired early");
        vm.warp(T0 + 2 hours);
        require(reg.phase(ASSET) == HaltRegistry.Phase.NORMAL, "still halted after the maximum");
    }

    function testRenewExtendsARunningHaltButNotALapsedOne() external {
        _setUp();
        require(_halt(1, uint64(_now())), "halt refused");
        vm.warp(T0 + 100 minutes);
        reg.renew(ASSET, 1, _now() + 600, hex"01", hex"02");
        vm.warp(T0 + 3 hours);
        require(reg.phase(ASSET) == HaltRegistry.Phase.HALTED, "renewal did not extend");
        vm.warp(T0 + 100 minutes + 2 hours);
        (bool ok,) = address(reg).call(abi.encodeCall(reg.renew, (ASSET, 1, _now() + 600, hex"01", hex"02")));
        require(!ok, "lapsed halt renewed");
        require(_halt(2, uint64(_now())), "new halt after lapse refused");
    }

    function testResumeStartsTheFiveMinuteAuctionThenReturnsToNormalV2() external {
        _setUp();
        require(_halt(1, uint64(_now() - 60)), "halt refused");
        vm.warp(T0 + 30 minutes);
        require(_resume(1, uint64(_now() - 30), hex"02"), "resume refused");
        require(reg.phase(ASSET) == HaltRegistry.Phase.RESUME_AUCTION, "no resume auction");
        require(auth.lastAction() == reg.RESUME_ACTION(), "wrong action");
        vm.warp(T0 + 30 minutes + 5 minutes - 1);
        require(reg.phase(ASSET) == HaltRegistry.Phase.RESUME_AUCTION, "auction ended early");
        vm.warp(T0 + 30 minutes + 5 minutes);
        require(reg.phase(ASSET) == HaltRegistry.Phase.NORMAL, "auction never ends");
    }

    function testResumeNeedsBothSignaturesTheRightHaltAndASaneTime() external {
        _setUp();
        require(_halt(1, uint64(_now())), "halt refused");
        vm.warp(T0 + 10 minutes);
        require(!_resume(1, uint64(_now() - 5), bytes("")), "ecdsa-only resume accepted");
        require(!_resume(2, uint64(_now() - 5), hex"02"), "wrong halt id accepted");
        require(!_resume(1, uint64(T0 - 1), hex"02"), "resume before the halt began accepted");
        require(!_resume(1, uint64(_now() + 1), hex"02"), "resume in the future accepted");
        require(reg.phase(ASSET) == HaltRegistry.Phase.HALTED, "state changed on refused resumes");
    }

    function testNothingToResumeWhenNotHalted() external {
        _setUp();
        require(!_resume(1, uint64(_now()), hex"02"), "resume with no halt accepted");
    }

    function testEachAssetHasItsOwnState() external {
        _setUp();
        require(_halt(1, uint64(_now())), "halt refused");
        require(reg.phase(keccak256("NVDA")) == HaltRegistry.Phase.NORMAL, "another asset halted");
    }

    function testLeafBudgetIsTrackedAndRotationFlagsAt80Percent() external {
        _setUp();
        require(!reg.rotationDue(), "rotation due at start");
        require(reg.ROTATION_THRESHOLD() * 100 / reg.LEAF_BUDGET() >= 80, "threshold below 80 percent");
        require(_halt(1, uint64(_now())), "halt refused");
        require(reg.leavesUsed() == 1, "leaf not counted");
    }
}
