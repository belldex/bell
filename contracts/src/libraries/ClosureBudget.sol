// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PolicyConstants} from "./PolicyConstants.sol";

library ClosureBudget {
    error BadCap(uint8 currency);
    error ZeroFill(uint8 currency);
    error EpisodeBudgetExceeded(uint8 currency, uint256 used, uint256 cap);
    error CapCastOverflow(uint256 value);

    function maximumClosureCap(uint128[2] memory tradeCap, uint128[2] memory windowCap, uint128[2] memory seedPrincipal)
        internal pure returns (uint128[2] memory maximum)
    {
        for (uint8 i; i < 2; ++i) {
            if (tradeCap[i] == 0 || windowCap[i] == 0 || tradeCap[i] > windowCap[i] || seedPrincipal[i] == 0) {
                revert BadCap(i);
            }
            uint256 limit = uint256(tradeCap[i]) * PolicyConstants.MAX_CLOSURE_TIMES_TRADE_CAP;
            if (windowCap[i] < limit) limit = windowCap[i];
            uint256 seedLimit = seedPrincipal[i] / PolicyConstants.MAX_CLOSURE_SEED_FRACTION_DENOMINATOR;
            if (seedLimit < limit) limit = seedLimit;
            if (limit > type(uint128).max) revert CapCastOverflow(limit);
            // The explicit bound check above proves this cast fits uint128.
            // forge-lint: disable-next-line(unsafe-typecast)
            maximum[i] = uint128(limit);
        }
    }

    function _absolute(int128 delta) private pure returns (uint256 magnitude) {
        assembly {
            let widened := signextend(15, delta)
            let sign := sar(255, widened)
            magnitude := xor(add(widened, sign), sign)
        }
    }

    function consumeEpisode(uint128[2] memory used, uint128[2] memory caps, int128 delta0, int128 delta1)
        internal pure returns (uint128[2] memory next)
    {
        int128[2] memory deltas = [delta0, delta1];
        next = used;
        for (uint8 i; i < 2; ++i) {
            uint256 amount = _absolute(deltas[i]);
            if (amount == 0) revert ZeroFill(i);
            uint256 candidate = uint256(used[i]) + amount;
            if (candidate > caps[i]) revert EpisodeBudgetExceeded(i, candidate, caps[i]);
            if (candidate > type(uint128).max) revert CapCastOverflow(candidate);
            // The explicit bound check above proves this cast fits uint128.
            // forge-lint: disable-next-line(unsafe-typecast)
            next[i] = uint128(candidate);
        }
    }
}
