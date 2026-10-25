// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ISafetyController} from "./interfaces/IBellProtocol.sol";
import {IBellEvents, IBellErrors} from "./interfaces/ProtocolEvents.sol";
import {PolicyConstants} from "./libraries/PolicyConstants.sol";

contract SafetyController is ISafetyController, IBellEvents, IBellErrors {
    uint8 private constant OP_RESUME = 1;
    uint8 private constant OP_ROLE_ROTATION = 2;
    uint8 private constant ROLE_GOVERNANCE = 0;
    uint8 private constant ROLE_GUARDIAN = 1;
    uint8 private constant STATUS_QUEUED = 1;
    uint8 private constant STATUS_DONE = 2;
    uint8 private constant STATUS_CANCELLED = 3;
    bytes32 private constant ERR_ROLE_SEPARATION = keccak256("ROLE_SEPARATION");
    bytes32 private constant ERR_TARGET = keccak256("TARGET");
    bytes32 private constant ERR_PAUSE_NONCE_OVERFLOW = keccak256("PAUSE_NONCE_OVERFLOW");
    bytes32 private constant ERR_RESUME_OPERATION = keccak256("RESUME_OPERATION");
    bytes32 private constant ERR_TIMELOCK = keccak256("TIMELOCK");
    bytes32 private constant ERR_ROLE_ROTATION = keccak256("ROLE_ROTATION");
    bytes32 private constant ERR_OPERATION_STATUS = keccak256("OPERATION_STATUS");
    bytes32 private constant ERR_TIME_RANGE = keccak256("TIME_RANGE");

    struct QueuedOperation {
        uint8 kind;
        bytes32 payloadHash;
        uint64 eta;
        uint64 expiry;
        uint64 pauseNonce;
        uint8 role;
        address successor;
        uint8 status;
    }

    address public override governance;
    address public override guardian;
    address public immutable treasury;
    uint64 private _operationNonce;
    mapping(bytes32 target => bool paused) private _paused;
    mapping(bytes32 target => uint64 nonce) private _pauseNonce;
    mapping(bytes32 operationId => QueuedOperation operation) private _operations;
    mapping(bytes32 operationId => bytes payload) private _operationPayload;

    constructor(address governance_, address guardian_, address treasury_) {
        if (governance_ == address(0) || guardian_ == address(0) || treasury_ == address(0)
            || governance_ == guardian_ || governance_ == treasury_ || guardian_ == treasury_)
            revert BadConfig(ERR_ROLE_SEPARATION);
        governance = governance_;
        guardian = guardian_;
        treasury = treasury_;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert Unauthorized();
        _;
    }

    function targetId(uint8 targetKind, address target) public pure returns (bytes32) {
        if ((targetKind != 1 && targetKind != 2) || target == address(0)) revert BadConfig(ERR_TARGET);
        return keccak256(abi.encode(targetKind, target));
    }

    function pausePool(address hook) external override onlyGuardian {
        _pause(targetId(1, hook));
    }

    function pauseAsset(address token) external override onlyGuardian {
        _pause(targetId(2, token));
    }

    function _pause(bytes32 target) private {
        uint64 nonce = _pauseNonce[target];
        if (nonce == type(uint64).max) revert BadConfig(ERR_PAUSE_NONCE_OVERFLOW);
        nonce += 1;
        _pauseNonce[target] = nonce;
        _paused[target] = true;
        emit Paused(target, nonce);
    }

    function queueResume(bytes32 target, uint64 nonce) external override onlyGovernance returns (bytes32 operationId) {
        if (!_paused[target] || _pauseNonce[target] != nonce) revert NonceMismatch(_pauseNonce[target], nonce);
        bytes32 payloadHash = keccak256(abi.encode(target, nonce));
        operationId = _queue(OP_RESUME, payloadHash, nonce, 0, address(0));
        _operationPayload[operationId] = abi.encode(target, nonce);
        emit ResumeQueued(operationId, target, nonce, _operations[operationId].eta);
    }

    function executeResume(bytes32 operationId) external override {
        QueuedOperation storage queued = _operations[operationId];
        if (queued.status != STATUS_QUEUED || queued.kind != OP_RESUME) revert BadConfig(ERR_RESUME_OPERATION);
        // The fixed 48-hour delay makes block timestamp's small proposer variance immaterial to safety.
        uint256 currentTime = block.timestamp;
        if (currentTime < queued.eta) revert BadConfig(ERR_TIMELOCK);
        if (currentTime > queued.expiry) revert DeadlineExpired(queued.expiry);
        (bytes32 target, uint64 nonce) = abi.decode(_resumePayload(operationId), (bytes32, uint64));
        if (!_paused[target] || _pauseNonce[target] != nonce) revert NonceMismatch(_pauseNonce[target], nonce);
        _paused[target] = false;
        queued.status = STATUS_DONE;
        emit Resumed(target, nonce);
    }

    function _resumePayload(bytes32 operationId) private view returns (bytes memory) {
        return _operationPayload[operationId];
    }

    function queueRoleRotation(uint8 role, address successor, bytes32 evidenceHash)
        external override onlyGovernance returns (bytes32 operationId)
    {
        if (role > ROLE_GUARDIAN || successor == address(0) || successor.code.length == 0 || evidenceHash == bytes32(0)) {
            revert BadConfig(ERR_ROLE_ROTATION);
        }
        if (successor == treasury || (role == ROLE_GOVERNANCE && successor == guardian)
            || (role == ROLE_GUARDIAN && successor == governance)) revert BadConfig(ERR_ROLE_SEPARATION);
        bytes32 payloadHash = keccak256(abi.encode(role, successor, evidenceHash));
        operationId = _queue(OP_ROLE_ROTATION, payloadHash, 0, role, successor);
        _operationPayload[operationId] = abi.encode(role, successor, evidenceHash);
    }

    function acceptRoleRotation(bytes32 operationId) external override {
        QueuedOperation storage queued = _operations[operationId];
        if (queued.status != STATUS_QUEUED || queued.kind != OP_ROLE_ROTATION || queued.successor != msg.sender) {
            revert Unauthorized();
        }
        // The fixed 48-hour delay makes block timestamp's small proposer variance immaterial to safety.
        uint256 currentTime = block.timestamp;
        if (currentTime < queued.eta) revert BadConfig(ERR_TIMELOCK);
        if (currentTime > queued.expiry) revert DeadlineExpired(queued.expiry);
        if (queued.successor == treasury
            || (queued.role == ROLE_GOVERNANCE && queued.successor == guardian)
            || (queued.role == ROLE_GUARDIAN && queued.successor == governance)) {
            revert BadConfig(ERR_ROLE_SEPARATION);
        }
        if (queued.role == ROLE_GOVERNANCE) governance = queued.successor;
        else guardian = queued.successor;
        queued.status = STATUS_DONE;
    }

    function cancel(bytes32 operationId) external override {
        if (msg.sender != governance && msg.sender != guardian) revert Unauthorized();
        QueuedOperation storage queued = _operations[operationId];
        if (queued.status != STATUS_QUEUED) revert BadConfig(ERR_OPERATION_STATUS);
        queued.status = STATUS_CANCELLED;
        emit OperationCancelled(operationId);
    }

    function pauseState(bytes32 target) external view override returns (bool paused, uint64 nonce) {
        return (_paused[target], _pauseNonce[target]);
    }

    function operation(bytes32 operationId)
        external view override returns (uint8 kind, bytes32 payloadHash, uint64 eta, uint64 expiry, uint8 status)
    {
        QueuedOperation storage queued = _operations[operationId];
        return (queued.kind, queued.payloadHash, queued.eta, queued.expiry, queued.status);
    }

    function _queue(uint8 kind, bytes32 payloadHash, uint64 pauseNonce, uint8 role, address successor)
        private returns (bytes32 operationId)
    {
        uint256 eta256 = block.timestamp + PolicyConstants.GOVERNANCE_MINIMUM_DELAY_SECONDS;
        uint256 expiry256 = eta256 + PolicyConstants.GOVERNANCE_OPERATION_EXPIRY_SECONDS;
        if (expiry256 > type(uint64).max) revert BadConfig(ERR_TIME_RANGE);
        operationId = keccak256(abi.encode(block.chainid, address(this), kind, payloadHash, _operationNonce++));
        // eta256 and expiry256 are checked against uint64 immediately above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 eta = uint64(eta256);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 expiry = uint64(expiry256);
        _operations[operationId] = QueuedOperation({
            kind: kind,
            payloadHash: payloadHash,
            eta: eta,
            expiry: expiry,
            pauseNonce: pauseNonce,
            role: role,
            successor: successor,
            status: STATUS_QUEUED
        });
    }
}
