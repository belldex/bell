// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {HybridAuth} from "./HybridAuth.sol";

/// @notice Hybrid-signed reporter adapter for testnet price observations.
contract PriceAttestationAdapter {
    bytes32 public constant ATTEST_PRICE_ACTION = keccak256("PRICE_ATTEST");

    error InvalidPriceAttestation();
    error ObservationNotIncreasing();

    struct PriceRecord {
        uint128 price;
        uint64 observedAt;
        uint64 sequence;
    }

    HybridAuth public immutable hybridAuth;
    bytes32 public immutable authorizationRole;
    mapping(bytes32 assetId => PriceRecord) private _prices;

    event PriceAttested(
        bytes32 indexed assetId,
        uint128 price,
        uint64 observedAt,
        uint64 sequence
    );

    constructor(HybridAuth auth, bytes32 role) {
        hybridAuth = auth;
        authorizationRole = role;
    }

    function latestPrice(bytes32 assetId)
        external
        view
        returns (uint128 price, uint64 observedAt, uint64 sequence)
    {
        PriceRecord memory record = _prices[assetId];
        return (record.price, record.observedAt, record.sequence);
    }

    function attestPrice(
        bytes32 assetId,
        uint128 price,
        uint64 observedAt,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external {
        if (
            assetId == bytes32(0) || price == 0 || observedAt == 0
                || observedAt > block.timestamp
        ) revert InvalidPriceAttestation();
        PriceRecord storage current = _prices[assetId];
        if (observedAt <= current.observedAt) revert ObservationNotIncreasing();
        bytes32 payloadHash = keccak256(abi.encode(assetId, price, observedAt));
        hybridAuth.authorize(
            authorizationRole,
            ATTEST_PRICE_ACTION,
            payloadHash,
            deadline,
            ecdsaSignature,
            pqSignature
        );
        current.price = price;
        current.observedAt = observedAt;
        current.sequence += 1;
        emit PriceAttested(assetId, price, observedAt, current.sequence);
    }
}
