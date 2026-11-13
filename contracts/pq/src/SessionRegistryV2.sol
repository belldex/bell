// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {HybridAuth} from "./HybridAuth.sol";

/// @notice Testnet close-anchor trust input; it never gates LP exits.
contract SessionRegistryV2 {
    bytes32 public constant SET_CLOSE_ANCHOR_ACTION = keccak256("SESSION_SET_CLOSE_ANCHOR");

    error InvalidAnchor();
    error CycleNotIncreasing();

    struct Anchor {
        uint64 cycle;
        bytes32 value;
    }

    HybridAuth public immutable hybridAuth;
    bytes32 public immutable authorizationRole;
    mapping(bytes32 poolId => Anchor) private _anchors;

    event CloseAnchorUpdated(bytes32 indexed poolId, uint64 indexed cycle, bytes32 anchor);

    constructor(HybridAuth auth, bytes32 role) {
        hybridAuth = auth;
        authorizationRole = role;
    }

    function closeAnchor(bytes32 poolId)
        external
        view
        returns (uint64 cycle, bytes32 value)
    {
        Anchor memory anchor = _anchors[poolId];
        return (anchor.cycle, anchor.value);
    }

    function setCloseAnchor(
        bytes32 poolId,
        uint64 cycle,
        bytes32 anchor,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external {
        if (poolId == bytes32(0) || anchor == bytes32(0)) revert InvalidAnchor();
        if (cycle <= _anchors[poolId].cycle) revert CycleNotIncreasing();
        bytes32 payloadHash = keccak256(abi.encode(poolId, cycle, anchor));
        hybridAuth.authorize(
            authorizationRole,
            SET_CLOSE_ANCHOR_ACTION,
            payloadHash,
            deadline,
            ecdsaSignature,
            pqSignature
        );
        _anchors[poolId] = Anchor(cycle, anchor);
        emit CloseAnchorUpdated(poolId, cycle, anchor);
    }
}
