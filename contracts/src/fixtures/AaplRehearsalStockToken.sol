// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Rehearsal fixture token simulating a Robinhood stock token (AAPL).
/// Implements standard ERC20 with 18 decimals and an open faucet mint,
/// as well as Robinhood corporate status getters expected by StockTokenStatusAdapter.
contract AaplRehearsalStockToken is ERC20 {
    constructor() ERC20("AAPL Rehearsal Stock Token", "AAPL-RH-REHEARSAL") {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function uiMultiplier() external pure returns (uint256) {
        return 1e18;
    }

    function newUIMultiplier() external pure returns (uint256) {
        return 1e18;
    }

    function effectiveAt() external pure returns (uint256) {
        return 0;
    }

    function oraclePaused() external pure returns (bool) {
        return false;
    }
}
