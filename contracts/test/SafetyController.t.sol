// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafetyController} from "../src/SafetyController.sol";
import {PolicyConstants} from "../src/libraries/PolicyConstants.sol";

interface VmSafety {
    function warp(uint256 timestamp) external;
}

contract SafetyRoleCaller {
    function pausePool(SafetyController controller, address hook) external {
        controller.pausePool(hook);
    }

    function acceptRotation(SafetyController controller, bytes32 operationId) external {
        controller.acceptRoleRotation(operationId);
    }
}

contract SafetyControllerTest {
    VmSafety private constant vm = VmSafety(address(uint160(uint256(keccak256("hevm cheat code")))));

    function _newController() internal returns (SafetyController controller, SafetyRoleCaller guardian, SafetyRoleCaller treasury) {
        guardian = new SafetyRoleCaller();
        treasury = new SafetyRoleCaller();
        controller = new SafetyController(
            address(this), address(guardian), address(treasury),
            PolicyConstants.GOVERNANCE_MINIMUM_DELAY_SECONDS,
            PolicyConstants.CALENDAR_PUBLICATION_LEAD_SECONDS,
            PolicyConstants.GOVERNANCE_OPERATION_EXPIRY_SECONDS
        );
    }

    function testGuardianPauseAndDelayedPermissionlessResume() external {
        (SafetyController controller, SafetyRoleCaller guardian,) = _newController();
        address hook = address(new SafetyRoleCaller());
        bytes32 target = controller.targetId(1, hook);
        guardian.pausePool(controller, hook);
        (bool paused, uint64 nonce) = controller.pauseState(target);
        require(paused && nonce == 1, "pause state");
        bytes32 operationId = controller.queueResume(target, nonce);
        (,, uint64 eta,,) = controller.operation(operationId);
        vm.warp(eta - 1);
        (bool early,) = address(controller).call(abi.encodeCall(controller.executeResume, (operationId)));
        require(!early, "early resume allowed");
        vm.warp(eta);
        controller.executeResume(operationId);
        (paused, nonce) = controller.pauseState(target);
        require(!paused && nonce == 1, "resume changed nonce or stayed paused");
    }

    function testNewPauseInvalidatesQueuedResume() external {
        (SafetyController controller, SafetyRoleCaller guardian,) = _newController();
        address hook = address(new SafetyRoleCaller());
        bytes32 target = controller.targetId(1, hook);
        guardian.pausePool(controller, hook);
        (, uint64 nonce) = controller.pauseState(target);
        bytes32 operationId = controller.queueResume(target, nonce);
        guardian.pausePool(controller, hook);
        (,, uint64 eta,,) = controller.operation(operationId);
        vm.warp(eta);
        (bool executed,) = address(controller).call(abi.encodeCall(controller.executeResume, (operationId)));
        require(!executed, "stale resume executed");
        (bool paused, uint64 currentNonce) = controller.pauseState(target);
        require(paused && currentNonce == 2, "new pause not latched");
    }

    function testResumeExpiryAndCancellationKeepPauseActive() external {
        (SafetyController controller, SafetyRoleCaller guardian,) = _newController();
        address hook = address(new SafetyRoleCaller());
        bytes32 target = controller.targetId(1, hook);
        guardian.pausePool(controller, hook);
        (, uint64 nonce) = controller.pauseState(target);
        bytes32 expired = controller.queueResume(target, nonce);
        (,,, uint64 expiry,) = controller.operation(expired);
        vm.warp(uint256(expiry) + 1);
        (bool executed,) = address(controller).call(abi.encodeCall(controller.executeResume, (expired)));
        require(!executed, "expired resume executed");

        bytes32 cancelled = controller.queueResume(target, nonce);
        controller.cancel(cancelled);
        (,,,, uint8 status) = controller.operation(cancelled);
        require(status == 3, "operation not cancelled");
        (executed,) = address(controller).call(abi.encodeCall(controller.executeResume, (cancelled)));
        require(!executed, "cancelled resume executed");
    }

    function testRoleRotationRequiresDelayedSuccessorAcceptance() external {
        (SafetyController controller, SafetyRoleCaller guardian,) = _newController();
        SafetyRoleCaller successor = new SafetyRoleCaller();
        bytes32 operationId = controller.queueRoleRotation(1, address(successor), bytes32(uint256(1)));
        (,, uint64 eta,,) = controller.operation(operationId);
        vm.warp(eta);
        successor.acceptRotation(controller, operationId);
        require(controller.guardian() == address(successor), "successor not accepted");
        address hook = address(new SafetyRoleCaller());
        successor.pausePool(controller, hook);
        (bool oldGuardianAccepted,) = address(guardian).call(abi.encodeCall(guardian.pausePool, (controller, hook)));
        require(!oldGuardianAccepted, "old guardian retained role");
        (bool paused, uint64 nonce) = controller.pauseState(controller.targetId(1, hook));
        require(paused && nonce == 1, "rotated guardian did not gain role");
    }

    function testPendingRotationCannotCollapseGovernanceAndGuardianRoles() external {
        (SafetyController controller,,) = _newController();
        SafetyRoleCaller sharedSuccessor = new SafetyRoleCaller();
        bytes32 governanceRotation = controller.queueRoleRotation(0, address(sharedSuccessor), bytes32(uint256(11)));
        bytes32 guardianRotation = controller.queueRoleRotation(1, address(sharedSuccessor), bytes32(uint256(12)));
        (,, uint64 eta,,) = controller.operation(governanceRotation);
        vm.warp(eta);
        sharedSuccessor.acceptRotation(controller, governanceRotation);
        (bool accepted,) = address(sharedSuccessor).call(
            abi.encodeCall(sharedSuccessor.acceptRotation, (controller, guardianRotation))
        );
        require(!accepted, "same account accepted both separated roles");
        require(controller.governance() == address(sharedSuccessor), "governance rotation lost");
        require(controller.guardian() != address(sharedSuccessor), "guardian role collapsed into governance");
    }
}
