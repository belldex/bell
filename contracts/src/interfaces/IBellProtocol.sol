// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AssetDescriptor,
    SourceSample,
    HealthView,
    CalendarLeaf,
    CalendarRoot,
    Anchor,
    PoolConfig,
    PoolState,
    Buckets,
    PolicyView,
    CreateRequest,
    CreateResult,
    OraclePullUpdate,
    SwapRequest
} from "../types/ProtocolTypes.sol";

interface IAssetRegistry {
    function queueAsset(AssetDescriptor calldata descriptor, bytes calldata sourceConfig) external returns (bytes32 operationId);
    function activateAsset(bytes32 operationId) external returns (bytes32 descriptorId);
    function cancel(bytes32 operationId) external;
    function descriptor(bytes32 descriptorId) external view returns (AssetDescriptor memory);
    function sourceConfig(bytes32 descriptorId) external view returns (bytes memory);
    function descriptorIdForToken(address token) external view returns (bytes32);
    function operation(bytes32 operationId)
        external view returns (uint8 kind, bytes32 payloadHash, uint64 eta, uint64 expiry, uint8 status);
}

interface ISessionRegistry {
    function applyPoolOracleUpdates(bytes32 asset0, bytes32 asset1, bytes calldata payload, bool swapEnvelope) external;
    function submitReports(bytes32 assetId, bytes[] calldata reports) external;
    function refreshStockWithReports(
        bytes32 assetId,
        SourceSample calldata directSample,
        bytes calldata directSignature,
        bytes[] calldata reports
    ) external returns (uint256 reasons);
    function refreshHealth(bytes32 assetId) external returns (uint256 reasons);
    function health(bytes32 assetId) external view returns (HealthView memory);
    function captureClose(bytes32 assetId, bytes32 boundaryHash) external returns (Anchor memory);
    function latestSample(bytes32 assetId, uint8 phase) external view returns (SourceSample memory);
    function closeAnchor(bytes32 assetId, bytes32 boundaryHash) external view returns (Anchor memory);
    function anchorStatus(bytes32 assetId, bytes32 boundaryHash)
        external
        view
        returns (Anchor memory anchor, bool valid, uint256 reasons, uint64 validUntil);
}

interface ICalendarRegistry {
    function queueRoot(bytes32 assetId, CalendarRoot calldata metadata) external returns (bytes32 operationId);
    function activateRoot(bytes32 operationId) external;
    function activateInterval(
        bytes32 assetId,
        CalendarLeaf calldata current,
        CalendarLeaf calldata previous,
        CalendarLeaf calldata next,
        bytes32[][] calldata proofs
    ) external;
    function currentInterval(bytes32 assetId) external view returns (CalendarLeaf memory);
    function nextInterval(bytes32 assetId) external view returns (CalendarLeaf memory);
    function cancel(bytes32 operationId) external;
    function operation(bytes32 operationId)
        external view returns (uint8 kind, bytes32 payloadHash, uint64 eta, uint64 expiry, uint8 status);
}

interface IBellHook {
    function config() external view returns (PoolConfig memory);
    function poolId() external view returns (bytes32);
    function apiVersion() external view returns (uint32);
    function refreshState() external returns (PolicyView memory);
    function prepareOracleUpdates(OraclePullUpdate[] calldata updates) external returns (PolicyView memory);
    function getPolicy() external view returns (PolicyView memory);
    function state() external view returns (PoolState memory);
    function buckets() external view returns (Buckets memory);
    function episodeGross(uint64 nonce) external view returns (uint128[2] memory);
    function activatePool(bytes32 requestHash, uint256 tokenId) external;
}

interface IBellPoolFactory {
    function predict(CreateRequest calldata request) external view returns (address hook, bytes32 poolId, bytes32 requestHash);
    function createAndSeed(CreateRequest calldata request) external returns (CreateResult memory);
    function nonces(address creator) external view returns (uint64);
}

interface IBellRouter {
    function swap(SwapRequest calldata request) external payable returns (uint128 amountIn, uint128 amountOut);
    function nonces(address payer) external view returns (uint64);
}

interface ITreasuryAdapter {
    function seed(bytes32 requestHash, CreateRequest calldata request) external returns (bytes32 positionKey);
    function remove(
        bytes32 positionKey,
        uint128 liquidity,
        uint128 amount0Min,
        uint128 amount1Min,
        uint64 deadline
    ) external returns (uint128 amount0, uint128 amount1);
    function collect(bytes32 positionKey, uint128 fee0Min, uint128 fee1Min, uint64 deadline)
        external returns (uint128 fee0, uint128 fee1);
}

interface ISafetyController {
    function pausePool(address hook) external;
    function pauseAsset(address token) external;
    function queueResume(bytes32 target, uint64 nonce) external returns (bytes32 operationId);
    function executeResume(bytes32 operationId) external;
    function cancel(bytes32 operationId) external;
    function queueRoleRotation(uint8 role, address successor, bytes32 evidenceHash) external returns (bytes32 operationId);
    function acceptRoleRotation(bytes32 operationId) external;
    function governance() external view returns (address);
    function guardian() external view returns (address);
    function governanceDelaySeconds() external view returns (uint32);
    function calendarPublicationLeadSeconds() external view returns (uint32);
    function operationExpirySeconds() external view returns (uint32);
    function pauseState(bytes32 target) external view returns (bool paused, uint64 nonce);
    function operation(bytes32 operationId)
        external view returns (uint8 kind, bytes32 payloadHash, uint64 eta, uint64 expiry, uint8 status);
}
