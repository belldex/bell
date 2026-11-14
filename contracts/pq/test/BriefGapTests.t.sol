// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PQKeyRegistry} from "../src/PQKeyRegistry.sol";
import {HybridAuth, IHashSigVerifier} from "../src/HybridAuth.sol";
import {HashSigVerifier} from "../src/HashSigVerifier.sol";
import {SHRINCS} from "quip-hashsigs/contracts/SHRINCS.sol";
import {SHRINCSVerifier} from "quip-hashsigs/contracts/SHRINCSVerifier.sol";
import {SHRINCSTestSigner} from "quip-hashsigs/test/helpers/SHRINCSTestSigner.sol";
import {SHRINCSTestCodec} from "quip-hashsigs/test/helpers/SHRINCSTestCodec.sol";

/// @notice Tests the PQ Hooks v2 brief (section 4) lists and the earlier suites do not name:
///         a rotated role key must refuse the old key, the one-time-leaf budget and ordering are enforced,
///         and a tampered real SHRINCS signature (chain or auth path) is never accepted.

interface VmGap {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function expectRevert(bytes4 selector) external;
    function prank(address caller) external;
}

contract BriefGapMockVerifier is IHashSigVerifier {
    function verify(bytes32, bytes32, bytes calldata signature)
        external
        pure
        returns (bool valid, uint32 leafIndex)
    {
        return abi.decode(signature, (bool, uint32));
    }
}

contract RoleKeyLifecycleTest {
    VmGap private constant vm = VmGap(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant OLD_KEY = 0xA11CE;
    uint256 private constant NEW_KEY = 0xB0B;
    bytes32 private constant ROLE = keccak256("GOVERNANCE");
    bytes32 private constant OLD_COMMITMENT = keccak256("old-root");
    bytes32 private constant NEW_COMMITMENT = keccak256("new-root");
    bytes32 private constant ACTION = keccak256("UPDATE_CALENDAR");
    bytes32 private constant PAYLOAD = keccak256("payload");

    PQKeyRegistry private registry;
    HybridAuth private auth;
    address private oldSigner;
    address private newSigner;

    function setUp() public {
        oldSigner = vm.addr(OLD_KEY);
        newSigner = vm.addr(NEW_KEY);
        registry = new PQKeyRegistry(address(this));
        auth = new HybridAuth(registry, new BriefGapMockVerifier());
        registry.bootstrapRole(ROLE, oldSigner, OLD_COMMITMENT, 3);
        registry.setHybridAuth(address(auth));
        registry.finalizeBootstrap();
    }

    function testRotationRefusesTheOldECDSAKeyAndStartsAFreshLeafSequence() public {
        _rotate(OLD_KEY, newSigner, NEW_COMMITMENT, 3, 1);
        PQKeyRegistry.RoleKey memory key = registry.roleKey(ROLE);
        require(key.keyVersion == 2, "key version not advanced");
        require(key.nextStatefulLeaf == 1, "leaf sequence not reset");
        require(key.ecdsaSigner == newSigner, "signer not replaced");

        // The retired key can no longer authorize anything, even with a valid PQ signature.
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory oldSig = _sign(OLD_KEY, deadline);
        vm.expectRevert(HybridAuth.InvalidECDSA.selector);
        auth.authorize(ROLE, ACTION, PAYLOAD, deadline, oldSig, abi.encode(true, uint32(1)));

        // The new key can, at leaf 1 of the new key version.
        bytes memory newSig = _sign(NEW_KEY, deadline);
        uint32 leaf = auth.authorize(ROLE, ACTION, PAYLOAD, deadline, newSig, abi.encode(true, uint32(1)));
        require(leaf == 1, "new key leaf not accepted");
    }

    function testLeafOfTheRetiredKeyVersionIsStale() public {
        _rotate(OLD_KEY, newSigner, NEW_COMMITMENT, 3, 1);
        vm.prank(address(auth));
        vm.expectRevert(PQKeyRegistry.StaleKeyVersion.selector);
        registry.consumeLeaf(ROLE, 1, 1);
    }

    function testRotationCannotReuseTheCommitment() public {
        // Rotating to the same commitment would reset the leaf counter and let leaves be signed twice.
        vm.prank(address(auth));
        vm.expectRevert(PQKeyRegistry.InvalidRoleKey.selector);
        registry.rotateRoleKey(ROLE, newSigner, OLD_COMMITMENT, 3);
    }

    function testRotationNeedsBothSignatures() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payload = keccak256(abi.encode(newSigner, NEW_COMMITMENT, uint32(3)));
        bytes32 digest = auth.actionDigest(ROLE, address(auth), auth.ROTATE_ACTION(), payload, 0, 1, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OLD_KEY, digest);
        // Valid ECDSA, invalid PQ.
        vm.expectRevert(HybridAuth.InvalidPQSignature.selector);
        auth.rotateRoleKey(ROLE, newSigner, NEW_COMMITMENT, 3, deadline, abi.encodePacked(r, s, v), abi.encode(false, uint32(1)));
        require(registry.roleKey(ROLE).keyVersion == 1, "rotation happened without a valid PQ signature");
        // Nobody else can call the registry directly.
        vm.expectRevert(PQKeyRegistry.Unauthorized.selector);
        registry.rotateRoleKey(ROLE, newSigner, NEW_COMMITMENT, 3);
    }

    function testSignatureBudgetIsExhaustedAfterTheLastLeaf() public {
        uint256 deadline = block.timestamp + 1 hours;
        for (uint32 leaf = 1; leaf <= 3; leaf++) {
            auth.authorize(ROLE, ACTION, PAYLOAD, deadline, _sign(OLD_KEY, deadline), abi.encode(true, leaf));
        }
        bytes memory fourth = _sign(OLD_KEY, deadline);
        vm.expectRevert(PQKeyRegistry.SignatureBudgetExhausted.selector);
        auth.authorize(ROLE, ACTION, PAYLOAD, deadline, fourth, abi.encode(true, uint32(4)));
    }

    function testALeafCannotBeSkippedOrReplayed() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory skipping = _sign(OLD_KEY, deadline);
        vm.expectRevert(PQKeyRegistry.LeafOutOfOrder.selector);
        auth.authorize(ROLE, ACTION, PAYLOAD, deadline, skipping, abi.encode(true, uint32(2)));
        require(auth.nonce(ROLE) == 0, "skipped leaf consumed a nonce");
        auth.authorize(ROLE, ACTION, PAYLOAD, deadline, _sign(OLD_KEY, deadline), abi.encode(true, uint32(1)));
        bytes memory replay = _sign(OLD_KEY, deadline);
        vm.expectRevert(PQKeyRegistry.LeafOutOfOrder.selector);
        auth.authorize(ROLE, ACTION, PAYLOAD, deadline, replay, abi.encode(true, uint32(1)));
    }

    function _rotate(uint256 signerKey, address nextSigner, bytes32 nextCommitment, uint32 maxLeaves, uint32 leaf) private {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payload = keccak256(abi.encode(nextSigner, nextCommitment, maxLeaves));
        PQKeyRegistry.RoleKey memory key = registry.roleKey(ROLE);
        bytes32 digest = auth.actionDigest(ROLE, address(auth), auth.ROTATE_ACTION(), payload, auth.nonce(ROLE), key.keyVersion, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        auth.rotateRoleKey(ROLE, nextSigner, nextCommitment, maxLeaves, deadline, abi.encodePacked(r, s, v), abi.encode(true, leaf));
    }

    function _sign(uint256 signerKey, uint256 deadline) private returns (bytes memory) {
        PQKeyRegistry.RoleKey memory key = registry.roleKey(ROLE);
        bytes32 digest = auth.actionDigest(ROLE, address(this), ACTION, PAYLOAD, auth.nonce(ROLE), key.keyVersion, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}

contract GapSHRINCSVerifierHarness is SHRINCSVerifier {
    function _pinnedSphincsPlusC() internal pure override returns (address) {
        return address(0);
    }
}

contract TamperedRealSignatureTest {
    HashSigVerifier private adapter;
    bytes32 private commitment;
    bytes32 private constant DIGEST = keccak256("signed action digest");

    function setUp() public {
        adapter = new HashSigVerifier(address(new GapSHRINCSVerifierHarness()));
        (, SHRINCS.PublicKey memory publicKey, bool ok) =
            SHRINCSTestSigner.keygen(bytes("bell tamper vector"), 4);
        require(ok, "keygen failed");
        bytes memory raw = publicKey.publicKeyCommitment;
        bytes32 value;
        assembly ("memory-safe") {
            value := mload(add(raw, 32))
        }
        commitment = value;
    }

    function _envelope(uint32 leaf) private view returns (bytes memory) {
        (SHRINCS.SigningKey memory key, SHRINCS.PublicKey memory publicKey, bool ok) =
            SHRINCSTestSigner.keygen(bytes("bell tamper vector"), 4);
        require(ok, "keygen failed");
        bytes memory rawMessage = abi.encodePacked(SHRINCS.statefulRawMessageHash(commitment, DIGEST));
        (SHRINCS.Signature memory signature, bool signed) = SHRINCSTestSigner.signStatefulRawAtLeaf(key, leaf, rawMessage);
        require(signed, "sign failed");
        return SHRINCSTestCodec.encodeStatefulEnvelope(publicKey, signature);
    }

    /// @dev Accepted means the adapter returned valid. A revert or a false return is a rejection.
    function _accepts(bytes memory envelope) private view returns (bool accepted) {
        try adapter.verify(commitment, DIGEST, envelope) returns (bool valid, uint32) {
            return valid;
        } catch {
            return false;
        }
    }

    /// @dev A real copy: assigning one bytes memory to another only aliases it.
    function _flip(bytes memory good, uint256 position) private pure returns (bytes memory copy) {
        copy = new bytes(good.length);
        for (uint256 i = 0; i < good.length; i++) copy[i] = good[i];
        copy[position] = bytes1(uint8(copy[position]) ^ 0x01);
    }

    function testUntamperedSignatureIsAccepted() public view {
        require(_accepts(_envelope(1)), "control signature rejected");
    }

    function testEveryFlippedByteRegionIsRejected() public view {
        bytes memory good = _envelope(1);
        uint256 len = good.length;
        // Sample the start (key material), several points through the chains and the tail (auth path).
        uint256[8] memory positions = [uint256(40), len / 8, len / 4, len / 3, len / 2, (len * 2) / 3, len - 96, len - 8];
        for (uint256 i = 0; i < positions.length; i++) {
            require(!_accepts(_flip(good, positions[i])), "tampered signature accepted");
        }
    }

    function testSignatureForAnotherCommitmentOrDigestIsRejected() public view {
        bytes memory good = _envelope(1);
        (bool validOther,) = adapter.verify(keccak256("another commitment"), DIGEST, good);
        require(!validOther, "accepted under another key commitment");
        (bool validWrongAction,) = adapter.verify(commitment, keccak256("another digest"), good);
        require(!validWrongAction, "accepted for another action");
    }

    function testTruncatedEnvelopeIsRejected() public view {
        bytes memory good = _envelope(1);
        bytes memory shortened = new bytes(good.length - 32);
        for (uint256 i = 0; i < shortened.length; i++) {
            shortened[i] = good[i];
        }
        require(!_accepts(shortened), "truncated envelope accepted");
    }

    function testLeafIndexFollowsTheSignedLeafAndCannotBeForgedByReplayingAnother() public view {
        (bool valid1, uint32 leaf1) = adapter.verify(commitment, DIGEST, _envelope(1));
        (bool valid2, uint32 leaf2) = adapter.verify(commitment, DIGEST, _envelope(2));
        require(valid1 && leaf1 == 1, "leaf 1 not reported");
        require(valid2 && leaf2 == 2, "leaf 2 not reported");
    }
}
