// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

/// @notice Converts the settled liquidity callback deltas into raw-unit seed principal.
/// @dev Principal excludes accrued LP fees: principalDelta[i] = delta[i] - feesAccrued[i];
///      seedPrincipal[i] = -principalDelta[i]. Widen before subtraction/negation so int128.min is safe.
library SeedAccounting {
    using BalanceDeltaLibrary for BalanceDelta;

    error BadSeed();

    function seedPrincipal(BalanceDelta delta, BalanceDelta feesAccrued)
        internal
        pure
        returns (uint128[2] memory principal)
    {
        int256 principal0 = int256(delta.amount0()) - int256(feesAccrued.amount0());
        int256 principal1 = int256(delta.amount1()) - int256(feesAccrued.amount1());
        principal[0] = _negativePrincipal(principal0);
        principal[1] = _negativePrincipal(principal1);
    }

    function _negativePrincipal(int256 delta) private pure returns (uint128 amount) {
        if (delta >= 0) revert BadSeed();
        uint256 widened = uint256(-delta);
        if (widened == 0 || widened > type(uint128).max) revert BadSeed();
        // The explicit range check above proves this conversion is lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        amount = uint128(widened);
    }
}
