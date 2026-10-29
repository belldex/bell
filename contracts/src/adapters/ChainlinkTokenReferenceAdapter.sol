// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";
import {ISourceAdapterIdentity} from "../interfaces/ISourceAdapterIdentity.sol";

interface ITokenOraclePause {
    function oraclePaused() external view returns (bool);
}

/// @title ChainlinkTokenReferenceAdapter
/// @notice Onchain reference-price adapter for PRICE_GUARDED: reads one token's
///         Chainlink Data Feed and scales it to an 18-decimal reference price.
/// @dev Staleness is governed by the configured feed heartbeat only; this adapter
///      intentionally does not reference PolicyConstants.
contract ChainlinkTokenReferenceAdapter is ISourceAdapterIdentity {
    error StaleReference();
    error ReferenceUnavailable();
    error BadConfig();

    AggregatorV3Interface public immutable feed;
    uint32 public immutable heartbeat;
    uint8 public immutable feedDecimals;
    address public immutable stockToken;
    string private _symbol;

    constructor(address feed_, uint32 heartbeat_, uint8 feedDecimals_, string memory symbol_, address stockToken_) {
        if (feed_ == address(0) || heartbeat_ == 0 || feedDecimals_ > 18) revert BadConfig();
        feed = AggregatorV3Interface(feed_);
        heartbeat = heartbeat_;
        feedDecimals = feedDecimals_;
        _symbol = symbol_;
        stockToken = stockToken_;
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    /// @notice Latest feed price scaled to 1e18. Feed answers are already multiplier-adjusted.
    /// @dev Named `referencePrice` because `reference` is a reserved keyword in Solidity >=0.8.26.
    function referencePrice() public view returns (uint128) {
        if (stockToken != address(0) && ITokenOraclePause(stockToken).oraclePaused()) revert ReferenceUnavailable();
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0) revert ReferenceUnavailable();
        if (block.timestamp - updatedAt > heartbeat) revert StaleReference();
        uint256 scaled = feedDecimals <= 18
            ? uint256(answer) * 10 ** (18 - feedDecimals)
            : uint256(answer) / 10 ** (feedDecimals - 18);
        require(scaled <= type(uint128).max, "overflow");
        return uint128(scaled);
    }

    /// @notice Deterministic wire identity for this adapter's configuration.
    function sourceConfigHash() external view returns (bytes32) {
        return keccak256(abi.encode("CHAINLINK:REFERENCE", feed, heartbeat, feedDecimals, _symbol));
    }

    /// @notice Deployment fingerprint distinguishing instances with identical config.
    function fingerprint() external view returns (bytes32) {
        return keccak256(abi.encode(address(this), feed, heartbeat, feedDecimals, _symbol, stockToken));
    }
}
