// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/// @dev Minimal ABI surface of the pinned Uniswap v4 PositionManager receipt views.
/// PositionInfo is an ABI uint256 despite being declared as a user-defined value type.
interface IPositionReceiptManager {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, uint256);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
}

/// @notice Verifies a freshly minted PUBLIC PositionManager receipt before hook activation.
/// @dev This is a receipt check, not a substitute for the factory's atomic settlement and amountMax checks.
library PositionReceipt {
    error InvalidPositionReceipt();

    function verifyPublicPosition(
        IPositionReceiptManager manager,
        uint256 tokenId,
        address recipient,
        PoolKey memory expectedKey,
        int24 expectedTickLower,
        int24 expectedTickUpper,
        uint128 expectedLiquidity
    ) internal view {
        if (address(manager) == address(0) || tokenId == 0 || recipient == address(0) || expectedLiquidity == 0) {
            revert InvalidPositionReceipt();
        }
        if (manager.ownerOf(tokenId) != recipient) revert InvalidPositionReceipt();

        (PoolKey memory actualKey, uint256 positionInfo) = manager.getPoolAndPositionInfo(tokenId);
        if (!_samePool(actualKey, expectedKey)) revert InvalidPositionReceipt();
        if (_tickLower(positionInfo) != expectedTickLower || _tickUpper(positionInfo) != expectedTickUpper) {
            revert InvalidPositionReceipt();
        }
        // PositionManager mints an unsubscribed receipt with the low byte clear.
        if (positionInfo & 0xff != 0 || manager.getPositionLiquidity(tokenId) != expectedLiquidity) {
            revert InvalidPositionReceipt();
        }
    }

    function _samePool(PoolKey memory a, PoolKey memory b) private pure returns (bool) {
        return Currency.unwrap(a.currency0) == Currency.unwrap(b.currency0)
            && Currency.unwrap(a.currency1) == Currency.unwrap(b.currency1)
            && a.fee == b.fee && a.tickSpacing == b.tickSpacing && address(a.hooks) == address(b.hooks);
    }

    function _tickLower(uint256 positionInfo) private pure returns (int24) {
        return int24(uint24(positionInfo >> 8));
    }

    function _tickUpper(uint256 positionInfo) private pure returns (int24) {
        return int24(uint24(positionInfo >> 32));
    }
}
