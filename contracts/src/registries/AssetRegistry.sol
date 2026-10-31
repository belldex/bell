// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetDescriptor, SourceWire} from "../types/ProtocolTypes.sol";
import {PolicyConstants} from "../libraries/PolicyConstants.sol";
import {ISafetyController} from "../interfaces/IBellProtocol.sol";
import {ISourceAdapterIdentity} from "../interfaces/ISourceAdapterIdentity.sol";
import {SourceConfigHash} from "../libraries/SourceConfigHash.sol";
import {IBellEvents, IBellErrors} from "../interfaces/ProtocolEvents.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

contract AssetRegistry is IBellEvents, IBellErrors {
    uint8 private constant STATUS_QUEUED = 1;
    uint8 private constant STATUS_DONE = 2;
    uint8 private constant STATUS_CANCELLED = 3;
    uint8 private constant SOURCE_AGGREGATOR_TOKEN = 1;
    uint8 private constant SOURCE_AGGREGATOR_QUOTE = 2;
    uint8 private constant SOURCE_STREAM_V11 = 3;
    uint8 private constant SOURCE_SECONDARY_TOKEN = 4;
    uint8 private constant SOURCE_CHAINLINK_SESSION = 5;
    uint8 private constant BASIS_UNDERLYING = 1;
    uint8 private constant BASIS_TOKEN_ADJUSTED = 2;
    uint8 private constant BASIS_QUOTE_USD = 3;
    uint8 private constant BASIS_SECONDARY_TOKEN = 4;
    bytes32 private constant ZERO32 = bytes32(0);
    bytes32 private constant ERR_SAFETY_CONTROLLER = keccak256("SAFETY_CONTROLLER");
    bytes32 private constant ERR_ASSET_DESCRIPTOR = keccak256("ASSET_DESCRIPTOR");
    bytes32 private constant ERR_TOKEN_CODEHASH = keccak256("TOKEN_CODEHASH");
    bytes32 private constant ERR_TOKEN_DECIMALS = keccak256("TOKEN_DECIMALS");
    bytes32 private constant ERR_TIME_RANGE = keccak256("TIME_RANGE");
    bytes32 private constant ERR_ASSET_OPERATION = keccak256("ASSET_OPERATION");
    bytes32 private constant ERR_TIMELOCK = keccak256("TIMELOCK");
    bytes32 private constant ERR_ASSET_CHANGED = keccak256("ASSET_CHANGED");
    bytes32 private constant ERR_UNKNOWN_ASSET = keccak256("UNKNOWN_ASSET");
    bytes32 private constant ERR_DECIMALS_GETTER = keccak256("DECIMALS_GETTER");
    bytes32 private constant ERR_DECIMALS_RANGE = keccak256("DECIMALS_RANGE");
    bytes32 private constant ERR_ADAPTER_CODE = keccak256("ADAPTER_CODE");
    bytes32 private constant ERR_STOCK_ADAPTERS = keccak256("STOCK_ADAPTERS");
    bytes32 private constant ERR_EXTENDED_ADAPTER = keccak256("EXTENDED_ADAPTER");
    bytes32 private constant ERR_OVERNIGHT_ADAPTER = keccak256("OVERNIGHT_ADAPTER");
    bytes32 private constant ERR_CAPABILITY_MASK = keccak256("CAPABILITY_MASK");
    bytes32 private constant ERR_SOURCE_CONFIG_MISSING = keccak256("SOURCE_CONFIG_MISSING");
    bytes32 private constant ERR_SOURCE_CONFIG_SIZE = keccak256("SOURCE_CONFIG_SIZE");
    bytes32 private constant ERR_SOURCE_CONFIG_ENCODING = keccak256("SOURCE_CONFIG_ENCODING");
    bytes32 private constant ERR_SOURCE_WIRE = keccak256("SOURCE_WIRE");
    bytes32 private constant ERR_SOURCE_WIRE_DUPLICATE = keccak256("SOURCE_WIRE_DUPLICATE");
    bytes32 private constant ERR_TOKEN_SOURCE = keccak256("TOKEN_SOURCE");
    bytes32 private constant ERR_QUOTE_SOURCE = keccak256("QUOTE_SOURCE");
    bytes32 private constant ERR_V11_SOURCE = keccak256("V11_SOURCE");
    bytes32 private constant ERR_SECONDARY_SOURCE = keccak256("SECONDARY_SOURCE");
    bytes32 private constant ERR_TOKEN_SOURCE_MISSING = keccak256("TOKEN_SOURCE_MISSING");
    bytes32 private constant ERR_REGULAR_STREAM_MISSING = keccak256("REGULAR_STREAM_MISSING");
    bytes32 private constant ERR_EXTENDED_STREAM_MISSING = keccak256("EXTENDED_STREAM_MISSING");
    bytes32 private constant ERR_OVERNIGHT_STREAM_MISSING = keccak256("OVERNIGHT_STREAM_MISSING");

    struct PendingAsset {
        AssetDescriptor descriptor;
        bytes sourceConfig;
        bytes32 descriptorId;
        bytes32 payloadHash;
        uint64 eta;
        uint64 expiry;
        uint8 status;
    }

    ISafetyController public immutable safetyController;
    uint64 private _operationNonce;
    mapping(bytes32 descriptorId => AssetDescriptor descriptor) private _descriptors;
    mapping(bytes32 descriptorId => bytes sourceConfig) private _sourceConfigs;
    mapping(address token => bytes32 descriptorId) private _descriptorByToken;
    mapping(address token => bool pending) private _pendingToken;
    mapping(bytes32 operationId => PendingAsset operation) private _pending;
    mapping(bytes32 operationId => bytes) private _operationPayload;

    constructor(address safetyController_) {
        if (safetyController_ == address(0) || safetyController_.code.length == 0) revert BadConfig(ERR_SAFETY_CONTROLLER);
        safetyController = ISafetyController(safetyController_);
    }

    modifier onlyGovernance() {
        if (msg.sender != safetyController.governance()) revert Unauthorized();
        _;
    }

    function queueAsset(AssetDescriptor calldata descriptor_, bytes calldata sourceConfig_)
        external onlyGovernance returns (bytes32 operationId)
    {
        if (descriptor_.id != ZERO32 || descriptor_.token == address(0) || descriptor_.token.code.length == 0
            || descriptor_.decimals > PolicyConstants.MAX_TOKEN_DECIMALS || descriptor_.evidenceHash == ZERO32
            || descriptor_.expectedCodeHash == ZERO32 || descriptor_.implementationFingerprint == ZERO32
            || _pendingToken[descriptor_.token] || _descriptorByToken[descriptor_.token] != ZERO32) {
            revert BadConfig(ERR_ASSET_DESCRIPTOR);
        }
        if (descriptor_.token.codehash != descriptor_.expectedCodeHash) revert BadConfig(ERR_TOKEN_CODEHASH);
        if (_readDecimals(descriptor_.token) != descriptor_.decimals) revert BadConfig(ERR_TOKEN_DECIMALS);
        _validateAdapters(descriptor_);
        bytes32 sourceConfigHash = _validateSourceConfig(descriptor_, sourceConfig_);
        bytes32 descriptorId = _descriptorId(descriptor_, sourceConfigHash);
        bytes32 payloadHash = keccak256(abi.encode(descriptorId, sourceConfigHash, descriptor_.evidenceHash));
        uint256 eta256 = block.timestamp + safetyController.governanceDelaySeconds();
        uint256 expiry256 = eta256 + safetyController.operationExpirySeconds();
        if (expiry256 > type(uint64).max) revert BadConfig(ERR_TIME_RANGE);
        // The explicit expiry bound above also bounds eta to uint64.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 eta = uint64(eta256);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 expiry = uint64(expiry256);
        operationId = keccak256(abi.encode(block.chainid, address(this), uint8(1), payloadHash, _operationNonce++));
        _pending[operationId] = PendingAsset({
            descriptor: descriptor_,
            sourceConfig: sourceConfig_,
            descriptorId: descriptorId,
            payloadHash: payloadHash,
            eta: eta,
            expiry: expiry,
            status: STATUS_QUEUED
        });
        _operationPayload[operationId] = abi.encode(descriptorId, sourceConfigHash);
        _pendingToken[descriptor_.token] = true;
        emit AssetQueued(operationId, descriptorId, eta);
    }

    function activateAsset(bytes32 operationId) external returns (bytes32 descriptorId) {
        PendingAsset storage pending = _pending[operationId];
        if (pending.status != STATUS_QUEUED) revert BadConfig(ERR_ASSET_OPERATION);
        uint256 currentTime = block.timestamp;
        if (currentTime < pending.eta) revert BadConfig(ERR_TIMELOCK);
        if (currentTime > pending.expiry) revert DeadlineExpired(pending.expiry);
        if (_descriptorByToken[pending.descriptor.token] != ZERO32 || pending.descriptor.token.codehash != pending.descriptor.expectedCodeHash) {
            revert BadConfig(ERR_ASSET_CHANGED);
        }
        descriptorId = pending.descriptorId;
        AssetDescriptor memory descriptor_ = pending.descriptor;
        descriptor_.id = descriptorId;
        _descriptors[descriptorId] = descriptor_;
        _sourceConfigs[descriptorId] = pending.sourceConfig;
        _descriptorByToken[descriptor_.token] = descriptorId;
        _pendingToken[descriptor_.token] = false;
        pending.status = STATUS_DONE;
        emit AssetActivated(descriptorId, descriptor_.evidenceHash);
    }

    function cancel(bytes32 operationId) external {
        address governor = safetyController.governance();
        address guardian = safetyController.guardian();
        if (msg.sender != governor && msg.sender != guardian) revert Unauthorized();
        PendingAsset storage pending = _pending[operationId];
        if (pending.status != STATUS_QUEUED) revert BadConfig(ERR_ASSET_OPERATION);
        pending.status = STATUS_CANCELLED;
        _pendingToken[pending.descriptor.token] = false;
        emit OperationCancelled(operationId);
    }

    function descriptor(bytes32 descriptorId) external view returns (AssetDescriptor memory) {
        AssetDescriptor memory result = _descriptors[descriptorId];
        if (result.id == ZERO32) revert BadConfig(ERR_UNKNOWN_ASSET);
        return result;
    }

    function sourceConfig(bytes32 descriptorId) external view returns (bytes memory) {
        if (_descriptors[descriptorId].id == ZERO32) revert BadConfig(ERR_UNKNOWN_ASSET);
        return _sourceConfigs[descriptorId];
    }

    function descriptorIdForToken(address token) external view returns (bytes32) {
        return _descriptorByToken[token];
    }

    function operation(bytes32 operationId)
        external view returns (uint8 kind, bytes32 payloadHash, uint64 eta, uint64 expiry, uint8 status)
    {
        PendingAsset storage pending = _pending[operationId];
        return (1, pending.payloadHash, pending.eta, pending.expiry, pending.status);
    }

    function _readDecimals(address token) private view returns (uint8 decimals_) {
        (bool ok, bytes memory data) = token.staticcall{gas: PolicyConstants.MAX_STATIC_CALL_GAS}(
            abi.encodeCall(IERC20Decimals.decimals, ())
        );
        if (!ok || data.length != 32) revert BadConfig(ERR_DECIMALS_GETTER);
        uint256 decoded = abi.decode(data, (uint256));
        if (decoded > PolicyConstants.MAX_TOKEN_DECIMALS) revert BadConfig(ERR_DECIMALS_RANGE);
        // The explicit range check above bounds token decimals to 0..18.
        // forge-lint: disable-next-line(unsafe-typecast)
        decimals_ = uint8(decoded);
    }

    function _validateAdapters(AssetDescriptor calldata descriptor_) private view {
        address[5] memory adapters = [
            descriptor_.tokenPriceAdapter,
            descriptor_.regularAdapter,
            descriptor_.extendedAdapter,
            descriptor_.overnightAdapter,
            descriptor_.secondaryAdapter
        ];
        for (uint256 i; i < adapters.length; ++i) {
            if (adapters[i] != address(0) && adapters[i].code.length == 0) revert BadConfig(ERR_ADAPTER_CODE);
        }
        if (descriptor_.isStock && (descriptor_.tokenPriceAdapter == address(0)
            || descriptor_.regularAdapter == address(0)
            || descriptor_.capabilityMask & (uint8(1) << PolicyConstants.PHASE_REGULAR) == 0)) revert BadConfig(ERR_STOCK_ADAPTERS);
        if (descriptor_.isStock && descriptor_.capabilityMask & (uint8(1) << PolicyConstants.PHASE_PRE) != 0
            && descriptor_.extendedAdapter == address(0)) revert BadConfig(ERR_EXTENDED_ADAPTER);
        if (descriptor_.isStock && descriptor_.capabilityMask & (uint8(1) << PolicyConstants.PHASE_POST) != 0
            && descriptor_.extendedAdapter == address(0)) revert BadConfig(ERR_EXTENDED_ADAPTER);
        if (descriptor_.isStock && descriptor_.capabilityMask & (uint8(1) << PolicyConstants.PHASE_OVERNIGHT) != 0
            && descriptor_.overnightAdapter == address(0)) revert BadConfig(ERR_OVERNIGHT_ADAPTER);
        // Capability bit 5 denotes CLOSED, which is a runtime phase rather than a token capability.
        if (descriptor_.capabilityMask & ~uint8(0x1e) != 0) revert BadConfig(ERR_CAPABILITY_MASK);
    }

    function _validateSourceConfig(AssetDescriptor calldata descriptor_, bytes calldata encoded)
        private view returns (bytes32 sourceHash)
    {
        if (encoded.length == 0) {
            if (descriptor_.isStock || descriptor_.tokenPriceAdapter != address(0) || descriptor_.regularAdapter != address(0)
                || descriptor_.extendedAdapter != address(0) || descriptor_.overnightAdapter != address(0)
                || descriptor_.secondaryAdapter != address(0)) revert BadConfig(ERR_SOURCE_CONFIG_MISSING);
            return keccak256(encoded);
        }
        if (encoded.length > 2048) revert BadConfig(ERR_SOURCE_CONFIG_SIZE);
        SourceWire[] memory wires = abi.decode(encoded, (SourceWire[]));
        if (wires.length == 0 || wires.length > PolicyConstants.MAX_SOURCE_WIRES_PER_ASSET
            || keccak256(abi.encode(wires)) != keccak256(encoded)) revert BadConfig(ERR_SOURCE_CONFIG_ENCODING);

        uint256 seen;
        uint8 streamMask;
        bool tokenAdjusted;
        for (uint256 i; i < wires.length; ++i) {
            SourceWire memory wire = wires[i];
            if (wire.kind < 1 || wire.kind > 5 || wire.phaseScope > 4 || wire.decimals > 18 || wire.endpoint == address(0)
                || wire.endpoint.code.length == 0 || wire.expectedCodeHash == ZERO32 || wire.endpoint.codehash != wire.expectedCodeHash
                || wire.expectedImplementation == address(0) || wire.expectedImplementation.code.length == 0
                || wire.canonicalTokenId != keccak256(abi.encode(block.chainid, descriptor_.token))) revert BadConfig(ERR_SOURCE_WIRE);
            uint256 bit = uint256(1) << (uint256(wire.kind) * 8 + wire.phaseScope);
            if (seen & bit != 0) revert BadConfig(ERR_SOURCE_WIRE_DUPLICATE);
            seen |= bit;

            if (wire.kind == 1) {
                if (!descriptor_.isStock || wire.phaseScope != 0 || wire.schema != 0 || wire.feedId != ZERO32 || wire.priceBasis != 2) revert BadConfig(ERR_TOKEN_SOURCE);
                tokenAdjusted = true;
            } else if (wire.kind == 2) {
                if (descriptor_.isStock || wire.phaseScope != 0 || wire.schema != 0 || wire.feedId != ZERO32 || wire.priceBasis != 3) revert BadConfig(ERR_QUOTE_SOURCE);
            } else if (wire.kind == 3) {
                // Schema 11 is the verified Chainlink EquityV11 report. Schema 12 is reserved for
                // an explicitly configured BELL-attested real-price adapter (e.g. Yahoo quotes);
                // the adapter code hash, expected endpoint identity and sourceConfigHash are still
                // pinned below, so a symbol or arbitrary JSON URL cannot self-admit as a source.
                if (!descriptor_.isStock || wire.phaseScope < 1 || wire.phaseScope > 3
                    || (wire.schema != 11 && wire.schema != 12) || wire.feedId == ZERO32 || wire.priceBasis != 1) {
                    revert BadConfig(ERR_V11_SOURCE);
                }
                streamMask |= uint8(1) << wire.phaseScope;
            } else if (wire.kind == SOURCE_CHAINLINK_SESSION) {
                if (!descriptor_.isStock || wire.phaseScope < 1 || wire.phaseScope > 3 || wire.schema != 1
                    || wire.feedId == ZERO32 || wire.priceBasis != 1 || wire.heartbeatSec != 86400) revert BadConfig(ERR_V11_SOURCE);
                streamMask |= uint8(1) << wire.phaseScope;
            } else if (!descriptor_.isStock || wire.phaseScope != 4 || wire.schema == 0 || wire.feedId == ZERO32 || wire.priceBasis != 4) {
                revert BadConfig(ERR_SECONDARY_SOURCE);
            }
            _assertAdapterBinding(descriptor_, wire);
        }
        if (descriptor_.isStock) {
            if (!tokenAdjusted) revert BadConfig(ERR_TOKEN_SOURCE_MISSING);
            if (streamMask & (uint8(1) << 1) == 0) {
                revert BadConfig(ERR_REGULAR_STREAM_MISSING);
            }
            if ((descriptor_.capabilityMask & (uint8(1) << PolicyConstants.PHASE_PRE) != 0 || descriptor_.capabilityMask & (uint8(1) << PolicyConstants.PHASE_POST) != 0)
                && streamMask & (uint8(1) << 2) == 0) revert BadConfig(ERR_EXTENDED_STREAM_MISSING);
            if (descriptor_.capabilityMask & (uint8(1) << PolicyConstants.PHASE_OVERNIGHT) != 0 && streamMask & (uint8(1) << 3) == 0) {
                revert BadConfig(ERR_OVERNIGHT_STREAM_MISSING);
            }
        }
        return keccak256(encoded);
    }

    function _assertAdapterBinding(AssetDescriptor calldata descriptor_, SourceWire memory wire) private view {
        address adapter;
        if (wire.kind == 1 || wire.kind == 2) adapter = descriptor_.tokenPriceAdapter;
        else if ((wire.kind == 3 || wire.kind == SOURCE_CHAINLINK_SESSION) && wire.phaseScope == 1) adapter = descriptor_.regularAdapter;
        else if ((wire.kind == 3 || wire.kind == SOURCE_CHAINLINK_SESSION) && wire.phaseScope == 2) adapter = descriptor_.extendedAdapter;
        else if ((wire.kind == 3 || wire.kind == SOURCE_CHAINLINK_SESSION) && wire.phaseScope == 3) adapter = descriptor_.overnightAdapter;
        else if (wire.kind == 4) adapter = descriptor_.secondaryAdapter;
        if (adapter == address(0) || adapter.code.length == 0) revert BadConfig(ERR_ADAPTER_CODE);
        (bool hashOk, bytes memory hashData) = adapter.staticcall{gas: PolicyConstants.MAX_STATIC_CALL_GAS}(
            abi.encodeCall(ISourceAdapterIdentity.sourceConfigHash, ())
        );
        (bool fingerprintOk, bytes memory fingerprintData) = adapter.staticcall{gas: PolicyConstants.MAX_STATIC_CALL_GAS}(
            abi.encodeCall(ISourceAdapterIdentity.fingerprint, ())
        );
        if (!hashOk || hashData.length != 32 || abi.decode(hashData, (bytes32)) != SourceConfigHash.hash(wire)
            || !fingerprintOk || fingerprintData.length != 32 || abi.decode(fingerprintData, (bytes32)) == ZERO32) {
            revert BadConfig(ERR_SOURCE_WIRE);
        }
    }

    function _descriptorId(AssetDescriptor calldata d, bytes32 sourceHash) private view returns (bytes32) {
        return keccak256(abi.encode(
            block.chainid,
            d.token,
            d.isStock,
            d.decimals,
            d.capabilityMask,
            d.tokenPriceAdapter,
            d.regularAdapter,
            d.extendedAdapter,
            d.overnightAdapter,
            d.secondaryAdapter,
            d.expectedCodeHash,
            d.implementationFingerprint,
            d.evidenceHash,
            sourceHash
        ));
    }
}
