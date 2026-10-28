// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Rehearsal swap executor for live BELL pools on Uniswap v4.
/// Calls PoolManager directly with empty hookData, proving beforeSwap / afterSwap hook callbacks onchain.
contract TestnetSwapExecutor is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;

    event RehearsalSwapExecuted(
        address indexed payer,
        bytes32 indexed poolId,
        bool zeroForOne,
        int128 amount0,
        int128 amount1
    );

    constructor(IPoolManager manager_) {
        poolManager = manager_;
    }

    function executeSwap(
        PoolKey calldata key,
        bool zeroForOne,
        int256 amountSpecified
    ) external returns (BalanceDelta delta) {
        bytes memory result = poolManager.unlock(
            abi.encode(key, zeroForOne, amountSpecified, msg.sender)
        );
        delta = abi.decode(result, (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "only pool manager");
        (PoolKey memory key, bool zeroForOne, int256 amountSpecified, address payer) =
            abi.decode(data, (PoolKey, bool, int256, address));

        uint160 priceLimit = zeroForOne
            ? 4295128740
            : 1461446703485210103287273052203988822378723970341;

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: priceLimit
            }),
            ""
        );

        if (zeroForOne) {
            uint256 payAmount = uint256(uint128(-delta.amount0()));
            IERC20(Currency.unwrap(key.currency0)).safeTransferFrom(payer, address(this), payAmount);
            poolManager.sync(key.currency0);
            IERC20(Currency.unwrap(key.currency0)).safeTransfer(address(poolManager), payAmount);
            poolManager.settle();

            uint256 takeAmount = uint256(uint128(delta.amount1()));
            poolManager.take(key.currency1, payer, takeAmount);
        } else {
            uint256 payAmount = uint256(uint128(-delta.amount1()));
            IERC20(Currency.unwrap(key.currency1)).safeTransferFrom(payer, address(this), payAmount);
            poolManager.sync(key.currency1);
            IERC20(Currency.unwrap(key.currency1)).safeTransfer(address(poolManager), payAmount);
            poolManager.settle();

            uint256 takeAmount = uint256(uint128(delta.amount0()));
            poolManager.take(key.currency0, payer, takeAmount);
        }

        emit RehearsalSwapExecuted(payer, keccak256(abi.encode(key)), zeroForOne, delta.amount0(), delta.amount1());
        return abi.encode(delta);
    }
}
