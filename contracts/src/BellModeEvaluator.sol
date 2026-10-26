// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ModePolicy} from "./libraries/ModePolicy.sol";
import {ClosureBudget} from "./libraries/ClosureBudget.sol";
import {FlowBudget} from "./libraries/FlowBudget.sol";
import {FeePolicy} from "./libraries/FeePolicy.sol";
import {WidePriceMath} from "./libraries/WidePriceMath.sol";
import {PolicyConstants} from "./libraries/PolicyConstants.sol";
import {IBellSwapEvaluator} from "./types/SwapEvaluation.sol";
import {Buckets, Mode, PoolClass} from "./types/ProtocolTypes.sol";

/// @notice Stateless, non-upgradeable transport for canonical mode and swap arithmetic.
/// @dev Each hook constructs and immutably binds its own instance. Calls are STATICCALLs,
/// not delegatecalls; no hook storage, permission, policy input or guard moves to this contract.
contract BellModeEvaluator is IBellSwapEvaluator {
    error InvalidActualDelta();
    error InvalidSwapContext();
    error InvalidPricePath();

    /// @dev This is a pure calculator, NOT reference admission. No caller can authorize a BellHook swap
    /// by calling it. Until authenticated reference/corporate snapshots are available, BellHook stays gated.
    function prepare(Context calldata context, bytes32 callbackHash, bool zeroForOne, int256 amountSpecified)
        external pure returns (Snapshot memory)
    {
        return _prepare(context, callbackHash, zeroForOne, amountSpecified);
    }

    function _prepare(Context memory c, bytes32 callbackHash, bool zeroForOne, int256 amountSpecified)
        private pure returns (Snapshot memory snapshot)
    {
        bool closed = c.mode == uint8(Mode.CLOSED);
        if (c.configHash == bytes32(0) || c.stateHash == bytes32(0) || callbackHash == bytes32(0)
            || c.poolClass > uint8(PoolClass.SESSION_ONLY) || c.timestamp == 0 || c.validUntil <= c.timestamp
            || c.bellStart == 0 || c.bellStart > c.timestamp || c.preSqrtPriceX96 == 0
            || c.decimals[0] > PolicyConstants.MAX_TOKEN_DECIMALS || c.decimals[1] > PolicyConstants.MAX_TOKEN_DECIMALS
            || amountSpecified == 0 || amountSpecified == type(int256).min
            || (closed ? (!c.closedLatched || c.closureNonce == 0 || !c.frozenStock || c.phase != PolicyConstants.PHASE_CLOSED)
                : (c.mode != uint8(Mode.ACTIVE) || c.closedLatched || c.frozenStock
                    || c.phase < PolicyConstants.PHASE_PRE || c.phase > PolicyConstants.PHASE_OVERNIGHT))) {
            revert InvalidSwapContext();
        }
        for (uint8 i; i < 2; ++i) {
            if (c.tradeCap[i] == 0 || c.windowCap[i] < c.tradeCap[i] || c.closureCap[i] == 0
                || uint256(c.closureCap[i]) > uint256(c.tradeCap[i]) * PolicyConstants.MAX_CLOSURE_TIMES_TRADE_CAP
                || c.closureCap[i] > c.windowCap[i]) revert InvalidSwapContext();
        }
        snapshot.context = c;
        snapshot.callbackHash = callbackHash;
        snapshot.zeroForOne = zeroForOne;
        snapshot.amountSpecified = amountSpecified;
        bool repricing;
        if (c.poolClass == uint8(PoolClass.PRICE_GUARDED)) {
            snapshot.bandBps = c.frozenStock ? PolicyConstants.FROZEN_STOCK_BAND_BPS : PolicyConstants.ACTIVE_BAND_BPS;
            repricing = !WidePriceMath.isWithinPriceBand(c.preSqrtPriceX96, c.referencePrice18[0],
                c.referencePrice18[1], c.decimals[0], c.decimals[1], snapshot.bandBps);
        } else if (c.referencePrice18[0] != 0 || c.referencePrice18[1] != 0) {
            // SESSION_ONLY must never advertise a synthetic fair-price reference.
            revert InvalidSwapContext();
        }
        uint64 elapsed = c.timestamp - c.bellStart;
        bool corporate = c.corporateUntil > c.timestamp;
        snapshot.guarded = corporate || repricing || elapsed < PolicyConstants.BELL_DURATION_SECONDS;
        uint24 baseFee;
        if (c.phase == PolicyConstants.PHASE_REGULAR) baseFee = PolicyConstants.FEE_REGULAR;
        else if (c.phase == PolicyConstants.PHASE_PRE) baseFee = PolicyConstants.FEE_PRE;
        else if (c.phase == PolicyConstants.PHASE_POST) baseFee = PolicyConstants.FEE_POST;
        else if (c.phase == PolicyConstants.PHASE_OVERNIGHT) baseFee = PolicyConstants.FEE_OVERNIGHT;
        else baseFee = PolicyConstants.FEE_CLOSED;
        snapshot.lpFeeUnits = FeePolicy.effectiveLpFee(baseFee, elapsed, corporate, repricing);
        (snapshot.effectiveTradeCap, snapshot.effectiveWindowCap) =
            FlowBudget.effectiveLimits(c.tradeCap, c.windowCap, c.phase, snapshot.guarded);
    }

    /// @notice Compute BOTH rolling and closure candidates before the caller writes either one.
    /// @dev The pinned context is used even if a live reference would change after the core swap. The hook
    /// must supply actual core deltas and slot0; an arbitrary hookData snapshot is never an authorized input.
    function settle(Snapshot calldata snapshot, bytes32 callbackHash, uint64 timestamp, uint160 postSqrtPriceX96,
        int128 delta0, int128 delta1, Buckets calldata buckets, uint128[2] calldata episodeGross)
        external pure returns (Buckets memory nextBuckets, uint128[2] memory nextEpisode, uint128[2] memory gross)
    {
        _checkSnapshot(snapshot, callbackHash, timestamp, postSqrtPriceX96);
        validateActual(snapshot.zeroForOne, snapshot.amountSpecified, delta0, delta1);
        (nextBuckets, gross) = _consumeRolling(snapshot, buckets, delta0, delta1);
        nextEpisode = snapshot.context.closedLatched
            ? ClosureBudget.consumeEpisode(episodeGross, snapshot.context.closureCap, delta0, delta1) : episodeGross;
    }

    function _consumeRolling(Snapshot calldata snapshot, Buckets calldata buckets, int128 delta0, int128 delta1)
        private pure returns (Buckets memory next, uint128[2] memory gross)
    {
        return FlowBudget.consume(buckets, snapshot.context.timestamp, delta0, delta1,
            snapshot.context.phase, snapshot.guarded, snapshot.context.tradeCap, snapshot.context.windowCap);
    }

    function _checkSnapshot(Snapshot calldata snapshot, bytes32 callbackHash, uint64 timestamp, uint160 postSqrtPriceX96)
        private pure
    {
        if (callbackHash != snapshot.callbackHash || timestamp != snapshot.context.timestamp || postSqrtPriceX96 == 0
            || keccak256(abi.encode(snapshot)) != keccak256(abi.encode(_prepare(snapshot.context,
                snapshot.callbackHash, snapshot.zeroForOne, snapshot.amountSpecified)))) revert InvalidSwapContext();
        Context calldata c = snapshot.context;
        if (c.poolClass == uint8(PoolClass.PRICE_GUARDED)
            && !WidePriceMath.allowsPricePath(c.preSqrtPriceX96, postSqrtPriceX96,
                c.referencePrice18[0], c.referencePrice18[1], c.decimals[0], c.decimals[1], snapshot.bandBps)) {
            revert InvalidPricePath();
        }
    }

    /// @notice Validate core caller deltas, independent of specified currency and partial fills.
    /// @dev Widen before negation, including int128.min. The input includes core's fees.
    function validateActual(bool zeroForOne, int256 amountSpecified, int128 delta0, int128 delta1) public pure {
        int256 input = zeroForOne ? int256(delta0) : int256(delta1);
        int256 output = zeroForOne ? int256(delta1) : int256(delta0);
        if (input >= 0 || output <= 0 || amountSpecified == 0 || amountSpecified == type(int256).min) {
            revert InvalidActualDelta();
        }
        // Exact-input may stop at a price limit; exact-output may likewise be partially filled.
        if (amountSpecified < 0 ? -input > -amountSpecified : output > amountSpecified) {
            revert InvalidActualDelta();
        }
    }

    function decide(ModePolicy.Context memory context) external pure returns (ModePolicy.Decision memory) {
        return ModePolicy.decide(context);
    }

    function maximumClosureCap(uint128[2] memory trade, uint128[2] memory window, uint128[2] memory principal)
        external pure returns (uint128[2] memory)
    {
        return ClosureBudget.maximumClosureCap(trade, window, principal);
    }
}
