// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BellOpeningAuction} from "../src/auction/BellOpeningAuction.sol";

interface Vm { function warp(uint256 timestamp) external; function prank(address sender) external; }

contract MockToken is ERC20 {
    address private _reentryTarget;
    uint128 private _reentryAmount;
    uint160 private _reentryLimit;
    bool private _reentryArmed;
    bool public reentrySucceeded;

    constructor(string memory n, string memory s) ERC20(n, s) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function armReentry(address target, uint128 amount, uint160 limit) external {
        _reentryTarget = target;
        _reentryAmount = amount;
        _reentryLimit = limit;
        _reentryArmed = true;
        reentrySucceeded = false;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool transferred = super.transferFrom(from, to, amount);
        if (_reentryArmed) {
            _reentryArmed = false;
            this.approve(_reentryTarget, _reentryAmount);
            (reentrySucceeded,) = _reentryTarget.call(
                abi.encodeWithSignature("submitOrder(bool,uint128,uint160)", true, _reentryAmount, _reentryLimit)
            );
        }
        return transferred;
    }
}

contract MockAuctionCalendar {
    bytes32 public immutable assetId;
    uint32 public immutable year;
    uint64 public currentStart;
    uint64 public currentEnd;
    uint64 public nextStart;
    uint64 public nextEnd;
    uint8 public currentPhase = 5;
    uint8 public nextPhase = 1;

    constructor(bytes32 assetId_) { assetId = assetId_; year = 2026; }
    function setIntervals(uint64 cs, uint64 ce, uint8 cp, uint64 ns, uint64 ne, uint8 np) external {
        currentStart = cs; currentEnd = ce; currentPhase = cp; nextStart = ns; nextEnd = ne; nextPhase = np;
    }
    function currentInterval(bytes32) external view returns (bytes32,uint32,uint32,uint64,uint64,uint8,bytes32) {
        return (assetId, year, 1, currentStart, currentEnd, currentPhase, keccak256("current"));
    }
    function nextInterval(bytes32) external view returns (bytes32,uint32,uint32,uint64,uint64,uint8,bytes32) {
        return (assetId, year, 2, nextStart, nextEnd, nextPhase, keccak256("next"));
    }
}

contract MockAuctionPolicyHook {
    struct Policy {
        bool canSwap; uint8 mode; uint8 phase; uint16 flags; uint256 reasons; uint24 fee; uint16 band;
        uint128[2] a; uint128[2] b; uint128[2] c; uint128[2] d; uint128[2] e;
        uint64 f; uint64 g; bytes32 h; bytes32 i;
    }
    function getPolicy() external pure returns (Policy memory p) {
        p.canSwap = true;
        p.mode = 1;
        p.phase = 1;
    }
}

contract BellOpeningAuctionTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint64 private constant OPEN_TIME = 1_800_000_000;
    uint32 private constant LEAD = 600;
    uint32 private constant TIMEOUT = 900;
    bytes32 private constant ASSET = keccak256("AAPL");
    address private constant FACTORY = address(0xFAC);
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    MockToken private quote;
    MockToken private base;
    MockAuctionCalendar private calendar;
    MockAuctionPolicyHook private hook;
    BellOpeningAuction private auction;

    function setUp() public {
        quote = new MockToken("Quote", "USDG");
        base = new MockToken("Base", "AAPL");
        calendar = new MockAuctionCalendar(ASSET);
        hook = new MockAuctionPolicyHook();
        auction = new BellOpeningAuction(
            FACTORY, address(hook), address(calendar), ASSET, address(quote), address(base), LEAD, TIMEOUT, 8,
            1e18, 1e18, 25
        );
        quote.mint(ALICE, 10_000e18);
        base.mint(BOB, 10_000e18);
        _arm(OPEN_TIME);
        vm.warp(OPEN_TIME - LEAD);
    }

    function _arm(uint64 open) private {
        calendar.setIntervals(open - 10_000, open, 5, open, open + 14_400, 1);
        vm.warp(open - 5_000);
        require(auction.armNext(), "cycle not armed");
    }

    function _selector(address target, bytes memory data) private returns (bytes4) {
        (bool ok, bytes memory ret) = target.call(data);
        if (ok || ret.length < 4) return bytes4(0);
        bytes4 s; assembly { s := mload(add(ret, 32)) } return s;
    }

    function _buy(uint128 amount, uint160 limit) private {
        vm.prank(ALICE); quote.approve(address(auction), type(uint256).max);
        vm.prank(ALICE); auction.submitOrder(true, amount, limit);
    }
    function _sell(uint128 amount, uint160 limit) private {
        vm.prank(BOB); base.approve(address(auction), type(uint256).max);
        vm.prank(BOB); auction.submitOrder(false, amount, limit);
    }

    function testArmsOnlyCalendarProvenClosedToOpenAndRepeatsPerCycle() external {
        require(auction.cycleId() == 1, "first cycle");
        require(auction.cycleOrderCount(1) == 0, "first cycle empty");
        _buy(10e18, uint160(1 << 96));
        require(auction.cycleOrderCount(1) == 1 && auction.cycleOrderId(1, 0) == 0, "first cycle id");
        vm.warp(OPEN_TIME + TIMEOUT);
        auction.refund();
        (uint64 oldOpen, uint64 oldDeadline, uint8 oldStage,, , bool oldFinalized) = auction.cycleSummary(1);
        require(oldOpen == OPEN_TIME && oldDeadline == OPEN_TIME + TIMEOUT, "old cycle summary timestamps");
        require(oldStage == 5 && oldFinalized, "old timeout summary");
        uint64 nextOpen = OPEN_TIME + 7 days;
        _arm(nextOpen);
        require(auction.cycleId() == 2, "second cycle");
        require(auction.openTime() == nextOpen, "next calendar open");
        vm.warp(nextOpen - LEAD);
        _sell(10e18, uint160(1 << 96));
        require(auction.cycleOrderCount(1) == 1 && auction.cycleOrderId(1, 0) == 0, "old cycle ids stable");
        require(auction.cycleOrderCount(2) == 1 && auction.cycleOrderId(2, 0) == 1, "new cycle id independent");
    }

    function testArmNextPermissionlesslyRefundsExpiredPreviousCycle() external {
        _buy(10e18, uint160(1 << 96));
        uint64 nextOpen = OPEN_TIME + 7 days;
        calendar.setIntervals(nextOpen - 10_000, nextOpen, 5, nextOpen, nextOpen + 14_400, 1);
        vm.warp(nextOpen - 5_000);

        require(auction.armNext(), "expired cycle blocked next opening");
        require(auction.cycleId() == 2, "next cycle not armed");
        (,,, , , bool previousFinalized) = auction.cycleSummary(1);
        require(previousFinalized, "previous cycle not made refundable");
        vm.prank(ALICE); auction.claimUnfilled(1, 0);
        require(quote.balanceOf(ALICE) == 10_000e18, "expired order was not refunded");
    }

    function testArmRejectsWrongCalendarPhase() external {
        vm.warp(OPEN_TIME + TIMEOUT);
        auction.refund();
        calendar.setIntervals(OPEN_TIME + TIMEOUT - 10, OPEN_TIME + TIMEOUT + 100, 4,
            OPEN_TIME + TIMEOUT + 100, OPEN_TIME + TIMEOUT + 1000, 1);
        require(!auction.armNext(), "overnight current leaf is not CLOSED");
        require(auction.cycleId() == 1, "cycle unchanged");
    }

    function testSubmitEscrowsAndHonorsMinimum() external {
        _buy(10e18, uint160(1 << 96));
        require(auction.orderCount() == 1, "order count");
        require(quote.balanceOf(address(auction)) == 10e18, "quote escrow");
        require(_selector(address(auction), abi.encodeCall(BellOpeningAuction.submitOrder,
            (true, uint128(1), uint160(1 << 96)))) == BellOpeningAuction.OrderTooSmall.selector, "minimum size");
    }

    function testSubmitOrderRejectsTokenCallbackReentry() external {
        quote.mint(address(quote), 10e18);
        quote.armReentry(address(auction), 10e18, uint160(1 << 96));
        _buy(10e18, uint160(1 << 96));

        require(!quote.reentrySucceeded(), "token callback inserted a second order");
        require(auction.orderCount() == 1, "unexpected nested order");
        require(quote.balanceOf(address(auction)) == 10e18, "escrow contains only the signed order");
    }

    function testCancelOnlyOwnerBeforeCutoff() external {
        _buy(10e18, uint160(1 << 96));
        require(_selector(address(auction), abi.encodeCall(BellOpeningAuction.cancelOrder, (uint32(0))))
            == BellOpeningAuction.NotOrderOwner.selector, "stranger cannot cancel");
        vm.prank(ALICE); auction.cancelOrder(0);
        require(quote.balanceOf(address(auction)) == 0, "cancel refunds escrow");
    }

    function testBlocksSwapsDuringOpenAndLockedButReopensAfterTimeout() external {
        vm.warp(OPEN_TIME - LEAD); require(auction.blocksSwaps(), "open blocks");
        vm.warp(OPEN_TIME); require(auction.blocksSwaps(), "locked blocks");
        vm.warp(OPEN_TIME + TIMEOUT); require(!auction.blocksSwaps(), "timeout reopens");
    }

    function testSettleSelectsMaximumVolumePriceWithoutKeeperPriceInput() external {
        _buy(100e18, uint160(2 << 96)); // buyer cap price 2
        _sell(100e18, uint160(1 << 96)); // seller floor price 1
        vm.warp(OPEN_TIME);
        auction.settle();
        require(auction.clearingPriceX96() == uint160(1 << 96), "tie -> lowest candidate");
    }

    function testCycleSummaryPersistsClearingResult() external {
        _buy(10e18, uint160(2 << 96));
        _sell(10e18, uint160(1 << 96));
        vm.warp(OPEN_TIME);
        auction.settle();
        (,,,, uint128 matchedBase, bool finalized) = auction.cycleSummary(1);
        require(finalized && matchedBase == 10e18, "cycle result not persisted");
    }

    function testIndicativeClearingIsReadOnlyAndMatchesSettlementCandidate() external {
        _buy(100e18, uint160(2 << 96));
        _sell(100e18, uint160(1 << 96));
        (uint160 price, uint128 volume) = auction.indicativeClearing();
        require(price == uint160(1 << 96) && volume == 100e18, "indicative result");
        require(auction.currentStage() == 2, "view did not settle");
    }

    function testP2PSettlementBalancesQuoteAndBaseEscrow() external {
        // price 1: buyer escrows 100 quote, seller offers 100 base.
        _buy(100e18, uint160(1 << 96));
        _sell(100e18, uint160(1 << 96));
        vm.warp(OPEN_TIME);
        auction.settle();
        (uint128 buyerBase, uint128 buyerQuoteRefund,) = auction.allocation(1, 0);
        (uint128 sellerBase, uint128 sellerQuote,) = auction.allocation(1, 1);
        require(buyerBase == 100e18 && buyerQuoteRefund == 0, "buyer fill");
        require(sellerBase == 100e18 && sellerQuote == 100e18, "seller payout");
        vm.prank(ALICE); auction.claimUnfilled(1, 0);
        vm.prank(BOB); auction.claimUnfilled(1, 1);
        require(base.balanceOf(ALICE) == 100e18, "buyer received base");
        require(quote.balanceOf(BOB) == 100e18, "seller received quote");
        require(quote.balanceOf(address(auction)) == 0 && base.balanceOf(address(auction)) == 0, "no residual balances");
    }

    function testOneSidedBookSettlesAtZeroVolumeAndRefundsAll() external {
        _buy(100e18, uint160(1 << 96));
        vm.warp(OPEN_TIME); auction.settle();
        (uint128 fill, uint128 payout, uint128 refundAmount) = auction.allocation(1, 0);
        require(fill == 0 && payout == 0 && refundAmount == 100e18, "one-sided refund");
        uint256 before = quote.balanceOf(ALICE);
        vm.prank(ALICE); auction.claimUnfilled(1, 0);
        require(quote.balanceOf(ALICE) == before + 100e18, "buyer refunded");
    }

    function testPartialFillRefundsExcessBuyerQuote() external {
        _buy(200e18, uint160(1 << 96));
        _sell(100e18, uint160(1 << 96));
        vm.warp(OPEN_TIME); auction.settle();
        (uint128 fill, uint128 payout, uint128 refundAmount) = auction.allocation(1, 0);
        require(fill == 100e18 && payout == 0 && refundAmount == 100e18, "partial buy fill");
        vm.prank(ALICE); auction.claimUnfilled(1, 0);
        vm.prank(BOB); auction.claimUnfilled(1, 1);
        require(quote.balanceOf(address(auction)) == 0 && base.balanceOf(address(auction)) == 0, "partial cycle escrow clears");
    }

    function testMultiOrderFractionalPriceLeavesNoEscrowDust() external {
        uint160 price = uint160((3 << 96) / 2); // quote/base = 1.5
        quote.mint(address(0xA2), 10e18);
        base.mint(address(0xB2), 20e18);
        vm.prank(ALICE); quote.approve(address(auction), type(uint256).max);
        vm.prank(ALICE); auction.submitOrder(true, 10e18, price);
        vm.prank(address(0xA2)); quote.approve(address(auction), type(uint256).max);
        vm.prank(address(0xA2)); auction.submitOrder(true, 10e18, price);
        vm.prank(BOB); base.approve(address(auction), type(uint256).max);
        vm.prank(BOB); auction.submitOrder(false, 10e18, price);
        vm.prank(address(0xB2)); base.approve(address(auction), type(uint256).max);
        vm.prank(address(0xB2)); auction.submitOrder(false, 10e18, price);

        vm.warp(OPEN_TIME);
        auction.settle();
        vm.prank(ALICE); auction.claimUnfilled(1, 0);
        vm.prank(address(0xA2)); auction.claimUnfilled(1, 1);
        vm.prank(BOB); auction.claimUnfilled(1, 2);
        vm.prank(address(0xB2)); auction.claimUnfilled(1, 3);
        require(quote.balanceOf(address(auction)) == 0, "no quote dust");
        require(base.balanceOf(address(auction)) == 0, "no base dust");
    }

    function testMultipleBuyerRoundingNeverSpendsMoreThanEachQuoteEscrow() external {
        uint256 q96 = 1 << 96;
        uint160 price = uint160((3 * q96) / 2);
        uint128 quoteA = uint128(10e18 + 1);
        uint128 quoteB = uint128(10e18 + 4);
        uint128 baseA = uint128(uint256(quoteA) * q96 / price);
        uint128 baseB = uint128(uint256(quoteB) * q96 / price);
        address carol = address(0xCA401);

        quote.mint(carol, quoteB);
        base.mint(BOB, uint256(baseA) + baseB);
        _buy(quoteA, price);
        vm.prank(carol); quote.approve(address(auction), type(uint256).max);
        vm.prank(carol); auction.submitOrder(true, quoteB, price);
        _sell(uint128(uint256(baseA) + baseB), price);

        vm.warp(OPEN_TIME);
        auction.settle();
        (uint128 fillA,, uint128 refundA) = auction.allocation(1, 0);
        (uint128 fillB,, uint128 refundB) = auction.allocation(1, 1);
        (, uint128 sellerPayout,) = auction.allocation(1, 2);
        uint256 spentA = uint256(quoteA) - refundA;
        uint256 spentB = uint256(quoteB) - refundB;

        require(fillA == baseA && fillB == baseB, "buyer capacities must match demand");
        require(spentA <= quoteA && spentB <= quoteB, "per-order rounding exceeded escrow");
        require(spentA + spentB == sellerPayout, "seller allocation must equal buyer debits");

        vm.prank(ALICE); auction.claimUnfilled(1, 0);
        vm.prank(carol); auction.claimUnfilled(1, 1);
        vm.prank(BOB); auction.claimUnfilled(1, 2);
        require(quote.balanceOf(BOB) == sellerPayout, "seller claim matches allocation");
        require(quote.balanceOf(address(auction)) == 0, "no quote escrow remains");
        require(base.balanceOf(address(auction)) == 0, "no base escrow remains");
    }

    function testWorstCaseTwentyFiveUniqueLimitsSettles() external {
        for (uint32 i; i < 13; ++i) {
            address buyer = address(uint160(0x1000 + i));
            quote.mint(buyer, 10e18);
            vm.prank(buyer); quote.approve(address(auction), type(uint256).max);
            vm.prank(buyer); auction.submitOrder(true, 10e18, uint160((uint256(2 << 96) + uint256(i) * 1e20)));
        }
        for (uint32 i; i < 12; ++i) {
            address seller = address(uint160(0x2000 + i));
            base.mint(seller, 10e18);
            vm.prank(seller); base.approve(address(auction), type(uint256).max);
            vm.prank(seller); auction.submitOrder(false, 10e18, uint160((uint256(1 << 96) - uint256(i) * 1e20)));
        }
        vm.warp(OPEN_TIME);
        auction.settle();
        require(auction.clearingPriceX96() != 0, "25-order book did not clear");
        require(auction.stage() == 4, "25-order cycle not settled");
    }

    function testLimitMismatchReturnsZeroVolume() external {
        _buy(100e18, uint160(1 << 96));
        _sell(100e18, uint160(2 << 96));
        vm.warp(OPEN_TIME); auction.settle();
        require(auction.clearingPriceX96() == 0, "no crossing price");
    }

    function testTimeoutRefundWorksEvenWhenKeeperNeverSettles() external {
        _buy(100e18, uint160(1 << 96));
        vm.warp(OPEN_TIME + TIMEOUT);
        require(!auction.blocksSwaps(), "swaps reopened by time");
        vm.prank(address(0xBEEF)); auction.claimUnfilled(1, 0);
        require(quote.balanceOf(ALICE) == 10_000e18, "permissionless timeout refund");
    }

    function testUnfilledBuyerCrowdedOutByPriorityGetsFullRefund() external {
        address carol = address(0xCA401);
        quote.mint(carol, 100e18);
        _buy(100e18, uint160(1 << 96));
        vm.prank(carol); quote.approve(address(auction), type(uint256).max);
        vm.prank(carol); auction.submitOrder(true, 100e18, uint160(1 << 96));
        _sell(100e18, uint160(1 << 96));
        vm.warp(OPEN_TIME); auction.settle();
        (uint128 fill,, uint128 refundAmount) = auction.allocation(1, 1);
        require(fill == 0 && refundAmount == 100e18, "crowded-out buyer refund recorded");
        vm.prank(ALICE); auction.claimUnfilled(1, 0);
        vm.prank(carol); auction.claimUnfilled(1, 1);
        vm.prank(BOB); auction.claimUnfilled(1, 2);
        require(quote.balanceOf(carol) == 100e18, "crowded-out buyer got quote back");
        require(quote.balanceOf(address(auction)) == 0 && base.balanceOf(address(auction)) == 0, "escrow empty");
    }

    function testBuyerBelowClearingPriceGetsFullRefund() external {
        address dave = address(0xDA7E);
        quote.mint(dave, 50e18);
        _buy(100e18, uint160(1 << 96));
        vm.prank(dave); quote.approve(address(auction), type(uint256).max);
        vm.prank(dave); auction.submitOrder(true, 50e18, uint160((1 << 96) / 2));
        _sell(100e18, uint160(1 << 96));
        vm.warp(OPEN_TIME); auction.settle();
        vm.prank(ALICE); auction.claimUnfilled(1, 0);
        vm.prank(dave); auction.claimUnfilled(1, 1);
        vm.prank(BOB); auction.claimUnfilled(1, 2);
        require(quote.balanceOf(dave) == 50e18, "below-price buyer got quote back");
        require(quote.balanceOf(address(auction)) == 0 && base.balanceOf(address(auction)) == 0, "escrow empty");
    }
}
