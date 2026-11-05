// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @title AuctionClearing
/// @notice Pure clearing math for the opening-bell batch.
/// @dev Prices are v4 `sqrtPriceX96` values, so no decimal scaling is needed: the pool's own units
///      already encode the token decimals. The two `mulDiv` steps keep `sqrtPriceX96 *
///      sqrtPriceX96` from overflowing uint256 at large prices.
library AuctionClearing {
    uint256 internal constant Q96 = 1 << 96;

    /// @notice token1 raw units per token0 raw unit, scaled by Q96.
    function priceQ96(uint160 sqrtPriceX96) internal pure returns (uint256) {
        return FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), Q96);
    }

    /// @notice Quote value of a base amount, in the quote token's raw units.
    /// @param baseAmount Amount of the base token.
    /// @param sqrtPriceX96 Resolving pool price.
    /// @param baseIsToken1 True when the base token is the pool's token1.
    function quoteForBase(uint256 baseAmount, uint160 sqrtPriceX96, bool baseIsToken1)
        internal
        pure
        returns (uint256)
    {
        uint256 p = priceQ96(sqrtPriceX96);
        if (p == 0) return 0;
        // Base is token1: the quote is token0, so divide by the price.
        // Base is token0: the quote is token1, so multiply by the price.
        return baseIsToken1 ? FullMath.mulDiv(baseAmount, Q96, p) : FullMath.mulDiv(baseAmount, p, Q96);
    }

    /// @notice Base amount obtained for a quote amount, in the base token's raw units.
    /// @param quoteAmount Amount of the quote token.
    /// @param sqrtPriceX96 Resolving pool price.
    /// @param baseIsToken1 True when the base token is the pool's token1.
    function baseForQuote(uint256 quoteAmount, uint160 sqrtPriceX96, bool baseIsToken1)
        internal
        pure
        returns (uint256)
    {
        uint256 p = priceQ96(sqrtPriceX96);
        if (p == 0) return 0;
        // Quote is token0 and base is token1: multiply by the price.
        // Quote is token1 and base is token0: divide by the price.
        return baseIsToken1 ? FullMath.mulDiv(quoteAmount, p, Q96) : FullMath.mulDiv(quoteAmount, Q96, p);
    }

    /// @notice Whether an order still accepts the clearing price.
    /// @dev `zeroForOne == true` spends token0 (the quote) to buy base, so it needs the price at or
    ///      below its cap. `zeroForOne == false` sells base, so it needs the price at or above its
    ///      floor. A zero limit means the owner set no bound.
    function sellLimitOk(bool zeroForOne, uint160 limitSqrtPriceX96, uint160 clearingSqrtPriceX96)
        internal
        pure
        returns (bool)
    {
        if (limitSqrtPriceX96 == 0) return true;
        return zeroForOne ? clearingSqrtPriceX96 <= limitSqrtPriceX96 : clearingSqrtPriceX96 >= limitSqrtPriceX96;
    }
}
