// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionClearing} from "../src/libraries/AuctionClearing.sol";

/// @dev sqrtPrice 2^96 is a raw 1:1 pool; sqrtPrice 2*2^96 is a raw 4:1 pool.
contract AuctionClearingTest {
    uint160 private constant P1 = uint160(1 << 96); // price 1
    uint160 private constant P4 = uint160(2 * (1 << 96)); // price 4

    function testQuoteForBaseAtUnitPriceIsIdentity() external pure {
        require(AuctionClearing.quoteForBase(1_000, P1, true) == 1_000, "base=token1 identity");
        require(AuctionClearing.quoteForBase(1_000, P1, false) == 1_000, "base=token0 identity");
    }

    function testQuoteForBaseWhenBaseIsToken1DividesByPrice() external pure {
        // Base is token1 and the quote is token0: 1000 token1 is worth 250 token0 at price 4.
        require(AuctionClearing.quoteForBase(1_000, P4, true) == 250, "base=token1 divide");
    }

    function testQuoteForBaseWhenBaseIsToken0MultipliesByPrice() external pure {
        // Base is token0 and the quote is token1: 1000 token0 is worth 4000 token1 at price 4.
        require(AuctionClearing.quoteForBase(1_000, P4, false) == 4_000, "base=token0 multiply");
    }

    function testBaseForQuoteIsTheInverse() external pure {
        require(AuctionClearing.baseForQuote(1_000, P1, true) == 1_000, "unit price");
        require(AuctionClearing.baseForQuote(4_000, P4, true) == 16_000, "base=token1 multiply");
        require(AuctionClearing.baseForQuote(4_000, P4, false) == 1_000, "base=token0 divide");
    }

    function testRoundTripIsExact() external pure {
        uint256 quoted = AuctionClearing.quoteForBase(1_000, P4, false);
        require(quoted == 4_000, "quote");
        require(AuctionClearing.baseForQuote(quoted, P4, false) == 1_000, "round trip");
    }

    function testPriceQ96ReadsTheRawPoolRatio() external pure {
        require(AuctionClearing.priceQ96(P1) == (1 << 96), "price 1");
        require(AuctionClearing.priceQ96(P4) == (4 * (1 << 96)), "price 4");
    }

    function testZeroSqrtPriceReturnsZeroInsteadOfReverting() external pure {
        require(AuctionClearing.quoteForBase(1_000, 0, true) == 0, "quote zero");
        require(AuctionClearing.baseForQuote(1_000, 0, true) == 0, "base zero");
    }

    function testSellerNeedsPriceAtOrAboveItsFloor() external pure {
        // zeroForOne == false sells base, so the clearing price must not be below its floor.
        require(AuctionClearing.sellLimitOk(false, P1, P1 + 1), "above floor accepted");
        require(!AuctionClearing.sellLimitOk(false, P1, P1 - 1), "below floor rejected");
        require(AuctionClearing.sellLimitOk(false, 0, 1), "zero limit means no bound");
    }

    function testBuyerNeedsPriceAtOrBelowItsCap() external pure {
        // zeroForOne == true buys base, so the clearing price must not be above its cap.
        require(AuctionClearing.sellLimitOk(true, P1, P1 - 1), "below cap accepted");
        require(!AuctionClearing.sellLimitOk(true, P1, P1 + 1), "above cap rejected");
        require(AuctionClearing.sellLimitOk(true, 0, type(uint160).max), "zero limit means no bound");
    }
}
