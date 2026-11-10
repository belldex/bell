// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IBellSwapLens {
    error PoolNotBound();

    struct SwapStatus {
        bool allowed;
        bytes4 reason;
        uint8 session;
        uint24 currentFeePips;
        uint256 maxIn0;
        uint256 maxIn1;
        bool auctionWindow;
        uint64 nextTransition;
    }

    /// @notice Quote an exact-input swap with empty hookData and the full-range v4 price limit.
    /// @dev Admission covers hook/core policy, not payer balances, allowances, router deadlines or slippage.
    /// maxIn fields are remaining token-denominated gross budgets; the opposite-side budget and price
    /// path can further restrict a quote. reason is the unwrapped hook/core error selector.
    /// When a blocked swap's fee metadata is unavailable, currentFeePips is zero.
    function getSwapStatus(bytes32 poolId, bool zeroForOne, uint256 amountIn) external view returns (SwapStatus memory);

    /// @notice Unknown pool IDs return zero metadata. Each immutable lens is bound to one hook/pool.
    function getPoolInfo(bytes32 poolId)
        external
        view
        returns (address hook, uint16 hookFlags, bool hasAuction, address auction);
}
