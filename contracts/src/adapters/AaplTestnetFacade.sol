// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice TESTNET-ONLY rehearsal facade for the canonical mainnet AAPL Robinhood Stock Token.
/// @dev This is NOT the canonical token and holds no value. It exists only so the
///      YahooAttestedSourceAdapter stream-mode constructor's `stockToken_.code.length != 0`
///      check passes on Testnet, where the real mainnet AAPL address has no deployment.
///      The adapter still binds the mainnet AAPL address as its pinned `stockToken` identity
///      (mainnet chainId + canonical address), and the evidence file records this split
///      explicitly so no one mistakes the facade for a canonical stock deployment.
contract AaplTestnetFacade {
    string public constant name = "AAPL Testnet Rehearsal Facade";
    string public constant symbol = "AAPL-RH-FACADE";
    uint8 public constant decimals = 18;

    // Match the real token's corporate getters so StockTokenStatusAdapter-style reads
    // (if any keeper calls them during rehearsal) return sane values.
    uint256 public uiMultiplier = 1e18;
    uint256 public newUIMultiplier = 1e18;
    uint256 public effectiveAt;
    bool public oraclePaused;

    constructor() payable {}
}
