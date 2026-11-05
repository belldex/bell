// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapRequest, OraclePullUpdate} from "../types/ProtocolTypes.sol";
import {IBellRouter} from "../interfaces/IBellProtocol.sol";
import {IAuctionResidualAdapter} from "./IAuctionResidualAdapter.sol";

/// @dev The two reads the adapter needs from the deployed hook.
interface IBellHookKeyView {
    function poolKey() external view returns (PoolKey memory);
    function configHash() external view returns (bytes32);
}

/// @title BellRouterResidualAdapter
/// @notice Executes a `BellOpeningAuction` residual as one exact-input swap through `BellRouter`.
/// @dev One adapter per pool. It is the only contract that can move the auction's residual, and the
///      hook admits it by requiring the canonical router as `sender` plus this adapter as the
///      router-supplied `payer`, so no ordinary caller can borrow the auction's slot.
contract BellRouterResidualAdapter is IAuctionResidualAdapter {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    error BadConfig();

    address public immutable router;
    address public immutable hook;
    IPoolManager public immutable poolManager;
    /// @dev Pinned at construction so a swapped config can never be traded against by accident.
    bytes32 public immutable expectedConfigHash;

    constructor(address router_, address hook_, address poolManager_) {
        if (router_ == address(0) || hook_ == address(0) || poolManager_ == address(0)) revert BadConfig();
        router = router_;
        hook = hook_;
        poolManager = IPoolManager(poolManager_);
        expectedConfigHash = IBellHookKeyView(hook_).configHash();
    }

    /// @notice Pool price, read straight from PoolManager storage.
    function poolSqrtPriceX96() external view returns (uint160 sqrtPriceX96) {
        PoolKey memory key = IBellHookKeyView(hook).poolKey();
        (sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, key.toId());
    }

    /// @notice Execute the residual exactly once through the router.
    /// @dev Pulls `amountIn` from the caller, which is always the auction. The router's nonce is read
    ///      live because it belongs to this adapter, not to the auction or any user.
    function swapExactInput(bool zeroForOne, uint128 amountIn, uint128 minAmountOut, uint256 deadline)
        external
        returns (uint128 amountOut)
    {
        PoolKey memory key = IBellHookKeyView(hook).poolKey();
        address inToken = Currency.unwrap(zeroForOne ? key.currency0 : key.currency1);
        address outToken = Currency.unwrap(zeroForOne ? key.currency1 : key.currency0);

        IERC20(inToken).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(inToken).forceApprove(router, amountIn);

        SwapRequest memory request = SwapRequest({
            hook: hook,
            zeroForOne: zeroForOne,
            exactInput: true,
            amountSpecified: amountIn,
            limitAmount: minAmountOut,
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE : TickMath.MAX_SQRT_PRICE,
            recipient: address(this),
            nonce: IBellRouter(router).nonces(address(this)),
            deadline: uint64(deadline),
            expectedConfigHash: expectedConfigHash,
            wrapInput: false,
            unwrapOutput: false,
            unwrapRefund: false,
            oracleUpdates: new OraclePullUpdate[](0)
        });

        (, amountOut) = IBellRouter(router).swap(request);
        IERC20(outToken).safeTransfer(msg.sender, amountOut);
    }
}
