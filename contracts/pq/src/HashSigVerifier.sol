// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC7913Verifier {
    function verify(bytes calldata key, bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4);
}

/// @title HashSigVerifier
/// @notice Narrow adapter for the audited Quip SHRINCS ERC-7913 verifier.
/// @dev The AGPL verifier is called as a deployed contract and is not
///      imported or modified here. The stateful auth-path length is its leaf.
contract HashSigVerifier {
    bytes4 private constant VALID = 0x024ad318;
    uint32 public constant MAX_LEAF = 4096;

    struct PublicKey {
        bytes statefulPublicKey;
        bytes publicKeyCommitment;
        bytes pkSeed;
        bytes hypertreeRoot;
    }

    struct StatefulSignature {
        bytes32 randomizer;
        uint32 counter;
        bytes32[] chains;
        bytes32[] authPath;
    }

    IERC7913Verifier public immutable shrincsVerifier;

    error InvalidVerifier();

    constructor(address verifier) {
        if (verifier.code.length == 0) revert InvalidVerifier();
        shrincsVerifier = IERC7913Verifier(verifier);
    }

    function verify(bytes32 commitment, bytes32 digest, bytes calldata envelope)
        external
        view
        returns (bool valid, uint32 leafIndex)
    {
        (PublicKey memory publicKey, StatefulSignature memory signature) =
            abi.decode(envelope, (PublicKey, StatefulSignature));
        if (
            publicKey.publicKeyCommitment.length != 32
                || bytes32(_word(publicKey.publicKeyCommitment)) != commitment
        ) return (false, 0);

        uint256 leaf = signature.authPath.length;
        if (leaf == 0 || leaf > MAX_LEAF) return (false, 0);
        bytes4 result = shrincsVerifier.verify(
            abi.encodePacked(commitment), digest, envelope
        );
        // forge-lint: disable-next-line(unsafe-typecast) leaf is bounded above to 4096.
        return (result == VALID, uint32(leaf));
    }

    function _word(bytes memory value) private pure returns (bytes32 result) {
        assembly ("memory-safe") {
            result := mload(add(value, 32))
        }
    }
}
