// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAssetRegistry, ISessionRegistry, ISafetyController, ICalendarRegistry} from "./interfaces/IBellProtocol.sol";
import {Anchor, AssetDescriptor, CalendarLeaf, HealthView, PoolClass, PoolState, ReasonBits, SourceSample} from "./types/ProtocolTypes.sol";
import {PolicyConstants} from "./libraries/PolicyConstants.sol";
import {ModePolicy} from "./libraries/ModePolicy.sol";
import {CalendarProof} from "./libraries/CalendarProof.sol";
import {AssetPolicy} from "./libraries/AssetPolicy.sol";

/// @dev Shared static dependency reader, split from BellPolicyOracle to keep both runtimes below EIP-170.
/// Results are ABI encoded so the oracle can keep its established public tuple types unchanged.
contract BellPolicyDependencyReader {
    struct Input {
        bytes32 configHash;
        bytes32 poolId;
        address hook;
        address token0;
        address token1;
        bytes32 asset0;
        bytes32 asset1;
        address assetRegistry;
        address calendarRegistry;
        address safetyController;
        address sessionRegistry;
        address referenceAdapter0;
        address referenceAdapter1;
        uint8 poolClass;
        uint8 referenceMode;
        bool executionReady;
        uint64 nowTime;
        uint64 bellStart;
        uint64 corporateUntil;
        uint128[2] tradeCap;
        uint128[2] windowCap;
        uint128[2] closureCap;
        PoolState state;
    }

    struct AssetEvaluation {
        uint256 reasons;
        uint64 validUntil;
        uint8 phase;
        bool phaseSet;
        bool isStock;
        uint64 healthySince;
        uint128 closeReferencePrice;
        bool plannedClosed;
        bool activeHealthy;
        bool legHealthy;
        bool closureContextOk;
        bool unexpectedClosed;
        uint64 observation;
        uint64 sessionValidUntil;
        bytes32 observationHash;
    }

    struct DependencyEvaluation {
        uint256 reasons;
        uint64 validUntil;
        uint64 fallbackValidUntil;
        uint8 phase;
        bool phaseSet;
        bool anyPlannedClosed;
        bool allLegsHealthy;
        bool closureContextValid;
        bool unexpectedClosed;
        uint8 stockMask;
        uint64[2] observations;
        uint64[2] healthySince;
        uint128[2] closeReferencePrices;
        uint64 poolPauseNonce;
        bool poolPauseOk;
        bytes32 dependencyHash;
    }

    struct AssetObservations {
        bytes32 pauseState;
        bytes32 descriptor;
        bytes32 calendar;
        bytes32 anchor;
        bytes32 health;
        bytes32 closedReport;
    }

    function evaluateDependencies(bytes calldata encodedInput) external view returns (bytes memory) {
        Input memory input = abi.decode(encodedInput, (Input));
        return abi.encode(_evaluateDependencies(input));
    }

    function _evaluateDependencies(Input memory input) private view returns (DependencyEvaluation memory deps) {
        deps.validUntil = type(uint64).max;
        deps.fallbackValidUntil = type(uint64).max;
        deps.phase = PolicyConstants.PHASE_UNKNOWN;
        bytes32 poolPauseObservation;

        if (input.nowTime == 0) deps.reasons |= ReasonBits.SETUP;

        {
            (bool ok, bool paused, uint64 nonce) =
                _readPauseState(input.safetyController, ModePolicy.targetId(1, input.hook));
            if (!ok) {
                deps.reasons |= ReasonBits.SETUP;
            } else {
                deps.poolPauseOk = true;
                deps.poolPauseNonce = nonce;
                poolPauseObservation = keccak256(abi.encode(paused, nonce));
                if (paused) deps.reasons |= ReasonBits.MANUAL_PAUSE;
            }
        }

        AssetEvaluation memory e0 = _evaluateAsset(input, input.asset0, input.token0);
        AssetEvaluation memory e1 = _evaluateAsset(input, input.asset1, input.token1);
        deps.reasons |= e0.reasons | e1.reasons;

        deps.stockMask = (e0.isStock ? uint8(1) : uint8(0)) | (e1.isStock ? uint8(2) : uint8(0));
        if (e0.isStock) deps.fallbackValidUntil = e0.sessionValidUntil;
        if (e1.isStock && e1.sessionValidUntil < deps.fallbackValidUntil) {
            deps.fallbackValidUntil = e1.sessionValidUntil;
        }
        deps.observations[0] = e0.observation;
        deps.observations[1] = e1.observation;
        deps.healthySince[0] = e0.healthySince;
        deps.healthySince[1] = e1.healthySince;
        deps.closeReferencePrices[0] = e0.closeReferencePrice;
        deps.closeReferencePrices[1] = e1.closeReferencePrice;
        deps.anyPlannedClosed = e0.plannedClosed || e1.plannedClosed;
        deps.unexpectedClosed = e0.unexpectedClosed || e1.unexpectedClosed;
        deps.allLegsHealthy = e0.legHealthy && e1.legHealthy;
        deps.closureContextValid = deps.anyPlannedClosed && e0.closureContextOk && e1.closureContextOk;

        if (e0.isStock && e0.phaseSet) {
            deps.phase = e0.phase;
            deps.phaseSet = true;
        }
        if (e1.isStock && e1.phaseSet) {
            if (!deps.phaseSet) {
                deps.phase = e1.phase;
                deps.phaseSet = true;
            } else if (deps.phase != e1.phase) {
                if (deps.phase == PolicyConstants.PHASE_CLOSED || e1.phase == PolicyConstants.PHASE_CLOSED) {
                    deps.phase = PolicyConstants.PHASE_CLOSED;
                } else {
                    deps.reasons |= ReasonBits.CALENDAR_CONFLICT;
                }
            }
        }
        if (e0.validUntil < deps.validUntil) deps.validUntil = e0.validUntil;
        if (e1.validUntil < deps.validUntil) deps.validUntil = e1.validUntil;

        if (deps.stockMask == 0) deps.reasons |= ReasonBits.CALENDAR_MISSING;

        deps.dependencyHash = keccak256(abi.encode(e0.observationHash, e1.observationHash, poolPauseObservation));
    }

    function _evaluateAsset(Input memory input, bytes32 assetId, address token)
        private
        view
        returns (AssetEvaluation memory result)
    {
        result.validUntil = type(uint64).max;
        AssetObservations memory observations;

        (bool pauseOk, bool paused, uint64 pauseNonce) = _readPauseState(input.safetyController, ModePolicy.targetId(2, token));
        if (!pauseOk) {
            _addReason(result, ReasonBits.SETUP);
        } else {
            observations.pauseState = keccak256(abi.encode(paused, pauseNonce));
            if (paused) _addReason(result, ReasonBits.ASSET_PAUSE);
        }

        (bool descriptorOk, AssetDescriptor memory descriptor_) = _readDescriptor(input.assetRegistry, assetId);
        if (descriptorOk) observations.descriptor = keccak256(abi.encode(descriptor_));
        if (!descriptorOk || descriptor_.id == bytes32(0) || descriptor_.token == address(0)) {
            _addReason(result, ReasonBits.SETUP);
        } else if (descriptor_.id != assetId || descriptor_.token != token) {
            _addReason(result, ReasonBits.FINGERPRINT_CHANGED);
        } else {
            result.isStock = descriptor_.isStock;
            result.closureContextOk = !descriptor_.isStock;
            if (
                descriptor_.expectedCodeHash != token.codehash || descriptor_.implementationFingerprint == bytes32(0)
                    || descriptor_.evidenceHash == bytes32(0)
            ) {
                _addReason(result, ReasonBits.FINGERPRINT_CHANGED);
            }
            if (descriptor_.isStock) {
                _evaluateStockCalendar(input, result, assetId, descriptor_, observations);
            }
        }

        bool referencePricedCounter = descriptorOk && input.poolClass == uint8(PoolClass.PRICE_GUARDED)
            && !descriptor_.isStock && input.referenceAdapter0 != address(0) && input.referenceAdapter1 != address(0);
        bool anytimeSessionOnlyStock = descriptorOk && descriptor_.isStock
            && input.poolClass == uint8(PoolClass.SESSION_ONLY);
        if (anytimeSessionOnlyStock) {
            // SESSION_ONLY is the explicit always-on AMM class. Its price comes from the pool itself;
            // source health is informational and must not disable trading outside feed update windows.
            result.legHealthy = true;
            if (block.timestamp <= type(uint64).max) result.observation = uint64(block.timestamp);
        } else if (descriptorOk && (AssetPolicy.oraclelessCounterasset(descriptor_, input.poolClass) || referencePricedCounter)) {
            // SESSION_ONLY explicitly accepts an oracleless counterasset. PRICE_GUARDED
            // non-stock assets instead rely on their required per-pool Chainlink adapter,
            // checked by _referencePrices; they must not need stock-session report health.
            result.legHealthy = true;
        } else {
            _evaluateAssetHealth(input, result, assetId, observations);
        }

        result.observationHash = keccak256(
            abi.encode(
                assetId,
                token,
                observations.pauseState,
                observations.descriptor,
                observations.calendar,
                observations.anchor,
                observations.health,
                observations.closedReport
            )
        );
    }

    function _evaluateStockCalendar(
        Input memory input,
        AssetEvaluation memory result,
        bytes32 assetId,
        AssetDescriptor memory descriptor_,
        AssetObservations memory observations
    ) private view {
        (uint8 calendarStatus, CalendarLeaf memory interval) = _readCalendar(input.calendarRegistry, assetId);
        observations.calendar =
            calendarStatus == 0 ? keccak256(abi.encode(interval)) : keccak256(abi.encode(calendarStatus));
        if (calendarStatus == 1) {
            _addReason(result, ReasonBits.CALENDAR_MISSING);
            result.validUntil = 0;
            return;
        }
        if (calendarStatus == 2) {
            _addReason(result, ReasonBits.CALENDAR_CONFLICT);
            result.validUntil = 0;
            return;
        }

        result.phase = interval.phase;
        result.phaseSet = true;
        result.sessionValidUntil = interval.end;
        if (interval.phase == PolicyConstants.PHASE_CLOSED) {
            if (input.poolClass == uint8(PoolClass.SESSION_ONLY)) {
                // A SESSION_ONLY pool keeps its closed-session fee and finite closure budget, but needs no
                // price anchor to stay tradable. This is what permits weekend swaps against the AMM price.
                result.plannedClosed = true;
                result.closureContextOk = true;
                result.legHealthy = true;
                if (block.timestamp <= type(uint64).max) result.observation = uint64(block.timestamp);
                if (interval.end < result.validUntil) result.validUntil = interval.end;
                return;
            }
            observations.anchor = _evaluatePlannedClosure(input, result, assetId, interval);
            return;
        }
        uint8 phaseBit = uint8(1 << interval.phase);
        if ((descriptor_.capabilityMask & phaseBit) == 0) {
            _addReason(result, ReasonBits.CALENDAR_CONFLICT);
            result.validUntil = 0;
            return;
        }
        result.closureContextOk = true;
        if (input.poolClass == uint8(PoolClass.SESSION_ONLY) && block.timestamp <= type(uint64).max) {
            result.observation = uint64(block.timestamp);
        }
        if (interval.end < result.validUntil) result.validUntil = interval.end;
    }

    function _evaluateAssetHealth(
        Input memory input,
        AssetEvaluation memory result,
        bytes32 assetId,
        AssetObservations memory observations
    ) private view {
        bool skipHealth = result.isStock && result.phaseSet && result.phase == PolicyConstants.PHASE_CLOSED;
        if (skipHealth) return;

        (bool healthOk, HealthView memory health_) = _readHealth(input.sessionRegistry, assetId);
        if (!healthOk) {
            _addReason(result, ReasonBits.REPORT_INVALID_OR_STALE);
            result.validUntil = 0;
            return;
        }

        observations.health = keccak256(abi.encode(health_));
        _addReason(result, health_.reasonBits);
        if (ModePolicy.hasUnknownReason(health_.reasonBits)) {
            _addReason(result, ReasonBits.REPORT_INVALID_OR_STALE);
        }
        if (!health_.ready) {
            if (health_.reasonBits == 0) _addReason(result, ReasonBits.REPORT_INVALID_OR_STALE);
            result.validUntil = 0;
            return;
        }
        if (
            health_.reasonBits != 0 || health_.healthySince == 0 || health_.validUntil <= input.nowTime
                || health_.healthySince > input.nowTime || health_.baselineObservation == 0
                || health_.latestObservation == 0 || health_.baselineObservation > input.nowTime
                || health_.latestObservation > input.nowTime
        ) {
            _addReason(result, ReasonBits.REPORT_INVALID_OR_STALE);
        }
        if (health_.validUntil < result.validUntil) result.validUntil = health_.validUntil;
        if (result.reasons != 0) return;

        result.activeHealthy = true;
        result.legHealthy = true;
        result.healthySince = health_.healthySince;
        result.observation = health_.latestObservation;
        if (result.isStock) {
            _rejectUnexpectedClosedReport(input, result, assetId, health_.latestObservation, observations);
        }
    }

    function _rejectUnexpectedClosedReport(
        Input memory input,
        AssetEvaluation memory result,
        bytes32 assetId,
        uint64 activeObservation,
        AssetObservations memory observations
    ) private view {
        (bool sampleOk, SourceSample memory closedSample) =
            _readLatestSample(input.sessionRegistry, assetId, PolicyConstants.PHASE_CLOSED);
        observations.closedReport = keccak256(abi.encode(sampleOk, closedSample));
        if (!sampleOk) {
            _addReason(result, ReasonBits.REPORT_INVALID_OR_STALE);
            result.activeHealthy = false;
            result.legHealthy = false;
            return;
        }
        if (
            closedSample.phase == PolicyConstants.PHASE_CLOSED && closedSample.observedAt != 0
                && closedSample.observedAt <= input.nowTime
                && input.nowTime - closedSample.observedAt < PolicyConstants.MAX_REPORT_AGE_SECONDS
                && closedSample.observedAt >= activeObservation
        ) {
            result.unexpectedClosed = true;
            result.activeHealthy = false;
            result.legHealthy = false;
            _addReason(result, ReasonBits.UNEXPECTED_CLOSED);
        }
    }

    function _evaluatePlannedClosure(
        Input memory input,
        AssetEvaluation memory result,
        bytes32 assetId,
        CalendarLeaf memory interval
    ) private view returns (bytes32 anchorObservation) {
        bytes32 boundary = CalendarProof.hashLeaf(block.chainid, input.calendarRegistry, interval);
        (bool anchorOk, uint256 anchorReasons, uint64 anchorValidUntil, Anchor memory anchor) =
            _readAnchorStatus(input.sessionRegistry, assetId, boundary);
        anchorObservation = keccak256(abi.encode(anchorOk, anchorReasons, anchorValidUntil, anchor));

        bool contextOk = anchorOk && anchorReasons == 0 && anchor.assetId == assetId && anchor.boundaryHash == boundary
            && anchor.price18 != 0 && anchor.multiplier18 != 0 && anchor.sourceHash != bytes32(0)
            && anchor.closureStart == interval.start && anchor.capturedAt < anchor.closureStart
            && anchor.observedAt <= anchor.capturedAt && anchor.inputAt <= anchor.capturedAt
            && anchor.inputAt <= input.nowTime && anchor.observedAt <= input.nowTime
            && anchorValidUntil > input.nowTime;

        if (contextOk) {
            (uint8 nextStatus, CalendarLeaf memory next) = _readNextCalendar(input.calendarRegistry, assetId);
            if (
                nextStatus == 2
                    || (nextStatus == 0
                        && (next.assetId != assetId || next.start != interval.end || next.end <= next.start
                            || next.phase < PolicyConstants.PHASE_PRE
                            || next.phase > PolicyConstants.PHASE_CLOSED
                            || next.provenanceHash == bytes32(0)))
            ) {
                contextOk = false;
                _addReason(result, ReasonBits.CALENDAR_CONFLICT);
            }
        }

        if (contextOk) {
            result.plannedClosed = true;
            result.closureContextOk = true;
            result.legHealthy = true;
            result.closeReferencePrice = anchor.price18;
            if (anchorValidUntil < result.validUntil) result.validUntil = anchorValidUntil;
            if (interval.end < result.validUntil) result.validUntil = interval.end;
        } else {
            result.unexpectedClosed = true;
            result.closureContextOk = false;
            _addReason(result, ReasonBits.UNEXPECTED_CLOSED);
            _addReason(result, anchorReasons == 0 ? ReasonBits.ANCHOR_MISSING_OR_EXPIRED : anchorReasons);
            result.validUntil = 0;
        }
    }

    function _addReason(AssetEvaluation memory result, uint256 reason) private pure {
        result.reasons |= reason;
    }

    function _readPauseState(address controller, bytes32 target)
        private
        view
        returns (bool success, bool paused, uint64 nonce)
    {
        bytes memory callData = abi.encodeWithSelector(ISafetyController.pauseState.selector, target);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        uint256 pausedWord;
        uint256 nonceWord;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(0x40, add(ptr, 64))
            success := staticcall(gasLimit, controller, add(callData, 32), mload(callData), ptr, 64)
            if iszero(eq(returndatasize(), 64)) { success := 0 }
            if success {
                pausedWord := mload(ptr)
                nonceWord := mload(add(ptr, 32))
            }
        }
        if (!success || pausedWord > 1 || nonceWord > type(uint64).max) return (false, false, 0);
        paused = pausedWord == 1;
        nonce = uint64(nonceWord);
        if (paused && nonce == 0) return (false, false, 0);
    }

    function _readDescriptor(address registry, bytes32 assetId)
        private
        view
        returns (bool success, AssetDescriptor memory descriptor_)
    {
        bytes memory callData = abi.encodeWithSelector(IAssetRegistry.descriptor.selector, assetId);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        assembly ("memory-safe") {
            descriptor_ := mload(0x40)
            mstore(0x40, add(descriptor_, 416))
            success := staticcall(gasLimit, registry, add(callData, 32), mload(callData), descriptor_, 416)
            if iszero(eq(returndatasize(), 416)) { success := 0 }
            if success {
                if shr(160, mload(add(descriptor_, 32))) { success := 0 }
                if or(gt(mload(add(descriptor_, 64)), 1), gt(mload(add(descriptor_, 96)), 18)) { success := 0 }
                if and(mload(add(descriptor_, 128)), not(0x1e)) { success := 0 }
            }
        }
    }

    function _readHealth(address registry, bytes32 assetId)
        private
        view
        returns (bool success, HealthView memory health_)
    {
        bytes memory callData = abi.encodeWithSelector(ISessionRegistry.health.selector, assetId);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        assembly ("memory-safe") {
            health_ := mload(0x40)
            mstore(0x40, add(health_, 192))
            success := staticcall(gasLimit, registry, add(callData, 32), mload(callData), health_, 192)
            if iszero(eq(returndatasize(), 192)) { success := 0 }
            if success {
                if or(
                    gt(mload(health_), 1),
                    or(
                        gt(mload(add(health_, 64)), 0xffffffffffffffff),
                        or(
                            gt(mload(add(health_, 96)), 0xffffffffffffffff),
                            or(
                                gt(mload(add(health_, 128)), 0xffffffffffffffff),
                                gt(mload(add(health_, 160)), 0xffffffffffffffff)
                            )
                        )
                    )
                ) { success := 0 }
            }
        }
    }

    function _readCalendar(address registry, bytes32 assetId)
        private
        view
        returns (uint8 status, CalendarLeaf memory interval)
    {
        (bool success, CalendarLeaf memory leaf) = _readLeaf(registry, ICalendarRegistry.currentInterval.selector, assetId);
        interval = leaf;
        if (!success) return (1, interval);
        if (interval.assetId == bytes32(0) || interval.end <= interval.start) return (1, interval);
        if (interval.assetId != assetId) return (2, interval);
        if (interval.start > block.timestamp || interval.end <= block.timestamp) return (1, interval);
        if (interval.phase < PolicyConstants.PHASE_PRE || interval.phase > PolicyConstants.PHASE_CLOSED) {
            return (2, interval);
        }
        if (interval.provenanceHash == bytes32(0)) return (2, interval);
        return (0, interval);
    }

    function _readNextCalendar(address registry, bytes32 assetId)
        private
        view
        returns (uint8 status, CalendarLeaf memory interval)
    {
        (bool success, CalendarLeaf memory leaf) = _readLeaf(registry, ICalendarRegistry.nextInterval.selector, assetId);
        interval = leaf;
        if (!success) return (2, interval);
        if (interval.assetId == bytes32(0)) return (1, interval);
        if (
            interval.assetId != assetId || interval.end <= interval.start || interval.phase < PolicyConstants.PHASE_PRE
                || interval.phase > PolicyConstants.PHASE_CLOSED || interval.provenanceHash == bytes32(0)
        ) return (2, interval);
        return (0, interval);
    }

    function _readLeaf(address registry, bytes4 selector, bytes32 assetId)
        private
        view
        returns (bool success, CalendarLeaf memory interval)
    {
        bytes memory callData = abi.encodeWithSelector(selector, assetId);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        assembly ("memory-safe") {
            interval := mload(0x40)
            mstore(0x40, add(interval, 224))
            success := staticcall(gasLimit, registry, add(callData, 32), mload(callData), interval, 224)
            if iszero(eq(returndatasize(), 224)) { success := 0 }
            if success {
                if or(
                    gt(mload(add(interval, 32)), 0xffffffff),
                    or(
                        gt(mload(add(interval, 64)), 0xffffffff),
                        or(
                            gt(mload(add(interval, 96)), 0xffffffffffffffff),
                            gt(mload(add(interval, 128)), 0xffffffffffffffff)
                        )
                    )
                ) { success := 0 }
                if gt(mload(add(interval, 160)), 0xff) { success := 0 }
            }
        }
    }

    function _readAnchorStatus(address registry, bytes32 assetId, bytes32 boundaryHash)
        private
        view
        returns (bool success, uint256 reasons, uint64 validUntil, Anchor memory anchor)
    {
        bytes memory callData =
            abi.encodeWithSelector(ISessionRegistry.anchorStatus.selector, assetId, boundaryHash);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        uint256 validWord;
        uint256 validUntilWord;
        assembly ("memory-safe") {
            anchor := mload(0x40)
            mstore(0x40, add(anchor, 384))
            success := staticcall(gasLimit, registry, add(callData, 32), mload(callData), anchor, 384)
            if iszero(eq(returndatasize(), 384)) { success := 0 }
            if success {
                validWord := mload(add(anchor, 288))
                reasons := mload(add(anchor, 320))
                validUntilWord := mload(add(anchor, 352))
                if or(
                    gt(validWord, 1),
                    or(
                        gt(validUntilWord, 0xffffffffffffffff),
                        or(
                            gt(mload(add(anchor, 64)), 0xffffffffffffffffffffffffffffffff),
                            or(
                                gt(mload(add(anchor, 96)), 0xffffffffffffffffffffffffffffffff),
                                or(
                                    gt(mload(add(anchor, 128)), 0xffffffffffffffff),
                                    or(
                                        gt(mload(add(anchor, 160)), 0xffffffffffffffff),
                                        or(
                                            gt(mload(add(anchor, 192)), 0xffffffffffffffff),
                                            gt(mload(add(anchor, 224)), 0xffffffffffffffff)
                                        )
                                    )
                                )
                            )
                        )
                    )
                ) { success := 0 }
            }
        }
        if (!success) return (false, 0, 0, anchor);
        validUntil = uint64(validUntilWord);
        success = validWord == 1;
    }

    function _readLatestSample(address registry, bytes32 assetId, uint8 phase)
        private
        view
        returns (bool success, SourceSample memory sample)
    {
        bytes memory callData = abi.encodeWithSelector(ISessionRegistry.latestSample.selector, assetId, phase);
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        assembly ("memory-safe") {
            sample := mload(0x40)
            mstore(0x40, add(sample, 320))
            success := staticcall(gasLimit, registry, add(callData, 32), mload(callData), sample, 320)
            if iszero(eq(returndatasize(), 320)) { success := 0 }
            if success {
                if or(
                    gt(mload(add(sample, 64)), 0xff),
                    gt(mload(add(sample, 96)), 0xffffffffffffffffffffffffffffffff)
                ) { success := 0 }
                if or(
                    or(
                        gt(mload(add(sample, 128)), 0xffffffffffffffff),
                        gt(mload(add(sample, 160)), 0xffffffffffffffff)
                    ),
                    or(
                        gt(mload(add(sample, 192)), 0xffffffffffffffff),
                        or(
                            gt(mload(add(sample, 224)), 0xffffffffffffffff),
                            gt(mload(add(sample, 256)), 0xffffffffffffffff)
                        )
                    )
                ) { success := 0 }
            }
        }
    }
}
