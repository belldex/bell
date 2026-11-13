// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {HybridAuth} from "./HybridAuth.sol";

/// @notice Testnet v2 calendar trust input; existing BELL registries untouched.
contract CalendarRegistryV2 {
    bytes32 public constant UPDATE_ROOT_ACTION = keccak256("CALENDAR_UPDATE_ROOT");

    error InvalidCalendar();

    HybridAuth public immutable hybridAuth;
    bytes32 public immutable authorizationRole;
    bytes32 public currentRoot;
    uint64 public validFrom;
    uint64 public validUntil;
    uint64 public epoch;

    event CalendarRootUpdated(
        bytes32 indexed root, uint64 indexed epoch, uint64 validFrom, uint64 validUntil
    );

    constructor(HybridAuth auth, bytes32 role) {
        hybridAuth = auth;
        authorizationRole = role;
    }

    function updateRoot(
        bytes32 root,
        uint64 nextValidFrom,
        uint64 nextValidUntil,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external {
        if (root == bytes32(0) || nextValidFrom >= nextValidUntil) {
            revert InvalidCalendar();
        }
        bytes32 payloadHash = keccak256(
            abi.encode(root, nextValidFrom, nextValidUntil)
        );
        hybridAuth.authorize(
            authorizationRole,
            UPDATE_ROOT_ACTION,
            payloadHash,
            deadline,
            ecdsaSignature,
            pqSignature
        );
        currentRoot = root;
        validFrom = nextValidFrom;
        validUntil = nextValidUntil;
        epoch += 1;
        emit CalendarRootUpdated(root, epoch, nextValidFrom, nextValidUntil);
    }
}
