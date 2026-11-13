// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {HashSigVerifier} from "../src/HashSigVerifier.sol";
import {SHRINCS} from "quip-hashsigs/contracts/SHRINCS.sol";
import {SHRINCSVerifier} from "quip-hashsigs/contracts/SHRINCSVerifier.sol";
import {SHRINCSTestSigner} from "quip-hashsigs/test/helpers/SHRINCSTestSigner.sol";
import {SHRINCSTestCodec} from "quip-hashsigs/test/helpers/SHRINCSTestCodec.sol";

contract StatefulSHRINCSVerifierHarness is SHRINCSVerifier {
    function _pinnedSphincsPlusC() internal pure override returns (address) {
        return address(0);
    }
}

contract RealSHRINCSAdapterTest {
    function testRealStatefulSignatureIsVerifiedAndLeafIsExtracted() public {
        StatefulSHRINCSVerifierHarness verifier = new StatefulSHRINCSVerifierHarness();
        HashSigVerifier adapter = new HashSigVerifier(address(verifier));
        (SHRINCS.SigningKey memory signingKey, SHRINCS.PublicKey memory publicKey, bool ok) =
            SHRINCSTestSigner.keygen(bytes("bell real adapter vector"), 4);
        require(ok, "keygen failed");
        bytes32 commitment = _commitment(publicKey);
        bytes32 actionDigest = keccak256("signed action digest");
        bytes memory rawMessage = abi.encodePacked(
            SHRINCS.statefulRawMessageHash(commitment, actionDigest)
        );
        (SHRINCS.Signature memory signature, bool signed) =
            SHRINCSTestSigner.signStatefulRawAtLeaf(signingKey, 1, rawMessage);
        require(signed, "sign failed");
        bytes memory envelope = SHRINCSTestCodec.encodeStatefulEnvelope(publicKey, signature);
        (bool valid, uint32 leaf) = adapter.verify(commitment, actionDigest, envelope);
        require(valid && leaf == 1, "valid stateful SHRINCS signature rejected");
        (valid,) = adapter.verify(commitment, keccak256("wrong action"), envelope);
        require(!valid, "signature accepted for another action");
    }

    function _commitment(SHRINCS.PublicKey memory publicKey)
        private
        pure
        returns (bytes32 value)
    {
        bytes memory raw = publicKey.publicKeyCommitment;
        assembly ("memory-safe") {
            value := mload(add(raw, 32))
        }
    }
}
