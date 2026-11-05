// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IBellOpeningAuction
/// @notice The narrow view BellHookV2 needs. Declared separately so the hook does not pull the whole
///         auction implementation, and so the guard stays testable with a stub.
interface IBellOpeningAuction {
    /// @notice True while the hook must reject ordinary swaps so the batch can clear first.
    function blocksSwaps() external view returns (bool);

    /// @notice Residual adapter authorised to call BellRouter on behalf of this auction.
    function adapter() external view returns (address);
}
