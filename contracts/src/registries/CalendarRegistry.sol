// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CalendarLeaf, CalendarRoot} from "../types/ProtocolTypes.sol";
import {CalendarProof} from "../libraries/CalendarProof.sol";
import {PolicyConstants} from "../libraries/PolicyConstants.sol";
import {ISafetyController, ICalendarRegistry} from "../interfaces/IBellProtocol.sol";
import {IBellEvents, IBellErrors} from "../interfaces/ProtocolEvents.sol";

contract CalendarRegistry is ICalendarRegistry, IBellEvents, IBellErrors {
    uint8 private constant STATUS_QUEUED = 1;
    uint8 private constant STATUS_DONE = 2;
    uint8 private constant STATUS_CANCELLED = 3;
    bytes32 private constant ZERO32 = bytes32(0);
    bytes32 private constant ERR_ROOT_QUEUE = keccak256("ROOT_QUEUE");
    bytes32 private constant ERR_ROOT_STATUS = keccak256("ROOT_STATUS");
    bytes32 private constant ERR_ROOT_TIME = keccak256("ROOT_TIME");
    bytes32 private constant ERR_ROOT_SLOT = keccak256("ROOT_SLOT");

    struct RootOperation {
        bytes32 assetId;
        CalendarRoot metadata;
        bytes32 payloadHash;
        uint64 eta;
        uint64 expiry;
        uint8 status;
    }

    ISafetyController public immutable safetyController;
    uint64 private _operationNonce;
    mapping(bytes32 operationId => RootOperation operation) private _operations;
    mapping(bytes32 assetId => bytes32 operationId) private _pendingRootForAsset;
    mapping(bytes32 assetId => bytes32 operationId) private _currentRootForAsset;
    mapping(bytes32 assetId => bytes32 operationId) private _nextRootForAsset;
    // CalendarRoot has no year ABI field. Inclusion proofs bind a year lazily to
    // its immutable governance operation, never to a mutable current/next slot.
    // Chronological links survive promotion and retain the previous terminal root.
    // Queueing cannot inspect a Merkle-committed year: conflicting year claims
    // are rejected at their first proved use, and a binding is never reassigned.
    mapping(bytes32 operationId => bytes32 previousId) private _previousRoot;
    mapping(bytes32 operationId => bytes32 followingId) private _followingRoot;
    mapping(bytes32 operationId => uint256 yearPlusOne) private _rootYear;
    mapping(bytes32 assetId => mapping(uint32 year => bytes32 operationId)) private _rootForYear;
    mapping(bytes32 assetId => CalendarLeaf interval) private _currentIntervals;
    mapping(bytes32 assetId => bool exists) private _hasCurrentInterval;
    mapping(bytes32 assetId => CalendarLeaf interval) private _nextIntervals;
    mapping(bytes32 assetId => bool exists) private _hasNextInterval;

    constructor(address safetyController_) {
        if (safetyController_ == address(0) || safetyController_.code.length == 0) revert BadConfig(bytes32("SAFETY_CONTROLLER"));
        safetyController = ISafetyController(safetyController_);
    }

    modifier onlyGovernance() {
        if (msg.sender != safetyController.governance()) revert Unauthorized();
        _;
    }

    function queueRoot(bytes32 assetId, CalendarRoot calldata metadata)
        external override onlyGovernance returns (bytes32 operationId)
    {
        if (assetId == ZERO32 || metadata.root == ZERO32 || metadata.datasetHash == ZERO32 || metadata.leafCount == 0
            || metadata.coverageEnd <= metadata.coverageStart || metadata.queuedAt != 0 || metadata.executableAt != 0
            || _pendingRootForAsset[assetId] != ZERO32 || _nextRootForAsset[assetId] != ZERO32) revert BadConfig(ERR_ROOT_QUEUE);
        uint256 notice = block.timestamp + safetyController.calendarPublicationLeadSeconds();
        if (metadata.coverageStart < notice) revert BadConfig(ERR_ROOT_TIME);

        bytes32 latestOperation = _nextRootForAsset[assetId] != ZERO32
            ? _nextRootForAsset[assetId]
            : _currentRootForAsset[assetId];
        if (latestOperation != ZERO32 && metadata.coverageStart < _operations[latestOperation].metadata.coverageEnd) {
            revert BadConfig(ERR_ROOT_QUEUE);
        }
        uint256 eta256 = block.timestamp + safetyController.governanceDelaySeconds();
        uint256 expiry256 = eta256 + safetyController.operationExpirySeconds();
        if (expiry256 > type(uint64).max) revert BadConfig(ERR_ROOT_TIME);
        bytes32 payloadHash = keccak256(abi.encode(assetId, metadata.root, metadata.leafCount, metadata.coverageStart, metadata.coverageEnd, metadata.datasetHash));
        operationId = keccak256(abi.encode(block.chainid, address(this), uint8(2), payloadHash, _operationNonce++));
        CalendarRoot memory queued = metadata;
        queued.queuedAt = uint64(block.timestamp);
        queued.executableAt = uint64(eta256);
        _operations[operationId] = RootOperation({
            assetId: assetId,
            metadata: queued,
            payloadHash: payloadHash,
            eta: uint64(eta256),
            expiry: uint64(expiry256),
            status: STATUS_QUEUED
        });
        _pendingRootForAsset[assetId] = operationId;
        emit RootQueued(operationId, assetId, metadata.root, uint64(eta256));
    }

    function activateRoot(bytes32 operationId) external override {
        RootOperation storage operation_ = _operations[operationId];
        if (operation_.status != STATUS_QUEUED || _pendingRootForAsset[operation_.assetId] != operationId) revert BadConfig(ERR_ROOT_STATUS);
        if (block.timestamp < operation_.eta || block.timestamp >= operation_.metadata.coverageStart) revert BadConfig(ERR_ROOT_TIME);
        if (block.timestamp > operation_.expiry) revert DeadlineExpired(operation_.expiry);

        bytes32 currentId = _currentRootForAsset[operation_.assetId];
        bytes32 nextId = _nextRootForAsset[operation_.assetId];
        if (currentId != ZERO32) {
            _previousRoot[operationId] = currentId;
            _followingRoot[currentId] = operationId;
        }
        if (currentId == ZERO32 || block.timestamp >= _operations[currentId].metadata.coverageEnd) {
            if (nextId != ZERO32) {
                if (block.timestamp < _operations[nextId].metadata.coverageStart) revert BadConfig(ERR_ROOT_SLOT);
                _currentRootForAsset[operation_.assetId] = nextId;
                _nextRootForAsset[operation_.assetId] = ZERO32;
            } else {
                _currentRootForAsset[operation_.assetId] = operationId;
            }
        } else if (nextId == ZERO32) {
            _nextRootForAsset[operation_.assetId] = operationId;
        } else {
            revert BadConfig(ERR_ROOT_SLOT);
        }

        _pendingRootForAsset[operation_.assetId] = ZERO32;
        operation_.status = STATUS_DONE;
        emit RootActivated(operation_.assetId, operation_.metadata.root, operation_.metadata.datasetHash);
    }

    function activateInterval(
        bytes32 assetId,
        CalendarLeaf calldata current,
        CalendarLeaf calldata previous,
        CalendarLeaf calldata next,
        bytes32[][] calldata proofs
    ) external override {
        if (proofs.length != 3 || proofs[0].length > 32 || proofs[1].length > 32 || proofs[2].length > 32) {
            revert BadCalendarProof(assetId);
        }
        bytes32 currentId = _currentRootForAsset[assetId];
        bytes32 nextId = _nextRootForAsset[assetId];
        if (currentId != ZERO32 && nextId != ZERO32 && block.timestamp >= _operations[nextId].metadata.coverageStart) {
            if (block.timestamp < _operations[currentId].metadata.coverageEnd) revert BadCalendarProof(assetId);
            _currentRootForAsset[assetId] = nextId;
            _nextRootForAsset[assetId] = ZERO32;
            currentId = nextId;
        }
        _verifyAndBind(assetId, currentId, current, proofs[0]);
        CalendarRoot storage root = _operations[currentId].metadata;
        CalendarProof.validateNeighbors(
            current,
            previous,
            next,
            root.leafCount,
            root.coverageStart,
            root.coverageEnd,
            uint64(block.timestamp)
        );
        _verifyNeighbor(assetId, currentId, current, previous, proofs[1], true);
        _verifyNeighbor(assetId, currentId, current, next, proofs[2], false);
        bytes32 leafHash = CalendarProof.hashLeaf(block.chainid, address(this), current);
        bool unchanged = _hasCurrentInterval[assetId]
            && keccak256(abi.encode(_currentIntervals[assetId])) == keccak256(abi.encode(current));
        _currentIntervals[assetId] = current;
        _hasCurrentInterval[assetId] = true;
        if (next.assetId != ZERO32) {
            _nextIntervals[assetId] = next;
            _hasNextInterval[assetId] = true;
        } else {
            delete _nextIntervals[assetId];
            _hasNextInterval[assetId] = false;
        }
        if (!unchanged) emit IntervalActivated(assetId, leafHash, current.start, current.end);
    }

    function _verifyAndBind(bytes32 assetId, bytes32 operationId, CalendarLeaf calldata leaf, bytes32[] calldata proof) private {
        RootOperation storage operation_ = _operations[operationId];
        CalendarRoot storage root = operation_.metadata;
        if (operationId == ZERO32 || operation_.status != STATUS_DONE || operation_.assetId != assetId
            || leaf.assetId != assetId || leaf.index >= root.leafCount
            || leaf.start < root.coverageStart || leaf.end > root.coverageEnd
            || (leaf.index == 0 && leaf.start != root.coverageStart)
            || (uint256(leaf.index) + 1 == root.leafCount && leaf.end != root.coverageEnd)
            || !CalendarProof.verify(root.root, block.chainid, address(this), leaf, proof)) revert BadCalendarProof(assetId);
        uint256 yearPlusOne = uint256(leaf.year) + 1;
        bytes32 assigned = _rootForYear[assetId][leaf.year];
        uint256 previousYear = _rootYear[_previousRoot[operationId]];
        uint256 followingYear = _rootYear[_followingRoot[operationId]];
        if ((assigned != ZERO32 && assigned != operationId)
            || (_rootYear[operationId] != 0 && _rootYear[operationId] != yearPlusOne)
            || (previousYear != 0 && previousYear >= yearPlusOne)
            || (followingYear != 0 && followingYear <= yearPlusOne)) revert BadCalendarProof(assetId);
        _rootYear[operationId] = yearPlusOne;
        _rootForYear[assetId][leaf.year] = operationId;
    }

    function _verifyNeighbor(
        bytes32 assetId, bytes32 currentId, CalendarLeaf calldata current,
        CalendarLeaf calldata neighbor, bytes32[] calldata proof, bool isPrevious
    ) private {
        if (neighbor.assetId == ZERO32) {
            if (proof.length != 0 || neighbor.year != 0 || neighbor.index != 0 || neighbor.start != 0
                || neighbor.end != 0 || neighbor.phase != 0 || neighbor.provenanceHash != ZERO32) revert BadCalendarProof(assetId);
            return;
        }
        bytes32 neighborId = currentId;
        if (neighbor.year != current.year) {
            if (isPrevious) {
                neighborId = _previousRoot[currentId];
                if (current.index != 0 || uint256(neighbor.year) + 1 != current.year
                    || uint256(neighbor.index) + 1 != _operations[neighborId].metadata.leafCount) revert BadCalendarProof(assetId);
            } else {
                neighborId = _followingRoot[currentId];
                if (uint256(current.index) + 1 != _operations[currentId].metadata.leafCount
                    || uint256(current.year) + 1 != neighbor.year || neighbor.index != 0) revert BadCalendarProof(assetId);
            }
        } else if (isPrevious ? uint256(neighbor.index) + 1 != current.index : uint256(current.index) + 1 != neighbor.index) {
            revert BadCalendarProof(assetId);
        }
        if (neighbor.assetId != assetId || (isPrevious ? neighbor.end != current.start : neighbor.start != current.end)) {
            revert BadCalendarProof(assetId);
        }
        _verifyAndBind(assetId, neighborId, neighbor, proof);
    }

    function currentInterval(bytes32 assetId) external view override returns (CalendarLeaf memory) {
        if (!_hasCurrentInterval[assetId]) return CalendarLeaf(0, 0, 0, 0, 0, 0, 0);
        CalendarLeaf memory interval = _currentIntervals[assetId];
        if (block.timestamp < interval.start || block.timestamp >= interval.end) return CalendarLeaf(0, 0, 0, 0, 0, 0, 0);
        return interval;
    }

    function nextInterval(bytes32 assetId) external view override returns (CalendarLeaf memory) {
        if (!_hasNextInterval[assetId]) return CalendarLeaf(0, 0, 0, 0, 0, 0, 0);
        return _nextIntervals[assetId];
    }

    function cancel(bytes32 operationId) external override {
        address governance = safetyController.governance();
        address guardian = safetyController.guardian();
        if (msg.sender != governance && msg.sender != guardian) revert Unauthorized();
        RootOperation storage operation_ = _operations[operationId];
        if (operation_.status != STATUS_QUEUED || _pendingRootForAsset[operation_.assetId] != operationId) revert BadConfig(ERR_ROOT_STATUS);
        operation_.status = STATUS_CANCELLED;
        _pendingRootForAsset[operation_.assetId] = ZERO32;
        emit OperationCancelled(operationId);
    }

    function operation(bytes32 operationId)
        external view returns (uint8 kind, bytes32 payloadHash, uint64 eta, uint64 expiry, uint8 status)
    {
        RootOperation storage operation_ = _operations[operationId];
        return (2, operation_.payloadHash, operation_.eta, operation_.expiry, operation_.status);
    }
}
