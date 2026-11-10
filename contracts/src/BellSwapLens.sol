// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IBellSwapLens} from "./interfaces/IBellSwapLens.sol";
import {IBellErrors} from "./interfaces/ProtocolEvents.sol";
import {ICalendarRegistry, IAssetRegistry} from "./interfaces/IBellProtocol.sol";
import {BellHook} from "./BellHook.sol";
import {BellHookV2} from "./BellHookV2.sol";
import {BellPolicyOracle} from "./BellPolicyOracle.sol";
import {BellModeEvaluator} from "./BellModeEvaluator.sol";
import {BellAuctionRegistry} from "./auction/BellAuctionRegistry.sol";
import {BellOpeningAuction} from "./auction/BellOpeningAuction.sol";
import {IBellSwapEvaluator} from "./types/SwapEvaluation.sol";
import {PoolConfig, PoolState, PolicyView, Buckets, CalendarLeaf, AssetDescriptor} from "./types/ProtocolTypes.sol";
import {FlowBudget} from "./libraries/FlowBudget.sol";
import {FeePolicy} from "./libraries/FeePolicy.sol";
import {WidePriceMath} from "./libraries/WidePriceMath.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TickBitmap} from "@uniswap/v4-core/src/libraries/TickBitmap.sol";
import {BitMath} from "@uniswap/v4-core/src/libraries/BitMath.sol";
import {SwapMath} from "@uniswap/v4-core/src/libraries/SwapMath.sol";
import {LiquidityMath} from "@uniswap/v4-core/src/libraries/LiquidityMath.sol";
import {ProtocolFeeLibrary} from "@uniswap/v4-core/src/libraries/ProtocolFeeLibrary.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {Pool} from "@uniswap/v4-core/src/libraries/Pool.sol";

/// @notice Ownerless, non-proxy, storage-free exact-input reader for one immutable BELL pool.
/// @dev PoolManager cannot reverse poolId into a PoolKey and the existing factory has no pool directory.
/// Deploy one lens per hook and publish the poolId-to-lens binding in the deployment manifest/indexer.
contract BellSwapLens is IBellSwapLens {
    using StateLibrary for IPoolManager;
    using SafeCast for uint256;
    using SafeCast for int256;

    error InvalidHook();
    error QuoteStepLimit();

    BellHook public immutable boundHook;
    bytes32 public immutable boundPoolId;
    // BellHook pins spacing 60. The entire tick domain contains fewer than 30,000 usable ticks
    // plus bitmap word boundaries, so this finite bound permits every canonical traversal.
    uint256 private constant MAX_QUOTE_STEPS = 32768;
    bytes32 private constant QUOTE_HASH = keccak256("BELL_SWAP_LENS");

    constructor(address hook_) {
        if (hook_.code.length == 0) revert InvalidHook();
        boundHook = BellHook(hook_);
        boundPoolId = BellHook(hook_).poolId();
        if (boundPoolId == bytes32(0)) revert InvalidHook();
    }

    function getPoolInfo(bytes32 poolId)
        public
        view
        returns (address hook, uint16 hookFlags, bool hasAuction, address auction)
    {
        if (poolId != boundPoolId) return (address(0), 0, false, address(0));
        hook = address(boundHook);
        hookFlags = uint16(uint160(hook) & 0x3fff);
        address registry = _auctionRegistry();
        if (registry != address(0)) auction = BellAuctionRegistry(registry).auctionFor(poolId);
        hasAuction = auction != address(0);
    }

    function getSwapStatus(bytes32 poolId, bool zeroForOne, uint256 amountIn)
        external
        view
        returns (SwapStatus memory status)
    {
        if (poolId != boundPoolId) {
            status.reason = PoolNotBound.selector;
            return status;
        }
        PoolConfig memory config = boundHook.config();
        PolicyView memory policy = boundHook.getPolicy();
        status.session = policy.phase;
        status.nextTransition = _nextTransition(config);
        status.currentFeePips = _fee(policy, boundHook.state(), config);
        (,,, address auction) = getPoolInfo(poolId);
        bool auctionBlocks;
        if (auction != address(0)) {
            status.auctionWindow = BellOpeningAuction(auction).currentStage() == uint8(BellOpeningAuction.Stage.OPEN);
            auctionBlocks = BellAuctionRegistry(_auctionRegistry()).blocksSwaps(poolId);
        }

        // Prepare through the same immutable oracle/evaluator as beforeSwap. A positive probe also
        // supplies fee and budgets for zero/oversized amount requests without changing policy precedence.
        uint256 probe = amountIn == 0 || amountIn > uint256(type(int256).max) ? 1 : amountIn;
        try this.prepareQuote(zeroForOne, probe) returns (IBellSwapEvaluator.Snapshot memory snapshot) {
            status.currentFeePips = snapshot.lpFeeUnits;
            (status.maxIn0, status.maxIn1) = _remaining(snapshot);
            if (auctionBlocks) {
                status.reason = BellHookV2.AuctionActive.selector;
            } else if (amountIn == 0 || amountIn > uint256(type(int256).max)) {
                status.reason = BellModeEvaluator.InvalidSwapContext.selector;
            } else {
                try this.checkQuote(snapshot) {
                    status.allowed = true;
                } catch (bytes memory reason) {
                    status.reason = bytes4(reason);
                }
            }
        } catch (bytes memory reason) {
            status.reason = auctionBlocks ? BellHookV2.AuctionActive.selector : bytes4(reason);
        }
        // Core rejects zero before initialization or any hook callback, including the auction guard.
        if (amountIn == 0) {
            status.allowed = false;
            status.reason = IPoolManager.SwapAmountCannotBeZero.selector;
        }
    }

    /// @dev External view helpers permit catching canonical evaluator errors without any state writes.
    function prepareQuote(bool direction, uint256 amount) external view returns (IBellSwapEvaluator.Snapshot memory) {
        PoolConfig memory c = boundHook.config();
        PoolState memory state = boundHook.state();
        BellPolicyOracle.Input memory input;
        input.configHash = boundHook.configHash();
        input.poolId = boundPoolId;
        input.hook = address(boundHook);
        input.token0 = c.token0;
        input.token1 = c.token1;
        input.asset0 = c.asset0;
        input.asset1 = c.asset1;
        input.assetRegistry = c.assetRegistry;
        input.calendarRegistry = c.calendarRegistry;
        input.safetyController = c.safetyController;
        input.sessionRegistry = boundHook.sessionRegistry();
        input.referenceAdapter0 = c.referenceAdapter0;
        input.referenceAdapter1 = c.referenceAdapter1;
        input.poolClass = c.poolClass;
        input.referenceMode = c.referenceMode;
        input.executionReady = true;
        input.nowTime = block.timestamp > type(uint64).max ? type(uint64).max : uint64(block.timestamp);
        input.bellStart = state.bellStart;
        input.corporateUntil = state.corporateUntil;
        input.tradeCap = c.tradeCap;
        input.windowCap = c.windowCap;
        input.closureCap = c.closureCap;
        input.state = state;
        (uint160 price,,,) = IPoolManager(c.poolManager).getSlot0(PoolId.wrap(boundPoolId));
        return boundHook.policyOracle()
            .prepareSwap(
                input,
                price,
                [_decimals(c.token0), _decimals(c.token1)],
                QUOTE_HASH,
                direction,
                -amount.toInt256(),
                address(boundHook.modeEvaluator())
            );
    }

    function checkQuote(IBellSwapEvaluator.Snapshot calldata snapshot) external view {
        (uint160 price, int128 delta0, int128 delta1) = _quote(snapshot);
        boundHook.modeEvaluator()
            .settle(
                snapshot,
                QUOTE_HASH,
                uint64(block.timestamp),
                price,
                delta0,
                delta1,
                boundHook.buckets(),
                boundHook.episodeGross(snapshot.context.closureNonce)
            );
    }

    function _remaining(IBellSwapEvaluator.Snapshot memory snapshot) private view returns (uint256 a, uint256 b) {
        Buckets memory buckets = FlowBudget.rollBuckets(boundHook.buckets(), snapshot.context.timestamp);
        uint128[2] memory episode = boundHook.episodeGross(snapshot.context.closureNonce);
        uint256[2] memory caps;
        for (uint256 i; i < 2; ++i) {
            uint256 used = uint256(buckets.currentGross[i]) + buckets.previousGross[i];
            uint256 window = snapshot.effectiveWindowCap[i];
            caps[i] = window > used ? window - used : 0;
            if (caps[i] > snapshot.effectiveTradeCap[i]) caps[i] = snapshot.effectiveTradeCap[i];
            if (snapshot.context.closedLatched) {
                uint256 closure =
                    snapshot.context.closureCap[i] > episode[i] ? snapshot.context.closureCap[i] - episode[i] : 0;
                if (caps[i] > closure) caps[i] = closure;
            }
        }
        return (caps[0], caps[1]);
    }

    function _auctionRegistry() private view returns (address registry) {
        // BellHook v1 has no auctionRegistry getter; v2 binds it immutably (including zero).
        (bool ok, bytes memory data) = address(boundHook).staticcall(abi.encodeWithSignature("auctionRegistry()"));
        if (ok && data.length == 32) registry = abi.decode(data, (address));
    }

    function _nextTransition(PoolConfig memory c) private view returns (uint64 next) {
        bytes32[2] memory assets = [c.asset0, c.asset1];
        for (uint256 i; i < 2; ++i) {
            // Non-stock legs have no exchange calendar and must not suppress the stock transition.
            try IAssetRegistry(c.assetRegistry).descriptor(assets[i]) returns (AssetDescriptor memory descriptor) {
                if (!descriptor.isStock) continue;
            } catch {
                return 0;
            }
            try ICalendarRegistry(c.calendarRegistry).currentInterval(assets[i]) returns (CalendarLeaf memory leaf) {
                if (leaf.assetId != assets[i] || leaf.start > block.timestamp || leaf.end <= block.timestamp) return 0;
                if (next == 0 || leaf.end < next) next = leaf.end;
            } catch {
                return 0;
            }
        }
    }

    function _fee(PolicyView memory p, PoolState memory state, PoolConfig memory c) private view returns (uint24) {
        if (p.phase == 0 || state.bellStart == 0 || state.bellStart > block.timestamp) return 0;
        uint24 base = p.phase == 2 ? 500 : p.phase == 1 || p.phase == 3 ? 3000 : p.phase == 4 ? 5000 : 10000;
        bool fallbackMode = (p.flags & 2) != 0;
        bool repricing;
        if (c.poolClass == 0 && !fallbackMode && p.referencePrice18[0] != 0 && p.referencePrice18[1] != 0) {
            (uint160 price,,,) = IPoolManager(c.poolManager).getSlot0(PoolId.wrap(boundPoolId));
            repricing = !WidePriceMath.isWithinPriceBand(
                price,
                p.referencePrice18[0],
                p.referencePrice18[1],
                _decimals(c.token0),
                _decimals(c.token1),
                p.mode == 2 ? 500 : 200
            );
        }
        return FeePolicy.effectiveLpFee(
            fallbackMode ? 10000 : base,
            uint64(block.timestamp - state.bellStart),
            state.corporateUntil > block.timestamp,
            repricing
        );
    }

    function _decimals(address token) private view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || data.length != 32) revert IBellErrors.BadConfig(keccak256("TOKENS"));
        uint256 value = abi.decode(data, (uint256));
        if (value > 18) revert IBellErrors.BadConfig(keccak256("TOKENS"));
        return uint8(value);
    }

    struct QuoteState {
        uint160 price;
        int24 tick;
        uint128 liquidity;
        int256 remaining;
        uint256 output;
    }

    /// @dev Read-only projection of pinned v4 Pool.swap, omitting fee-growth/storage writes.
    /// Uses core's exact rounding, bitmap traversal, tick liquidity and protocol-fee composition.
    function _quote(IBellSwapEvaluator.Snapshot calldata snapshot)
        private
        view
        returns (uint160 price, int128 delta0, int128 delta1)
    {
        PoolConfig memory c = boundHook.config();
        IPoolManager manager = IPoolManager(c.poolManager);
        PoolId pool = PoolId.wrap(boundPoolId);
        QuoteState memory q;
        uint24 protocol;
        (q.price, q.tick, protocol,) = manager.getSlot0(pool);
        q.liquidity = manager.getLiquidity(pool);
        q.remaining = snapshot.amountSpecified;
        bool direction = snapshot.zeroForOne;
        uint16 protocolFee =
            direction ? ProtocolFeeLibrary.getZeroForOneFee(protocol) : ProtocolFeeLibrary.getOneForZeroFee(protocol);
        uint24 fee = protocolFee == 0
            ? snapshot.lpFeeUnits
            : ProtocolFeeLibrary.calculateSwapFee(protocolFee, snapshot.lpFeeUnits);
        uint160 limit = direction ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        if (direction ? limit >= q.price : limit <= q.price) {
            revert Pool.PriceLimitAlreadyExceeded(q.price, limit);
        }
        uint256 steps;
        while (q.remaining != 0 && q.price != limit) {
            if (++steps > MAX_QUOTE_STEPS) revert QuoteStepLimit();
            (int24 next, bool initialized) = _nextTick(manager, pool, q.tick, c.tickSpacing, direction);
            if (next < TickMath.MIN_TICK) next = TickMath.MIN_TICK;
            if (next > TickMath.MAX_TICK) next = TickMath.MAX_TICK;
            uint160 nextPrice = TickMath.getSqrtPriceAtTick(next);
            uint160 oldPrice = q.price;
            uint256 input;
            uint256 output;
            uint256 feeAmount;
            (q.price, input, output, feeAmount) = SwapMath.computeSwapStep(
                q.price, SwapMath.getSqrtPriceTarget(direction, nextPrice, limit), q.liquidity, q.remaining, fee
            );
            q.remaining += (input + feeAmount).toInt256();
            q.output += output;
            if (q.price == nextPrice) {
                if (initialized) {
                    (, int128 net) = manager.getTickLiquidity(pool, next);
                    q.liquidity = LiquidityMath.addDelta(q.liquidity, direction ? -net : net);
                }
                q.tick = direction ? next - 1 : next;
            } else if (q.price != oldPrice) {
                q.tick = TickMath.getTickAtSqrtPrice(q.price);
            }
        }
        int128 spent = (snapshot.amountSpecified - q.remaining).toInt128();
        int128 received = q.output.toInt256().toInt128();
        return direction ? (q.price, spent, received) : (q.price, received, spent);
    }

    function _nextTick(IPoolManager manager, PoolId pool, int24 tick, int24 spacing, bool left)
        private
        view
        returns (int24 next, bool initialized)
    {
        int24 compressed = TickBitmap.compress(tick, spacing);
        if (!left) ++compressed;
        (int16 word, uint8 bit) = TickBitmap.position(compressed);
        uint256 bitmap = manager.getTickBitmap(pool, word);
        uint256 masked = left ? bitmap & (type(uint256).max >> (255 - bit)) : bitmap & ~((uint256(1) << bit) - 1);
        initialized = masked != 0;
        if (left) {
            next = (compressed - int24(uint24(initialized ? bit - BitMath.mostSignificantBit(masked) : bit))) * spacing;
        } else {
            next = (compressed + int24(uint24(initialized ? BitMath.leastSignificantBit(masked) - bit : 255 - bit)))
                * spacing;
        }
    }
}
