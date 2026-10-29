// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ChainlinkTokenReferenceAdapter} from "../../../src/adapters/ChainlinkTokenReferenceAdapter.sol";
import {AggregatorV3Interface} from "../../../src/interfaces/AggregatorV3Interface.sol";
import {ISourceAdapterIdentity} from "../../../src/interfaces/ISourceAdapterIdentity.sol";
import {SourceConfigHash} from "../../../src/libraries/SourceConfigHash.sol";
import {SourceWire} from "../../../src/types/ProtocolTypes.sol";

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

contract ZeroRoundAggregator is AggregatorV3Interface {
    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "stub";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80) external pure returns (uint80, int256, uint256, uint256, uint80) {
        return (0, 100, 0, 0, 0);
    }

    function latestRoundData() external pure returns (uint80, int256, uint256, uint256, uint80) {
        return (0, 100, 0, 0, 0);
    }
}

contract UnansweredRoundAggregator is AggregatorV3Interface {
    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "stub";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80) external pure returns (uint80, int256, uint256, uint256, uint80) {
        return (7, 100, 0, 0, 6);
    }

    function latestRoundData() external pure returns (uint80, int256, uint256, uint256, uint80) {
        return (7, 100, 0, 0, 6);
    }
}

contract StubStockWithPause {
    bool public oraclePaused;

    function setPaused(bool p) external {
        oraclePaused = p;
    }
}

contract RevertingDecimalsAggregator is AggregatorV3Interface {
    function decimals() external pure returns (uint8) {
        revert("decimals unavailable");
    }

    function description() external pure returns (string memory) {
        revert("description unavailable");
    }

    function version() external pure returns (uint256) {
        revert("version unavailable");
    }

    function getRoundData(uint80) external pure returns (uint80, int256, uint256, uint256, uint80) {
        revert("round unavailable");
    }

    function latestRoundData() external pure returns (uint80, int256, uint256, uint256, uint80) {
        revert("round unavailable");
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

    function _canonicalWire(address feed_, uint8 decimals_, uint32 heartbeatSec_) private view returns (SourceWire memory wire) {
        wire = SourceWire({
            kind: 4,
            phaseScope: 4,
            endpoint: feed_,
            feedId: keccak256(abi.encode("BELL:CHAINLINK:REFERENCE:FEED", feed_)),
            schema: 11,
            decimals: decimals_,
            priceBasis: 4,
            heartbeatSec: heartbeatSec_,
            expectedCodeHash: feed_.codehash,
            expectedImplementation: feed_,
            canonicalTokenId: keccak256(abi.encode(block.chainid, address(0)))
        });
    }

    function test_sourceConfigHash_matches_canonical_SourceConfigHash_wire() external {
        setUp();
        StubAggregator agg = new StubAggregator(100, block.timestamp, 8);
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(0));
        SourceWire memory wire = _canonicalWire(address(agg), 8, 86400);
        bytes32 expected = keccak256(abi.encode(
            wire.kind,
            wire.phaseScope,
            wire.endpoint,
            wire.feedId,
            wire.schema,
            wire.decimals,
            wire.priceBasis,
            wire.heartbeatSec,
            wire.expectedCodeHash,
            wire.expectedImplementation,
            wire.canonicalTokenId,
            block.chainid,
            address(0)
        ));
        require(a.sourceConfigHash() == expected, "sourceConfigHash is not the canonical SourceWire field order");
        require(a.sourceConfigHash() != SourceConfigHash.hash(wire), "pause binding is not domain-separated");
    }

    function test_sourceConfigHash_differs_when_pause_binding_differs() external {
        setUp();
        StubAggregator agg = new StubAggregator(100, block.timestamp, 8);
        ChainlinkTokenReferenceAdapter unbound = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(0));
        ChainlinkTokenReferenceAdapter bound = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(1));
        require(unbound.sourceConfigHash() != bound.sourceConfigHash(), "sourceConfigHash ignored the pause binding");
        // Changing the stockToken alone must not change the canonical wire fields.
        require(unbound.sourceConfigHash() != SourceConfigHash.hash(_canonicalWire(address(agg), 8, 86400)),
            "pause-binding domain separation is not appended after the wire hash");
    }

    function test_reverts_when_answer_is_zero() external {
        setUp();
        StubAggregator agg = new StubAggregator(0, block.timestamp, 8);
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(0));
        vm.expectRevert(ChainlinkTokenReferenceAdapter.ReferenceUnavailable.selector);
        a.referencePrice();
    }

    function test_reverts_when_round_is_invalid() external {
        setUp();
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(
            address(new ZeroRoundAggregator()), 86400, 8, "x", address(0)
        );
        vm.expectRevert(ChainlinkTokenReferenceAdapter.ReferenceUnavailable.selector);
        a.referencePrice();

        setUp();
        ChainlinkTokenReferenceAdapter b = new ChainlinkTokenReferenceAdapter(
            address(new UnansweredRoundAggregator()), 86400, 8, "x", address(0)
        );
        vm.expectRevert(ChainlinkTokenReferenceAdapter.ReferenceUnavailable.selector);
        b.referencePrice();
    }

    function test_accepts_age_exactly_at_heartbeat() external {
        setUp();
        StubAggregator agg = new StubAggregator(100, block.timestamp - 86400, 8);
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(0));
        require(a.referencePrice() == 100 * 1e10, "age exactly at heartbeat must be accepted");
    }

    function test_scales_six_decimal_feed_answer_to_1e18() external {
        setUp();
        StubAggregator agg = new StubAggregator(350_733931, block.timestamp, 6); // $350.733931
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 6, "x", address(0));
        require(a.referencePrice() == 350_733931 * 1e12, "6-decimal feed answer not scaled to 1e18");
    }

    function test_reverts_when_updated_at_is_in_the_future() external {
        setUp();
        StubAggregator agg = new StubAggregator(100, block.timestamp + 1, 8);
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(address(agg), 86400, 8, "x", address(0));
        vm.expectRevert(ChainlinkTokenReferenceAdapter.StaleReference.selector);
        a.referencePrice();
    }

    function test_constructor_rejects_decimals_mismatch_with_feed() external {
        setUp();
        StubAggregator agg = new StubAggregator(100, block.timestamp, 8);
        vm.expectRevert(ChainlinkTokenReferenceAdapter.BadConfig.selector);
        new ChainlinkTokenReferenceAdapter(address(agg), 86400, 6, "x", address(0));

        setUp();
        RevertingDecimalsAggregator reverting = new RevertingDecimalsAggregator();
        vm.expectRevert(ChainlinkTokenReferenceAdapter.BadConfig.selector);
        new ChainlinkTokenReferenceAdapter(address(reverting), 86400, 8, "x", address(0));

        setUp();
        StubAggregator exact = new StubAggregator(100, block.timestamp, 8);
        ChainlinkTokenReferenceAdapter a = new ChainlinkTokenReferenceAdapter(address(exact), 86400, 8, "x", address(0));
        require(a.referencePrice() == 100 * 1e10, "matching decimals constructor must succeed");
    }
}
