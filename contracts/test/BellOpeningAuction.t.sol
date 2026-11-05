// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BellOpeningAuction} from "../src/auction/BellOpeningAuction.sol";
import {IAuctionResidualAdapter} from "../src/auction/IAuctionResidualAdapter.sol";
import {AuctionClearing} from "../src/libraries/AuctionClearing.sol";

interface Vm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
}

contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Deterministic executor. Quotes at the configured price and actually moves tokens so the
///      settlement claims can be exercised end to end. Never moves the price, so the auction's
///      post-residual price guard is satisfied whenever the clearing price matches.
contract MockAuctionAdapter is IAuctionResidualAdapter {
    address public immutable token0;
    address public immutable token1;
    uint160 public priceX96 = uint160(1 << 96);

    uint128 public lastAmountIn;
    bool public lastZeroForOne;
    bool public revertNext;

    error AdapterReverted();
    error Slippage();

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function setPrice(uint160 next) external {
        priceX96 = next;
    }

    function setRevertNext(bool next) external {
        revertNext = next;
    }

    function poolSqrtPriceX96() external view returns (uint160) {
        return priceX96;
    }

    function swapExactInput(bool zeroForOne, uint128 amountIn, uint128 minAmountOut, uint256)
        external
        returns (uint128 amountOut)
    {
        if (revertNext) revert AdapterReverted();
        lastZeroForOne = zeroForOne;
        lastAmountIn = amountIn;
        if (zeroForOne) {
            // token0 in, token1 out.
            IERC20(token0).transferFrom(msg.sender, address(this), amountIn);
            amountOut = uint128(AuctionClearing.baseForQuote(amountIn, priceX96, true));
            if (amountOut < minAmountOut) revert Slippage();
            IERC20(token1).transfer(msg.sender, amountOut);
        } else {
            // token1 in, token0 out.
            IERC20(token1).transferFrom(msg.sender, address(this), amountIn);
            amountOut = uint128(AuctionClearing.quoteForBase(amountIn, priceX96, true));
            if (amountOut < minAmountOut) revert Slippage();
            IERC20(token0).transfer(msg.sender, amountOut);
        }
    }
}

contract BellOpeningAuctionTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint64 private constant OPEN_TIME = 1_800_000_000;
    uint32 private constant LEAD = 600;
    uint32 private constant TIMEOUT = 900;

    uint8 private constant STAGE_IDLE = 0;
    uint8 private constant STAGE_OPEN = 1;
    uint8 private constant STAGE_LOCKED = 2;
    uint8 private constant STAGE_SETTLED = 3;
    uint8 private constant STAGE_REFUNDED = 4;

    address private constant HOOK = address(0xF00D);
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    MockToken private token0; // quote
    MockToken private token1; // base
    MockAuctionAdapter private adapter;
    BellOpeningAuction private auction;

    function setUp() public {
        token0 = new MockToken("Quote", "USDG");
        token1 = new MockToken("Base", "AAPL");
        adapter = new MockAuctionAdapter(address(token0), address(token1));
        auction = new BellOpeningAuction(
            HOOK,
            address(adapter),
            address(token0),
            address(token1),
            OPEN_TIME,
            LEAD,
            TIMEOUT,
            [uint128(1e18), uint128(1e18)],
            10_000e18,
            25
        );
        token0.mint(ALICE, 10_000e18);
        token1.mint(BOB, 10_000e18);
        // Keep the mock solvent so the residual legs can actually pay out.
        token0.mint(address(adapter), 1_000_000e18);
        token1.mint(address(adapter), 1_000_000e18);
        vm.warp(OPEN_TIME - LEAD);
    }

    // ---------------------------------------------------------------- helpers

    function _revertSelector(address target, bytes memory data) private returns (bytes4) {
        (bool ok, bytes memory ret) = target.call(data);
        if (ok || ret.length < 4) return bytes4(0);
        bytes4 selector;
        assembly {
            selector := mload(add(ret, 32))
        }
        return selector;
    }

    function _order(bool zeroForOne, uint128 amountIn, uint160 limit) private {
        address buyer = zeroForOne ? ALICE : BOB;
        address inToken = zeroForOne ? address(token0) : address(token1);
        vm.prank(buyer);
        IERC20(inToken).approve(address(auction), type(uint256).max);
        vm.prank(buyer);
        auction.submitOrder(zeroForOne, amountIn, limit);
    }

    /// @dev Alice buys with `quoteIn` of token0; Bob sells `baseIn` of token1. At price 1 these are
    ///      comparable raw amounts.
    function _twoSidedBook(uint128 quoteIn, uint128 baseIn) private {
        _order(true, quoteIn, 0);
        _order(false, baseIn, 0);
    }

    // ---------------------------------------------------------------- escrow

    function testSubmitOrderEscrowsTheInput() external {
        _order(true, 100e18, 0);
        require(auction.orderCount() == 1, "order count");
        require(token0.balanceOf(ALICE) == 10_000e18 - 100e18, "buyer debited");
        require(token0.balanceOf(address(auction)) == 100e18, "auction holds escrow");
    }

    function testSubmitOrderRejectsBelowMinimumSize() external {
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.submitOrder, (true, 1, uint160(0))));
        require(got == BellOpeningAuction.OrderTooSmall.selector, "too small rejected");
    }

    function testSubmitOrderRejectsAfterCutoff() external {
        vm.warp(OPEN_TIME);
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.submitOrder, (true, 100e18, uint160(0))));
        require(got == BellOpeningAuction.AuctionNotOpen.selector, "late order rejected");
    }

    function testCancelOrderReturnsEscrowAndRejectsNonOwner() external {
        _order(false, 5e18, 0);
        require(token1.balanceOf(BOB) == 10_000e18 - 5e18, "escrowed");

        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.cancelOrder, (0)));
        require(got == BellOpeningAuction.NotOrderOwner.selector, "non owner rejected");

        vm.prank(BOB);
        auction.cancelOrder(0);
        require(token1.balanceOf(BOB) == 10_000e18, "refunded");
        require(token1.balanceOf(address(auction)) == 0, "escrow empty");
    }

    function testCancelOrderRejectsAfterCutoff() external {
        _order(false, 5e18, 0);
        vm.warp(OPEN_TIME);
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.cancelOrder, (0)));
        require(got == BellOpeningAuction.AuctionNotOpen.selector, "cancel after cutoff rejected");
    }

    function testBookFullIsRejected() external {
        BellOpeningAuction small = new BellOpeningAuction(
            HOOK, address(adapter), address(token0), address(token1), OPEN_TIME, LEAD, TIMEOUT,
            [uint128(1e18), uint128(1e18)], 10_000e18, 1
        );
        vm.prank(ALICE);
        token0.approve(address(small), type(uint256).max);
        vm.prank(ALICE);
        small.submitOrder(true, 100e18, 0);

        vm.prank(BOB);
        token1.approve(address(small), type(uint256).max);
        bytes4 got = _revertSelector(address(small), abi.encodeCall(BellOpeningAuction.submitOrder, (false, 100e18, uint160(0))));
        require(got == BellOpeningAuction.BookFull.selector, "book full rejected");
    }

    // ---------------------------------------------------------------- gating

    function testBlocksSwapsOnlyInsideTheWindow() external {
        vm.warp(OPEN_TIME - LEAD - 1);
        require(!auction.blocksSwaps(), "idle does not block");
        require(auction.stage() == STAGE_IDLE, "idle stage");

        vm.warp(OPEN_TIME - 1);
        require(auction.blocksSwaps(), "open blocks");
        require(auction.stage() == STAGE_OPEN, "open stage");

        vm.warp(OPEN_TIME);
        require(auction.blocksSwaps(), "locked blocks");
        require(auction.stage() == STAGE_LOCKED, "locked stage");

        // Past the settle timeout the swap path must reopen even with no settlement, otherwise a
        // failed settle would brick the pool.
        vm.warp(OPEN_TIME + TIMEOUT);
        require(!auction.blocksSwaps(), "timeout reopens swaps");
    }

    // ---------------------------------------------------------------- settle

    function testSettleRejectsBeforeOpenTime() external {
        _twoSidedBook(100e18, 100e18);
        vm.warp(OPEN_TIME - 1);
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.settle, (uint160(1 << 96))));
        require(got == BellOpeningAuction.AuctionNotSettleable.selector, "early settle rejected");
    }

    function testSettleRejectsEmptyBook() external {
        vm.warp(OPEN_TIME);
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.settle, (uint160(1 << 96))));
        require(got == BellOpeningAuction.NothingToSettle.selector, "empty book rejected");
    }

    function testSettleRejectsPriceOutsideTheOrderLimit() external {
        _order(true, 100e18, uint160(2 * (1 << 96))); // buyer caps the price at 4
        vm.warp(OPEN_TIME);
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.settle, (uint160(2 * (1 << 96) + 1))));
        require(got == BellOpeningAuction.LimitViolated.selector, "limit enforced");
    }

    function testSettleRejectsClearingPriceFarFromThePool() external {
        // A clearing price far from the pool forces a large residual whose output floor cannot be
        // met, so the swap leg refuses before any payout is recorded.
        _twoSidedBook(100e18, 100e18);
        vm.warp(OPEN_TIME);
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.settle, (uint160(3 * (1 << 96)))));
        require(got == MockAuctionAdapter.Slippage.selector, "residual output floor enforced");
    }

    function testSettleNetsExactlyWithoutTouchingThePool() external {
        _twoSidedBook(100e18, 100e18);
        vm.warp(OPEN_TIME);
        auction.settle(uint160(1 << 96));

        require(adapter.lastAmountIn() == 0, "pool untouched");
        require(auction.stage() == STAGE_SETTLED, "settled stage");

        (uint128 baseOut0, uint128 quoteOut0, bool claimable0) = auction.payouts(0);
        require(baseOut0 == 100e18 && quoteOut0 == 0 && claimable0, "buyer receives base");

        (uint128 baseOut1, uint128 quoteOut1,) = auction.payouts(1);
        require(baseOut1 == 0 && quoteOut1 == 100e18, "seller receives quote");
    }

    function testSettleBuysTheResidualWhenDemandExceedsSupply() external {
        _twoSidedBook(200e18, 100e18);
        vm.warp(OPEN_TIME);
        auction.settle(uint160(1 << 96));
        require(adapter.lastZeroForOne(), "pool sells base to us");
        require(adapter.lastAmountIn() == 100e18, "residual quote in");
    }

    function testSettleSellsTheResidualWhenSupplyExceedsDemand() external {
        _twoSidedBook(100e18, 200e18);
        vm.warp(OPEN_TIME);
        auction.settle(uint160(1 << 96));
        require(!adapter.lastZeroForOne(), "pool buys base from us");
        require(adapter.lastAmountIn() == 100e18, "residual base in");
    }

    function testSettleRejectsResidualOverTheCap() external {
        BellOpeningAuction capped = new BellOpeningAuction(
            HOOK, address(adapter), address(token0), address(token1), OPEN_TIME, LEAD, TIMEOUT,
            [uint128(1e18), uint128(1e18)], 10e18, 25
        );
        vm.prank(ALICE);
        token0.approve(address(capped), type(uint256).max);
        vm.prank(ALICE);
        capped.submitOrder(true, 200e18, 0);
        vm.prank(BOB);
        token1.approve(address(capped), type(uint256).max);
        vm.prank(BOB);
        capped.submitOrder(false, 100e18, 0);

        vm.warp(OPEN_TIME);
        bytes4 got = _revertSelector(address(capped), abi.encodeCall(BellOpeningAuction.settle, (uint160(1 << 96))));
        require(got == BellOpeningAuction.ResidualTooLarge.selector, "residual cap enforced");
    }

    function testSettleUpdatesThePriceGuardFromThePool() external {
        // The mock never moves its price, so a settlement at the pool price is accepted and a
        // settlement far from it is not. This pins the guard as unconditional, not residual-sized.
        _twoSidedBook(100e18, 100e18);
        adapter.setPrice(uint160(2 * (1 << 96)));
        vm.warp(OPEN_TIME);
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.settle, (uint160(1 << 96))));
        require(got == BellOpeningAuction.ClearingPriceMismatch.selector, "guard follows the pool");
    }

    function testSettleTwiceIsRejected() external {
        _twoSidedBook(100e18, 100e18);
        vm.warp(OPEN_TIME);
        auction.settle(uint160(1 << 96));
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.settle, (uint160(1 << 96))));
        require(got == BellOpeningAuction.AlreadySettled.selector, "double settle rejected");
    }

    // ---------------------------------------------------------------- claims

    function testClaimsPayOutOnce() external {
        _twoSidedBook(100e18, 100e18);
        vm.warp(OPEN_TIME);
        auction.settle(uint160(1 << 96));

        uint256 aliceBaseBefore = token1.balanceOf(ALICE);
        vm.prank(ALICE);
        auction.claimBase(0);
        require(token1.balanceOf(ALICE) == aliceBaseBefore + 100e18, "buyer paid base");

        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.claimBase, (0)));
        require(got == BellOpeningAuction.NotClaimable.selector, "double claim rejected");

        uint256 bobQuoteBefore = token0.balanceOf(BOB);
        vm.prank(BOB);
        auction.claimQuote(1);
        require(token0.balanceOf(BOB) == bobQuoteBefore + 100e18, "seller paid quote");
    }

    function testClaimsRejectBeforeSettlement() external {
        _twoSidedBook(100e18, 100e18);
        vm.warp(OPEN_TIME);
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.claimBase, (0)));
        require(got == BellOpeningAuction.NotSettled.selector, "pre-settle claim rejected");
    }

    function testEscrowBalancesAfterAResidualSettlement() external {
        // Both claims must succeed even when the pool supplied part of the base. Alice holds no base
        // and Bob holds no quote to begin with, so the balances are pure settlement output.
        _twoSidedBook(200e18, 100e18);
        vm.warp(OPEN_TIME);
        auction.settle(uint160(1 << 96));

        require(token1.balanceOf(ALICE) == 0, "buyer starts with no base");
        require(token0.balanceOf(BOB) == 0, "seller starts with no quote");

        vm.prank(ALICE);
        auction.claimBase(0);
        vm.prank(BOB);
        auction.claimQuote(1);

        require(token1.balanceOf(ALICE) == 200e18, "buyer receives the full base");
        require(token0.balanceOf(BOB) == 100e18, "seller receives the full quote");
        require(token1.balanceOf(address(auction)) == 0, "base escrow drained");
        require(token0.balanceOf(address(auction)) == 0, "quote escrow drained");
    }

    // ---------------------------------------------------------------- refunds

    function testRefundRejectsBeforeTheTimeout() external {
        vm.warp(OPEN_TIME + 10);
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.refund, ()));
        require(got == BellOpeningAuction.RefundNotOpen.selector, "early refund rejected");
    }

    function testRefundAfterTimeoutIsPermissionlessAndReturnsEscrow() external {
        _twoSidedBook(100e18, 100e18);
        vm.warp(OPEN_TIME + TIMEOUT);
        require(!auction.blocksSwaps(), "swaps reopen");
        auction.refund();
        require(auction.stage() == STAGE_REFUNDED, "refunded stage");

        uint256 before = token1.balanceOf(BOB);
        vm.prank(address(0xDEAD)); // a third party can only help: funds go to the owner
        auction.claimRefund(1);
        require(token1.balanceOf(BOB) == before + 100e18, "escrow returned");
    }

    function testSettleAfterRefundIsRejected() external {
        _twoSidedBook(100e18, 100e18);
        vm.warp(OPEN_TIME + TIMEOUT);
        auction.refund();
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.settle, (uint160(1 << 96))));
        require(got == BellOpeningAuction.AlreadyRefunded.selector, "settle after refund rejected");
    }

    function testClaimRefundBeforeRefundIsRejected() external {
        _twoSidedBook(100e18, 100e18);
        vm.warp(OPEN_TIME + TIMEOUT);
        bytes4 got = _revertSelector(address(auction), abi.encodeCall(BellOpeningAuction.claimRefund, (1)));
        require(got == BellOpeningAuction.RefundNotOpen.selector, "claim before refund rejected");
    }

    function testClaimRefundAllReturnsEveryOrder() external {
        _twoSidedBook(100e18, 100e18);
        vm.warp(OPEN_TIME + TIMEOUT);
        auction.refund();
        uint32[] memory ids = new uint32[](2);
        ids[0] = 0;
        ids[1] = 1;
        auction.claimRefundAll(ids);
        require(token0.balanceOf(address(auction)) == 0, "quote escrow empty");
        require(token1.balanceOf(address(auction)) == 0, "base escrow empty");
        require(auction.stage() == STAGE_REFUNDED, "still refunded");
    }

    function testConstructorRejectsBadConfig() external {
        // openTime at or below the lead would underflow the window arithmetic.
        bool reverted;
        try new BellOpeningAuction(
            HOOK, address(adapter), address(token0), address(token1), 10, 600, TIMEOUT,
            [uint128(1e18), uint128(1e18)], 1e18, 25
        ) returns (BellOpeningAuction) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "bad window accepted");

        // The two legs must be distinct tokens.
        bool revertedSame;
        try new BellOpeningAuction(
            HOOK, address(adapter), address(token0), address(token0), OPEN_TIME, LEAD, TIMEOUT,
            [uint128(1e18), uint128(1e18)], 1e18, 25
        ) returns (BellOpeningAuction) {
            revertedSame = false;
        } catch {
            revertedSame = true;
        }
        require(revertedSame, "identical legs accepted");
    }
}
