// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ChainlinkTokenReferenceAdapter} from "../../../src/adapters/ChainlinkTokenReferenceAdapter.sol";
import {AggregatorV3Interface} from "../../../src/interfaces/AggregatorV3Interface.sol";
import {ISourceAdapterIdentity} from "../../../src/interfaces/ISourceAdapterIdentity.sol";

interface VmChainlink {
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 revertData) external;
}

contract StubAggregator is AggregatorV3Interface {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public dec;

    constructor(int256 a, uint256 t, uint8 d) {
        answer = a;
        updatedAt = t;
        dec = d;
    }

    function decimals() external view returns (uint8) {
        return dec;
    }

    function description() external view returns (string memory) {
        return "stub";
    }

    function version() external view returns (uint256) {
        return 1;
    }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract StubStockWithPause {
    bool public oraclePaused;

    function setPaused(bool p) external {
        oraclePaused = p;
    }
}

contract ChainlinkTokenReferenceAdapterTest {
    VmChainlink private constant vm = VmChainlink(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint64 private constant NOW = 1_793_029_632;

    function setUp() internal {
        vm.warp(NOW);
    }

    function test_scales_feed_answer_to_1e18() external {
        setUp();
        StubAggregator agg = new StubAggregator(350_73393114, block.timestamp, 8); // $350.73
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(
            address(agg), 86400, 8, "Robinhood AAPL / USD", address(0)
        );
        require(a.referencePrice() == 350_73393114 * 1e10, "feed answer not scaled to 1e18");
        require(a.heartbeat() == 86400, "heartbeat not configured");
    }

    function test_reverts_when_older_than_heartbeat() external {
        setUp();
        StubAggregator agg = new StubAggregator(100, block.timestamp - 86401, 8);
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(0));
        vm.expectRevert(ChainlinkTokenReferenceAdapter.StaleReference.selector);
        a.referencePrice();
    }

    function test_reverts_when_token_oracle_paused() external {
        setUp();
        StubAggregator agg = new StubAggregator(100, block.timestamp, 8);
        StubStockWithPause stock = new StubStockWithPause();
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(stock));
        stock.setPaused(true);
        vm.expectRevert(ChainlinkTokenReferenceAdapter.ReferenceUnavailable.selector);
        a.referencePrice();
    }

    function test_exposes_identity_surface() external {
        setUp();
        StubAggregator agg = new StubAggregator(100, block.timestamp, 8);
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(0));
        ISourceAdapterIdentity identity = ISourceAdapterIdentity(address(a));
        require(identity.sourceConfigHash() != bytes32(0), "sourceConfigHash absent");
        require(identity.fingerprint() != bytes32(0), "fingerprint absent");
        ChainlinkTokenReferenceAdapter b = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(0));
        require(identity.sourceConfigHash() == b.sourceConfigHash(), "sourceConfigHash not deterministic");
    }
}
