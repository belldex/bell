// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Testnet fixture that stands in for a Chainlink equity Data Feed proxy.
/// @dev Robinhood testnet has no equity Data Feeds. The owner sets the price; `latestRoundData` reports the current block time
///      as `updatedAt`, so the fixture never reads as stale. It exists only so the Einstein stack can run on testnet.
contract MockChainlinkFeed {
    address public immutable owner;
    uint8 public immutable decimals;
    string public description;
    uint80 public roundId;
    int256 public answer;

    event PriceSet(uint80 indexed roundId, int256 answer);

    constructor(uint8 decimals_, string memory description_, int256 initialAnswer) {
        owner = msg.sender;
        decimals = decimals_;
        description = description_;
        roundId = 1;
        answer = initialAnswer;
        emit PriceSet(1, initialAnswer);
    }

    /// @dev The adapter checks that `aggregator()` has code and a fixed code hash; the fixture is its own aggregator.
    function aggregator() external view returns (address) { return address(this); }

    function setPrice(int256 newAnswer) external {
        require(msg.sender == owner && newAnswer > 0, "not owner");
        roundId += 1;
        answer = newAnswer;
        emit PriceSet(roundId, newAnswer);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, block.timestamp, block.timestamp, roundId);
    }
}
