// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FeePolicy} from "../src/libraries/FeePolicy.sol";

contract FeePolicyHarness {
    function bellFee(uint24 baseFee, uint64 elapsedSeconds) external pure returns (uint24) {
        return FeePolicy.bellFee(baseFee, elapsedSeconds);
    }

    function effectiveLpFee(uint24 baseFee, uint64 elapsedSeconds, bool corporate, bool repricing)
        external
        pure
        returns (uint24)
    {
        return FeePolicy.effectiveLpFee(baseFee, elapsedSeconds, corporate, repricing);
    }
}
