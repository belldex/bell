// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title PQKeyRegistry
/// @notice Pins one SHRINCS key commitment and signer per privileged role.
/// @dev Bootstrap is a one-time ECDSA-admin action. After it is sealed,
///      HybridAuth alone can consume one-time leaves or rotate a role key.
contract PQKeyRegistry {
    uint32 public constant MAX_STATEFUL_SIGNATURES = 4096;

    struct RoleKey {
        address ecdsaSigner;
        bytes32 publicKeyCommitment;
        uint32 maxStatefulSignatures;
        uint32 nextStatefulLeaf;
        uint32 keyVersion;
        bool installed;
    }

    error Unauthorized();
    error BootstrapClosed();
    error BootstrapIncomplete();
    error InvalidRoleKey();
    error RoleAlreadyInstalled();
    error UnknownRole();
    error StaleKeyVersion();
    error LeafOutOfOrder();
    error SignatureBudgetExhausted();

    address public immutable bootstrapAdmin;
    address public hybridAuth;
    bool public bootstrapFinalized;
    uint256 public configuredRoleCount;

    mapping(bytes32 role => RoleKey) private _roleKeys;

    event RoleKeyBootstrapped(
        bytes32 indexed role,
        address indexed ecdsaSigner,
        bytes32 indexed publicKeyCommitment,
        uint32 maxStatefulSignatures
    );
    event RoleKeyRotated(
        bytes32 indexed role,
        address indexed ecdsaSigner,
        bytes32 indexed publicKeyCommitment,
        uint32 keyVersion,
        uint32 maxStatefulSignatures
    );
    event StatefulLeafConsumed(
        bytes32 indexed role,
        uint32 indexed keyVersion,
        uint32 indexed leafIndex
    );
    event BootstrapFinalized(address indexed hybridAuth);

    constructor(address admin) {
        if (admin == address(0)) revert InvalidRoleKey();
        bootstrapAdmin = admin;
    }

    function bootstrapRole(
        bytes32 role,
        address ecdsaSigner,
        bytes32 publicKeyCommitment,
        uint32 maxStatefulSignatures
    ) external {
        if (msg.sender != bootstrapAdmin) revert Unauthorized();
        if (bootstrapFinalized) revert BootstrapClosed();
        if (_roleKeys[role].installed) revert RoleAlreadyInstalled();
        _validateRoleKey(role, ecdsaSigner, publicKeyCommitment, maxStatefulSignatures);

        _roleKeys[role] = RoleKey({
            ecdsaSigner: ecdsaSigner,
            publicKeyCommitment: publicKeyCommitment,
            maxStatefulSignatures: maxStatefulSignatures,
            // Quip SHRINCS reserves leaf zero; signatures start at one.
            nextStatefulLeaf: 1,
            keyVersion: 1,
            installed: true
        });
        configuredRoleCount += 1;
        emit RoleKeyBootstrapped(
            role, ecdsaSigner, publicKeyCommitment, maxStatefulSignatures
        );
    }

    function setHybridAuth(address auth) external {
        if (msg.sender != bootstrapAdmin) revert Unauthorized();
        if (bootstrapFinalized) revert BootstrapClosed();
        if (auth == address(0) || hybridAuth != address(0)) {
            revert InvalidRoleKey();
        }
        hybridAuth = auth;
    }

    function finalizeBootstrap() external {
        if (msg.sender != bootstrapAdmin) revert Unauthorized();
        if (bootstrapFinalized) revert BootstrapClosed();
        if (hybridAuth == address(0) || configuredRoleCount == 0) {
            revert BootstrapIncomplete();
        }
        bootstrapFinalized = true;
        emit BootstrapFinalized(hybridAuth);
    }

    function roleKey(bytes32 role) external view returns (RoleKey memory key) {
        key = _roleKeys[role];
        if (!key.installed) revert UnknownRole();
    }

    function consumeLeaf(bytes32 role, uint32 keyVersion, uint32 leafIndex)
        external
    {
        if (!bootstrapFinalized || msg.sender != hybridAuth) {
            revert Unauthorized();
        }
        RoleKey storage key = _roleKeys[role];
        if (!key.installed) revert UnknownRole();
        if (key.keyVersion != keyVersion) revert StaleKeyVersion();
        if (key.nextStatefulLeaf > key.maxStatefulSignatures) {
            revert SignatureBudgetExhausted();
        }
        if (leafIndex != key.nextStatefulLeaf) revert LeafOutOfOrder();

        key.nextStatefulLeaf += 1;
        emit StatefulLeafConsumed(role, keyVersion, leafIndex);
    }

    function rotateRoleKey(
        bytes32 role,
        address ecdsaSigner,
        bytes32 publicKeyCommitment,
        uint32 maxStatefulSignatures
    ) external {
        if (!bootstrapFinalized || msg.sender != hybridAuth) {
            revert Unauthorized();
        }
        RoleKey storage key = _roleKeys[role];
        if (!key.installed) revert UnknownRole();
        _validateRoleKey(role, ecdsaSigner, publicKeyCommitment, maxStatefulSignatures);
        if (publicKeyCommitment == key.publicKeyCommitment) {
            revert InvalidRoleKey();
        }

        key.ecdsaSigner = ecdsaSigner;
        key.publicKeyCommitment = publicKeyCommitment;
        key.maxStatefulSignatures = maxStatefulSignatures;
        key.nextStatefulLeaf = 1;
        key.keyVersion += 1;
        emit RoleKeyRotated(
            role,
            ecdsaSigner,
            publicKeyCommitment,
            key.keyVersion,
            maxStatefulSignatures
        );
    }

    function _validateRoleKey(
        bytes32 role,
        address ecdsaSigner,
        bytes32 publicKeyCommitment,
        uint32 maxStatefulSignatures
    ) private pure {
        if (
            role == bytes32(0) || ecdsaSigner == address(0)
                || publicKeyCommitment == bytes32(0)
                || maxStatefulSignatures == 0
                || maxStatefulSignatures > MAX_STATEFUL_SIGNATURES
        ) revert InvalidRoleKey();
    }
}
