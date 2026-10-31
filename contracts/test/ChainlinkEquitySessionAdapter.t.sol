// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ChainlinkEquitySessionAdapter, IEquityAggregatorV3} from "../src/adapters/ChainlinkEquitySessionAdapter.sol";

interface Vm { function warp(uint256 timestamp) external; }

contract MockEquityAggregatorImplementation {}

contract MockEquityFeed is IEquityAggregatorV3 {
    address public immutable overrideAggregator;
    uint8 public immutable overrideDecimals;
    int256 public answer = 20_000_000_000;
    uint256 public updatedAt;
    uint80 public roundId = 1;

    constructor(address implementation, uint8 decimals_) {
        overrideAggregator = implementation;
        overrideDecimals = decimals_;
        updatedAt = block.timestamp;
    }

    function decimals() external view override returns (uint8) { return overrideDecimals; }
    function aggregator() external view override returns (address) { return overrideAggregator; }
    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
    function setRound(int256 nextAnswer, uint256 nextUpdatedAt) external { answer = nextAnswer; updatedAt = nextUpdatedAt; }
}

contract MockRobinhoodEquityToken {
    uint256 public uiMultiplier = 2e18;
    bool public oraclePaused;
    function setPaused(bool paused) external { oraclePaused = paused; }
}

contract ChainlinkEquitySessionAdapterTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function _adapter(MockEquityFeed feed, MockEquityAggregatorImplementation implementation, MockRobinhoodEquityToken token)
        private returns (ChainlinkEquitySessionAdapter)
    {
        return new ChainlinkEquitySessionAdapter(
            address(feed), address(feed).codehash, address(implementation), address(implementation).codehash,
            address(token), address(token).codehash, 8, 3, keccak256("canonical-token-id")
        );
    }

    function _fixture() private returns (MockEquityFeed, MockEquityAggregatorImplementation, MockRobinhoodEquityToken, ChainlinkEquitySessionAdapter) {
        MockEquityAggregatorImplementation implementation = new MockEquityAggregatorImplementation();
        MockEquityFeed feed = new MockEquityFeed(address(implementation), 8);
        MockRobinhoodEquityToken token = new MockRobinhoodEquityToken();
        return (feed, implementation, token, _adapter(feed, implementation, token));
    }

    function testConvertsRobinhoodTotalReturnFeedBackToUnderlyingPrice() external {
        (,,, ChainlinkEquitySessionAdapter adapter) = _fixture();
        // The feed reports $200 token value with a 2x token multiplier; SessionRegistry applies 2x.
        require(adapter.readCurrent().price18 == 100e18, "multiplier applied twice");
    }

    function testRejectsRoundsAtOrBeyondThe120SecondFreshnessLimit() external {
        (MockEquityFeed feed, MockEquityAggregatorImplementation implementation, MockRobinhoodEquityToken token, ChainlinkEquitySessionAdapter adapter) = _fixture();
        vm.warp(10_000);
        feed.setRound(20_000_000_000, block.timestamp - 120);
        (bool ok,) = address(adapter).staticcall(abi.encodeCall(ChainlinkEquitySessionAdapter.readCurrent, ()));
        require(!ok, "stale round accepted");
        // Keep references live so the test confirms its fixture identity remains pinned.
        require(address(implementation).code.length != 0 && address(token).code.length != 0, "fixture missing");
    }

    function testRejectsPausedRobinhoodOracle() external {
        (,, MockRobinhoodEquityToken token, ChainlinkEquitySessionAdapter adapter) = _fixture();
        token.setPaused(true);
        (bool ok,) = address(adapter).staticcall(abi.encodeCall(ChainlinkEquitySessionAdapter.readCurrent, ()));
        require(!ok, "paused round accepted");
    }
}
