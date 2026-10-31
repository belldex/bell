// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Lifecycle, Mode, ReasonBits} from "../types/ProtocolTypes.sol";
import {PolicyConstants} from "./PolicyConstants.sol";

/// @title ModePolicy
/// @notice Canonical lifecycle/health/closure decision for one BELL pool.
/// @dev This library is pure: the hook is responsible for collecting dependency reasons, anchors and recovery
/// observations with bounded staticcalls. Keeping the decision here means `getPolicy`, `refreshState` and
/// `beforeSwap` cannot drift.
///
/// Unknown enum values are never permissive:
/// - a lifecycle other than LIVE is SETUP (including corrupted/unknown values),
/// - a phase outside PRE..OVERNIGHT is CALENDAR_CONFLICT,
/// - CLOSED is UNEXPECTED_CLOSED unless a planned closure context and anchor were proven,
/// - a recovery candidate is only released on an explicit checkpoint, never by a view.
library ModePolicy {
    /// @dev ReasonBits 0..16 are the only known bits. Higher bits are retained but force a blocking reason.
    uint256 internal constant KNOWN_REASON_BITS = (uint256(1) << 17) - 1;

    /// @dev Inputs for the full closure/recovery decision. The hook fills every field from one dependency
    /// evaluation so the view and the checkpoint consume the same observations.
    struct Context {
        uint8 lifecycle;
        uint8 previousMode;
        bool activationCommitted;
        uint8 phase;
        bool phaseSet;
        bool closedLatched;
        uint64 closureNonce;
        uint64 reopenCandidateAt;
        uint64 oldValidUntil;
        uint64[2] reopenBaseObservations;
        uint64[2] lastOpenObservations;
        bool anyPlannedClosed;
        bool allLegsHealthy;
        bool closureContextValid;
        bool unexpectedClosed;
        uint256 dependencyReasons;
        uint64 validUntil;
        uint64[2] observations;
        uint8 stockMask;
        uint64 nowTime;
        bool executionReady;
        bool priceProtectionFallback;
    }

    /// @dev Result of one decision. `beginLatch`/`releaseLatch` are transitions that only a checkpoint may
    /// commit; the view projects them without writing.
    struct Decision {
        uint8 mode;
        bool canSwap;
        uint256 reasons;
        bool latch;
        uint64 closureNonce;
        bool beginLatch;
        bool releaseLatch;
        bool releaseRecovery;
        bool cancelCandidate;
        uint64 reopenCandidateAt;
        uint64 oldValidUntil;
        uint64[2] reopenBaseObservations;
        uint64[2] lastOpenObservations;
    }

    /// @dev Backwards-compatible projection used by M05-02 tests and simple callers.
    struct Evaluation {
        uint8 mode;
        uint256 reasons;
        bool canSwap;
    }

    /// @notice Full closure/recovery decision for a LIVE pool snapshot.
    function decide(Context memory context) internal pure returns (Decision memory decision) {
        decision.mode = uint8(Mode.HALTED);
        decision.reasons = context.dependencyReasons;
        decision.latch = context.closedLatched;
        decision.closureNonce = context.closureNonce;
        decision.reopenCandidateAt = context.reopenCandidateAt;
        decision.oldValidUntil = context.oldValidUntil;
        decision.reopenBaseObservations = context.reopenBaseObservations;
        decision.lastOpenObservations = context.lastOpenObservations;

        if (context.lifecycle != uint8(Lifecycle.LIVE)) {
            // DEPLOYED, SEEDING and any unknown/corrupted value are all pre-live SETUP states.
            decision.mode = uint8(Mode.SETUP);
            decision.reasons |= ReasonBits.SETUP;
            return decision;
        }

        // A LIVE pool without the normative non-zero activation marker is not activated, even if a corrupt
        // previous mode says otherwise. This gate is sticky: no latch, recovery candidate or ACTIVE projection
        // is reachable until M05-04/M06 commits the marker.
        if (!context.activationCommitted) {
            decision.mode = uint8(Mode.HALTED);
            decision.reasons |= ReasonBits.SETUP;
            _cancelCandidate(decision);
            return decision;
        }

        if (context.priceProtectionFallback) {
            if (decision.reasons != 0 || !context.phaseSet || context.validUntil == 0
                || context.nowTime >= context.validUntil || !context.allLegsHealthy) {
                _cancelCandidate(decision);
                return decision;
            }
            if (context.phase == PolicyConstants.PHASE_CLOSED) {
                if (!context.anyPlannedClosed || !context.closureContextValid) {
                    decision.reasons |= ReasonBits.UNEXPECTED_CLOSED;
                    _cancelCandidate(decision);
                    return decision;
                }
                decision.mode = uint8(Mode.CLOSED);
                decision.latch = true;
                decision.canSwap = context.executionReady;
                if (!context.closedLatched) {
                    decision.beginLatch = true;
                    decision.closureNonce = context.closureNonce + 1;
                }
                decision.reopenCandidateAt = 0;
                decision.reopenBaseObservations = [uint64(0), uint64(0)];
                return decision;
            }
            if (context.phase < PolicyConstants.PHASE_PRE || context.phase > PolicyConstants.PHASE_OVERNIGHT) {
                decision.reasons |= ReasonBits.CALENDAR_CONFLICT;
                _cancelCandidate(decision);
                return decision;
            }
            if (context.closedLatched) {
                // Keep the existing closure recovery delay when the calendar reopens. The fallback
                // observation is only a time checkpoint; it does not claim a stock price was observed.
                if (context.reopenCandidateAt == 0 || context.reopenCandidateAt > context.nowTime
                    || context.nowTime >= context.oldValidUntil) {
                    decision.mode = uint8(Mode.RECOVERING);
                    decision.reasons |= ReasonBits.RECOVERY_PENDING;
                    decision.reopenCandidateAt = context.nowTime;
                    decision.reopenBaseObservations = context.observations;
                    decision.oldValidUntil = context.validUntil;
                    decision.lastOpenObservations = context.observations;
                    return decision;
                }
                if (context.nowTime - context.reopenCandidateAt >= PolicyConstants.REOPEN_MINIMUM_SEPARATION_SECONDS
                    && _observationsAdvanced(context.observations, context.reopenBaseObservations, context.stockMask)) {
                    decision.latch = false;
                    decision.releaseLatch = true;
                    decision.reopenCandidateAt = 0;
                    decision.reopenBaseObservations = [uint64(0), uint64(0)];
                    decision.oldValidUntil = context.validUntil;
                    decision.lastOpenObservations = context.observations;
                    decision.mode = uint8(Mode.ACTIVE);
                    decision.canSwap = context.executionReady;
                    return decision;
                }
                decision.mode = uint8(Mode.RECOVERING);
                decision.reasons |= ReasonBits.RECOVERY_PENDING;
                decision.oldValidUntil = context.validUntil;
                decision.lastOpenObservations = context.observations;
                return decision;
            }
            decision.mode = uint8(Mode.ACTIVE);
            decision.canSwap = context.executionReady;
            decision.reopenCandidateAt = 0;
            decision.reopenBaseObservations = [uint64(0), uint64(0)];
            decision.oldValidUntil = context.validUntil;
            decision.lastOpenObservations = context.observations;
            return decision;
        }

        bool healthy = decision.reasons == 0;

        if (context.closedLatched) {
            if (context.anyPlannedClosed) {
                // A proven closure (or a fault inside an existing closure) never creates a new episode.
                decision.mode = healthy && context.closureContextValid ? uint8(Mode.CLOSED) : uint8(Mode.HALTED);
                decision.canSwap = decision.mode == uint8(Mode.CLOSED) && context.executionReady;
                if (!context.closureContextValid) decision.reasons |= ReasonBits.ANCHOR_MISSING_OR_EXPIRED;
                _cancelCandidate(decision);
                return decision;
            }

            if (
                !healthy || !context.allLegsHealthy || !context.phaseSet
                    || context.phase == PolicyConstants.PHASE_CLOSED || context.validUntil == 0
                    || context.nowTime >= context.validUntil
            ) {
                decision.mode = uint8(Mode.HALTED);
                if (!context.phaseSet) {
                    decision.reasons |= ReasonBits.CALENDAR_CONFLICT;
                } else if (context.phase == PolicyConstants.PHASE_CLOSED) {
                    decision.reasons |= ReasonBits.UNEXPECTED_CLOSED;
                } else if (context.phase < PolicyConstants.PHASE_PRE || context.phase > PolicyConstants.PHASE_OVERNIGHT)
                {
                    decision.reasons |= ReasonBits.CALENDAR_CONFLICT;
                }
                if (!context.allLegsHealthy && decision.reasons == 0) {
                    decision.reasons |= ReasonBits.REPORT_INVALID_OR_STALE;
                }
                if (context.validUntil == 0 || context.nowTime >= context.validUntil) {
                    decision.reasons |= ReasonBits.REPORT_INVALID_OR_STALE;
                }
                _cancelCandidate(decision);
                return decision;
            }

            // All stock/required legs are open and healthy. The first proof stores candidateAt and the baseline;
            // the old validity deadline is checked before accepting the new vector.
            if (
                context.reopenCandidateAt == 0 || context.reopenCandidateAt > context.nowTime
                    || context.nowTime >= context.oldValidUntil
            ) {
                decision.mode = uint8(Mode.RECOVERING);
                decision.reasons |= ReasonBits.RECOVERY_PENDING;
                decision.reopenCandidateAt = context.nowTime;
                decision.reopenBaseObservations = context.observations;
                decision.oldValidUntil = context.validUntil;
                decision.lastOpenObservations = context.observations;
                return decision;
            }

            bool advanced =
                _observationsAdvanced(context.observations, context.reopenBaseObservations, context.stockMask);
            if (
                context.nowTime - context.reopenCandidateAt >= PolicyConstants.REOPEN_MINIMUM_SEPARATION_SECONDS
                    && advanced
            ) {
                decision.latch = false;
                decision.releaseLatch = true;
                decision.reopenCandidateAt = 0;
                decision.reopenBaseObservations = [uint64(0), uint64(0)];
                decision.oldValidUntil = context.validUntil;
                decision.lastOpenObservations = context.observations;
                if (context.executionReady) {
                    decision.mode = uint8(Mode.ACTIVE);
                    decision.canSwap = true;
                } else {
                    // M05-05 owns swap enforcement. The closure latch still releases on this checkpoint, but the
                    // post-release view must not advertise swap capability before that path exists.
                    decision.mode = uint8(Mode.HALTED);
                    decision.reasons |= ReasonBits.SETUP;
                }
                return decision;
            }

            decision.mode = uint8(Mode.RECOVERING);
            decision.reasons |= ReasonBits.RECOVERY_PENDING;
            decision.oldValidUntil = context.validUntil;
            decision.lastOpenObservations = context.observations;
            return decision;
        }

        // No latch yet: a proven planned closure starts exactly one episode, even under an unrelated pause/fault.
        if (context.anyPlannedClosed && context.closureContextValid && !context.unexpectedClosed) {
            decision.latch = true;
            decision.beginLatch = true;
            decision.closureNonce = context.closureNonce + 1;
            decision.mode = healthy ? uint8(Mode.CLOSED) : uint8(Mode.HALTED);
            decision.canSwap = decision.mode == uint8(Mode.CLOSED) && context.executionReady;
            decision.reopenCandidateAt = 0;
            decision.reopenBaseObservations = [uint64(0), uint64(0)];
            decision.oldValidUntil = 0;
            return decision;
        }

        if (context.unexpectedClosed) {
            decision.mode = uint8(Mode.HALTED);
            decision.reasons |= ReasonBits.UNEXPECTED_CLOSED;
            _cancelCandidate(decision);
            return decision;
        }

        if (!healthy) {
            decision.mode = uint8(Mode.HALTED);
            _cancelCandidate(decision);
            return decision;
        }

        _decideOpen(context, decision);
    }

    /// @dev Healthy open-session branch. A non-latched pool that was not continuously ACTIVE must prove a fresh
    /// joint vector for `REOPEN_MINIMUM_SEPARATION_SECONDS` before trading again. This is the ordinary
    /// fault/pause recovery path; the closure episode path is handled above by the latch.
    function _decideOpen(Context memory context, Decision memory decision) private pure {
        if (!context.phaseSet) {
            decision.reasons |= ReasonBits.CALENDAR_CONFLICT;
            _cancelCandidate(decision);
            return;
        }
        if (context.phase == PolicyConstants.PHASE_CLOSED) {
            decision.reasons |= ReasonBits.UNEXPECTED_CLOSED;
            _cancelCandidate(decision);
            return;
        }
        if (context.phase < PolicyConstants.PHASE_PRE || context.phase > PolicyConstants.PHASE_OVERNIGHT) {
            decision.reasons |= ReasonBits.CALENDAR_CONFLICT;
            _cancelCandidate(decision);
            return;
        }
        if (!context.allLegsHealthy || context.validUntil == 0 || context.nowTime >= context.validUntil) {
            decision.reasons |= ReasonBits.REPORT_INVALID_OR_STALE;
            _cancelCandidate(decision);
            return;
        }

        // LIVE + SETUP is a pre-activation or misconfigured state. M05-04/M06 must commit a real mode before any
        // open-session decision; even a ready execution path must not turn SETUP into ACTIVE here.
        if (context.previousMode == uint8(Mode.SETUP)) {
            decision.mode = uint8(Mode.HALTED);
            decision.reasons |= ReasonBits.SETUP;
            decision.reopenCandidateAt = 0;
            decision.reopenBaseObservations = [uint64(0), uint64(0)];
            return;
        }

        if (
            context.previousMode == uint8(Mode.ACTIVE) && context.oldValidUntil != 0
                && context.nowTime < context.oldValidUntil
        ) {
            _settleOpen(context, decision);
            return;
        }

        // A committed ACTIVE pool whose old deadline was crossed (or was never committed) cannot be settled
        // straight back to ACTIVE: one fresh read is not proof of continuity. Start ordinary recovery instead.
        _decideRecovery(context, decision);
    }

    /// @dev Ordinary (non-latched) recovery candidate. Uses the same 60-second/advance/old-deadline rules as the
    /// closure recovery path, but never sets `releaseLatch` and never touches the closure episode ledger.
    function _decideRecovery(Context memory context, Decision memory decision) private pure {
        if (context.reopenCandidateAt == 0) {
            // A completed recovery whose execution gate (M05-05) still blocks is a steady state: the vector has
            // been continuously valid since the release, so only a real validity gap starts a new candidate.
            if (context.oldValidUntil != 0 && context.nowTime < context.oldValidUntil) {
                _settleOpen(context, decision);
                return;
            }
            _startCandidate(context, decision);
            return;
        }

        if (context.reopenCandidateAt > context.nowTime || context.nowTime >= context.oldValidUntil) {
            _startCandidate(context, decision);
            return;
        }

        bool advanced = _observationsAdvanced(context.observations, context.reopenBaseObservations, context.stockMask);
        if (
            context.nowTime - context.reopenCandidateAt >= PolicyConstants.REOPEN_MINIMUM_SEPARATION_SECONDS && advanced
        ) {
            decision.reopenCandidateAt = 0;
            decision.reopenBaseObservations = [uint64(0), uint64(0)];
            decision.oldValidUntil = context.validUntil;
            decision.lastOpenObservations = context.observations;
            decision.releaseRecovery = true;
            if (context.executionReady) {
                decision.mode = uint8(Mode.ACTIVE);
                decision.canSwap = true;
            } else {
                // M05-05 owns swap enforcement. Ordinary recovery still completes, but the checkpoint remains
                // HALTED/SETUP until the execution path exists.
                decision.mode = uint8(Mode.HALTED);
                decision.reasons |= ReasonBits.SETUP;
            }
            return;
        }

        decision.mode = uint8(Mode.RECOVERING);
        decision.reasons |= ReasonBits.RECOVERY_PENDING;
        decision.oldValidUntil = context.validUntil;
        decision.lastOpenObservations = context.observations;
    }

    function _startCandidate(Context memory context, Decision memory decision) private pure {
        decision.mode = uint8(Mode.RECOVERING);
        decision.reasons |= ReasonBits.RECOVERY_PENDING;
        decision.reopenCandidateAt = context.nowTime;
        decision.reopenBaseObservations = context.observations;
        decision.oldValidUntil = context.validUntil;
        decision.lastOpenObservations = context.observations;
    }

    function _settleOpen(Context memory context, Decision memory decision) private pure {
        decision.reopenCandidateAt = 0;
        decision.reopenBaseObservations = [uint64(0), uint64(0)];
        decision.oldValidUntil = context.validUntil;
        decision.lastOpenObservations = context.observations;
        if (context.executionReady) {
            decision.mode = uint8(Mode.ACTIVE);
            decision.canSwap = true;
        } else {
            decision.mode = uint8(Mode.HALTED);
            decision.reasons |= ReasonBits.SETUP;
        }
    }

    /// @notice Backwards-compatible projection for the non-closure lifecycle/health matrix.
    /// @dev A latched pool without recovery inputs is treated as still closed; the hook always uses `decide`
    /// with real anchor/recovery context.
    function evaluate(uint8 lifecycle, uint8 phase, bool closedLatched, uint256 dependencyReasons, bool executionReady)
        internal
        pure
        returns (Evaluation memory evaluation)
    {
        Context memory context;
        context.lifecycle = lifecycle;
        context.previousMode = uint8(Mode.ACTIVE);
        context.activationCommitted = true;
        context.phase = phase;
        context.phaseSet = phase != PolicyConstants.PHASE_UNKNOWN;
        context.closedLatched = closedLatched;
        context.anyPlannedClosed = closedLatched;
        context.allLegsHealthy = true;
        context.closureContextValid = closedLatched;
        context.dependencyReasons = dependencyReasons;
        context.validUntil = type(uint64).max;
        context.oldValidUntil = type(uint64).max;
        context.executionReady = executionReady;
        Decision memory decision = decide(context);
        evaluation.mode = decision.mode;
        evaluation.reasons = decision.reasons;
        evaluation.canSwap = decision.canSwap;
    }

    /// @notice Lowest set reason bit. 20.A/20.C use the smallest bit as the dominant error while the
    /// full reason mask remains available for display and checkpointing.
    function dominantReason(uint256 reasonBits) internal pure returns (uint256) {
        unchecked {
            return reasonBits & (~reasonBits + 1);
        }
    }

    /// @notice True when a dependency returned a reason outside the normative 0..16 range.
    function hasUnknownReason(uint256 reasonBits) internal pure returns (bool) {
        return reasonBits & ~KNOWN_REASON_BITS != 0;
    }

    /// @notice Typed SafetyController target namespace: kind 1 = pool hook, kind 2 = asset token.
    /// @dev Mirrors SafetyController.targetId so the hook does not need an extra dependency call. A test
    /// cross-checks both implementations against the deployed SafetyController.
    function targetId(uint8 targetKind, address target) internal pure returns (bytes32) {
        return keccak256(abi.encode(targetKind, target));
    }

    function _cancelCandidate(Decision memory decision) private pure {
        decision.cancelCandidate = decision.reopenCandidateAt != 0;
        decision.reopenCandidateAt = 0;
        decision.reopenBaseObservations = [uint64(0), uint64(0)];
        decision.oldValidUntil = 0;
    }

    function _observationsAdvanced(uint64[2] memory observations, uint64[2] memory baseline, uint8 stockMask)
        private
        pure
        returns (bool)
    {
        for (uint256 i; i < 2; ++i) {
            // forge-lint: disable-next-line(incorrect-shift)
            if ((stockMask & uint8(1 << i)) == 0) continue;
            if (observations[i] <= baseline[i]) return false;
        }
        return true;
    }
}
