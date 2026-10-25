// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library WidePriceMath {
    error InvalidPriceDomain();
    error WideProductOverflow();

    struct U768 {
        uint256 high;
        uint256 middle;
        uint256 low;
    }

    function _mul512(uint256 a, uint256 b) private pure returns (uint256 low, uint256 high) {
        assembly {
            let mm := mulmod(a, b, not(0))
            low := mul(a, b)
            high := sub(sub(mm, low), lt(mm, low))
        }
    }

    function _mul(U768 memory value, uint256 factor) private pure returns (U768 memory result) {
        (uint256 lowLow, uint256 lowHigh) = _mul512(value.low, factor);
        (uint256 middleLow, uint256 middleHigh) = _mul512(value.middle, factor);
        (uint256 highLow, uint256 highHigh) = _mul512(value.high, factor);
        if (highHigh != 0) revert WideProductOverflow();

        result.low = lowLow;
        unchecked {
            result.middle = lowHigh + middleLow;
            uint256 middleCarry = result.middle < lowHigh ? 1 : 0;
            result.high = middleHigh + highLow;
            if (result.high < middleHigh) revert WideProductOverflow();
            uint256 highBeforeCarry = result.high;
            result.high += middleCarry;
            if (result.high < highBeforeCarry) revert WideProductOverflow();
        }
    }

    function _power10(uint8 exponent) private pure returns (uint256 value) {
        value = 1;
        for (uint8 i; i < exponent; ++i) value *= 10;
    }

    function _compare(U768 memory a, U768 memory b) private pure returns (int8) {
        if (a.high < b.high) return -1;
        if (a.high > b.high) return 1;
        if (a.middle < b.middle) return -1;
        if (a.middle > b.middle) return 1;
        if (a.low < b.low) return -1;
        if (a.low > b.low) return 1;
        return 0;
    }

    function _priceProduct(uint160 sqrtPriceX96, uint128 price1, uint8 decimals0)
        private pure returns (U768 memory product)
    {
        (uint256 low, uint256 high) = _mul512(uint256(sqrtPriceX96), uint256(sqrtPriceX96));
        product.middle = high;
        product.low = low;
        product = _mul(product, price1);
        product = _mul(product, _power10(decimals0));
        product = _mul(product, 10000);
    }

    function _boundProduct(uint128 price0, uint8 decimals1, uint16 basisPoints) private pure returns (U768 memory product) {
        product.low = uint256(1) << 192;
        product = _mul(product, price0);
        product = _mul(product, _power10(decimals1));
        product = _mul(product, basisPoints);
    }

    function _validate(uint160 sqrtPriceX96, uint128 price0, uint128 price1, uint8 decimals0, uint8 decimals1, uint16 bandBps)
        private pure
    {
        if (sqrtPriceX96 == 0 || price0 == 0 || price1 == 0 || decimals0 > 18 || decimals1 > 18
            || (bandBps != 200 && bandBps != 500)) revert InvalidPriceDomain();
    }

    function isWithinPriceBand(uint160 sqrtPriceX96, uint128 price0, uint128 price1, uint8 decimals0, uint8 decimals1, uint16 bandBps)
        internal pure returns (bool)
    {
        _validate(sqrtPriceX96, price0, price1, decimals0, decimals1, bandBps);
        U768 memory actual = _priceProduct(sqrtPriceX96, price1, decimals0);
        U768 memory lower = _boundProduct(price0, decimals1, 10000 - bandBps);
        U768 memory upper = _boundProduct(price0, decimals1, 10000 + bandBps);
        return _compare(lower, actual) <= 0 && _compare(actual, upper) <= 0;
    }

    function allowsPricePath(
        uint160 preSqrtPriceX96,
        uint160 postSqrtPriceX96,
        uint128 price0,
        uint128 price1,
        uint8 decimals0,
        uint8 decimals1,
        uint16 bandBps
    ) internal pure returns (bool) {
        _validate(preSqrtPriceX96, price0, price1, decimals0, decimals1, bandBps);
        _validate(postSqrtPriceX96, price0, price1, decimals0, decimals1, bandBps);
        U768 memory lower = _boundProduct(price0, decimals1, 10000 - bandBps);
        U768 memory upper = _boundProduct(price0, decimals1, 10000 + bandBps);
        U768 memory pre = _priceProduct(preSqrtPriceX96, price1, decimals0);
        U768 memory post = _priceProduct(postSqrtPriceX96, price1, decimals0);
        int8 relation = _compare(pre, lower);
        if (relation >= 0 && _compare(pre, upper) <= 0) {
            return _compare(post, lower) >= 0 && _compare(post, upper) <= 0;
        }
        if (relation < 0) return postSqrtPriceX96 > preSqrtPriceX96 && _compare(post, upper) <= 0;
        return postSqrtPriceX96 < preSqrtPriceX96 && _compare(post, lower) >= 0;
    }
}
