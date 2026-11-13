// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PQKeyRegistry} from "./PQKeyRegistry.sol";

interface IHashSigVerifier {
    function verify(bytes32 commitment, bytes32 digest, bytes calldata signature)
        external
        view
        returns (bool valid, uint32 leafIndex);
}

/// @title HybridAuth
/// @notice EIP-712 actions require both a role's ECDSA and SHRINCS signatures.
contract HybridAuth {
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant ACTION_TYPEHASH = keccak256(
        "HybridAction(bytes32 role,address target,bytes32 action,bytes32 payloadHash,uint256 nonce,uint32 keyVersion,uint256 deadline)"
    );
    bytes32 private constant NAME_HASH = keccak256("BELL HybridAuth");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 public constant ROTATE_ACTION = keccak256("ROTATE_ROLE_KEY");
    uint256 private constant SECP256K1_HALF_N =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    error Expired();
    error InvalidECDSA();
    error InvalidPQSignature();
    error InvalidSignatureLength();
    error InvalidTarget();

    PQKeyRegistry public immutable registry;
    IHashSigVerifier public immutable hashSigVerifier;
    mapping(bytes32 role => uint256) public nonce;

    event HybridActionAuthorized(
        bytes32 indexed role,
        address indexed target,
        bytes32 indexed action,
        uint256 nonce,
        uint32 keyVersion,
        uint32 leafIndex,
        bytes32 payloadHash
    );

    constructor(PQKeyRegistry keyRegistry, IHashSigVerifier verifier) {
        if (address(keyRegistry).code.length == 0 || address(verifier).code.length == 0) {
            revert InvalidPQSignature();
        }
        registry = keyRegistry;
        hashSigVerifier = verifier;
    }

    function actionDigest(
        bytes32 role,
        address target,
        bytes32 action,
        bytes32 payloadHash,
        uint256 actionNonce,
        uint32 keyVersion,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
        bytes32 body = keccak256(
            abi.encode(
                ACTION_TYPEHASH,
                role,
                target,
                action,
                payloadHash,
                actionNonce,
                keyVersion,
                deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, body));
    }

    function authorize(
        bytes32 role,
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external returns (uint32 leafIndex) {
        if (msg.sender == address(0)) revert InvalidTarget();
        leafIndex = _authorize(
            role, msg.sender, action, payloadHash, deadline, ecdsaSignature, pqSignature
        );
    }

    function rotateRoleKey(
        bytes32 role,
        address nextSigner,
        bytes32 nextCommitment,
        uint32 nextMaxStatefulSignatures,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external {
        bytes32 payloadHash = keccak256(
            abi.encode(nextSigner, nextCommitment, nextMaxStatefulSignatures)
        );
        _authorize(
            role,
            address(this),
            ROTATE_ACTION,
            payloadHash,
            deadline,
            ecdsaSignature,
            pqSignature
        );
        registry.rotateRoleKey(
            role, nextSigner, nextCommitment, nextMaxStatefulSignatures
        );
    }

    function _authorize(
        bytes32 role,
        address target,
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) private returns (uint32 leafIndex) {
        if (block.timestamp > deadline) revert Expired();
        PQKeyRegistry.RoleKey memory key = registry.roleKey(role);
        uint256 actionNonce = nonce[role];
        bytes32 digest = actionDigest(
            role, target, action, payloadHash, actionNonce, key.keyVersion, deadline
        );
        if (_recover(digest, ecdsaSignature) != key.ecdsaSigner) {
            revert InvalidECDSA();
        }

        bool valid;
        try hashSigVerifier.verify(key.publicKeyCommitment, digest, pqSignature) returns (
            bool isValid, uint32 parsedLeaf
        ) {
            valid = isValid;
            leafIndex = parsedLeaf;
        } catch {
            revert InvalidPQSignature();
        }
        if (!valid) revert InvalidPQSignature();

        registry.consumeLeaf(role, key.keyVersion, leafIndex);
        nonce[role] = actionNonce + 1;
        emit HybridActionAuthorized(
            role, target, action, actionNonce, key.keyVersion, leafIndex, payloadHash
        );
    }

    function _recover(bytes32 digest, bytes calldata signature)
        private
        pure
        returns (address signer)
    {
        if (signature.length != 65) revert InvalidSignatureLength();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > SECP256K1_HALF_N || (v != 27 && v != 28)) {
            revert InvalidECDSA();
        }
        signer = ecrecover(digest, v, r, s);
    }
}
