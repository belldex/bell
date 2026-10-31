// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAssetRegistry} from "./interfaces/IBellProtocol.sol";
import {ISessionRegistry, ISafetyController} from "./interfaces/IBellProtocol.sol";
import {ICalendarRegistry} from "./interfaces/IBellProtocol.sol";
import {Anchor, AssetDescriptor, Buckets, CalendarLeaf, HealthView, Lifecycle, Mode, PoolClass, PoolState, PolicyFlags, ReasonBits, SourceSample} from "./types/ProtocolTypes.sol";
import {PolicyConstants} from "./libraries/PolicyConstants.sol";
import {ModePolicy} from "./libraries/ModePolicy.sol";
import {CalendarProof} from "./libraries/CalendarProof.sol";
import {AssetPolicy} from "./libraries/AssetPolicy.sol";
import {WidePriceMath} from "./libraries/WidePriceMath.sol";
import {FlowBudget} from "./libraries/FlowBudget.sol";
import {IBellSwapEvaluator} from "./types/SwapEvaluation.sol";
import {BellPolicyDependencyReader} from "./BellPolicyDependencyReader.sol";

/// @dev Narrow local surface of ChainlinkTokenReferenceAdapter consumed with bounded staticcalls.
interface IChainlinkTokenReference {
    function referencePrice() external view returns (uint128);
}

/// @title BellPolicyOracle
/// @notice Stateless view-only transport for the complete BELL policy evaluation.
/// @dev This contract exists because `BellHook` was 5 bytes short of the EIP-170 limit. Every dependency read,
/// every reason aggregation and the whole `ModePolicy` decision lived inside the hook, leaving no room for the
/// M05-05 swap enforcement. Moving the *evaluation* here (called with STATICCALL, never DELEGATECALL) frees that
/// room while keeping the same semantics: the hook still owns the mutable state, still writes every checkpoint
/// and still decides whether to block. The oracle can only answer; it cannot mutate, authorize or bypass.
///
/// The instance is constructed by each hook, so it is immutable per pool like the hook itself. It holds no
/// storage at all: every input arrives in calldata, and a failed read is reported as a blocking reason exactly
/// as before, never as a healthy default.
interface IBellPolicyDependencyReader {
    function evaluateDependencies(bytes calldata encodedInput) external view returns (bytes memory);
}

contract BellPolicyOracle {
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

    struct Output {
        uint8 mode;
        bool canSwap;
        uint256 reasonBits;
        uint8 phase;
        uint16 flags;
        uint24 lpFeeUnits;
        uint16 bandBps;
        uint128[2] effectiveTradeCap;
        uint128[2] effectiveWindowCap;
        uint128[2] rollingRemaining;
        uint128[2] closureRemaining;
        uint128[2] referencePrice18;
        uint64 validUntil;
        uint64 closureNonce;
        bytes32 configHash;
        bytes32 dependencyHash;
        // ModePolicy decision, flattened so the hook does not need the struct.
        uint8 decisionMode;
        bool latch;
        uint64 decisionClosureNonce;
        bool beginLatch;
        bool releaseLatch;
        bool releaseRecovery;
        uint64 reopenCandidateAt;
        uint64 oldValidUntil;
        uint64[2] reopenBaseObservations;
        uint64[2] lastOpenObservations;
        uint64 pauseNonce;
        bool poolPauseOk;
    }

    struct ActivationCheck {
        uint128[2] references;
        uint256 referenceReasons;
        bool fallbackMode;
    }

    /// @notice Full evaluation for one pool snapshot. Pure view: no writes, no external mutation.
    function evaluate(Input calldata input, uint128[2] calldata currentGross, uint128[2] calldata previousGross, uint128[2] calldata episodeGross)
        external
        view
        returns (Output memory output)
    {
        DependencyEvaluation memory deps = _dependency(input);

        // PRICE_GUARDED reference reads happen before the decision so a failed/stale feed is a
        // recorded fallback condition or blocking reason, never a revert of the whole evaluate.
        (uint128[2] memory referencePrices, uint256 referenceReasons) = _referencePrices(input, deps);
        bool priceProtectionFallback = _priceProtectionFallback(input, deps, referenceReasons, false);
        uint256 blockingReasons = deps.reasons | referenceReasons;

        ModePolicy.Context memory context;
        context.lifecycle = input.state.lifecycle;
        context.previousMode = input.state.mode;
        context.activationCommitted = input.state.bellStart != 0;
        context.phase = deps.phase;
        context.phaseSet = deps.phaseSet;
        context.closedLatched = input.state.closedLatched;
        context.closureNonce = input.state.closureNonce;
        context.reopenCandidateAt = input.state.reopenCandidateAt;
        context.oldValidUntil = input.state.oldValidUntil;
        context.reopenBaseObservations = input.state.reopenBaseObservations;
        context.lastOpenObservations = input.state.lastOpenObservations;
        context.anyPlannedClosed = priceProtectionFallback && deps.phase == PolicyConstants.PHASE_CLOSED
            ? true : deps.anyPlannedClosed;
        context.allLegsHealthy = priceProtectionFallback || deps.allLegsHealthy;
        context.closureContextValid = priceProtectionFallback && deps.phase == PolicyConstants.PHASE_CLOSED
            ? true : deps.closureContextValid;
        context.unexpectedClosed = priceProtectionFallback ? false : deps.unexpectedClosed;
        context.dependencyReasons = priceProtectionFallback ? 0 : blockingReasons;
        context.validUntil = priceProtectionFallback ? deps.fallbackValidUntil : deps.validUntil;
        context.priceProtectionFallback = priceProtectionFallback;
        context.observations = deps.observations;
        if (priceProtectionFallback) {
            for (uint256 i; i < 2; ++i) {
                // A synthetic monotonic observation supports the recovery ledger while the external quote is
                // unavailable. It is time evidence only; it is never passed off as a price observation.
                if ((deps.stockMask & uint8(1 << i)) != 0) context.observations[i] = input.nowTime;
            }
        }
        context.stockMask = deps.stockMask;
        context.nowTime = input.nowTime;
        context.executionReady = input.executionReady;

        ModePolicy.Decision memory decision = ModePolicy.decide(context);

        output.mode = decision.mode;
        output.canSwap = decision.canSwap;
        output.reasonBits = decision.reasons;
        output.decisionMode = decision.mode;
        output.latch = decision.latch;
        output.decisionClosureNonce = decision.closureNonce;
        output.beginLatch = decision.beginLatch;
        output.releaseLatch = decision.releaseLatch;
        output.releaseRecovery = decision.releaseRecovery;
        output.reopenCandidateAt = decision.reopenCandidateAt;
        output.oldValidUntil = decision.oldValidUntil;
        output.reopenBaseObservations = decision.reopenBaseObservations;
        output.lastOpenObservations = decision.lastOpenObservations;

        // A pre-live pool has no actionable phase. Report the session phase only once LIVE so callers cannot
        // mistake a SETUP view for a tradable session.
        output.phase = input.state.lifecycle == uint8(Lifecycle.LIVE) && deps.phaseSet ? deps.phase : PolicyConstants.PHASE_UNKNOWN;
        output.flags = input.state.lifecycle != uint8(Lifecycle.LIVE) ? 0
            : input.poolClass == uint8(PoolClass.SESSION_ONLY)
                ? PolicyFlags.PRICE_PROTECTION_NOT_APPLICABLE
                : priceProtectionFallback ? PolicyFlags.PRICE_PROTECTION_FALLBACK : PolicyFlags.PRICE_PROTECTION_ACTIVE;
        output.lpFeeUnits = 0;
        output.bandBps = 0;
        output.effectiveTradeCap = [_tradeCap(input, 0), _tradeCap(input, 1)];
        output.effectiveWindowCap = [_windowCap(input, 0), _windowCap(input, 1)];
        if (priceProtectionFallback) {
            output.lpFeeUnits = PolicyConstants.FEE_CLOSED;
            (output.effectiveTradeCap, output.effectiveWindowCap) = _fallbackLimits(input, deps.phase);
        }
        output.rollingRemaining = [
            _rollingRemaining(output.effectiveWindowCap[0], currentGross[0], previousGross[0]),
            _rollingRemaining(output.effectiveWindowCap[1], currentGross[1], previousGross[1])
        ];
        output.closureRemaining = [
            _closureRemaining(input, episodeGross[0], 0),
            _closureRemaining(input, episodeGross[1], 1)
        ];
        output.referencePrice18 = priceProtectionFallback ? [uint128(0), uint128(0)] : referencePrices;
        output.validUntil = input.state.lifecycle == uint8(Lifecycle.LIVE)
            && context.validUntil != type(uint64).max ? context.validUntil : 0;
        output.closureNonce = input.state.closureNonce;
        output.configHash = input.configHash;
        output.pauseNonce = deps.poolPauseNonce;
        output.poolPauseOk = deps.poolPauseOk;
        output.dependencyHash = deps.dependencyHash;
    }

    function _tradeCap(Input calldata input, uint256 i) private pure returns (uint128) {
        return input.tradeCap[i];
    }

    /// @notice Per-side reference prices for PRICE_GUARDED. Each read is a bounded staticcall: a
    /// failed or stale feed becomes a recorded blocking reason, never a revert of the evaluation and
    /// never a healthy default. SESSION_ONLY (or a pool missing an adapter) reports ([0, 0], 0).
    function _referencePrices(Input calldata input, DependencyEvaluation memory deps)
        private
        view
        returns (uint128[2] memory prices, uint256 reasons)
    {
        if (input.poolClass != uint8(PoolClass.PRICE_GUARDED) || input.referenceAdapter0 == address(0)
            || input.referenceAdapter1 == address(0)) {
            return (prices, 0);
        }
        prices[0] = deps.closeReferencePrices[0] != 0
            ? deps.closeReferencePrices[0]
            : _readReferencePrice(input.referenceAdapter0);
        prices[1] = deps.closeReferencePrices[1] != 0
            ? deps.closeReferencePrices[1]
            : _readReferencePrice(input.referenceAdapter1);
        // A zero price means the bounded read failed, returned out of domain or reported a stale
        // feed (the adapter reverts). Eligible pools may use the explicit AMM fallback; other
        // contexts preserve this reason and remain blocked.
        if (prices[0] == 0 || prices[1] == 0) reasons = ReasonBits.PRICE_INPUT_INVALID_OR_STALE;
    }

    function _priceProtectionFallback(
        Input calldata input,
        DependencyEvaluation memory deps,
        uint256 referenceReasons,
        bool activation
    ) private pure returns (bool) {
        if (input.poolClass != uint8(PoolClass.PRICE_GUARDED)
            || input.referenceAdapter0 == address(0) || input.referenceAdapter1 == address(0)
            || (activation
                ? input.state.lifecycle != uint8(Lifecycle.SEEDING)
                : input.state.lifecycle != uint8(Lifecycle.LIVE) || input.state.bellStart == 0)
            || !deps.phaseSet || deps.stockMask == 0) return false;
        uint256 reasons = deps.reasons | referenceReasons;
        uint256 fallbackReasons = ReasonBits.REPORT_INVALID_OR_STALE | ReasonBits.PRICE_INPUT_INVALID_OR_STALE;
        if (deps.phase == PolicyConstants.PHASE_CLOSED) {
            fallbackReasons |= ReasonBits.UNEXPECTED_CLOSED | ReasonBits.ANCHOR_MISSING_OR_EXPIRED;
        } else if (deps.phase < PolicyConstants.PHASE_PRE || deps.phase > PolicyConstants.PHASE_OVERNIGHT) {
            return false;
        }
        return reasons != 0 && reasons & ~fallbackReasons == 0 && deps.fallbackValidUntil > input.nowTime;
    }

    /// @dev Selector-only staticcall with the house gas bound; returndata must be one uint128 word.
    function _readReferencePrice(address adapter) private view returns (uint128) {
        bytes4 selector = IChainlinkTokenReference.referencePrice.selector;
        uint256 gasLimit = PolicyConstants.MAX_STATIC_CALL_GAS;
        bool success;
        uint256 value;
        assembly ("memory-safe") {
            mstore(0, selector)
            success := staticcall(gasLimit, adapter, 0, 4, 0, 32)
            if iszero(eq(returndatasize(), 32)) { success := 0 }
            value := mload(0)
        }
        if (!success || value > type(uint128).max) return 0;
        return uint128(value);
    }

    function _windowCap(Input calldata input, uint256 i) private pure returns (uint128) {
        return input.windowCap[i];
    }

    function _fallbackLimits(Input calldata input, uint8 phase)
        private pure returns (uint128[2] memory trade, uint128[2] memory window)
    {
        return FlowBudget.effectiveLimits(input.tradeCap, input.windowCap, phase, true);
    }

    function _rollingRemaining(uint128 cap, uint128 currentGross, uint128 previousGross) private pure returns (uint128) {
        uint256 used = uint256(currentGross) + uint256(previousGross);
        if (used >= cap) return 0;
        return cap - uint128(used);
    }

    function _closureRemaining(Input calldata input, uint128 gross, uint256 i) private pure returns (uint128) {
        // No episode means no closure budget has been opened yet. Reporting a full cap here would advertise
        // spending room that does not exist.
        if (input.state.closureNonce == 0) return 0;
        uint128 cap = input.closureCap[i];
        return cap > gross ? cap - gross : 0;
    }

    /// @notice Swap preparation: builds the evaluator context and returns the pinned snapshot.
    /// @dev The hook supplies only the live facts the oracle cannot read (slot0, decimals, callback hash).
    function prepareSwap(
        Input calldata input,
        uint160 preSqrtPriceX96,
        uint8[2] calldata decimals,
        bytes32 callbackHash,
        bool zeroForOne,
        int256 amountSpecified,
        address evaluator
    ) external view returns (IBellSwapEvaluator.Snapshot memory snapshot) {
        BellPolicyOracle.Output memory o = this.evaluate(
            input, [uint128(0), uint128(0)], [uint128(0), uint128(0)], [uint128(0), uint128(0)]
        );
        if (!o.canSwap || o.beginLatch || o.releaseLatch || o.releaseRecovery) {
            uint256 reason = o.reasonBits;
            if (o.beginLatch || o.releaseLatch || o.releaseRecovery) reason |= ReasonBits.RECOVERY_PENDING;
            revert PolicyBlocked(reason);
        }
        bool fallbackMode = (o.flags & PolicyFlags.PRICE_PROTECTION_FALLBACK) != 0;
        if (input.poolClass == uint8(PoolClass.PRICE_GUARDED) && !fallbackMode
            && (o.referencePrice18[0] == 0 || o.referencePrice18[1] == 0)) {
            revert PolicyBlocked(ReasonBits.PRICE_INPUT_INVALID_OR_STALE);
        }

        IBellSwapEvaluator.Context memory context;
        context.configHash = input.configHash;
        context.stateHash = o.dependencyHash;
        context.poolClass = input.poolClass;
        context.mode = o.mode;
        context.phase = o.phase;
        context.closedLatched = o.mode == uint8(Mode.CLOSED);
        context.frozenStock = o.mode == uint8(Mode.CLOSED);
        context.closureNonce = o.closureNonce;
        context.timestamp = input.nowTime;
        context.validUntil = o.validUntil;
        context.bellStart = input.bellStart;
        context.corporateUntil = input.corporateUntil;
        context.preSqrtPriceX96 = preSqrtPriceX96;
        context.decimals = decimals;
        context.tradeCap = input.tradeCap;
        context.windowCap = input.windowCap;
        context.closureCap = input.closureCap;
        context.referencePrice18 = o.referencePrice18;
        snapshot = IBellSwapEvaluator(evaluator).prepare(context, callbackHash, zeroForOne, amountSpecified);
    }

    /// @notice Swap settlement: validates actual core deltas and returns both budget candidates.
    /// @dev Same arithmetic as `BellModeEvaluator.settle`, reached through the oracle so the hook's stack stays
    /// shallow. The hook still performs both writes.
    function settleSwap(
        IBellSwapEvaluator.Snapshot calldata snapshot,
        bytes32 callbackHash,
        uint64 timestamp,
        uint160 postSqrtPriceX96,
        int128 delta0,
        int128 delta1,
        Buckets calldata buckets,
        uint128[2] calldata episodeGross,
        address evaluator
    )
        external
        view
        returns (Buckets memory nextBuckets, uint128[2] memory nextEpisode, uint128[2] memory gross)
    {
        return IBellSwapEvaluator(evaluator).settle(
            snapshot, callbackHash, timestamp, postSqrtPriceX96, delta0, delta1, buckets, episodeGross
        );
    }

    error PolicyBlocked(uint256 reasonBits);

    /// @notice Dependency-only projection used by activation. Same reads, no decision.
    function bootstrap(Input calldata input) external view returns (DependencyEvaluation memory) {
        return _dependency(input);
    }

    /// @notice Validates fully seeded pool activation and returns 1=open, 2=verified close, 3=closed staging.
    /// @dev Keeping this aggregation beside dependency evaluation avoids duplicating large validation logic in
    /// the CREATE2 hook. Status 3 is only possible for a proven planned close with a narrowly missing price input.
    function activationStatus(Input calldata input, uint160 poolSqrtPriceX96, uint8[2] calldata decimals)
        external view returns (uint8 status, uint64 validUntil, uint64[2] memory observations)
    {
        DependencyEvaluation memory deps = _dependency(input);
        return _classifyActivation(input, deps, poolSqrtPriceX96, decimals);
    }

    function _classifyActivation(
        Input calldata input,
        DependencyEvaluation memory deps,
        uint160 poolSqrtPriceX96,
        uint8[2] calldata decimals
    ) private view returns (uint8 status, uint64 validUntil, uint64[2] memory observations) {
        ActivationCheck memory check;
        (check.references, check.referenceReasons) = _referencePrices(input, deps);
        check.fallbackMode = _priceProtectionFallback(input, deps, check.referenceReasons, true);
        if (check.fallbackMode) {
            deps.reasons = 0;
            deps.validUntil = deps.fallbackValidUntil;
            deps.allLegsHealthy = true;
            if (deps.phase == PolicyConstants.PHASE_CLOSED) {
                deps.anyPlannedClosed = true;
                deps.closureContextValid = true;
                deps.unexpectedClosed = false;
            }
            for (uint256 i; i < 2; ++i) {
                // The activation observations record only that fallback policy was checked at this time.
                if ((deps.stockMask & uint8(1 << i)) != 0) deps.observations[i] = uint64(block.timestamp);
            }
            check.references = [uint128(0), uint128(0)];
            check.referenceReasons = 0;
        }
        status = _activationReadiness(input, deps, check);
        if (status == 1 || status == 2) {
            uint16 band = status == 2 ? PolicyConstants.FROZEN_STOCK_BAND_BPS : PolicyConstants.ACTIVE_BAND_BPS;
            if (!check.fallbackMode && input.poolClass == uint8(PoolClass.PRICE_GUARDED)
                && (check.referenceReasons != 0
                    || !_isActivationPriceWithinBand(poolSqrtPriceX96, check.references, decimals, band))) {
                status = 0;
            }
        }
        validUntil = deps.validUntil;
        observations = deps.observations;
        if (status == 1 && input.poolClass != uint8(PoolClass.SESSION_ONLY) && !check.fallbackMode) {
            for (uint256 i; i < 2; ++i) {
                // forge-lint: disable-next-line(incorrect-shift)
                if ((deps.stockMask & uint8(1 << i)) == 0) continue;
                if (deps.healthySince[i] == 0
                    || uint256(deps.healthySince[i]) + PolicyConstants.REOPEN_MINIMUM_SEPARATION_SECONDS > block.timestamp
                    || deps.observations[i] == 0) status = 0;
            }
        }
    }

    function _activationReadiness(Input calldata input, DependencyEvaluation memory deps, ActivationCheck memory check)
        private view returns (uint8 status)
    {
        bool refsReady = check.fallbackMode || (check.referenceReasons == 0
            && (input.poolClass != uint8(PoolClass.PRICE_GUARDED)
                || (check.references[0] != 0 && check.references[1] != 0)));
        bool openReady = deps.reasons == 0 && refsReady && deps.phaseSet
            && deps.phase != PolicyConstants.PHASE_CLOSED && deps.allLegsHealthy
            && deps.validUntil > block.timestamp && deps.stockMask != 0;
        bool closedReady = deps.reasons == 0 && refsReady && deps.phaseSet
            && deps.phase == PolicyConstants.PHASE_CLOSED && deps.anyPlannedClosed
            && deps.closureContextValid && deps.allLegsHealthy && deps.validUntil > block.timestamp
            && deps.stockMask != 0;
        uint256 stageReasons = ReasonBits.SETUP | ReasonBits.UNEXPECTED_CLOSED
            | ReasonBits.ANCHOR_MISSING_OR_EXPIRED | ReasonBits.PRICE_INPUT_INVALID_OR_STALE;
        bool canStageClosed = deps.phaseSet && deps.phase == PolicyConstants.PHASE_CLOSED
            && deps.stockMask != 0 && deps.reasons & ~(ReasonBits.UNEXPECTED_CLOSED
                | ReasonBits.ANCHOR_MISSING_OR_EXPIRED) == 0
            && (deps.reasons | check.referenceReasons) & ~stageReasons == 0;

        if (openReady) status = 1;
        else if (closedReady) status = 2;
        else if (canStageClosed) status = 3;
    }

    function _isActivationPriceWithinBand(
        uint160 sqrtPriceX96,
        uint128[2] memory prices,
        uint8[2] calldata decimals,
        uint16 band
    ) private pure returns (bool) {
        return prices[0] != 0 && prices[1] != 0
            && WidePriceMath.isWithinPriceBand(
                sqrtPriceX96, prices[0], prices[1], decimals[0], decimals[1], band
            );
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


    address public immutable dependencyReader;

    constructor() {
        dependencyReader = address(new BellPolicyDependencyReader());
    }

    function _dependency(Input calldata input) private view returns (DependencyEvaluation memory deps) {
        bytes memory encoded = IBellPolicyDependencyReader(dependencyReader).evaluateDependencies(abi.encode(input));
        deps = abi.decode(encoded, (DependencyEvaluation));
    }


}
