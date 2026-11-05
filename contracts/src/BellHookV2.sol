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

/// @dev One read from the deployment-wide auction registry.
interface IBellAuctionRegistry {
    function blocksSwaps(bytes32 poolId) external view returns (bool);
}

/// @title BellHookV2
/// @notice BellHook plus the Opening Bell Auction guard.
/// @dev The only behavioural delta is in `_beforeSwap` and `_beforeAddLiquidity`. Everything else —
///      session fees, flow budgets, closure budgets, recovery, the unblockable LP exit — is inherited
///      unchanged, so the two templates cannot drift apart.
///
///      The auction is resolved through a write-once registry rather than an immutable address,
///      because the hook and the auction each need the other's address and cannot both be first.
contract BellHookV2 is BellHook {
    error AuctionActive();

    /// @notice Write-once pool-to-auction registry. Zero disables the guard entirely.
    address public immutable auctionRegistry;

    constructor(
        PoolConfig memory config_,
        PoolKey memory key_,
        bytes32 templateCodeHash_,
        address sessionRegistry_,
        BellPolicyOracle policyOracle_,
        BellModeEvaluator modeEvaluator_,
        address auctionRegistry_
    ) BellHook(config_, key_, templateCodeHash_, sessionRegistry_, policyOracle_, modeEvaluator_) {
        auctionRegistry = auctionRegistry_;
    }

    /// @dev The registry returns false for a pool that has no auction binding.
    function _auctionBlocks() private view returns (bool) {
        if (auctionRegistry == address(0)) return false;
        return IBellAuctionRegistry(auctionRegistry).blocksSwaps(poolId);
    }

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (_auctionBlocks()) revert AuctionActive();
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
        if (_auctionBlocks()) revert AuctionActive();
        return super._beforeAddLiquidity(sender, key, params, hookData);
    }

}
