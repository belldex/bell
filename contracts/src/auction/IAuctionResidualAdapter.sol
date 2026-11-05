// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IAuctionResidualAdapter
/// @notice The only seam between the auction and the pool.
/// @dev Implemented in production by a thin adapter over BellRouter. Keeping it this narrow is what
///      lets the auction be tested without v4, a hook, or a router.
interface IAuctionResidualAdapter {
    /// @notice Pool price at the moment the residual is quoted.
    function poolSqrtPriceX96() external view returns (uint160);

    /// @notice Execute one exact-input residual swap.
    /// @dev Pulls `amountIn` of the input token from the caller (`msg.sender`), so the caller must
    ///      approve this contract first. `zeroForOne` follows the v4 pool convention.
    function swapExactInput(bool zeroForOne, uint128 amountIn, uint128 minAmountOut, uint256 deadline)
        external
        returns (uint128 amountOut);
}
