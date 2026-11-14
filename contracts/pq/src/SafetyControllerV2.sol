// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {HybridAuth} from "./HybridAuth.sol";

/// @title SafetyControllerV2
/// @notice Hybrid-authorized governance and guardian actions for a future BELL hook stack.
/// @dev The read ABI matches the controller interface consumed by BellHook. Legacy mutation
///      selectors intentionally revert: callers must use the signature-bearing V2 methods.
///      No PoolManager hook callback is added here, so this controller cannot gate LP exits.
contract SafetyControllerV2 {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN");
    bytes32 public constant PAUSE_ACTION = keccak256("SAFETY_PAUSE");
    bytes32 public constant QUEUE_RESUME_ACTION = keccak256("SAFETY_QUEUE_RESUME");
    bytes32 public constant QUEUE_CALL_ACTION = keccak256("SAFETY_QUEUE_GOVERNANCE_CALL");
    bytes32 public constant GUARDIAN_CANCEL_REGISTRY_ACTION = keccak256("SAFETY_GUARDIAN_CANCEL_REGISTRY");
    bytes32 public constant CANCEL_ACTION = keccak256("SAFETY_CANCEL_OPERATION");

    uint8 private constant OP_RESUME = 1;
    uint8 private constant OP_GOVERNANCE_CALL = 2;
    uint8 private constant STATUS_QUEUED = 1;
    uint8 private constant STATUS_DONE = 2;
    uint8 private constant STATUS_CANCELLED = 3;

    error HybridSignaturesRequired();
    error InvalidTarget();
    error InvalidOperation();
    error TimelockNotElapsed();
    error OperationExpired();
    error PauseStateMismatch();
    error CallFailed(bytes returnData);
    error TimeRangeInvalid();

    struct QueuedOperation {
        uint8 kind;
        bytes32 payloadHash;
        uint64 eta;
        uint64 expiry;
        uint64 pauseNonce;
        bytes32 target;
        uint8 status;
    }

    HybridAuth public immutable hybridAuth;
    uint32 public immutable governanceDelaySeconds;
    uint32 public immutable calendarPublicationLeadSeconds;
    uint32 public immutable operationExpirySeconds;
    uint64 private _operationNonce;
    mapping(bytes32 target => bool paused) private _paused;
    mapping(bytes32 target => uint64 nonce) private _pauseNonce;
    mapping(bytes32 operationId => QueuedOperation operation) private _operations;
    mapping(bytes32 operationId => bytes data) private _operationPayload;

    event Paused(bytes32 indexed target, uint64 nonce);
    event ResumeQueued(bytes32 indexed operationId, bytes32 indexed target, uint64 nonce, uint64 eta);
    event Resumed(bytes32 indexed target, uint64 nonce);
    event GovernanceCallQueued(bytes32 indexed operationId, address indexed target, bytes32 payloadHash, uint64 eta);
    event GovernanceCallExecuted(bytes32 indexed operationId, address indexed target);
    event RegistryOperationCancelled(address indexed target, bytes32 indexed operationId);
    event OperationCancelled(bytes32 indexed operationId);

    constructor(
        HybridAuth auth_,
        uint32 governanceDelaySeconds_,
        uint32 calendarPublicationLeadSeconds_,
        uint32 operationExpirySeconds_
    ) {
        if (address(auth_).code.length == 0 || operationExpirySeconds_ == 0) {
            revert InvalidTarget();
        }
        hybridAuth = auth_;
        governanceDelaySeconds = governanceDelaySeconds_;
        calendarPublicationLeadSeconds = calendarPublicationLeadSeconds_;
        operationExpirySeconds = operationExpirySeconds_;
    }

    /// @dev Legacy entrypoints are retained to make accidental old-client use fail explicitly.
    function pausePool(address) external pure {
        revert HybridSignaturesRequired();
    }

    function pauseAsset(address) external pure {
        revert HybridSignaturesRequired();
    }

    function queueResume(bytes32, uint64) external pure returns (bytes32) {
        revert HybridSignaturesRequired();
    }

    function cancel(bytes32) external pure {
        revert HybridSignaturesRequired();
    }

    function queueRoleRotation(uint8, address, bytes32) external pure returns (bytes32) {
        revert HybridSignaturesRequired();
    }

    function acceptRoleRotation(bytes32) external pure {
        revert HybridSignaturesRequired();
    }

    function pausePoolHybrid(address hook, uint256 deadline, bytes calldata ecdsaSignature, bytes calldata pqSignature)
        external
    {
        if (hook == address(0)) revert InvalidTarget();
        _authorize(
            GUARDIAN_ROLE, PAUSE_ACTION, keccak256(abi.encode(uint8(1), hook)), deadline, ecdsaSignature, pqSignature
        );
        _pause(targetId(1, hook));
    }

    function pauseAssetHybrid(
        address token,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external {
        if (token == address(0)) revert InvalidTarget();
        _authorize(
            GUARDIAN_ROLE, PAUSE_ACTION, keccak256(abi.encode(uint8(2), token)), deadline, ecdsaSignature, pqSignature
        );
        _pause(targetId(2, token));
    }

    function queueResumeHybrid(
        bytes32 target,
        uint64 pauseNonce,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external returns (bytes32 operationId) {
        if (!_paused[target] || _pauseNonce[target] != pauseNonce) {
            revert PauseStateMismatch();
        }
        _authorize(
            GOVERNANCE_ROLE,
            QUEUE_RESUME_ACTION,
            keccak256(abi.encode(target, pauseNonce)),
            deadline,
            ecdsaSignature,
            pqSignature
        );
        bytes32 payloadHash = keccak256(abi.encode(target, pauseNonce));
        operationId = _queue(OP_RESUME, payloadHash, pauseNonce, target, bytes(""));
        emit ResumeQueued(operationId, target, pauseNonce, _operations[operationId].eta);
    }

    /// @notice Queue a governance call to a registry or protocol contract.
    /// @dev Target and exact calldata are covered by both signatures and the operation timelock.
    function queueGovernanceCall(
        address target,
        bytes calldata callData,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external returns (bytes32 operationId) {
        if (target == address(0) || target == address(this) || target.code.length == 0 || callData.length < 4) {
            revert InvalidTarget();
        }
        bytes32 payloadHash = keccak256(abi.encode(target, keccak256(callData)));
        _authorize(GOVERNANCE_ROLE, QUEUE_CALL_ACTION, payloadHash, deadline, ecdsaSignature, pqSignature);
        operationId = _queue(OP_GOVERNANCE_CALL, payloadHash, 0, bytes32(uint256(uint160(target))), callData);
        emit GovernanceCallQueued(operationId, target, payloadHash, _operations[operationId].eta);
    }

    function executeResume(bytes32 operationId) external {
        QueuedOperation storage queued = _ready(operationId, OP_RESUME);
        bytes32 target = queued.target;
        uint64 pauseNonce = queued.pauseNonce;
        if (!_paused[target] || _pauseNonce[target] != pauseNonce) revert PauseStateMismatch();
        _paused[target] = false;
        queued.status = STATUS_DONE;
        emit Resumed(target, pauseNonce);
    }

    /// @notice Execute a matured governance call. Anyone may relay it after the timelock.
    function executeGovernanceCall(bytes32 operationId) external returns (bytes memory returnData) {
        QueuedOperation storage queued = _ready(operationId, OP_GOVERNANCE_CALL);
        address target = address(uint160(uint256(queued.target)));
        if (target.code.length == 0) revert InvalidTarget();
        bytes memory callData = _operationPayload[operationId];
        (bool success, bytes memory result) = target.call(callData);
        if (!success) revert CallFailed(result);
        queued.status = STATUS_DONE;
        emit GovernanceCallExecuted(operationId, target);
        return result;
    }

    /// @notice Preserve the existing guardian's immediate registry-cancel path under hybrid auth.
    /// @dev Only the fixed `cancel(bytes32)` selector is forwarded; it cannot execute arbitrary data.
    function cancelRegistryOperationHybrid(
        address target,
        bytes32 registryOperationId,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external {
        if (target == address(0) || target.code.length == 0) revert InvalidTarget();
        _authorize(
            GUARDIAN_ROLE,
            GUARDIAN_CANCEL_REGISTRY_ACTION,
            keccak256(abi.encode(target, registryOperationId)),
            deadline,
            ecdsaSignature,
            pqSignature
        );
        (bool success, bytes memory result) =
            target.call(abi.encodeWithSignature("cancel(bytes32)", registryOperationId));
        if (!success) revert CallFailed(result);
        emit RegistryOperationCancelled(target, registryOperationId);
    }

    function cancelHybrid(
        bytes32 operationId,
        bytes32 role,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external {
        if (role != GOVERNANCE_ROLE && role != GUARDIAN_ROLE) revert InvalidOperation();
        QueuedOperation storage queued = _operations[operationId];
        if (queued.status != STATUS_QUEUED) revert InvalidOperation();
        _authorize(
            role,
            CANCEL_ACTION,
            keccak256(abi.encode(operationId, queued.payloadHash)),
            deadline,
            ecdsaSignature,
            pqSignature
        );
        queued.status = STATUS_CANCELLED;
        emit OperationCancelled(operationId);
    }

    function governance() external view returns (address) {
        return address(this);
    }

    function guardian() external view returns (address) {
        return hybridAuth.registry().roleKey(GUARDIAN_ROLE).ecdsaSigner;
    }

    function pauseState(bytes32 target) external view returns (bool paused, uint64 nonce_) {
        return (_paused[target], _pauseNonce[target]);
    }

    function operation(bytes32 operationId)
        external
        view
        returns (uint8 kind, bytes32 payloadHash, uint64 eta, uint64 expiry, uint8 status)
    {
        QueuedOperation storage queued = _operations[operationId];
        return (queued.kind, queued.payloadHash, queued.eta, queued.expiry, queued.status);
    }

    function targetId(uint8 targetKind, address target) public pure returns (bytes32) {
        if ((targetKind != 1 && targetKind != 2) || target == address(0)) revert InvalidTarget();
        return keccak256(abi.encode(targetKind, target));
    }

    function _pause(bytes32 target) private {
        if (_pauseNonce[target] == type(uint64).max) revert TimeRangeInvalid();
        uint64 nextNonce = ++_pauseNonce[target];
        _paused[target] = true;
        emit Paused(target, nextNonce);
    }

    function _queue(uint8 kind, bytes32 payloadHash, uint64 pauseNonce, bytes32 target, bytes memory payload)
        private
        returns (bytes32 operationId)
    {
        uint256 eta256 = block.timestamp + governanceDelaySeconds;
        uint256 expiry256 = eta256 + operationExpirySeconds;
        if (expiry256 > type(uint64).max) revert TimeRangeInvalid();
        operationId = keccak256(abi.encode(block.chainid, address(this), kind, payloadHash, _operationNonce++));
        _operations[operationId] = QueuedOperation({
            kind: kind,
            payloadHash: payloadHash,
            eta: uint64(eta256),
            expiry: uint64(expiry256),
            pauseNonce: pauseNonce,
            target: target,
            status: STATUS_QUEUED
        });
        _operationPayload[operationId] = payload;
    }

    function _ready(bytes32 operationId, uint8 expectedKind) private view returns (QueuedOperation storage queued) {
        queued = _operations[operationId];
        if (queued.status != STATUS_QUEUED || queued.kind != expectedKind) revert InvalidOperation();
        if (block.timestamp < queued.eta) revert TimelockNotElapsed();
        if (block.timestamp > queued.expiry) revert OperationExpired();
    }

    function _authorize(
        bytes32 role,
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) private {
        hybridAuth.authorize(role, action, payloadHash, deadline, ecdsaSignature, pqSignature);
    }
}
