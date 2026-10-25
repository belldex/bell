// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetDescriptor, SourceWire, SourceSample, HealthView, Anchor, CalendarLeaf, ReasonBits} from "../types/ProtocolTypes.sol";
import {ISessionRegistry} from "../interfaces/IBellProtocol.sol";
import {IBellEvents, IBellErrors} from "../interfaces/ProtocolEvents.sol";
import {PolicyConstants} from "../libraries/PolicyConstants.sol";
import {SourceConfigHash} from "../libraries/SourceConfigHash.sol";
import {CalendarProof} from "../libraries/CalendarProof.sol";
import {StockTokenStatusAdapter} from "../adapters/StockTokenStatusAdapter.sol";

interface ISessionAssetRegistry {
    function descriptor(bytes32 assetId) external view returns (AssetDescriptor memory);
    function sourceConfig(bytes32 assetId) external view returns (bytes memory);
}

interface ISessionDecoder {
    function decodeVerified(bytes calldata report) external returns (SourceSample memory);
}

interface ISessionDirectSource {
    function sourceConfigHash() external view returns (bytes32);
    function fingerprint() external view returns (bytes32);
    function readCurrent() external view returns (SourceSample memory);
}

interface ISessionCalendar {
    function currentInterval(bytes32 assetId) external view returns (CalendarLeaf memory);
    function nextInterval(bytes32 assetId) external view returns (CalendarLeaf memory);
}

contract SessionRegistry is ISessionRegistry, IBellEvents, IBellErrors {
    bytes32 private constant ZERO32 = bytes32(0);
    uint8 private constant KIND_QUOTE = 2;
    uint8 private constant KIND_V11 = 3;
    uint8 private constant KIND_SECONDARY = 4;
    bytes32 private constant ERR_REENTRANT = keccak256("REENTRANT_REPORT_SUBMISSION");

    ISessionAssetRegistry public immutable assetRegistry;
    address public immutable calendarRegistry;
    StockTokenStatusAdapter private immutable _stockTokenStatusAdapter;
    mapping(bytes32 assetId => mapping(uint8 phase => SourceSample sample)) private _latestByPhase;
    mapping(bytes32 assetId => mapping(bytes32 feedId => uint64 observation)) private _highWater;
    mapping(bytes32 reportHash => bool accepted) private _acceptedReports;
    mapping(bytes32 assetId => HealthView health) private _health;
    mapping(bytes32 key => Anchor anchor) private _anchors;
    uint256 private _submitLock;

    struct StockHealthInputs {
        uint256 reasons;
        uint64 validUntil;
        uint64 baseline;
        uint64 latest;
        uint128 underlyingPrice;
        uint128 directPrice;
        uint128 multiplier;
        bool calendarOk;
        bool directOk;
        bool corporateOk;
    }

    struct CloseCaptureInputs {
        CalendarLeaf upcoming;
        SourceSample underlying;
        SourceSample direct;
        uint128 multiplier;
        bytes32 corporateFingerprint;
    }

    constructor(address assetRegistry_, address calendarRegistry_) {
        if (assetRegistry_ == address(0) || assetRegistry_.code.length == 0) revert BadConfig(bytes32("ASSET_REGISTRY"));
        if (calendarRegistry_ != address(0) && calendarRegistry_.code.length == 0) revert BadConfig(bytes32("CALENDAR_REGISTRY"));
        assetRegistry = ISessionAssetRegistry(assetRegistry_);
        calendarRegistry = calendarRegistry_;
        _stockTokenStatusAdapter = new StockTokenStatusAdapter();
    }

    function submitReports(bytes32 assetId, bytes[] calldata reports) external override nonReentrant {
        if (assetId == ZERO32 || reports.length == 0 || reports.length > PolicyConstants.MAX_REPORTS_PER_BATCH) {
            revert BadReport(ZERO32, 1);
        }
        AssetDescriptor memory descriptor_ = assetRegistry.descriptor(assetId);
        SourceWire[] memory wires = abi.decode(assetRegistry.sourceConfig(assetId), (SourceWire[]));
        if (wires.length == 0 || wires.length > PolicyConstants.MAX_SOURCE_WIRES_PER_ASSET) revert BadConfig(bytes32("SOURCE_CONFIG"));

        uint256 totalBytes;
        SourceSample[] memory decoded = new SourceSample[](reports.length);
        for (uint256 i; i < reports.length; ++i) {
            bytes calldata report = reports[i];
            if (report.length == 0 || report.length > PolicyConstants.MAX_REPORT_BYTES) revert BadReport(ZERO32, 2);
            totalBytes += report.length;
            if (totalBytes > PolicyConstants.MAX_REPORT_BATCH_BYTES) revert BadReport(ZERO32, 3);
            (bool matched, SourceSample memory sample) = _decodeForAsset(descriptor_, wires, report);
            if (!matched) revert BadReport(ZERO32, 4);
            _validateSample(assetId, sample);
            if (sample.observedAt <= _highWater[assetId][sample.feedId]) revert Replay(sample.feedId, sample.observedAt);
            if (_acceptedReports[sample.reportHash]) revert Replay(sample.feedId, sample.observedAt);
            for (uint256 j; j < i; ++j) {
                if (decoded[j].feedId == sample.feedId || decoded[j].reportHash == sample.reportHash) {
                    revert Replay(sample.feedId, sample.observedAt);
                }
            }
            sample.descriptorId = assetId;
            decoded[i] = sample;
        }

        // Commit only after every report has passed decoding and batch-wide replay checks.
        for (uint256 i; i < decoded.length; ++i) {
            SourceSample memory sample = decoded[i];
            _highWater[assetId][sample.feedId] = sample.observedAt;
            _acceptedReports[sample.reportHash] = true;
            _latestByPhase[assetId][sample.phase] = sample;
            emit ReportAccepted(assetId, sample.feedId, sample.observedAt, sample.inputAt, sample.phase, sample.reportHash);
        }
    }

    modifier nonReentrant() {
        if (_submitLock != 0) revert BadConfig(ERR_REENTRANT);
        _submitLock = 1;
        _;
        _submitLock = 0;
    }

    function _decodeForAsset(AssetDescriptor memory descriptor_, SourceWire[] memory wires, bytes calldata report)
        private returns (bool matched, SourceSample memory sample)
    {
        for (uint256 i; i < wires.length; ++i) {
            SourceWire memory wire = wires[i];
            if (wire.kind != KIND_V11 && wire.kind != KIND_SECONDARY) continue;
            address adapter = _adapterFor(descriptor_, wire);
            if (adapter == address(0) || adapter.code.length == 0) continue;
            try ISessionDecoder(adapter).decodeVerified(report) returns (SourceSample memory candidate) {
                if (candidate.feedId != wire.feedId) continue;
                if (!_phaseMatches(wire, candidate.phase)) revert BadReport(wire.feedId, 5);
                return (true, candidate);
            } catch {
                // Another configured verifier may own this report; malformed batches still fail if none match.
            }
        }
    }

    function _adapterFor(AssetDescriptor memory descriptor_, SourceWire memory wire) private pure returns (address) {
        if (wire.kind == KIND_SECONDARY) return descriptor_.secondaryAdapter;
        if (wire.phaseScope == 1) return descriptor_.regularAdapter;
        if (wire.phaseScope == 2) return descriptor_.extendedAdapter;
        if (wire.phaseScope == 3) return descriptor_.overnightAdapter;
        return address(0);
    }

    function _phaseMatches(SourceWire memory wire, uint8 phase) private pure returns (bool) {
        if (wire.kind == KIND_SECONDARY) return wire.phaseScope == 4 && phase == 5;
        if (wire.phaseScope == 1) return phase == 2;
        if (wire.phaseScope == 2) return phase == 1 || phase == 3;
        if (wire.phaseScope == 3) return phase == 4;
        return false;
    }

    function _validateSample(bytes32 assetId, SourceSample memory sample) private view {
        if (sample.feedId == ZERO32 || sample.reportHash == ZERO32 || sample.phase == 0 || sample.phase > 5
            || sample.price18 == 0 || sample.observedAt == 0 || sample.observedAt > block.timestamp
            || sample.inputAt == 0 || sample.inputAt > block.timestamp || sample.validFrom > sample.observedAt
            || sample.expiresAt <= block.timestamp || sample.validUntil <= block.timestamp
            || sample.validUntil > sample.expiresAt
            || uint256(sample.validUntil) > uint256(sample.observedAt) + PolicyConstants.MAX_REPORT_AGE_SECONDS) {
            revert BadReport(sample.feedId, 6);
        }
        uint256 inputAge = block.timestamp - sample.inputAt;
        uint256 maximumInputAge = sample.phase == 2
            ? PolicyConstants.MAX_INPUT_AGE_REGULAR_SECONDS
            : sample.phase == 1
                ? PolicyConstants.MAX_INPUT_AGE_PRE_SECONDS
                : sample.phase == 3
                    ? PolicyConstants.MAX_INPUT_AGE_POST_SECONDS
                    : PolicyConstants.MAX_INPUT_AGE_OVERNIGHT_SECONDS;
        if (block.timestamp - sample.observedAt >= PolicyConstants.MAX_REPORT_AGE_SECONDS || inputAge > maximumInputAge) {
            revert BadReport(sample.feedId, 7);
        }
        // A verifier adapter returns an unset descriptor id; the registry is the canonical binder.
        if (sample.descriptorId != ZERO32 && sample.descriptorId != assetId) revert BadReport(sample.feedId, 8);
    }

    function refreshHealth(bytes32 assetId) external override returns (uint256 reasons) {
        AssetDescriptor memory descriptor_ = assetRegistry.descriptor(assetId);
        SourceWire[] memory wires = abi.decode(assetRegistry.sourceConfig(assetId), (SourceWire[]));
        if (!descriptor_.isStock) return _refreshNonStockQuote(assetId, wires);
        return _refreshStock(assetId, descriptor_, wires);
    }

    function _refreshStock(bytes32 assetId, AssetDescriptor memory descriptor_, SourceWire[] memory wires)
        private returns (uint256 reasons)
    {
        StockHealthInputs memory inputs;
        inputs.validUntil = type(uint64).max;
        CalendarLeaf memory interval;
        (inputs.calendarOk, interval) = _currentInterval(assetId);
        if (!inputs.calendarOk) inputs.reasons |= ReasonBits.CALENDAR_MISSING;
        else if (interval.phase < PolicyConstants.PHASE_PRE || interval.phase > PolicyConstants.PHASE_OVERNIGHT
            || (descriptor_.capabilityMask & uint8(1 << interval.phase)) == 0) {
            inputs.reasons |= ReasonBits.CALENDAR_CONFLICT;
        }

        if (inputs.calendarOk && interval.phase >= PolicyConstants.PHASE_PRE && interval.phase <= PolicyConstants.PHASE_OVERNIGHT) {
            if (interval.end < inputs.validUntil) inputs.validUntil = interval.end;
            (bool underlyingOk, SourceSample memory current, uint256 streamReasons) =
                _readEligibleUnderlying(assetId, _stockStreamAdapter(descriptor_, interval.phase), wires, interval.phase);
            inputs.reasons |= streamReasons;
            if (underlyingOk) {
                inputs.underlyingPrice = current.price18;
                inputs.baseline = current.observedAt;
                inputs.latest = current.observedAt;
                if (current.validUntil < inputs.validUntil) inputs.validUntil = current.validUntil;
                uint64 freshnessUntil = _stockFreshnessDeadline(current, interval.phase);
                if (freshnessUntil < inputs.validUntil) inputs.validUntil = freshnessUntil;
            }
        }

        (bool directOk, SourceSample memory direct, uint256 directReasons) = _readStockDirect(assetId, descriptor_, wires);
        inputs.directOk = directOk;
        inputs.reasons |= directReasons;
        if (directOk) {
            inputs.directPrice = direct.price18;
            if (direct.validUntil < inputs.validUntil) inputs.validUntil = direct.validUntil;
        }

        (bool corporateOk, uint128 multiplier, uint64 corporateUntil,, uint256 corporateReasons) = _readCorporate(descriptor_.token);
        inputs.corporateOk = corporateOk;
        inputs.multiplier = multiplier;
        inputs.reasons |= corporateReasons;
        if (corporateOk && corporateUntil < inputs.validUntil) inputs.validUntil = corporateUntil;

        if (inputs.underlyingPrice != 0 && inputs.directOk && inputs.corporateOk
            && !_withinCrossSourceDeviation(inputs.underlyingPrice, inputs.multiplier, inputs.directPrice)) {
            inputs.reasons |= ReasonBits.CORPORATE_INCONSISTENT;
        }
        return _storeStockHealth(assetId, inputs);
    }

    function _stockFreshnessDeadline(SourceSample memory sample, uint8 phase) private pure returns (uint64 deadline) {
        uint256 reportDeadline = uint256(sample.observedAt) + PolicyConstants.MAX_REPORT_AGE_SECONDS;
        uint256 inputDeadline = uint256(sample.inputAt) + _maximumStockInputAge(phase);
        uint256 earliest = reportDeadline < inputDeadline ? reportDeadline : inputDeadline;
        if (earliest > type(uint64).max) return 0;
        // earliest is explicitly bounded to the uint64 domain above.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(earliest);
    }

    function _storeStockHealth(bytes32 assetId, StockHealthInputs memory inputs) private returns (uint256 reasons) {
        bool ready = inputs.calendarOk && inputs.underlyingPrice != 0 && inputs.directOk && inputs.corporateOk
            && inputs.reasons == 0 && inputs.validUntil > block.timestamp;
        HealthView memory previous = _health[assetId];
        uint64 healthySince = ready
            ? previous.ready && previous.validUntil > block.timestamp && previous.reasonBits == 0 ? previous.healthySince : uint64(block.timestamp)
            : 0;
        HealthView memory result = HealthView({
            ready: ready,
            reasonBits: inputs.reasons,
            healthySince: healthySince,
            validUntil: ready ? inputs.validUntil : 0,
            baselineObservation: ready ? inputs.baseline : 0,
            latestObservation: ready ? inputs.latest : 0
        });
        _health[assetId] = result;
        emit HealthCheckpoint(assetId, inputs.reasons, result.validUntil);
        return inputs.reasons;
    }

    function _currentInterval(bytes32 assetId) private view returns (bool success, CalendarLeaf memory interval) {
        if (calendarRegistry == address(0) || calendarRegistry.code.length == 0) return (false, interval);
        address registry = calendarRegistry;
        bytes memory callData = abi.encodeWithSelector(ISessionCalendar.currentInterval.selector, assetId);
        assembly ("memory-safe") {
            interval := mload(0x40)
            mstore(0x40, add(interval, 224))
            success := staticcall(100000, registry, add(callData, 32), mload(callData), interval, 224)
            if iszero(eq(returndatasize(), 224)) { success := 0 }
            if success {
                if or(
                    or(gt(mload(add(interval, 32)), 0xffffffff), gt(mload(add(interval, 64)), 0xffffffff)),
                    or(
                        or(gt(mload(add(interval, 96)), 0xffffffffffffffff), gt(mload(add(interval, 128)), 0xffffffffffffffff)),
                        gt(mload(add(interval, 160)), 0xff)
                    )
                ) { success := 0 }
            }
        }
        if (!success || interval.assetId != assetId || interval.start > block.timestamp || interval.end <= block.timestamp) {
            return (false, interval);
        }
    }

    function _nextInterval(bytes32 assetId) private view returns (bool success, CalendarLeaf memory interval) {
        if (calendarRegistry == address(0) || calendarRegistry.code.length == 0) return (false, interval);
        address registry = calendarRegistry;
        bytes memory callData = abi.encodeWithSelector(ISessionCalendar.nextInterval.selector, assetId);
        assembly ("memory-safe") {
            interval := mload(0x40)
            mstore(0x40, add(interval, 224))
            success := staticcall(100000, registry, add(callData, 32), mload(callData), interval, 224)
            if iszero(eq(returndatasize(), 224)) { success := 0 }
            if success {
                if or(
                    or(gt(mload(add(interval, 32)), 0xffffffff), gt(mload(add(interval, 64)), 0xffffffff)),
                    or(
                        or(gt(mload(add(interval, 96)), 0xffffffffffffffff), gt(mload(add(interval, 128)), 0xffffffffffffffff)),
                        gt(mload(add(interval, 160)), 0xff)
                    )
                ) { success := 0 }
            }
        }
        if (!success || interval.assetId != assetId) return (false, interval);
    }

    function _stockStreamAdapter(AssetDescriptor memory descriptor_, uint8 phase) private pure returns (address) {
        if (phase == PolicyConstants.PHASE_REGULAR) return descriptor_.regularAdapter;
        if (phase == PolicyConstants.PHASE_OVERNIGHT) return descriptor_.overnightAdapter;
        return descriptor_.extendedAdapter;
    }

    function _readEligibleUnderlying(bytes32 assetId, address adapter, SourceWire[] memory wires, uint8 phase)
        private view returns (bool healthy, SourceSample memory sample, uint256 reasons)
    {
        uint8 requiredScope = phase == PolicyConstants.PHASE_REGULAR ? 1 : phase == PolicyConstants.PHASE_OVERNIGHT ? 3 : 2;
        for (uint256 i; i < wires.length; ++i) {
            SourceWire memory wire = wires[i];
            if (wire.kind != KIND_V11 || wire.phaseScope != requiredScope) continue;
            (bool configOk, bytes32 configHash) = _readAdapterWord(adapter, ISessionDirectSource.sourceConfigHash.selector);
            (bool fingerprintOk, bytes32 fingerprint) = _readAdapterWord(adapter, ISessionDirectSource.fingerprint.selector);
            sample = _latestByPhase[assetId][phase];
            if (!configOk || configHash != SourceConfigHash.hash(wire) || !fingerprintOk || fingerprint == ZERO32) {
                return (false, sample, ReasonBits.FINGERPRINT_CHANGED);
            }
            if (sample.feedId != wire.feedId || sample.phase != phase || !_validStockSample(sample, phase)) {
                return (false, sample, ReasonBits.REPORT_INVALID_OR_STALE);
            }
            return (true, sample, 0);
        }
        return (false, sample, ReasonBits.REPORT_INVALID_OR_STALE);
    }

    function _validStockSample(SourceSample memory sample, uint8 phase) private view returns (bool) {
        uint256 maximumInputAge = _maximumStockInputAge(phase);
        return sample.price18 != 0 && sample.observedAt != 0 && sample.observedAt <= block.timestamp
            && sample.inputAt != 0 && sample.inputAt <= block.timestamp && sample.validFrom <= sample.observedAt
            && sample.expiresAt > block.timestamp && sample.validUntil > block.timestamp && sample.validUntil <= sample.expiresAt
            && block.timestamp - sample.observedAt < PolicyConstants.MAX_REPORT_AGE_SECONDS
            && block.timestamp - sample.inputAt <= maximumInputAge
            && uint256(sample.validUntil) <= uint256(sample.observedAt) + PolicyConstants.MAX_REPORT_AGE_SECONDS;
    }

    function _maximumStockInputAge(uint8 phase) private pure returns (uint256) {
        if (phase == PolicyConstants.PHASE_REGULAR) return PolicyConstants.MAX_INPUT_AGE_REGULAR_SECONDS;
        if (phase == PolicyConstants.PHASE_PRE) return PolicyConstants.MAX_INPUT_AGE_PRE_SECONDS;
        if (phase == PolicyConstants.PHASE_POST) return PolicyConstants.MAX_INPUT_AGE_POST_SECONDS;
        return PolicyConstants.MAX_INPUT_AGE_OVERNIGHT_SECONDS;
    }

    function _readStockDirect(bytes32 assetId, AssetDescriptor memory descriptor_, SourceWire[] memory wires)
        private view returns (bool healthy, SourceSample memory sample, uint256 reasons)
    {
        for (uint256 i; i < wires.length; ++i) {
            if (wires[i].kind == 1 && wires[i].phaseScope == 0 && wires[i].priceBasis == 2) {
                return _readDirect(assetId, descriptor_.tokenPriceAdapter, wires[i], 1, 2);
            }
        }
        return (false, sample, ReasonBits.PRICE_INPUT_INVALID_OR_STALE);
    }

    function _readCorporate(address token)
        private view returns (bool healthy, uint128 multiplier, uint64 validUntil, bytes32 fingerprint, uint256 reasons)
    {
        if (block.timestamp > type(uint64).max) return (false, 0, 0, ZERO32, ReasonBits.CORPORATE_INCONSISTENT);
        bytes memory callData = abi.encodeWithSelector(StockTokenStatusAdapter.readStatus.selector, token, uint64(block.timestamp));
        StockTokenStatusAdapter.Status memory status;
        bool success;
        address adapter = address(_stockTokenStatusAdapter);
        assembly ("memory-safe") {
            status := mload(0x40)
            mstore(0x40, add(status, 192))
            success := staticcall(100000, adapter, add(callData, 32), mload(callData), status, 192)
            if iszero(eq(returndatasize(), 192)) { success := 0 }
            if success {
                if or(
                    or(gt(mload(status), 0xffffffffffffffffffffffffffffffffffff), gt(mload(add(status, 32)), 0xffffffffffffffffffffffffffffffffffff)),
                    or(
                        gt(mload(add(status, 64)), 0xffffffffffffffff),
                        or(gt(mload(add(status, 96)), 1), gt(mload(add(status, 128)), 1))
                    )
                ) { success := 0 }
                if iszero(mload(add(status, 160))) { success := 0 }
            }
        }
        if (!success) return (false, 0, 0, ZERO32, ReasonBits.CORPORATE_INCONSISTENT);
        if (status.oraclePaused) return (false, 0, 0, ZERO32, ReasonBits.ISSUER_PAUSE);
        validUntil = status.pending ? status.effectiveAt : type(uint64).max;
        return (true, status.multiplier18, validUntil, status.fingerprint, 0);
    }

    function _withinCrossSourceDeviation(uint128 underlyingPrice, uint128 multiplier, uint128 directPrice) private pure returns (bool) {
        uint256 adjusted = uint256(underlyingPrice) * uint256(multiplier) / 1e18;
        if (adjusted == 0 || adjusted > type(uint128).max) return false;
        uint256 difference = adjusted > directPrice ? adjusted - directPrice : uint256(directPrice) - adjusted;
        return difference * 10000 <= adjusted * PolicyConstants.MAX_CROSS_SOURCE_DEVIATION_BPS;
    }

    function _refreshNonStockQuote(bytes32 assetId, SourceWire[] memory wires)
        private returns (uint256 reasons)
    {
        uint64 validUntil = type(uint64).max;
        uint64 baseline;
        uint64 latest;
        uint256 expected;
        uint256 healthy;
        for (uint256 i; i < wires.length; ++i) {
            SourceWire memory wire = wires[i];
            if (wire.kind != KIND_QUOTE) continue;
            expected++;
            (bool directHealthy, SourceSample memory sample, uint256 directReasons) =
                _readDirectQuote(assetId, wire);
            if (!directHealthy) {
                reasons |= directReasons;
                continue;
            }
            healthy++;
            if (sample.observedAt > latest) latest = sample.observedAt;
            if (baseline == 0 || sample.observedAt < baseline) baseline = sample.observedAt;
            if (sample.validUntil < validUntil) validUntil = sample.validUntil;
        }
        bool ready = expected > 0 && healthy == expected && reasons == 0;
        HealthView memory previous = _health[assetId];
        uint64 healthySince = ready
            ? previous.ready && previous.validUntil > block.timestamp && previous.reasonBits == 0 ? previous.healthySince : uint64(block.timestamp)
            : 0;
        HealthView memory result = HealthView({
            ready: ready,
            reasonBits: reasons,
            healthySince: healthySince,
            validUntil: ready ? validUntil : 0,
            baselineObservation: ready ? baseline : 0,
            latestObservation: ready ? latest : 0
        });
        _health[assetId] = result;
        emit HealthCheckpoint(assetId, reasons, result.validUntil);
    }

    function _readDirectQuote(bytes32 assetId, SourceWire memory wire)
        private view returns (bool healthy, SourceSample memory sample, uint256 reasons)
    {
        return _readDirect(assetId, assetRegistry.descriptor(assetId).tokenPriceAdapter, wire, KIND_QUOTE, 3);
    }

    function _readDirect(bytes32 assetId, address adapter, SourceWire memory wire, uint8 requiredKind, uint8 requiredPriceBasis)
        private view returns (bool healthy, SourceSample memory sample, uint256 reasons)
    {
        if (wire.kind != requiredKind || wire.phaseScope != 0 || wire.schema != 0 || wire.feedId != ZERO32
            || wire.priceBasis != requiredPriceBasis) {
            return (false, sample, ReasonBits.PRICE_INPUT_INVALID_OR_STALE);
        }
        if (adapter == address(0) || adapter.code.length == 0) {
            return (false, sample, ReasonBits.FINGERPRINT_CHANGED);
        }
        (bool configOk, bytes32 configHash) = _readAdapterWord(adapter, ISessionDirectSource.sourceConfigHash.selector);
        if (!configOk || configHash != SourceConfigHash.hash(wire)) {
            return (false, sample, ReasonBits.FINGERPRINT_CHANGED);
        }
        (bool fingerprintOk, bytes32 fingerprint) = _readAdapterWord(adapter, ISessionDirectSource.fingerprint.selector);
        if (!fingerprintOk || fingerprint == ZERO32) {
            return (false, sample, ReasonBits.FINGERPRINT_CHANGED);
        }
        (bool sampleOk, SourceSample memory current) = _readAdapterSample(adapter);
        if (!sampleOk) {
            return (false, sample, ReasonBits.PRICE_INPUT_INVALID_OR_STALE);
        }
        sample = current;
        if (sample.descriptorId != ZERO32 && sample.descriptorId != assetId
            || sample.feedId != wire.feedId || sample.phase != 0 || sample.price18 == 0
            || sample.observedAt == 0 || sample.observedAt > block.timestamp
            || sample.inputAt == 0 || sample.inputAt > block.timestamp
            || sample.validFrom > sample.observedAt || sample.expiresAt <= block.timestamp
            || sample.validUntil <= block.timestamp || sample.validUntil > sample.expiresAt
            || block.timestamp - sample.observedAt > (requiredKind == KIND_QUOTE ? PolicyConstants.MAX_QUOTE_AGE_SECONDS : PolicyConstants.MAX_DIRECT_PRICE_AGE_SECONDS)
            || block.timestamp - sample.inputAt > (requiredKind == KIND_QUOTE ? PolicyConstants.MAX_QUOTE_AGE_SECONDS : PolicyConstants.MAX_DIRECT_PRICE_AGE_SECONDS)
            || uint256(sample.validUntil) > uint256(sample.observedAt) + (requiredKind == KIND_QUOTE ? PolicyConstants.MAX_QUOTE_AGE_SECONDS : PolicyConstants.MAX_DIRECT_PRICE_AGE_SECONDS)) {
            return (false, sample, ReasonBits.PRICE_INPUT_INVALID_OR_STALE);
        }
        return (true, sample, 0);
    }

    function _readAdapterWord(address adapter, bytes4 selector) private view returns (bool success, bytes32 value) {
        bytes memory callData = abi.encodeWithSelector(selector);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        assembly ("memory-safe") {
            let output := mload(0x40)
            mstore(0x40, add(output, 32))
            success := staticcall(gasLimit, adapter, add(callData, 32), mload(callData), output, 32)
            if iszero(eq(returndatasize(), 32)) { success := 0 }
            if success { value := mload(output) }
        }
    }

    function _readAdapterSample(address adapter) private view returns (bool success, SourceSample memory sample) {
        bytes memory callData = abi.encodeWithSelector(ISessionDirectSource.readCurrent.selector);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        assembly ("memory-safe") {
            // SourceSample has ten static ABI words. The fixed output buffer prevents wholesale returndata copying.
            sample := mload(0x40)
            mstore(0x40, add(sample, 320))
            success := staticcall(gasLimit, adapter, add(callData, 32), mload(callData), sample, 320)
            if iszero(eq(returndatasize(), 320)) { success := 0 }
            if success {
                if or(gt(mload(add(sample, 64)), 0xff), gt(mload(add(sample, 96)), 0xffffffffffffffffffffffffffffffffffff)) {
                    success := 0
                }
                if or(
                    or(gt(mload(add(sample, 128)), 0xffffffffffffffff), gt(mload(add(sample, 160)), 0xffffffffffffffff)),
                    or(
                        gt(mload(add(sample, 192)), 0xffffffffffffffff),
                        or(gt(mload(add(sample, 224)), 0xffffffffffffffff), gt(mload(add(sample, 256)), 0xffffffffffffffff))
                    )
                ) { success := 0 }
            }
        }
    }

    function health(bytes32 assetId) external view override returns (HealthView memory result) {
        result = _health[assetId];
        if (result.ready && result.validUntil <= block.timestamp) {
            result.ready = false;
            result.reasonBits |= ReasonBits.REPORT_INVALID_OR_STALE;
        }
    }

    function latestSample(bytes32 assetId, uint8 phase) external view override returns (SourceSample memory) {
        return _latestByPhase[assetId][phase];
    }

    function captureClose(bytes32 assetId, bytes32 boundaryHash) external override returns (Anchor memory anchor) {
        AssetDescriptor memory descriptor_ = assetRegistry.descriptor(assetId);
        if (!descriptor_.isStock || assetId == ZERO32 || block.timestamp > type(uint64).max) revert BadConfig(bytes32("CLOSE_CAPTURE_ASSET"));
        SourceWire[] memory wires = abi.decode(assetRegistry.sourceConfig(assetId), (SourceWire[]));
        if (wires.length == 0 || wires.length > PolicyConstants.MAX_SOURCE_WIRES_PER_ASSET) revert BadConfig(bytes32("SOURCE_CONFIG"));

        anchor = _buildCloseAnchor(assetId, boundaryHash, descriptor_, wires);
        bytes32 key = keccak256(abi.encode(assetId, boundaryHash));
        Anchor memory previous = _anchors[key];
        if (previous.assetId != ZERO32 && anchor.observedAt <= previous.observedAt) return previous;
        _anchors[key] = anchor;
        emit CloseCaptured(assetId, boundaryHash, anchor.price18, anchor.inputAt, anchor.multiplier18);
    }

    function _buildCloseAnchor(bytes32 assetId, bytes32 boundaryHash, AssetDescriptor memory descriptor_, SourceWire[] memory wires)
        private view returns (Anchor memory anchor)
    {
        CloseCaptureInputs memory inputs;
        uint8 phase;
        {
            (bool currentOk, CalendarLeaf memory current) = _currentInterval(assetId);
            (bool nextOk, CalendarLeaf memory upcoming) = _nextInterval(assetId);
            if (!currentOk || !nextOk || current.phase < PolicyConstants.PHASE_PRE || current.phase > PolicyConstants.PHASE_OVERNIGHT
                || (descriptor_.capabilityMask & uint8(1 << current.phase)) == 0
                || (upcoming.phase != PolicyConstants.PHASE_CLOSED
                    && (upcoming.phase < PolicyConstants.PHASE_PRE || upcoming.phase > PolicyConstants.PHASE_OVERNIGHT
                        || (descriptor_.capabilityMask & uint8(1 << upcoming.phase)) != 0))
                || upcoming.start != current.end || upcoming.end <= upcoming.start
                || boundaryHash != CalendarProof.hashLeaf(block.chainid, calendarRegistry, upcoming)
                || block.timestamp >= upcoming.start || block.timestamp + PolicyConstants.CLOSE_CAPTURE_WINDOW_SECONDS < upcoming.start) {
                revert BadConfig(bytes32("CLOSE_CAPTURE_CALENDAR"));
            }
            phase = current.phase;
            inputs.upcoming = upcoming;
        }
        {
            bool underlyingOk;
            bool directOk;
            bool corporateOk;
            (underlyingOk, inputs.underlying,) = _readEligibleUnderlying(assetId, _stockStreamAdapter(descriptor_, phase), wires, phase);
            (directOk, inputs.direct,) = _readStockDirect(assetId, descriptor_, wires);
            (corporateOk, inputs.multiplier,, inputs.corporateFingerprint,) = _readCorporate(descriptor_.token);
            if (!underlyingOk || !directOk || !corporateOk
                || !_withinCrossSourceDeviation(inputs.underlying.price18, inputs.multiplier, inputs.direct.price18)) {
                revert BadConfig(bytes32("CLOSE_CAPTURE_INPUT"));
            }
        }
        uint256 adjusted = uint256(inputs.underlying.price18) * uint256(inputs.multiplier) / 1e18;
        if (adjusted == 0 || adjusted > type(uint128).max) revert BadConfig(bytes32("CLOSE_CAPTURE_PRICE"));

        anchor = Anchor({
            assetId: assetId,
            boundaryHash: boundaryHash,
            price18: uint128(adjusted),
            multiplier18: inputs.multiplier,
            capturedAt: uint64(block.timestamp),
            observedAt: inputs.underlying.observedAt,
            inputAt: inputs.underlying.inputAt,
            closureStart: inputs.upcoming.start,
            sourceHash: keccak256(abi.encode(inputs.underlying.reportHash, inputs.direct.reportHash, inputs.corporateFingerprint))
        });
    }

    function closeAnchor(bytes32 assetId, bytes32 boundaryHash) external view override returns (Anchor memory) {
        return _anchors[keccak256(abi.encode(assetId, boundaryHash))];
    }

    /// @notice Validates a stored close anchor against its own capture metadata and the live corporate getters.
    /// @dev This is the minimal onchain view the hook needs for the planned-closure branch. It deliberately does
    /// not re-read the calendar: the caller binds `boundaryHash` to the canonical upcoming/current CLOSED leaf
    /// through `CalendarProof.hashLeaf(chainId, calendarRegistry, leaf)` and checks `closureStart` itself.
    /// A pending multiplier caps validity at its effective time; an immediate/past multiplier change or issuer
    /// pause invalidates the anchor instead of silently rescaling it.
    function anchorStatus(bytes32 assetId, bytes32 boundaryHash)
        external
        view
        override
        returns (Anchor memory anchor, bool valid, uint256 reasons, uint64 validUntil)
    {
        anchor = _anchors[keccak256(abi.encode(assetId, boundaryHash))];
        if (assetId == ZERO32 || boundaryHash == ZERO32 || anchor.assetId != assetId
            || anchor.boundaryHash != boundaryHash || anchor.price18 == 0 || anchor.multiplier18 == 0
            || anchor.capturedAt == 0 || anchor.observedAt == 0 || anchor.inputAt == 0 || anchor.closureStart == 0
            || anchor.sourceHash == ZERO32 || anchor.capturedAt >= anchor.closureStart
            || anchor.observedAt > anchor.capturedAt || anchor.inputAt > anchor.capturedAt
            || anchor.inputAt > block.timestamp || anchor.observedAt > block.timestamp) {
            return (anchor, false, ReasonBits.ANCHOR_MISSING_OR_EXPIRED, 0);
        }

        uint256 deadline = uint256(anchor.inputAt) + PolicyConstants.MAX_ANCHOR_AGE_SECONDS + 1;
        validUntil = deadline > type(uint64).max ? type(uint64).max : uint64(deadline);
        if (block.timestamp >= validUntil) {
            return (anchor, false, ReasonBits.ANCHOR_MISSING_OR_EXPIRED, validUntil);
        }

        AssetDescriptor memory descriptor_ = assetRegistry.descriptor(assetId);
        if (!descriptor_.isStock) {
            return (anchor, false, ReasonBits.ANCHOR_MISSING_OR_EXPIRED, validUntil);
        }
        (bool corporateOk, uint128 multiplier, uint64 corporateUntil,, uint256 corporateReasons) =
            _readCorporate(descriptor_.token);
        if (!corporateOk || multiplier != anchor.multiplier18) {
            return (
                anchor,
                false,
                corporateReasons == 0 ? ReasonBits.CORPORATE_INCONSISTENT : corporateReasons,
                validUntil
            );
        }
        // A pending multiplier is still the current multiplier until `effectiveAt`; the frozen price cannot
        // outlive that boundary.
        if (corporateUntil < validUntil) validUntil = corporateUntil;
        if (block.timestamp >= validUntil) {
            return (anchor, false, ReasonBits.CORPORATE_INCONSISTENT, validUntil);
        }
        return (anchor, true, 0, validUntil);
    }
}
