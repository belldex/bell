// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICalendarRegistry} from "../interfaces/IBellProtocol.sol";
import {CalendarLeaf} from "../types/ProtocolTypes.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

interface IAuctionHookPolicy {
    struct View {
        bool canSwap;
        uint8 mode;
        uint8 phase;
        uint16 flags;
        uint256 reasonBits;
        uint24 lpFeeUnits;
        uint16 bandBps;
        uint128[2] a;
        uint128[2] b;
        uint128[2] c;
        uint128[2] d;
        uint128[2] e;
        uint64 f;
        uint64 g;
        bytes32 h;
        bytes32 i;
    }
    function getPolicy() external view returns (View memory);
}

/// @title BellOpeningAuction
/// @notice Reusable per-pool, P2P-only opening auction with uniform-price clearing.
/// @dev One contract serves all CLOSED -> PRE/OVERNIGHT cycles. Every cycle is tied to adjacent,
///      currently-active CalendarRegistry leaves. The contract never calls PoolManager, BellRouter,
///      an oracle, or an external solver; it computes the maximum-volume clearing price itself.
///      Token orientation is semantic and explicit: quoteToken is USDG, baseToken is the stock.
contract BellOpeningAuction {
    using SafeERC20 for IERC20;

    enum Stage { IDLE, ARMED, OPEN, LOCKED, SETTLED, REFUNDED }

    struct Order {
        address owner;
        uint128 amountIn;
        uint160 limitPriceX96; // quote raw units per base raw unit, scaled by 2^96
        uint64 cycleId;
        bool isBuyer;
        bool cancelled;
        bool claimed;
    }

    struct Allocation {
        uint128 baseFill;
        uint128 quotePayout;
    }

    error UnauthorizedFactory();
    error BadConfig();
    error BadCalendarTransition();
    error AuctionNotOpen();
    error OrderTooSmall();
    error BookFull();
    error NotOrderOwner();
    error AlreadyCancelled();
    error AlreadyClaimed();
    error NotFinalized();
    error NothingToSettle();
    error AlreadyFinalized();
    error NoMatchingOrders();
    error InvalidLimit();
    error EscrowInvariant();
    error RefundNotOpen();
    error PolicyHalted();
    error ReentrantCall();

    uint256 private constant Q96 = 1 << 96;
    uint8 private constant PHASE_PRE = 1;
    uint8 private constant PHASE_OVERNIGHT = 4;
    uint8 private constant PHASE_CLOSED = 5;

    address public immutable factory;
    address public immutable hook;
    address public immutable calendarRegistry;
    bytes32 public immutable assetId;
    address public immutable quoteToken;
    address public immutable baseToken;
    uint32 public immutable auctionLead;
    uint32 public immutable settleTimeout;
    uint32 public immutable auctionMaximumCycles;
    uint128 public immutable minOrderSizeQuote;
    uint128 public immutable minOrderSizeBase;
    uint8 public immutable maxOrders;

    uint64 public cycleId;
    uint64 public openTime;
    uint64 public cycleDeadline;
    uint8 public stage;
    bytes32 public closedLeafHash;
    bytes32 public openLeafHash;
    bytes32 public lastArmedTransitionHash;
    uint160 public clearingPriceX96;
    bool private _entered;

    Order[] private _orders;
    mapping(uint64 cycle => uint32[] orderIds) private _cycleOrders;
    mapping(uint64 cycle => uint64) public cycleOpenTimeById;
    mapping(uint64 cycle => uint160) public cycleClearingPriceById;
    mapping(uint64 cycle => uint128) public cycleMatchedBaseById;
    mapping(uint64 cycle => mapping(uint32 orderId => Allocation)) private _allocations;
    mapping(uint64 cycle => mapping(uint32 orderId => uint128)) private _quoteRefunds;
    mapping(uint64 cycle => uint128) public quoteEscrowByCycle;
    mapping(uint64 cycle => uint128) public baseEscrowByCycle;
    mapping(uint64 cycle => bool) private _finalized;
    mapping(uint64 cycle => bool) private _refunded;
    mapping(uint64 cycle => uint64) public cycleDeadlineById;

    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    event CycleArmed(uint64 indexed cycleId, uint64 openTime, bytes32 closedLeafHash, bytes32 openLeafHash);
    event OrderSubmitted(uint64 indexed cycleId, uint32 indexed orderId, address indexed owner, bool isBuyer, uint128 amountIn, uint160 limitPriceX96);
    event OrderCancelled(uint64 indexed cycleId, uint32 indexed orderId, address indexed owner);
    event CycleSettled(uint64 indexed cycleId, uint160 clearingPriceX96, uint128 matchedBase, uint32 filledOrders);
    event CycleRefunded(uint64 indexed cycleId);
    event UnfilledClaimed(uint64 indexed cycleId, uint32 indexed orderId, address indexed owner, uint128 quoteRefund, uint128 baseRefund);

    constructor(
        address factory_,
        address hook_,
        address calendarRegistry_,
        bytes32 assetId_,
        address quoteToken_,
        address baseToken_,
        uint32 auctionLead_,
        uint32 settleTimeout_,
        uint32 auctionMaximumCycles_,
        uint128 minOrderSizeQuote_,
        uint128 minOrderSizeBase_,
        uint8 maxOrders_
    ) {
        if (
            factory_ == address(0) || hook_ == address(0) || calendarRegistry_.code.length == 0
                || assetId_ == bytes32(0) || quoteToken_.code.length == 0 || baseToken_.code.length == 0
                || quoteToken_ == baseToken_ || auctionLead_ == 0 || settleTimeout_ == 0 || auctionMaximumCycles_ == 0
                || minOrderSizeQuote_ == 0 || minOrderSizeBase_ == 0 || maxOrders_ == 0 || maxOrders_ > 25
        ) revert BadConfig();
        factory = factory_;
        hook = hook_;
        calendarRegistry = calendarRegistry_;
        assetId = assetId_;
        quoteToken = quoteToken_;
        baseToken = baseToken_;
        auctionLead = auctionLead_;
        settleTimeout = settleTimeout_;
        auctionMaximumCycles = auctionMaximumCycles_;
        minOrderSizeQuote = minOrderSizeQuote_;
        minOrderSizeBase = minOrderSizeBase_;
        maxOrders = maxOrders_;
    }

    /// @notice Arm the next CLOSED -> PRE/OVERNIGHT cycle after validating both adjacent leaves.
    function armNext() external nonReentrant returns (bool armed) {
        CalendarLeaf memory current = ICalendarRegistry(calendarRegistry).currentInterval(assetId);
        CalendarLeaf memory next = ICalendarRegistry(calendarRegistry).nextInterval(assetId);
        if (
            current.phase != PHASE_CLOSED || current.end != next.start
                || (next.phase != PHASE_PRE && next.phase != PHASE_OVERNIGHT)
                || block.timestamp < current.start || block.timestamp >= current.end
        ) return false;
        bytes32 transitionHash = keccak256(abi.encode(_hashLeaf(current), _hashLeaf(next)));
        if (transitionHash == lastArmedTransitionHash) return false;
        if (cycleId >= auctionMaximumCycles) return false;
        if (cycleId != 0 && !_finalized[cycleId]) {
            if (block.timestamp < cycleDeadlineById[cycleId]) return false;
            _refunded[cycleId] = true;
            _finalized[cycleId] = true;
            emit CycleRefunded(cycleId);
        }
        if (next.start <= block.timestamp) return false;

        cycleId += 1;
        openTime = next.start;
        cycleOpenTimeById[cycleId] = next.start;
        cycleDeadline = next.start + settleTimeout;
        cycleDeadlineById[cycleId] = next.start + settleTimeout;
        closedLeafHash = _hashLeaf(current);
        openLeafHash = _hashLeaf(next);
        lastArmedTransitionHash = transitionHash;
        clearingPriceX96 = 0;
        stage = uint8(Stage.ARMED);
        emit CycleArmed(cycleId, openTime, closedLeafHash, openLeafHash);
        return true;
    }

    /// @notice Current cycle stage, projected from timestamp and the stored calendar boundary.
    function currentStage() public view returns (uint8) {
        if (cycleId == 0 || stage == uint8(Stage.IDLE)) return uint8(Stage.IDLE);
        if (_finalized[cycleId]) return _refunded[cycleId] ? uint8(Stage.REFUNDED) : uint8(Stage.SETTLED);
        if (block.timestamp < openTime - auctionLead) return uint8(Stage.ARMED);
        if (block.timestamp < openTime) return uint8(Stage.OPEN);
        if (block.timestamp < cycleDeadline) return uint8(Stage.LOCKED);
        return uint8(Stage.REFUNDED);
    }

    /// @notice Stored status for prior cycles so users can reach claims after the auction rolls over.
    function cycleSummary(uint64 cycle) external view returns (
        uint64 cycleOpenTime, uint64 deadline, uint8 cycleStage, uint160 priceX96, uint128 matchedBase, bool finalized
    ) {
        cycleOpenTime = cycleOpenTimeById[cycle];
        deadline = cycleDeadlineById[cycle];
        finalized = _finalized[cycle];
        if (_refunded[cycle] || (!finalized && cycle != 0 && block.timestamp >= deadline)) cycleStage = uint8(Stage.REFUNDED);
        else if (finalized) cycleStage = uint8(Stage.SETTLED);
        else if (cycle == cycleId) cycleStage = currentStage();
        else cycleStage = uint8(Stage.IDLE);
        if (cycle == cycleId) priceX96 = clearingPriceX96;
        else priceX96 = cycleClearingPriceById[cycle];
        matchedBase = cycleMatchedBaseById[cycle];
    }

    /// @notice True while ordinary pool swaps/add-liquidity must be blocked for this cycle.
    function blocksSwaps() external view returns (bool) {
        uint8 s = currentStage();
        return s == uint8(Stage.OPEN) || s == uint8(Stage.LOCKED);
    }

    /// @notice Number of order records for the current cycle.
    function orderCount() external view returns (uint32) { return uint32(_cycleOrders[cycleId].length); }

    /// @notice Number of order ids in a cycle, including cancelled entries.
    function cycleOrderCount(uint64 cycle) external view returns (uint32) { return uint32(_cycleOrders[cycle].length); }

    /// @notice Stable global order id at a cycle-local order index.
    function cycleOrderId(uint64 cycle, uint32 index) external view returns (uint32) {
        return _cycleOrders[cycle][index];
    }

    /// @notice Total number of order records ever created; IDs are stable across cycles.
    function totalOrderCount() external view returns (uint32) { return uint32(_orders.length); }

    /// @notice Read one stable order record.
    function order(uint32 id) external view returns (Order memory) { return _orders[id]; }

    /// @notice Read one order's P2P allocation and quote refund.
    function allocation(uint64 cycle, uint32 id) external view returns (uint128 baseFill, uint128 quotePayout, uint128 quoteRefund) {
        Allocation memory a = _allocations[cycle][id];
        return (a.baseFill, a.quotePayout, _quoteRefunds[cycle][id]);
    }

    /// @notice Indicative maximum-volume price and base volume for the current order book.
    /// @dev Read-only preview only; `settle()` recomputes the result from storage immediately before
    ///      writing, so this view can never authorize an execution.
    function indicativeClearing() external view returns (uint160 priceX96, uint128 matchedBase) {
        uint32[] storage ids = _cycleOrders[cycleId];
        priceX96 = _maximumVolumePrice(ids);
        if (priceX96 != 0) matchedBase = _matchedBase(ids, priceX96);
    }


    /// @notice Submit a quote-funded buy order, or a base-funded sell order.
    function submitOrder(bool isBuyer, uint128 amountIn, uint160 limitPriceX96) external nonReentrant returns (uint32 id) {
        if (currentStage() != uint8(Stage.OPEN)) revert AuctionNotOpen();
        if (limitPriceX96 == 0) revert InvalidLimit();
        uint128 minimum = isBuyer ? minOrderSizeQuote : minOrderSizeBase;
        if (amountIn < minimum) revert OrderTooSmall();
        if (_cycleOrders[cycleId].length >= maxOrders) revert BookFull();
        address input = isBuyer ? quoteToken : baseToken;
        uint128 alreadyEscrowed = isBuyer ? quoteEscrowByCycle[cycleId] : baseEscrowByCycle[cycleId];
        if (amountIn > type(uint128).max - alreadyEscrowed) revert BookFull();
        IERC20(input).safeTransferFrom(msg.sender, address(this), amountIn);
        if (isBuyer) quoteEscrowByCycle[cycleId] = alreadyEscrowed + amountIn;
        else baseEscrowByCycle[cycleId] = alreadyEscrowed + amountIn;
        id = uint32(_orders.length);
        _orders.push(Order(msg.sender, amountIn, limitPriceX96, cycleId, isBuyer, false, false));
        _cycleOrders[cycleId].push(id);
        emit OrderSubmitted(cycleId, id, msg.sender, isBuyer, amountIn, limitPriceX96);
    }

    /// @notice Cancel an owned order before the open cutoff.
    function cancelOrder(uint32 id) external nonReentrant {
        Order storage o = _orders[id];
        if (o.owner != msg.sender) revert NotOrderOwner();
        if (o.cancelled || o.claimed) revert AlreadyCancelled();
        if (o.cycleId != cycleId || currentStage() != uint8(Stage.OPEN)) revert AuctionNotOpen();
        o.cancelled = true;
        if (o.isBuyer) quoteEscrowByCycle[cycleId] -= o.amountIn;
        else baseEscrowByCycle[cycleId] -= o.amountIn;
        IERC20(o.isBuyer ? quoteToken : baseToken).safeTransfer(o.owner, o.amountIn);
        emit OrderCancelled(cycleId, id, o.owner);
    }

    /// @notice Clear the current cycle at the deterministic maximum-volume uniform price.
    function settle() external nonReentrant {
        uint64 cycle = cycleId;
        if (currentStage() != uint8(Stage.LOCKED)) revert AuctionNotOpen();
        if (_finalized[cycle]) revert AlreadyFinalized();
        IAuctionHookPolicy.View memory policy = IAuctionHookPolicy(hook).getPolicy();
        if (!policy.canSwap) revert PolicyHalted();
        uint32[] storage ids = _cycleOrders[cycle];
        if (ids.length == 0) {
            _finalize(cycle, 0, 0);
            return;
        }

        uint160 price = _maximumVolumePrice(ids);
        if (price == 0) {
            // No two-sided volume: close the cycle with every order refundable, never route one side
            // into the AMM as a disguised market order.
            _setFullQuoteRefunds(cycle, ids);
            _finalize(cycle, 0, 0);
            return;
        }

        uint128 matchedBase = _matchedBase(ids, price);
        if (matchedBase == 0) {
            _setFullQuoteRefunds(cycle, ids);
            _finalize(cycle, 0, 0);
            return;
        }
        _allocate(ids, price, matchedBase);
        clearingPriceX96 = price;
        _finalize(cycle, price, matchedBase);
    }

    /// @notice Permissionlessly claim an order's fill and unfilled input after settlement/refund.
    function claimUnfilled(uint64 cycle, uint32 id) external nonReentrant {
        Order storage o = _orders[id];
        if (o.owner == address(0) || o.cycleId != cycle || o.cancelled || o.claimed) revert AlreadyClaimed();
        if (!_finalized[cycle] && block.timestamp < cycleDeadlineById[cycle]) revert NotFinalized();
        if (!_finalized[cycle] && block.timestamp >= cycleDeadlineById[cycle]) {
            _refunded[cycle] = true;
            _finalized[cycle] = true;
            if (cycle == cycleId) stage = uint8(Stage.REFUNDED);
            emit CycleRefunded(cycle);
        }
        o.claimed = true;

        uint128 baseRefund;
        uint128 quoteRefund = _quoteRefunds[cycle][id];
        Allocation memory a = _allocations[cycle][id];
        if (_refunded[cycle]) {
            if (o.isBuyer) quoteRefund = o.amountIn;
            else baseRefund = o.amountIn;
        } else if (o.isBuyer) {
            quoteRefund = _quoteRefunds[cycle][id];
            if (a.baseFill != 0) IERC20(baseToken).safeTransfer(o.owner, a.baseFill);
        } else {
            baseRefund = o.amountIn - a.baseFill;
            if (a.quotePayout != 0) IERC20(quoteToken).safeTransfer(o.owner, a.quotePayout);
        }
        if (quoteRefund != 0) {
            quoteEscrowByCycle[cycle] -= quoteRefund;
            IERC20(quoteToken).safeTransfer(o.owner, quoteRefund);
        }
        if (baseRefund != 0) {
            baseEscrowByCycle[cycle] -= baseRefund;
            IERC20(baseToken).safeTransfer(o.owner, baseRefund);
        }
        emit UnfilledClaimed(cycle, id, o.owner, quoteRefund, baseRefund);
    }

    /// @notice Open permissionless full refunds after the settle timeout.
    function refund() external nonReentrant {
        uint64 cycle = cycleId;
        if (cycle == 0 || _finalized[cycle]) revert AlreadyFinalized();
        if (block.timestamp < cycleDeadlineById[cycle]) revert RefundNotOpen();
        _refunded[cycle] = true;
        _finalized[cycle] = true;
        stage = uint8(Stage.REFUNDED);
        emit CycleRefunded(cycle);
    }

    function _maximumVolumePrice(uint32[] storage ids) private view returns (uint160 best) {
        uint256 bestVolume;
        for (uint256 i; i < ids.length; ++i) {
            Order storage candidate = _orders[ids[i]];
            if (candidate.cancelled) continue;
            uint160 price = candidate.limitPriceX96;
            (uint256 demand, uint256 supply) = _volumesAt(ids, price);
            uint256 volume = demand < supply ? demand : supply;
            if (volume > bestVolume || (volume == bestVolume && volume != 0 && (best == 0 || price < best))) {
                bestVolume = volume;
                best = price;
            }
        }
    }

    function _volumesAt(uint32[] storage ids, uint160 price) private view returns (uint256 demand, uint256 supply) {
        for (uint256 i; i < ids.length; ++i) {
            Order storage o = _orders[ids[i]];
            if (o.cancelled) continue;
            if (o.isBuyer && o.limitPriceX96 >= price) demand += _baseFromQuote(o.amountIn, price);
            if (!o.isBuyer && o.limitPriceX96 <= price) supply += o.amountIn;
        }
    }

    function _matchedBase(uint32[] storage ids, uint160 price) private view returns (uint128 matched) {
        (uint256 demand, uint256 supply) = _volumesAt(ids, price);
        uint256 volume = demand < supply ? demand : supply;
        if (volume > type(uint128).max) revert BadConfig();
        matched = uint128(volume);
    }

    function _allocate(uint32[] storage ids, uint160 price, uint128 matchedBase) private {
        // Price priority + FIFO: buyers with highest caps first, sellers with lowest floors first.
        // n <= 25, so deterministic insertion sort is bounded and easily gas-benchmarked.
        uint32[] memory buyers = new uint32[](ids.length);
        uint32[] memory sellers = new uint32[](ids.length);
        uint256 buyerCount;
        uint256 sellerCount;
        for (uint256 i; i < ids.length; ++i) {
            uint32 id = ids[i];
            Order storage o = _orders[id];
            if (o.cancelled) continue;
            if (o.isBuyer && o.limitPriceX96 >= price) buyers[buyerCount++] = id;
            if (!o.isBuyer && o.limitPriceX96 <= price) sellers[sellerCount++] = id;
        }
        _sort(buyers, buyerCount, true);
        _sort(sellers, sellerCount, false);

        uint128 remainingBuyer = matchedBase;
        uint128 remainingSeller = matchedBase;
        for (uint256 i; i < buyerCount && remainingBuyer != 0; ++i) {
            uint32 id = buyers[i];
            Order storage o = _orders[id];
            uint256 capacity = _baseFromQuote(o.amountIn, price);
            uint128 fill = capacity < remainingBuyer ? uint128(capacity) : remainingBuyer;
            _allocations[cycleId][id].baseFill = fill;
            remainingBuyer -= fill;
        }
        for (uint256 i; i < sellerCount && remainingSeller != 0; ++i) {
            uint32 id = sellers[i];
            Order storage o = _orders[id];
            uint128 fill = o.amountIn < remainingSeller ? o.amountIn : remainingSeller;
            _allocations[cycleId][id].baseFill = fill;
            remainingSeller -= fill;
        }
        if (remainingBuyer != 0 || remainingSeller != 0) revert EscrowInvariant();

        uint256 totalQuote;
        for (uint256 i; i < buyerCount; ++i) {
            uint32 id = buyers[i];
            uint128 fill = _allocations[cycleId][id].baseFill;
            if (fill == 0) continue;
            uint128 spent = uint128(FullMath.mulDivRoundingUp(fill, price, Q96));
            totalQuote += spent;
            _quoteRefunds[cycleId][id] = _orders[id].amountIn - spent;
        }
        if (totalQuote > type(uint128).max) revert EscrowInvariant();
        _assignSellerQuote(sellers, sellerCount, matchedBase, totalQuote);
        _refundUnfilledBuyers(ids);
    }

    /// @dev A buyer that received no fill (limit below the clearing price, or crowded out by price
    ///      priority) is owed its whole escrow back. Without this its quote would be stranded.
    function _refundUnfilledBuyers(uint32[] storage ids) private {
        for (uint256 i; i < ids.length; ++i) {
            uint32 id = ids[i];
            Order storage o = _orders[id];
            if (o.cancelled || !o.isBuyer) continue;
            if (_allocations[cycleId][id].baseFill == 0) _quoteRefunds[cycleId][id] = o.amountIn;
        }
    }

    function _assignSellerQuote(uint32[] memory sellers, uint256 sellerCount, uint128 matchedBase, uint256 totalQuote)
        private
    {
        uint256 assignedQuote;
        for (uint256 i; i < sellerCount; ++i) {
            uint32 id = sellers[i];
            uint128 fill = _allocations[cycleId][id].baseFill;
            if (fill == 0) continue;
            uint256 payout = FullMath.mulDiv(totalQuote, fill, matchedBase);
            _allocations[cycleId][id].quotePayout = uint128(payout);
            assignedQuote += payout;
        }
        uint256 remainder = totalQuote - assignedQuote;
        for (uint256 i; i < sellerCount && remainder != 0; ++i) {
            uint32 id = sellers[i];
            if (_allocations[cycleId][id].baseFill == 0) continue;
            _allocations[cycleId][id].quotePayout += 1;
            remainder -= 1;
        }
        if (remainder != 0) revert EscrowInvariant();
    }

    function _setFullQuoteRefunds(uint64 cycle, uint32[] storage ids) private {
        for (uint256 i; i < ids.length; ++i) {
            uint32 id = ids[i];
            Order storage o = _orders[id];
            if (!o.cancelled && o.isBuyer) _quoteRefunds[cycle][id] = o.amountIn;
        }
    }

    function _sort(uint32[] memory ids, uint256 count, bool buyers) private view {
        for (uint256 i = 1; i < count; ++i) {
            uint32 current = ids[i];
            uint256 j = i;
            while (j != 0 && _before(current, ids[j - 1], buyers)) {
                ids[j] = ids[j - 1];
                unchecked { --j; }
            }
            ids[j] = current;
        }
    }

    function _before(uint32 a, uint32 b, bool buyers) private view returns (bool) {
        uint160 pa = _orders[a].limitPriceX96;
        uint160 pb = _orders[b].limitPriceX96;
        if (pa == pb) return a < b;
        return buyers ? pa > pb : pa < pb;
    }

    function _baseFromQuote(uint128 quote, uint160 price) private pure returns (uint256) {
        return FullMath.mulDiv(quote, Q96, price);
    }

    function _quoteSpent(uint32[] storage, uint32, uint128, uint128 baseFill, uint160 price) private pure returns (uint128) {
        return uint128(FullMath.mulDivRoundingUp(baseFill, price, Q96));
    }

    function _finalize(uint64 cycle, uint160 price, uint128 matchedBase) private {
        _finalized[cycle] = true;
        _refunded[cycle] = false;
        cycleClearingPriceById[cycle] = price;
        cycleMatchedBaseById[cycle] = matchedBase;
        clearingPriceX96 = price;
        stage = uint8(Stage.SETTLED);
        emit CycleSettled(cycle, price, matchedBase, uint32(_cycleOrders[cycle].length));
    }

    function _hashLeaf(CalendarLeaf memory leaf) private pure returns (bytes32) {
        return keccak256(abi.encode(leaf.assetId, leaf.year, leaf.index, leaf.start, leaf.end, leaf.phase, leaf.provenanceHash));
    }
}
