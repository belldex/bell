// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {WidePriceMath} from "../src/libraries/WidePriceMath.sol";

contract WidePriceMathTest {
    uint160 private constant Q96 = uint160(1 << 96);
    uint128 private constant USD = 1e18;

    function testEqualNormalizedReferenceIsInsideInclusiveBand() external pure {
        require(WidePriceMath.isWithinPriceBand(Q96, USD, USD, 18, 18, 200), "unit price outside");
    }

    function testInclusiveLowerAndUpperBandBoundaries() external pure {
        // Raw AMM price 49 is exactly the 200 bps lower edge of a reference price 50.
        require(WidePriceMath.isWithinPriceBand(Q96 * 7, 50, 1, 0, 0, 200), "lower edge excluded");
        require(!WidePriceMath.isWithinPriceBand(Q96 * 7 - 1, 50, 1, 0, 0, 200), "below lower edge accepted");
        // Raw AMM price 9 is exactly the 500 bps upper edge of a reference price 60/7.
        require(WidePriceMath.isWithinPriceBand(Q96 * 3, 60, 7, 0, 0, 500), "upper edge excluded");
        require(!WidePriceMath.isWithinPriceBand(Q96 * 3 + 1, 60, 7, 0, 0, 500), "above upper edge accepted");
    }

    function testRejectsLargeDeviationInBothPriceDirections() external pure {
        require(!WidePriceMath.isWithinPriceBand(Q96 * 9 / 10, USD, USD, 18, 18, 200), "below band accepted");
        require(!WidePriceMath.isWithinPriceBand(Q96 * 11 / 10, USD, USD, 18, 18, 200), "above band accepted");
    }

    function testCorrectivePathMovesTowardReferenceWithoutOvershoot() external pure {
        uint160 below = Q96 * 9 / 10;
        uint160 above = Q96 * 11 / 10;
        require(WidePriceMath.allowsPricePath(below, Q96, USD, USD, 18, 18, 200), "lower correction rejected");
        require(!WidePriceMath.allowsPricePath(below, below - 1, USD, USD, 18, 18, 200), "lower wrong-way path accepted");
        require(WidePriceMath.allowsPricePath(above, Q96, USD, USD, 18, 18, 200), "upper correction rejected");
        require(!WidePriceMath.allowsPricePath(above, above + 1, USD, USD, 18, 18, 200), "upper wrong-way path accepted");
    }

    function testMaximumDomainDoesNotOverflowIntermediateArithmetic() external pure {
        WidePriceMath.isWithinPriceBand(type(uint160).max, type(uint128).max, type(uint128).max, 18, 18, 500);
    }

    function testInvalidPriceDomainReverts() external view {
        try this.callInvalid() {
            revert("invalid band accepted");
        } catch {}
    }

    function callInvalid() external pure returns (bool) {
        return WidePriceMath.isWithinPriceBand(Q96, USD, USD, 19, 18, 200);
    }
}
