// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Buckets} from "../types/ProtocolTypes.sol";
import {PolicyConstants} from "./PolicyConstants.sol";

library FlowBudget {
    error UnsupportedPhase(uint8 phase);
    error TimeRegression(uint64 currentEpoch, uint64 requestedEpoch);
    error ZeroFill(uint8 currency);
    error TradeCapExceeded(uint8 currency, uint256 amount, uint256 cap);
    error WindowCapExceeded(uint8 currency, uint256 gross, uint256 cap);
    error CapCastOverflow(uint256 cap);

    function _minimum(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _scaled(uint128 cap, uint8 numerator, uint8 denominator) private pure returns (uint128) {
        uint256 scaled = uint256(cap) * numerator / denominator;
        if (scaled > type(uint128).max) revert CapCastOverflow(scaled);
        // The explicit bound check above proves this cast fits uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(scaled);
    }

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) revert CapCastOverflow(value);
        // The explicit bound check above proves this cast fits uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(value);
    }

    function _absolute(int128 delta) private pure returns (uint256 magnitude) {
        assembly {
            let widened := signextend(15, delta)
            let sign := sar(255, widened)
            magnitude := xor(add(widened, sign), sign)
        }
    }

    function effectiveLimits(uint128[2] memory tradeCaps, uint128[2] memory windowCaps, uint8 phase, bool guarded)
        internal
        pure
        returns (uint128[2] memory tradeLimits, uint128[2] memory windowLimits)
    {
        uint8 tradeNumerator;
        uint8 tradeDenominator;
        uint8 windowNumerator;
        uint8 windowDenominator;
        if (phase == PolicyConstants.PHASE_REGULAR) {
            tradeNumerator = PolicyConstants.REGULAR_TRADE_NUMERATOR;
            tradeDenominator = PolicyConstants.REGULAR_TRADE_DENOMINATOR;
            windowNumerator = PolicyConstants.REGULAR_WINDOW_NUMERATOR;
            windowDenominator = PolicyConstants.REGULAR_WINDOW_DENOMINATOR;
        } else if (phase == PolicyConstants.PHASE_PRE) {
            tradeNumerator = PolicyConstants.PRE_TRADE_NUMERATOR;
            tradeDenominator = PolicyConstants.PRE_TRADE_DENOMINATOR;
            windowNumerator = PolicyConstants.PRE_WINDOW_NUMERATOR;
            windowDenominator = PolicyConstants.PRE_WINDOW_DENOMINATOR;
        } else if (phase == PolicyConstants.PHASE_POST) {
            tradeNumerator = PolicyConstants.POST_TRADE_NUMERATOR;
            tradeDenominator = PolicyConstants.POST_TRADE_DENOMINATOR;
            windowNumerator = PolicyConstants.POST_WINDOW_NUMERATOR;
            windowDenominator = PolicyConstants.POST_WINDOW_DENOMINATOR;
        } else if (phase == PolicyConstants.PHASE_OVERNIGHT) {
            tradeNumerator = PolicyConstants.OVERNIGHT_TRADE_NUMERATOR;
            tradeDenominator = PolicyConstants.OVERNIGHT_TRADE_DENOMINATOR;
            windowNumerator = PolicyConstants.OVERNIGHT_WINDOW_NUMERATOR;
            windowDenominator = PolicyConstants.OVERNIGHT_WINDOW_DENOMINATOR;
        } else if (phase == PolicyConstants.PHASE_CLOSED) {
            tradeNumerator = PolicyConstants.CLOSED_TRADE_NUMERATOR;
            tradeDenominator = PolicyConstants.CLOSED_TRADE_DENOMINATOR;
            windowNumerator = PolicyConstants.CLOSED_WINDOW_NUMERATOR;
            windowDenominator = PolicyConstants.CLOSED_WINDOW_DENOMINATOR;
        } else {
            revert UnsupportedPhase(phase);
        }

        for (uint8 i; i < 2; ++i) {
            uint256 tradeLimit = _scaled(tradeCaps[i], tradeNumerator, tradeDenominator);
            uint256 windowLimit = _scaled(windowCaps[i], windowNumerator, windowDenominator);
            if (guarded) {
                tradeLimit = _minimum(tradeLimit, _scaled(tradeCaps[i], PolicyConstants.GUARD_TRADE_NUMERATOR, PolicyConstants.GUARD_TRADE_DENOMINATOR));
                windowLimit = _minimum(windowLimit, _scaled(windowCaps[i], PolicyConstants.GUARD_WINDOW_NUMERATOR, PolicyConstants.GUARD_WINDOW_DENOMINATOR));
            }
            tradeLimits[i] = _toUint128(tradeLimit);
            windowLimits[i] = _toUint128(windowLimit);
        }
    }

    function rollBuckets(Buckets memory buckets, uint64 timestamp) internal pure returns (Buckets memory next) {
        uint64 epoch = timestamp / PolicyConstants.ROLLING_WINDOW_SECONDS;
        if (epoch < buckets.epoch) revert TimeRegression(buckets.epoch, epoch);
        if (epoch == buckets.epoch) {
            next.epoch = buckets.epoch;
            next.currentGross = buckets.currentGross;
            next.previousGross = buckets.previousGross;
            return next;
        }
        next.epoch = epoch;
        if (epoch == buckets.epoch + 1) {
            next.previousGross = buckets.currentGross;
        } else {
            next.previousGross = [uint128(0), uint128(0)];
        }
        next.currentGross = [uint128(0), uint128(0)];
    }

    function consume(
        Buckets memory buckets,
        uint64 timestamp,
        int128 delta0,
        int128 delta1,
        uint8 phase,
        bool guarded,
        uint128[2] memory tradeCaps,
        uint128[2] memory windowCaps
    ) internal pure returns (Buckets memory next, uint128[2] memory gross) {
        next = rollBuckets(buckets, timestamp);
        uint128[2] memory tradeLimits;
        uint128[2] memory windowLimits;
        (tradeLimits, windowLimits) = effectiveLimits(tradeCaps, windowCaps, phase, guarded);
        gross[0] = uint128(_absolute(delta0));
        gross[1] = uint128(_absolute(delta1));

        for (uint8 i; i < 2; ++i) {
            if (gross[i] == 0) revert ZeroFill(i);
            if (gross[i] > tradeLimits[i]) revert TradeCapExceeded(i, gross[i], tradeLimits[i]);
            uint256 candidate = uint256(next.previousGross[i]) + next.currentGross[i] + gross[i];
            if (candidate > windowLimits[i]) revert WindowCapExceeded(i, candidate, windowLimits[i]);
            next.currentGross[i] = uint128(uint256(next.currentGross[i]) + gross[i]);
        }
    }
}
