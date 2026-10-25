// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EquityV11Adapter} from "../src/adapters/EquityV11Adapter.sol";
import {SourceSample} from "../src/types/ProtocolTypes.sol";

interface VmV11 {
    function warp(uint256 timestamp) external;
}

contract MockVerifierProxy {
    function verify(bytes calldata report, bytes calldata parameterPayload) external payable returns (bytes memory) {
        require(msg.value == 0 && parameterPayload.length == 0, "subscription verify must be zero fee metadata");
        return report;
    }
}

contract EquityV11AdapterTest {
    VmV11 private constant vm = VmV11(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant FEED_ID = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;

    function _report(uint32 status, int192 mid, uint32 expires, uint64 lastSeen)
        internal pure returns (EquityV11Adapter.ReportV11 memory)
    {
        return EquityV11Adapter.ReportV11({
            feedId: FEED_ID,
            validFromTimestamp: 990,
            observationsTimestamp: 995,
            nativeFee: 123,
            linkFee: 456,
            expiresAt: expires,
            mid: mid,
            lastSeenTimestampNs: lastSeen,
            bid: mid - 1,
            bidVolume: 10,
            ask: mid + 1,
            askVolume: 11,
            lastTradedPrice: mid,
            marketStatus: status
        });
    }

    function _adapter(MockVerifierProxy verifier) internal returns (EquityV11Adapter) {
        return new EquityV11Adapter(address(verifier), address(verifier).codehash, FEED_ID, 8, 1, bytes32(uint256(1)));
    }

    function _adapterScope(MockVerifierProxy verifier, uint8 scope) internal returns (EquityV11Adapter) {
        return new EquityV11Adapter(address(verifier), address(verifier).codehash, FEED_ID, 8, scope, bytes32(uint256(1)));
    }

    function testRoutesThroughVerifierWithEmptyFeeMetadataAndNormalizesV11Body() external {
        vm.warp(1000);
        MockVerifierProxy verifier = new MockVerifierProxy();
        EquityV11Adapter adapter = _adapter(verifier);
        bytes memory report = abi.encode(_report(2, 200_000_000, 1200, 990 * 1e9));
        SourceSample memory sample = adapter.decodeVerified(report);
        require(sample.feedId == FEED_ID && sample.phase == 2, "feed or phase");
        require(sample.price18 == 2e18, "price normalization");
        require(sample.observedAt == 995 && sample.inputAt == 990 && sample.validUntil == 1115, "timestamps");
        require(sample.reportHash == keccak256(report), "report hash");
    }

    function testAllowsNonmonotonicInputTimeButRejectsWrongFeedAndInvalidStatus() external {
        vm.warp(1000);
        MockVerifierProxy verifier = new MockVerifierProxy();
        EquityV11Adapter adapter = _adapter(verifier);
        SourceSample memory sample = adapter.decodeVerified(abi.encode(_report(2, 200_000_000, 1200, 980 * 1e9)));
        require(sample.inputAt == 980, "input timestamp normalization");
        EquityV11Adapter.ReportV11 memory badFeed = _report(2, 200_000_000, 1200, 990 * 1e9);
        badFeed.feedId = bytes32(uint256(2));
        (bool ok,) = address(adapter).call(abi.encodeCall(adapter.decodeVerified, (abi.encode(badFeed))));
        require(!ok, "wrong feed accepted");
        (ok,) = address(adapter).call(abi.encodeCall(adapter.decodeVerified, (abi.encode(_report(6, 200_000_000, 1200, 990 * 1e9)))));
        require(!ok, "invalid market status accepted");
        (ok,) = address(adapter).call(abi.encodeCall(adapter.decodeVerified, (abi.encode(_report(1, 200_000_000, 1200, 990 * 1e9)))));
        require(!ok, "regular-scoped adapter accepted pre-market phase");
    }

    function testRejectsExpiredFutureNegativeAndMalformedReports() external {
        vm.warp(1000);
        MockVerifierProxy verifier = new MockVerifierProxy();
        EquityV11Adapter adapter = _adapter(verifier);
        for (uint256 i; i < 3; ++i) {
            EquityV11Adapter.ReportV11 memory report = _report(2, 200_000_000, 1200, 990 * 1e9);
            if (i == 0) report.expiresAt = 1000;
            if (i == 1) report.mid = -1;
            if (i == 2) report.validFromTimestamp = 1001;
            (bool ok,) = address(adapter).call(abi.encodeCall(adapter.decodeVerified, (abi.encode(report))));
            require(!ok, "invalid signed report accepted");
        }
        (bool malformed,) = address(adapter).call(abi.encodeCall(adapter.decodeVerified, (hex"1234")));
        require(!malformed, "malformed report accepted");
    }

    function testExtendedSourceScopeAcceptsPreAndPostOnly() external {
        vm.warp(1000);
        MockVerifierProxy verifier = new MockVerifierProxy();
        EquityV11Adapter adapter = _adapterScope(verifier, 2);
        SourceSample memory sample = adapter.decodeVerified(abi.encode(_report(1, 200_000_000, 1200, 990 * 1e9)));
        require(sample.phase == 1, "pre-market phase not preserved");
        sample = adapter.decodeVerified(abi.encode(_report(3, 200_000_000, 1200, 990 * 1e9)));
        require(sample.phase == 3, "post-market phase not preserved");
        (bool regularAccepted,) = address(adapter).call(abi.encodeCall(adapter.decodeVerified, (abi.encode(_report(2, 200_000_000, 1200, 990 * 1e9)))));
        require(!regularAccepted, "extended source accepted regular phase");
    }
}
