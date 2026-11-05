// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {BellHook} from "./BellHook.sol";
import {BellPolicyOracle} from "./BellPolicyOracle.sol";
import {BellModeEvaluator} from "./BellModeEvaluator.sol";
import {PoolConfig} from "./types/ProtocolTypes.sol";
import {IBellOpeningAuction} from "./auction/IBellOpeningAuction.sol";

/// @title BellHookV2
/// @notice BellHook plus the Opening Bell Auction guard.
/// @dev The only behavioural delta is in `_beforeSwap` and `_beforeAddLiquidity`. Everything else —
///      session fees, flow budgets, closure budgets, recovery, the unblockable LP exit — is inherited
///      unchanged, so the two templates cannot drift apart.
///
///      The guard cannot key on `sender` alone: in v4 the `sender` of `beforeSwap` is whoever called
///      `PoolManager.swap`, which for a residual is the router, not the auction. It therefore requires
///      both `sender == router` and the `payer` carried in the router's own `hookData`. `hookData` is
///      not attacker-controlled because BellRouter builds it from its own `msg.sender`.
contract BellHookV2 is BellHook {
    error AuctionActive();

    /// @notice The per-pool auction this hook defers to. Zero disables the guard entirely.
    address public immutable auction;
    /// @notice The canonical router allowed to carry an auction residual.
    address public immutable router;

    constructor(
        PoolConfig memory config_,
        PoolKey memory key_,
        bytes32 templateCodeHash_,
        address sessionRegistry_,
        BellPolicyOracle policyOracle_,
        BellModeEvaluator modeEvaluator_,
        address auction_,
        address router_
    ) BellHook(config_, key_, templateCodeHash_, sessionRegistry_, policyOracle_, modeEvaluator_) {
        auction = auction_;
        router = router_;
    }

    /// @notice True when the caller is the auction arriving through the canonical router.
    function _isAuctionResidual(address sender, bytes calldata hookData) private view returns (bool) {
        return sender == router && _payer(hookData) == auction;
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (auction != address(0) && IBellOpeningAuction(auction).blocksSwaps()) {
            if (!_isAuctionResidual(sender, hookData)) revert AuctionActive();
        }
        return super._beforeSwap(sender, key, params, hookData);
    }

    /// @dev Rejects liquidity adds while the batch is open so JIT liquidity cannot absorb the
    ///      residual. Removals are untouched: the LP exit invariant still comes from the permission
    ///      mask, not from this function.
    function _beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4) {
        if (auction != address(0) && IBellOpeningAuction(auction).blocksSwaps()) revert AuctionActive();
        return super._beforeAddLiquidity(sender, key, params, hookData);
    }

    /// @dev First word of the router's `hookData` is `abi.encode(payer, requestHash, updates)`.
    function _payer(bytes calldata hookData) private pure returns (address payer) {
        if (hookData.length < 32) return address(0);
        assembly ("memory-safe") {
            payer := shr(96, calldataload(hookData.offset))
        }
    }
}
