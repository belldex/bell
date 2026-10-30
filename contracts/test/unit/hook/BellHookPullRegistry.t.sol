// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SessionRegistry} from "../../../src/registries/SessionRegistry.sol";
import {YahooSourceVerifier} from "../../../src/adapters/YahooSourceVerifier.sol";
import {YahooAttestedSourceAdapter} from "../../../src/adapters/YahooAttestedSourceAdapter.sol";
import {AssetDescriptor, SourceWire, SourceSample, OraclePullUpdate, CalendarLeaf} from "../../../src/types/ProtocolTypes.sol";
import {SourceConfigHash} from "../../../src/libraries/SourceConfigHash.sol";
import {CalendarProof} from "../../../src/libraries/CalendarProof.sol";
import {MockSessionCalendar, MockSessionStockToken} from "../../SessionRegistry.t.sol";

interface VmPullRegistry {
    function warp(uint256) external;
    function addr(uint256) external view returns (address);
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
}

contract PullRegistryAssets {
    mapping(bytes32 => AssetDescriptor) private _descriptors;
    mapping(bytes32 => bytes) private _configs;

    function set(AssetDescriptor calldata descriptor_, bytes calldata config) external {
        _descriptors[descriptor_.id] = descriptor_;
        _configs[descriptor_.id] = config;
    }
    function descriptor(bytes32 id) external view returns (AssetDescriptor memory) { return _descriptors[id]; }
    function sourceConfig(bytes32 id) external view returns (bytes memory) { return _configs[id]; }
}

/// @dev Real SessionRegistry/Yahoo direct validation exercises the raw transport used by BellHook.
/// The phase decoder is an admitted deterministic fixture; its validation is covered by registry tests.
contract BellHookPullRegistryTest {
    VmPullRegistry private constant vm = VmPullRegistry(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant STOCK = keccak256("AAPL");
    bytes32 private constant COUNTER = keccak256("USDG");
    bytes32 private constant FEED = bytes32(uint256(11));
    uint256 private constant REPORTER = 0xA11CE;
    PullRegistryAssets private assets;
    MockSessionCalendar private calendar;
    SessionRegistry private registry;
    YahooSourceVerifier private verifier;
    YahooAttestedSourceAdapter private direct;
    bytes32 private streamConfigHash;

    function setUp() external {
        vm.warp(1000);
        assets = new PullRegistryAssets();
        calendar = new MockSessionCalendar();
        calendar.setInterval(CalendarLeaf(STOCK, 2026, 1, 500, 2000, 2, bytes32(uint256(4))));
        MockSessionStockToken token = new MockSessionStockToken();
        SourceWire[] memory wires = new SourceWire[](2);
        wires[0] = SourceWire(3, 1, address(this), FEED, 11, 8, 1, 0, address(this).codehash, address(this), bytes32(uint256(1)));
        wires[1] = SourceWire(1, 0, address(0x1234), bytes32(0), 0, 8, 2, 60, bytes32(uint256(1)), address(0x1234), bytes32(uint256(1)));
        streamConfigHash = SourceConfigHash.hash(wires[0]);
        verifier = new YahooSourceVerifier(vm.addr(REPORTER));
        direct = new YahooAttestedSourceAdapter(verifier, SourceConfigHash.hash(wires[1]), bytes32(0), 0, true, address(0));
        AssetDescriptor memory descriptor_;
        descriptor_.id = STOCK;
        descriptor_.token = address(token);
        descriptor_.isStock = true;
        descriptor_.decimals = 18;
        descriptor_.capabilityMask = 0x1e;
        descriptor_.tokenPriceAdapter = address(direct);
        descriptor_.regularAdapter = address(this);
        assets.set(descriptor_, abi.encode(wires));
        descriptor_.id = COUNTER;
        descriptor_.isStock = false;
        assets.set(descriptor_, abi.encode(new SourceWire[](0)));
        registry = new SessionRegistry(address(assets), address(calendar));
    }

    function sourceConfigHash() external view returns (bytes32) { return streamConfigHash; }
    function fingerprint() external pure returns (bytes32) { return bytes32(uint256(1)); }
    function decodeVerified(bytes calldata report) external pure returns (SourceSample memory) { return abi.decode(report, (SourceSample)); }

    function testPoolTransportPublishesSignedDirectReportsAndHealth() external {
        OraclePullUpdate[] memory updates = _updates();
        registry.applyPoolOracleUpdates(STOCK, COUNTER, abi.encode(address(this), bytes32("request"), updates), true);
        require(registry.health(STOCK).ready, "stock not healthy");
        require(registry.latestSample(STOCK, 2).observedAt == 1000 && direct.readCurrent().observedAt == 1000, "samples not updated");
        require(address(registry).code.length <= 24576, "registry exceeds EIP-170");
        vm.warp(1001);
        registry.applyPoolOracleUpdates(STOCK, COUNTER, abi.encode(_updates()), false);
        require(registry.health(STOCK).latestObservation == 1001, "prepare transport did not refresh");
    }

    function testPoolTransportRejectsLegacyMalformedAndTrailingEnvelope() external {
        _reject(abi.encode(address(this), bytes32("request")), true);
        bytes memory canonical = abi.encode(address(this), bytes32("request"), _updates());
        _reject(bytes.concat(canonical, hex"00"), true);
        OraclePullUpdate[] memory updates = _updates();
        updates[0].assetId = keccak256("outside pool");
        _reject(abi.encode(updates), false);
        require(!registry.health(STOCK).ready, "rejected update changed health");
    }

    function testPoolTransportBadSignatureAndReplayRemainRejected() external {
        OraclePullUpdate[] memory updates = _updates();
        updates[0].directSignature = new bytes(65);
        _reject(abi.encode(updates), false);
        require(registry.latestSample(STOCK, 2).observedAt == 0, "bad signature wrote stream");
        updates = _updates();
        registry.applyPoolOracleUpdates(STOCK, COUNTER, abi.encode(updates), false);
        _reject(abi.encode(updates), false);
        require(direct.readCurrent().observedAt == 1000, "replay changed direct sample");
    }

    function testPoolTransportCapturesCanonicalCloseAfterReportsAndRollsBackBadBoundary() external {
        CalendarLeaf memory upcoming = CalendarLeaf(STOCK, 2026, 2, 1100, 2000, 5, bytes32(uint256(5)));
        calendar.setInterval(CalendarLeaf(STOCK, 2026, 1, 500, 1100, 2, bytes32(uint256(4))));
        calendar.setNextInterval(upcoming);
        OraclePullUpdate[] memory updates = _updates();
        updates[0].closeBoundaryHash = keccak256("noncanonical boundary");
        _reject(abi.encode(updates), false);
        require(registry.latestSample(STOCK, 2).observedAt == 0 && !registry.health(STOCK).ready, "bad anchor retained reports");
        updates[0].closeBoundaryHash = CalendarProof.hashLeaf(block.chainid, address(calendar), upcoming);
        registry.applyPoolOracleUpdates(STOCK, COUNTER, abi.encode(updates), false);
        require(registry.closeAnchor(STOCK, updates[0].closeBoundaryHash).observedAt == 1000, "canonical anchor missing");
    }

    function testPoolTransportCannotCaptureCloseOutsideFiveMinuteWindow() external {
        CalendarLeaf memory upcoming = CalendarLeaf(STOCK, 2026, 2, 1301, 2000, 5, bytes32(uint256(5)));
        calendar.setInterval(CalendarLeaf(STOCK, 2026, 1, 500, 1301, 2, bytes32(uint256(4))));
        calendar.setNextInterval(upcoming);
        OraclePullUpdate[] memory updates = _updates();
        updates[0].closeBoundaryHash = CalendarProof.hashLeaf(block.chainid, address(calendar), upcoming);
        _reject(abi.encode(updates), false);
        require(registry.latestSample(STOCK, 2).observedAt == 0, "out-of-window capture retained reports");
    }

    function _updates() private view returns (OraclePullUpdate[] memory updates) {
        updates = new OraclePullUpdate[](1);
        updates[0].assetId = STOCK;
        uint64 at = uint64(block.timestamp);
        SourceSample memory sample = SourceSample(bytes32(0), bytes32(0), 0, 100e18, at, at, at, at + 120, at + 120, keccak256(abi.encode("direct", at)));
        updates[0].directSample = sample;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(REPORTER, verifier.digest(direct.sourceConfigHash(), sample));
        updates[0].directSignature = abi.encodePacked(r, s, v);
        SourceSample memory stream = SourceSample(STOCK, FEED, 2, 100e18, at, at, at, at + 120, at + 120, keccak256(abi.encode("stream", at)));
        updates[0].reports = new bytes[](1);
        updates[0].reports[0] = abi.encode(stream);
    }

    function _reject(bytes memory payload, bool swapEnvelope) private {
        (bool ok,) = address(registry).call(abi.encodeCall(registry.applyPoolOracleUpdates, (STOCK, COUNTER, payload, swapEnvelope)));
        require(!ok, "invalid transport accepted");
    }
}
