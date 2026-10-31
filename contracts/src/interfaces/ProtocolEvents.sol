// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IBellEvents {
    event AssetQueued(bytes32 indexed operationId, bytes32 indexed descriptorId, uint64 eta);
    event AssetActivated(bytes32 indexed descriptorId, bytes32 evidenceHash);
    event RootQueued(bytes32 indexed operationId, bytes32 indexed assetId, bytes32 root, uint64 eta);
    event RootActivated(bytes32 indexed assetId, bytes32 root, bytes32 datasetHash);
    event IntervalActivated(bytes32 indexed assetId, bytes32 indexed leafHash, uint64 start, uint64 end);
    event ReportAccepted(bytes32 indexed assetId, bytes32 indexed feedId, uint64 observedAt, uint64 inputAt, uint8 phase, bytes32 reportHash);
    event HealthCheckpoint(bytes32 indexed assetId, uint256 reasonBits, uint64 validUntil);
    event CloseCaptured(bytes32 indexed assetId, bytes32 indexed boundaryHash, uint128 price18, uint64 inputAt, uint128 multiplier18);
    event PoolCreated(address indexed hook, bytes32 indexed poolId, bytes32 configHash, address indexed creator, address recipient);
    event SeedCaptured(bytes32 indexed poolId, uint128 principal0, uint128 principal1);
    event PoolActivated(bytes32 indexed poolId, uint256 tokenId, bytes32 positionKey);
    event PoolStaged(bytes32 indexed poolId, uint256 tokenId, bytes32 positionKey);
    event ModeCheckpoint(bytes32 indexed poolId, uint8 mode, uint256 reasons, uint64 closureNonce, uint64 reopenCandidateAt);
    event ClosureStarted(bytes32 indexed poolId, uint64 nonce);
    event ClosureEnded(bytes32 indexed poolId, uint64 nonce);
    event BudgetConsumed(bytes32 indexed poolId, uint64 epoch, uint64 closureNonce, uint128 gross0, uint128 gross1);
    event ServiceFeePaid(address indexed creator, address indexed token, uint128 amount, address recipient);
    event Paused(bytes32 indexed target, uint64 nonce);
    event ResumeQueued(bytes32 indexed operationId, bytes32 indexed target, uint64 nonce, uint64 eta);
    event Resumed(bytes32 indexed target, uint64 nonce);
    event OperationCancelled(bytes32 indexed operationId);
}

interface IBellErrors {
    error Unauthorized();
    error BadConfig(bytes32 reason);
    error BadLifecycle(uint8 lifecycle);
    error PolicyBlocked(uint256 reasonBits);
    error BadReport(bytes32 feedId, uint8 reason);
    error Replay(bytes32 feedId, uint64 observation);
    error BadCalendarProof(bytes32 assetId);
    error BadSeed();
    error CapExceeded(uint8 currency, uint8 capKind, uint256 amount, uint256 limit);
    error PricePathRejected();
    error DeadlineExpired(uint64 deadline);
    error NonceMismatch(uint64 expected, uint64 supplied);
    error SettlementMismatch(address token);
    error SlippageExceeded();
    error ContextMismatch();
}
