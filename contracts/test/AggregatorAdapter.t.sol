// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AggregatorAdapter} from "../src/adapters/AggregatorAdapter.sol";
import {SourceSample} from "../src/types/ProtocolTypes.sol";

interface VmAggregator {
    function warp(uint256 timestamp) external;
}

contract MockAggregatorImplementation {}

contract MockAggregatorProxy {
    address public aggregator;
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId = 1;
    uint80 public answeredInRound = 1;

    constructor(address implementation, uint8 decimals_) {
        aggregator = implementation;
        decimals = decimals_;
    }

    function setRound(int256 answer_, uint256 updatedAt_, uint80 roundId_, uint80 answeredInRound_) external {
        answer = answer_;
        updatedAt = updatedAt_;
        roundId = roundId_;
        answeredInRound = answeredInRound_;
    }

    function setAggregator(address implementation) external {
        aggregator = implementation;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}

contract AggregatorAdapterTest {
    VmAggregator private constant vm = VmAggregator(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint8 private constant TOKEN_ADJUSTED = 2;

    function _fixture() internal returns (MockAggregatorImplementation implementation, MockAggregatorProxy proxy, AggregatorAdapter adapter) {
        implementation = new MockAggregatorImplementation();
        proxy = new MockAggregatorProxy(address(implementation), 8);
        adapter = new AggregatorAdapter(
            address(proxy),
            address(proxy).codehash,
            address(implementation),
            address(implementation).codehash,
            8,
            86400,
            TOKEN_ADJUSTED,
            1,
            0,
            bytes32(uint256(1))
        );
    }

    function testNormalizesAdjustedPriceAndCapsMetadataHeartbeatAtPolicyMaximum() external {
        vm.warp(1_000_000);
        (, MockAggregatorProxy proxy, AggregatorAdapter adapter) = _fixture();
        proxy.setRound(200_000_000, 999_995, 7, 7);
        SourceSample memory sample = adapter.readCurrent();
        require(sample.price18 == 2e18, "price normalization");
        require(sample.observedAt == 999_995, "round timestamp");
        require(sample.validUntil == 1_000_595, "strict heartbeat cap");
    }

    function testRejectsStaleNegativeFutureAndIncompleteRounds() external {
        vm.warp(1_000_000);
        (, MockAggregatorProxy proxy, AggregatorAdapter adapter) = _fixture();
        proxy.setRound(100_000_000, 999_399, 7, 7);
        (bool ok,) = address(adapter).staticcall(abi.encodeCall(adapter.readCurrent, ()));
        require(!ok, "stale round accepted");
        proxy.setRound(100_000_000, 999_400, 7, 7);
        (ok,) = address(adapter).staticcall(abi.encodeCall(adapter.readCurrent, ()));
        require(!ok, "exact expiry boundary accepted");
        proxy.setRound(-1, 999_999, 8, 8);
        (ok,) = address(adapter).staticcall(abi.encodeCall(adapter.readCurrent, ()));
        require(!ok, "negative answer accepted");
        proxy.setRound(100_000_000, 1_000_001, 9, 9);
        (ok,) = address(adapter).staticcall(abi.encodeCall(adapter.readCurrent, ()));
        require(!ok, "future round accepted");
        proxy.setRound(100_000_000, 999_999, 10, 9);
        (ok,) = address(adapter).staticcall(abi.encodeCall(adapter.readCurrent, ()));
        require(!ok, "incomplete round accepted");
    }

    function testRejectsProxyOrImplementationFingerprintChange() external {
        vm.warp(1_000_000);
        (MockAggregatorImplementation implementation, MockAggregatorProxy proxy, AggregatorAdapter adapter) = _fixture();
        MockAggregatorImplementation replacement = new MockAggregatorImplementation();
        proxy.setAggregator(address(replacement));
        (bool ok,) = address(adapter).staticcall(abi.encodeCall(adapter.readCurrent, ()));
        require(!ok, "implementation change accepted");
        require(address(implementation).codehash != bytes32(0), "fixture implementation missing");
    }
}
