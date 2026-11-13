// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PQKeyRegistry} from "../src/PQKeyRegistry.sol";
import {HybridAuth, IHashSigVerifier} from "../src/HybridAuth.sol";

interface VmHybrid {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function expectRevert(bytes4 selector) external;
}

contract MockHashSigVerifier is IHashSigVerifier {
    function verify(bytes32, bytes32, bytes calldata signature)
        external
        pure
        returns (bool valid, uint32 leafIndex)
    {
        return abi.decode(signature, (bool, uint32));
    }
}

contract HybridAuthTest {
    VmHybrid private constant vm =
        VmHybrid(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SIGNER_KEY = 0xA11CE;
    bytes32 private constant ROLE = keccak256("KEEPER");
    bytes32 private constant COMMITMENT = keccak256("root");
    bytes32 private constant ACTION = keccak256("UPDATE_CALENDAR");
    bytes32 private constant PAYLOAD = keccak256("calendar-payload");

    PQKeyRegistry private registry;
    HybridAuth private auth;

    function setUp() public {
        registry = new PQKeyRegistry(address(this));
        auth = new HybridAuth(registry, new MockHashSigVerifier());
        registry.bootstrapRole(
            ROLE, vm.addr(SIGNER_KEY), COMMITMENT, 8
        );
        registry.setHybridAuth(address(auth));
        registry.finalizeBootstrap();
    }

    function testRequiresBothSignaturesAndConsumesNonceAndLeaf() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory ecdsa = _sign(deadline);
        auth.authorize(
            ROLE, ACTION, PAYLOAD, deadline, ecdsa, abi.encode(true, uint32(1))
        );
        require(auth.nonce(ROLE) == 1, "nonce not consumed");
        require(registry.roleKey(ROLE).nextStatefulLeaf == 2, "leaf not consumed");
    }

    function testRejectsInvalidECDSAWithoutConsumingPQLeaf() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory valid = _sign(deadline);
        valid[0] = bytes1(uint8(valid[0]) ^ 1);
        vm.expectRevert(HybridAuth.InvalidECDSA.selector);
        auth.authorize(
            ROLE, ACTION, PAYLOAD, deadline, valid, abi.encode(true, uint32(1))
        );
        require(auth.nonce(ROLE) == 0, "failed signature consumed nonce");
        require(registry.roleKey(ROLE).nextStatefulLeaf == 1, "failed signature consumed leaf");
    }

    function testRejectsInvalidPQEvenWhenECDSAIsValid() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory ecdsa = _sign(deadline);
        vm.expectRevert(HybridAuth.InvalidPQSignature.selector);
        auth.authorize(
            ROLE, ACTION, PAYLOAD, deadline, ecdsa,
            abi.encode(false, uint32(1))
        );
        require(auth.nonce(ROLE) == 0, "failed PQ consumed nonce");
    }

    function testRejectsReplayedECDSAAndLeaf() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory ecdsa = _sign(deadline);
        bytes memory pq = abi.encode(true, uint32(1));
        auth.authorize(ROLE, ACTION, PAYLOAD, deadline, ecdsa, pq);
        vm.expectRevert(HybridAuth.InvalidECDSA.selector);
        auth.authorize(ROLE, ACTION, PAYLOAD, deadline, ecdsa, pq);
    }

    function testDigestBindsTheTarget() public view {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 ownDigest = auth.actionDigest(
            ROLE, address(this), ACTION, PAYLOAD, 0, 1, deadline
        );
        bytes32 otherDigest = auth.actionDigest(
            ROLE, address(0xBEEF), ACTION, PAYLOAD, 0, 1, deadline
        );
        require(ownDigest != otherDigest, "target not bound");
    }

    function _sign(uint256 deadline) private returns (bytes memory signature) {
        bytes32 digest = auth.actionDigest(
            ROLE, address(this), ACTION, PAYLOAD, 0, 1, deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
}
