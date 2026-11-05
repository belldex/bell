// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAuctionResidualAdapter} from "./IAuctionResidualAdapter.sol";
import {AuctionClearing} from "../libraries/AuctionClearing.sol";

/// @title BellOpeningAuction
/// @notice One per pool. Escrows the opening-bell order flow, clears it at a single price, and sends
///         only the unmatched residual to the pool.
/// @dev Holds user funds for the length of the window, so every exit path is permissionless and
///      independent of any pausable controller.
///
///      Orientation: `token0` is the quote and `token1` is the base. `zeroForOne == true` spends the
///      quote to buy base, so it is a buyer; `zeroForOne == false` sells base, so it is a seller.
contract BellOpeningAuction {
    using SafeERC20 for IERC20;

    enum Stage {
        IDLE,
        OPEN,
        LOCKED,
        SETTLED,
        REFUNDED
    }

    struct Order {
        address owner;
        bool zeroForOne;
        uint128 amountIn;
        uint160 limitSqrtPriceX96;
        bool gone;
    }

    struct Payout {
        uint128 baseOut;
        uint128 quoteOut;
        bool claimable;
    }

    error AuctionNotOpen();
    error AuctionNotSettleable();
    error OrderTooSmall();
    error BookFull();
    error NotOrderOwner();
    error OrderAlreadyGone();
    error LimitViolated();
    error ResidualTooLarge();
    error ClearingPriceMismatch();
    error AlreadySettled();
    error AlreadyRefunded();
    error NothingToSettle();
    error NotSettled();
    error RefundNotOpen();
    error NotClaimable();
    error BadConfig();

    /// @dev The clearing price must land within this band of the pool's own price.
    uint16 internal constant PRICE_TOLERANCE_BPS = 50;

    address public immutable hook;
    address public immutable adapter;
    /// @dev Quote token.
    address public immutable token0;
    /// @dev Base token.
    address public immutable token1;
    uint64 public immutable openTime;
    uint32 public immutable auctionLead;
    uint32 public immutable settleTimeout;
    uint128 public immutable minOrderSize0;
    uint128 public immutable minOrderSize1;
    uint128 public immutable residualCap;
    uint8 public immutable maxOrders;

    Order[] internal _orders;
    Payout[] internal _payouts;
    uint160 internal _clearingSqrtPriceX96;
    bool internal _settled;
    bool internal _refunded;

    constructor(
        address hook_,
        address adapter_,
        address token0_,
        address token1_,
        uint64 openTime_,
        uint32 auctionLead_,
        uint32 settleTimeout_,
        uint128[2] memory minOrderSize_,
        uint128 residualCap_,
        uint8 maxOrders_
    ) {
        if (
            hook_ == address(0) || adapter_ == address(0) || token0_ == address(0) || token1_ == address(0)
                || token0_ == token1_ || openTime_ <= auctionLead_ || settleTimeout_ == 0 || maxOrders_ == 0
        ) revert BadConfig();
        hook = hook_;
        adapter = adapter_;
        token0 = token0_;
        token1 = token1_;
        openTime = openTime_;
        auctionLead = auctionLead_;
        settleTimeout = settleTimeout_;
        minOrderSize0 = minOrderSize_[0];
        minOrderSize1 = minOrderSize_[1];
        residualCap = residualCap_;
        maxOrders = maxOrders_;
    }

    /// @notice Current lifecycle stage.
    function stage() public view returns (uint8) {
        if (_settled) return uint8(Stage.SETTLED);
        if (_refunded) return uint8(Stage.REFUNDED);
        if (block.timestamp < openTime - auctionLead) return uint8(Stage.IDLE);
        if (block.timestamp < openTime) return uint8(Stage.OPEN);
        return uint8(Stage.LOCKED);
    }

    /// @notice Number of orders ever submitted, including cancelled ones.
    function orderCount() external view returns (uint32) {
        return uint32(_orders.length);
    }

    /// @notice Order record by id.
    function order(uint32 id) external view returns (Order memory) {
        return _orders[id];
    }

    /// @notice The price the batch cleared at, once settled.
    function clearingSqrtPriceX96() external view returns (uint160) {
        return _clearingSqrtPriceX96;
    }

    /// @notice Per-order settlement outcome.
    function payouts(uint32 id) external view returns (uint128 baseOut, uint128 quoteOut, bool claimable) {
        Payout memory p = _payouts[id];
        return (p.baseOut, p.quoteOut, p.claimable);
    }

    /// @notice True while the hook must reject ordinary swaps so the batch can clear first.
    /// @dev Must go false on the refund timeout, otherwise a failed settle bricks the pool.
    function blocksSwaps() public view returns (bool) {
        if (_settled || _refunded) return false;
        if (block.timestamp < openTime - auctionLead) return false;
        if (block.timestamp >= openTime + settleTimeout) return false;
        return true;
    }

    /// @notice Escrow one order. The input token is pulled immediately.
    function submitOrder(bool zeroForOne, uint128 amountIn, uint160 limitSqrtPriceX96) external {
        if (stage() != uint8(Stage.OPEN)) revert AuctionNotOpen();
        if (amountIn < (zeroForOne ? minOrderSize0 : minOrderSize1)) revert OrderTooSmall();
        if (_orders.length >= maxOrders) revert BookFull();

        address inToken = zeroForOne ? token0 : token1;
        IERC20(inToken).safeTransferFrom(msg.sender, address(this), amountIn);

        _orders.push(
            Order({
                owner: msg.sender,
                zeroForOne: zeroForOne,
                amountIn: amountIn,
                limitSqrtPriceX96: limitSqrtPriceX96,
                gone: false
            })
        );
    }

    /// @notice Withdraw an order any time before the cutoff.
    function cancelOrder(uint32 id) external {
        if (block.timestamp >= openTime) revert AuctionNotOpen();
        Order storage o = _orders[id];
        if (o.owner != msg.sender) revert NotOrderOwner();
        if (o.gone) revert OrderAlreadyGone();
        o.gone = true;
        IERC20(o.zeroForOne ? token0 : token1).safeTransfer(o.owner, o.amountIn);
    }

    /// @notice Clear the batch at one uniform price and route only the residual to the pool.
    /// @dev Permissionless: the caller proposes one price and every constraint is re-checked here, so
    ///      a bad proposal reverts instead of moving funds.
    function settle(uint160 clearingSqrtPriceX96_) external {
        if (block.timestamp < openTime) revert AuctionNotSettleable();
        if (_settled) revert AlreadySettled();
        if (_refunded) revert AlreadyRefunded();
        if (_orders.length == 0) revert NothingToSettle();

        uint256 supplyBase; // base offered by sellers (zeroForOne == false)
        uint256 demandBase; // base wanted by buyers (zeroForOne == true), converted at P*

        for (uint256 i; i < _orders.length; ++i) {
            Order memory o = _orders[i];
            if (o.gone) continue;
            if (!AuctionClearing.sellLimitOk(o.zeroForOne, o.limitSqrtPriceX96, clearingSqrtPriceX96_)) {
                revert LimitViolated();
            }
            if (o.zeroForOne) {
                demandBase += AuctionClearing.baseForQuote(o.amountIn, clearingSqrtPriceX96_, true);
            } else {
                supplyBase += o.amountIn;
            }
        }

        uint256 residual = demandBase >= supplyBase ? demandBase - supplyBase : supplyBase - demandBase;
        if (residual > residualCap) revert ResidualTooLarge();

        if (residual > 0) {
            if (demandBase >= supplyBase) {
                // Pay quote (token0) to receive base (token1): token0 in, token1 out.
                uint128 quoteIn = uint128(AuctionClearing.quoteForBase(residual, clearingSqrtPriceX96_, true));
                IERC20(token0).forceApprove(adapter, quoteIn);
                IAuctionResidualAdapter(adapter).swapExactInput(
                    true, quoteIn, uint128(residual), block.timestamp + 300
                );
            } else {
                // Give base (token1) to receive quote (token0): token1 in, token0 out. The output
                // floor is what the sellers are owed at P*; without it the pool could return too
                // little quote and the final seller claim would come up short.
                uint256 owed = AuctionClearing.quoteForBase(residual, clearingSqrtPriceX96_, true);
                uint128 minQuoteOut = uint128((owed * (10_000 - PRICE_TOLERANCE_BPS)) / 10_000);
                IERC20(token1).forceApprove(adapter, residual);
                IAuctionResidualAdapter(adapter).swapExactInput(
                    false, uint128(residual), minQuoteOut, block.timestamp + 300
                );
            }
        }

        // Unconditional: the clearing price must be the pool's own price whether or not a residual
        // traded. A residual-sized check alone would let the solver pick any price on a book that
        // happens to net exactly.
        _requirePriceOk(clearingSqrtPriceX96_, IAuctionResidualAdapter(adapter).poolSqrtPriceX96());

        _clearingSqrtPriceX96 = clearingSqrtPriceX96_;

        // The netting identity: buyers receive exactly baseForQuote(their quote, P*) and sellers
        // receive exactly quoteForBase(their base, P*). The pool leg cancels the difference, so
        // neither side takes a haircut and the escrow balances in both residual directions.
        for (uint256 i; i < _orders.length; ++i) {
            Order memory o = _orders[i];
            if (o.gone) {
                _payouts.push(Payout(0, 0, false));
                continue;
            }
            if (o.zeroForOne) {
                uint128 baseOut = uint128(AuctionClearing.baseForQuote(o.amountIn, clearingSqrtPriceX96_, true));
                _payouts.push(Payout(baseOut, 0, true));
            } else {
                uint128 quoteOut = uint128(AuctionClearing.quoteForBase(o.amountIn, clearingSqrtPriceX96_, true));
                _payouts.push(Payout(0, quoteOut, true));
            }
        }
        _settled = true;
    }

    /// @notice Open the refund path once settle() has missed its window.
    /// @dev Deliberately permissionless and independent of any pause controller.
    function refund() external {
        if (_settled) revert AlreadySettled();
        if (block.timestamp < openTime + settleTimeout) revert RefundNotOpen();
        _refunded = true;
    }

    /// @notice Withdraw the base a buy order was filled for.
    function claimBase(uint32 id) external {
        if (!_settled) revert NotSettled();
        Payout storage p = _payouts[id];
        if (!p.claimable || p.baseOut == 0) revert NotClaimable();
        uint128 amount = p.baseOut;
        p.baseOut = 0;
        p.claimable = false;
        IERC20(token1).safeTransfer(_orders[id].owner, amount);
    }

    /// @notice Withdraw the quote a sell order was filled for.
    function claimQuote(uint32 id) external {
        if (!_settled) revert NotSettled();
        Payout storage p = _payouts[id];
        if (!p.claimable || p.quoteOut == 0) revert NotClaimable();
        uint128 amount = p.quoteOut;
        p.quoteOut = 0;
        p.claimable = false;
        IERC20(token0).safeTransfer(_orders[id].owner, amount);
    }

    /// @notice Return an escrowed order in full once the refund window is open.
    /// @dev Permissionless: the funds always go to `owner`, so a third party can only help.
    function claimRefund(uint32 id) public {
        if (!_refunded) revert RefundNotOpen();
        Order storage o = _orders[id];
        if (o.gone) revert OrderAlreadyGone();
        o.gone = true;
        IERC20(o.zeroForOne ? token0 : token1).safeTransfer(o.owner, o.amountIn);
    }

    /// @notice Convenience batch over `claimRefund`.
    function claimRefundAll(uint32[] calldata ids) external {
        for (uint256 i; i < ids.length; ++i) {
            claimRefund(ids[i]);
        }
    }

    function _requirePriceOk(uint160 clearing, uint160 observed) private pure {
        uint256 lo = (uint256(clearing) * (10_000 - PRICE_TOLERANCE_BPS)) / 10_000;
        uint256 hi = (uint256(clearing) * (10_000 + PRICE_TOLERANCE_BPS)) / 10_000;
        if (uint256(observed) < lo || uint256(observed) > hi) revert ClearingPriceMismatch();
    }
}
