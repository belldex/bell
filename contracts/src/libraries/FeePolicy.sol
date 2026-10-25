// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PolicyConstants} from "./PolicyConstants.sol";

library FeePolicy {
    error UnsupportedBaseFee(uint24 fee);
    error FeeOverflow(uint256 fee);

    function bellFee(uint24 baseFee, uint64 elapsedSeconds) internal pure returns (uint24) {
        if (
            baseFee != PolicyConstants.FEE_REGULAR && baseFee != PolicyConstants.FEE_PRE
                && baseFee != PolicyConstants.FEE_POST && baseFee != PolicyConstants.FEE_OVERNIGHT
                && baseFee != PolicyConstants.FEE_CLOSED
        ) revert UnsupportedBaseFee(baseFee);

        uint256 remaining = elapsedSeconds >= PolicyConstants.BELL_DURATION_SECONDS
            ? 0
            : uint256(PolicyConstants.BELL_DURATION_SECONDS - elapsedSeconds);
        uint256 numerator = (PolicyConstants.BELL_MAXIMUM_FEE_UNITS - baseFee) * remaining;
        uint256 increase = numerator == 0 ? 0 : (numerator + PolicyConstants.BELL_DURATION_SECONDS - 1) / PolicyConstants.BELL_DURATION_SECONDS;
        uint256 result = uint256(baseFee) + increase;
        if (result > type(uint24).max) revert FeeOverflow(result);
        // The explicit bound check above proves this cast fits the v4 fee width.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint24(result);
    }

    function effectiveLpFee(uint24 baseFee, uint64 bellElapsedSeconds, bool corporate, bool repricing)
        internal
        pure
        returns (uint24 fee)
    {
        fee = bellFee(baseFee, bellElapsedSeconds);
        if (fee < baseFee) fee = baseFee;
        if (corporate && fee < PolicyConstants.CORPORATE_MINIMUM_FEE_UNITS) {
            fee = PolicyConstants.CORPORATE_MINIMUM_FEE_UNITS;
        }
        if (repricing && fee < PolicyConstants.REPRICING_MINIMUM_FEE_UNITS) {
            fee = PolicyConstants.REPRICING_MINIMUM_FEE_UNITS;
        }
    }
}
