// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {WidePriceMath} from "../src/libraries/WidePriceMath.sol";

contract WidePriceMathHarness {
    function within(uint160 sqrtPriceX96, uint128 price0, uint128 price1, uint8 decimals0, uint8 decimals1, uint16 bandBps)
        external pure returns (bool)
    {
        return WidePriceMath.isWithinPriceBand(sqrtPriceX96, price0, price1, decimals0, decimals1, bandBps);
    }

    function allows(uint160 preSqrtPriceX96, uint160 postSqrtPriceX96, uint128 price0, uint128 price1, uint8 decimals0, uint8 decimals1, uint16 bandBps)
        external pure returns (bool)
    {
        return WidePriceMath.allowsPricePath(preSqrtPriceX96, postSqrtPriceX96, price0, price1, decimals0, decimals1, bandBps);
    }
}
