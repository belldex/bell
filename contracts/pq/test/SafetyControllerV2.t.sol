// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PQKeyRegistry} from "../src/PQKeyRegistry.sol";
import {HybridAuth, IHashSigVerifier} from "../src/HybridAuth.sol";
import {SafetyControllerV2} from "../src/SafetyControllerV2.sol";

interface VmSafetyV2 {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
}

contract SafetyV2MockVerifier is IHashSigVerifier {
    function verify(bytes32, bytes32, bytes calldata signature) external pure returns (bool valid, uint32 leaf) {
        return abi.decode(signature, (bool, uint32));
    }
}

contract SafetyV2GovernedTarget {
    address public immutable controller;
    bytes32 public acceptedValue;
    bytes32 public cancelledOperation;

    constructor(address controller_) {
        controller = controller_;
    }

    function setValue(bytes32 value) external {
        require(msg.sender == controller, "controller only");
        acceptedValue = value;
    }

    function fail() external pure {
        revert("target failure");
    }

    function cancel(bytes32 operationId) external {
        require(msg.sender == controller, "controller only");
        cancelledOperation = operationId;
    }
}

contract SafetyControllerV2Test {
    VmSafetyV2 private constant vm = VmSafetyV2(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant GOV_KEY = 0xCA11;
    uint256 private constant GUARDIAN_KEY = 0xCA12;
    bytes32 private constant GOV_ROLE = keccak256("GOVERNANCE");
    bytes32 private constant GUARDIAN_ROLE = keccak256("GUARDIAN");
    bytes32 private constant GOV_COMMITMENT = keccak256("gov-root");
    bytes32 private constant GUARDIAN_COMMITMENT = keccak256("guardian-root");

    PQKeyRegistry private registry;
    HybridAuth private auth;
    SafetyControllerV2 private controller;

    function setUp() public {
        registry = new PQKeyRegistry(address(this));
        auth = new HybridAuth(registry, new SafetyV2MockVerifier());
        registry.bootstrapRole(GOV_ROLE, vm.addr(GOV_KEY), GOV_COMMITMENT, 32);
        registry.bootstrapRole(GUARDIAN_ROLE, vm.addr(GUARDIAN_KEY), GUARDIAN_COMMITMENT, 32);
        registry.setHybridAuth(address(auth));
        registry.finalizeBootstrap();
        controller = new SafetyControllerV2(auth, 1 days, 1 hours, 3 days);
    }

    function testGuardianPauseRequiresHybridAuthorization() public {
        address hook = address(0xB311);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payload = keccak256(abi.encode(uint8(1), hook));
        (bytes memory ecdsa, bytes memory pq) =
            _sign(GUARDIAN_ROLE, GUARDIAN_KEY, controller.PAUSE_ACTION(), payload, deadline, 1);
        controller.pausePoolHybrid(hook, deadline, ecdsa, pq);
        (bool paused, uint64 nonce_) = controller.pauseState(controller.targetId(1, hook));
        require(paused && nonce_ == 1, "pause missing");
        require(auth.nonce(GUARDIAN_ROLE) == 1, "guardian nonce not consumed");
    }

    function testInvalidPQSignatureDoesNotPauseOrConsumeNonce() public {
        address hook = address(0xB312);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payload = keccak256(abi.encode(uint8(1), hook));
        (bytes memory ecdsa,) = _sign(GUARDIAN_ROLE, GUARDIAN_KEY, controller.PAUSE_ACTION(), payload, deadline, 1);
        vm.expectRevert(HybridAuth.InvalidPQSignature.selector);
        controller.pausePoolHybrid(hook, deadline, ecdsa, abi.encode(false, uint32(1)));
        (bool paused, uint64 nonce_) = controller.pauseState(controller.targetId(1, hook));
        require(!paused && nonce_ == 0, "invalid signature mutated pause");
        require(auth.nonce(GUARDIAN_ROLE) == 0, "invalid signature consumed nonce");
    }

    function testLegacyPauseSelectorIsClosed() public {
        vm.expectRevert(SafetyControllerV2.HybridSignaturesRequired.selector);
        controller.pausePool(address(0xB313));
    }

    function testGuardianCanCancelRegistryOperationImmediatelyWithHybridAuth() public {
        SafetyV2GovernedTarget target = new SafetyV2GovernedTarget(address(controller));
        bytes32 registryOperationId = keccak256("pending calendar root");
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payload = keccak256(abi.encode(address(target), registryOperationId));
        (bytes memory ecdsa, bytes memory pq) =
            _sign(GUARDIAN_ROLE, GUARDIAN_KEY, controller.GUARDIAN_CANCEL_REGISTRY_ACTION(), payload, deadline, 1);
        controller.cancelRegistryOperationHybrid(address(target), registryOperationId, deadline, ecdsa, pq);
        require(target.cancelledOperation() == registryOperationId, "registry cancel was not forwarded");
    }

    function testGovernanceCallIsHybridAuthorizedAndTimelocked() public {
        bytes32 value = keccak256("authorized calendar root");
        SafetyV2GovernedTarget target = new SafetyV2GovernedTarget(address(controller));
        bytes memory callData = abi.encodeCall(target.setValue, (value));
        bytes32 payload = keccak256(abi.encode(address(target), keccak256(callData)));
        uint256 deadline = block.timestamp + 1 hours;
        (bytes memory ecdsa, bytes memory pq) =
            _sign(GOV_ROLE, GOV_KEY, controller.QUEUE_CALL_ACTION(), payload, deadline, 1);
        bytes32 operationId = controller.queueGovernanceCall(address(target), callData, deadline, ecdsa, pq);
        require(target.acceptedValue() == bytes32(0), "call executed during queue");
        vm.expectRevert(SafetyControllerV2.TimelockNotElapsed.selector);
        controller.executeGovernanceCall(operationId);
        vm.warp(block.timestamp + 1 days);
        controller.executeGovernanceCall(operationId);
        require(target.acceptedValue() == value, "governance call did not execute");
        (,,,, uint8 status) = controller.operation(operationId);
        require(status == 2, "operation not marked done");
    }

    function testExecutionFailureDoesNotConsumeOperation() public {
        SafetyV2GovernedTarget target = new SafetyV2GovernedTarget(address(controller));
        bytes memory callData = abi.encodeCall(target.fail, ());
        bytes32 payload = keccak256(abi.encode(address(target), keccak256(callData)));
        uint256 deadline = block.timestamp + 1 hours;
        (bytes memory ecdsa, bytes memory pq) =
            _sign(GOV_ROLE, GOV_KEY, controller.QUEUE_CALL_ACTION(), payload, deadline, 1);
        bytes32 operationId = controller.queueGovernanceCall(address(target), callData, deadline, ecdsa, pq);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert();
        controller.executeGovernanceCall(operationId);
        (,,,, uint8 status) = controller.operation(operationId);
        require(status == 1, "failed call consumed operation");
    }

    function _sign(bytes32 role, uint256 signerKey, bytes32 action, bytes32 payloadHash, uint256 deadline, uint32 leaf)
        private
        returns (bytes memory ecdsa, bytes memory pq)
    {
        PQKeyRegistry.RoleKey memory key = registry.roleKey(role);
        uint32 keyVersion = key.keyVersion;
        bytes32 digest =
            auth.actionDigest(role, address(controller), action, payloadHash, auth.nonce(role), keyVersion, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        ecdsa = abi.encodePacked(r, s, v);
        pq = abi.encode(true, leaf);
    }
}
