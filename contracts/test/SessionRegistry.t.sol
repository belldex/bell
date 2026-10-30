// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {YahooSourceVerifier} from "../src/adapters/YahooSourceVerifier.sol";
import {YahooAttestedSourceAdapter} from "../src/adapters/YahooAttestedSourceAdapter.sol";
import {SessionRegistry} from "../src/registries/SessionRegistry.sol";
import {AssetDescriptor, SourceWire, SourceSample, HealthView, Anchor, CalendarLeaf, ReasonBits} from "../src/types/ProtocolTypes.sol";
import {SourceConfigHash} from "../src/libraries/SourceConfigHash.sol";
import {CalendarProof} from "../src/libraries/CalendarProof.sol";

interface VmSession {
    function warp(uint256 timestamp) external;
    function addr(uint256 key) external view returns (address);
    function sign(uint256 key, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
}

contract MockSessionCalendar {
    CalendarLeaf private _interval;
    CalendarLeaf private _nextInterval;
    bool public malformed;

    function setInterval(CalendarLeaf calldata interval_) external { _interval = interval_; }
    function setNextInterval(CalendarLeaf calldata interval_) external { _nextInterval = interval_; }
    function setMalformed(bool value) external { malformed = value; }
    function currentInterval(bytes32) external view returns (CalendarLeaf memory interval) {
        if (malformed) {
            bytes32 assetId = _interval.assetId;
            uint64 start = _interval.start;
            uint64 end = _interval.end;
            assembly ("memory-safe") {
                mstore(0, assetId)
                // Deliberately non-canonical uint32 year word; its low bits remain a plausible year.
                mstore(32, add(shl(32, 1), 2026))
                mstore(64, 1)
                mstore(96, start)
                mstore(128, end)
                mstore(160, 2)
                mstore(192, 4)
                return(0, 224)
            }
        }
        return _interval;
    }
    function nextInterval(bytes32) external view returns (CalendarLeaf memory interval) { return _nextInterval; }
}

contract MockSessionStockToken {
    uint256 public multiplier = 1e18;
    uint256 public nextMultiplier = 1e18;
    uint256 public effective;
    bool public paused;
    bool public failGetters;
    uint8 public malformedMode;

    function uiMultiplier() external view returns (uint256) {
        require(!failGetters, "getter");
        if (malformedMode == 1) assembly ("memory-safe") { return(0, 131072) }
        return multiplier;
    }
    function newUIMultiplier() external view returns (uint256) { require(!failGetters, "getter"); return nextMultiplier; }
    function effectiveAt() external view returns (uint256) { require(!failGetters, "getter"); return effective; }
    function oraclePaused() external view returns (bool) {
        require(!failGetters, "getter");
        if (malformedMode == 2) assembly ("memory-safe") { mstore(0, 2) return(0, 32) }
        return paused;
    }
    function set(uint256 multiplier_, uint256 nextMultiplier_, uint256 effective_, bool paused_) external {
        multiplier = multiplier_; nextMultiplier = nextMultiplier_; effective = effective_; paused = paused_;
    }
    function setFailGetters(bool value) external { failGetters = value; }
    function setMalformedMode(uint8 value) external { malformedMode = value; }
}

contract MockSessionAssets {
    AssetDescriptor private _descriptor;
    bytes private _sourceConfig;

    constructor(AssetDescriptor memory descriptor_, bytes memory sourceConfig_) {
        _descriptor = descriptor_;
        _sourceConfig = sourceConfig_;
    }

    function descriptor(bytes32) external view returns (AssetDescriptor memory) { return _descriptor; }
    function sourceConfig(bytes32) external view returns (bytes memory) { return _sourceConfig; }
}

contract MockSessionAdapter {
    bytes32 public configHash;
    bytes32 public fingerprintValue = bytes32(uint256(1));

    function decodeVerified(bytes calldata encoded) external pure returns (SourceSample memory sample) {
        sample = abi.decode(encoded, (SourceSample));
    }
    function sourceConfigHash() external view returns (bytes32) { return configHash; }
    function fingerprint() external view returns (bytes32) { return fingerprintValue; }
    function setConfigHash(bytes32 value) external { configHash = value; }
}

contract MockSessionQuoteSource {
    SourceSample private _sample;
    bytes32 private _configHash;
    bytes32 public fingerprintValue;
    bool public unavailable;

    constructor(SourceSample memory sample_) {
        _sample = sample_;
        fingerprintValue = bytes32(uint256(1));
    }

    function sourceConfigHash() external view returns (bytes32) { return _configHash; }
    function fingerprint() external view returns (bytes32) { return fingerprintValue; }
    function readCurrent() external view returns (SourceSample memory) {
        require(!unavailable, "unavailable");
        return _sample;
    }

    function setSample(SourceSample calldata sample_) external { _sample = sample_; }
    function setConfigHash(bytes32 value) external { _configHash = value; }
    function setUnavailable(bool value) external { unavailable = value; }
}

contract MalformedReturnQuoteSource {
    bytes32 public configHash;
    uint8 public mode;

    function sourceConfigHash() external view returns (bytes32) { return configHash; }
    function fingerprint() external pure returns (bytes32) { return bytes32(uint256(1)); }
    function setConfigHash(bytes32 value) external { configHash = value; }
    function setMode(uint8 value) external { mode = value; }

    fallback() external {
        if (mode == 0) {
            assembly ("memory-safe") {
                mstore(0, 0)
                return(0, 32)
            }
        }
        assembly ("memory-safe") {
            // SourceSample has ten ABI words. Word two deliberately exceeds uint8.
            mstore(0, 0)
            mstore(32, 0)
            mstore(64, 256)
            mstore(96, 1)
            mstore(128, 999)
            mstore(160, 999)
            mstore(192, 999)
            mstore(224, 1059)
            mstore(256, 1059)
            mstore(288, 1)
            return(0, 320)
        }
    }
}

contract GasBoundQuoteSource {
    bytes32 public configHash;

    function sourceConfigHash() external view returns (bytes32) { return configHash; }
    function fingerprint() external pure returns (bytes32) { return bytes32(uint256(1)); }
    function setConfigHash(bytes32 value) external { configHash = value; }

    fallback() external {
        assembly ("memory-safe") {
            // A normal unbounded external call can return a sample, but the registry must cap this read.
            if lt(gas(), 110000) { revert(0, 0) }
            mstore(0, 0)
            mstore(32, 0)
            mstore(64, 0)
            mstore(96, 1)
            mstore(128, 999)
            mstore(160, 999)
            mstore(192, 999)
            mstore(224, 1059)
            mstore(256, 1059)
            mstore(288, 1)
            return(0, 320)
        }
    }
}

contract OversizedReturnQuoteSource {
    bytes32 public configHash;

    function sourceConfigHash() external view returns (bytes32) { return configHash; }
    function fingerprint() external pure returns (bytes32) { return bytes32(uint256(1)); }
    function setConfigHash(bytes32 value) external { configHash = value; }

    fallback() external {
        assembly ("memory-safe") {
            // Successful 128 KiB returndata must not be copied into SessionRegistry memory.
            return(0, 131072)
        }
    }
}

contract ReentrantSessionAdapter {
    address public registry;
    bytes32 public immutable assetId;
    bytes private nestedReport;
    bool private entered;
    bool public nestedAccepted;

    constructor(bytes32 assetId_, bytes memory nestedReport_) {
        assetId = assetId_;
        nestedReport = nestedReport_;
    }

    function setRegistry(address registry_) external { registry = registry_; }

    function decodeVerified(bytes calldata encoded) external returns (SourceSample memory sample) {
        if (!entered) {
            entered = true;
            bytes[] memory batch = new bytes[](1);
            batch[0] = nestedReport;
            (nestedAccepted,) = registry.call(abi.encodeWithSignature("submitReports(bytes32,bytes[])", assetId, batch));
        }
        return abi.decode(encoded, (SourceSample));
    }
}

contract SessionRegistryTest {
    VmSession private constant vm = VmSession(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant ASSET = bytes32(uint256(0xA55E7));

    function _wire(address, bytes32 feedId, uint8 scope) internal view returns (SourceWire memory) {
        return SourceWire({
            kind: 3, phaseScope: scope, endpoint: address(this), feedId: feedId, schema: 11,
            decimals: 8, priceBasis: 1, heartbeatSec: 0, expectedCodeHash: address(this).codehash,
            expectedImplementation: address(this), canonicalTokenId: bytes32(uint256(1))
        });
    }

    function _sample(bytes32 feedId, uint8 phase, uint64 observedAt, uint64 inputAt, uint64 validUntil, uint8 tag)
        internal pure returns (SourceSample memory)
    {
        return SourceSample({
            descriptorId: ASSET, feedId: feedId, phase: phase, price18: 2e18,
            observedAt: observedAt, inputAt: inputAt, validFrom: observedAt - 1,
            expiresAt: validUntil, validUntil: validUntil, reportHash: bytes32(uint256(tag))
        });
    }

    function _registry() internal returns (SessionRegistry registry) {
        MockSessionAdapter regular = new MockSessionAdapter();
        MockSessionAdapter extended = new MockSessionAdapter();
        SourceWire[] memory wires = new SourceWire[](2);
        wires[0] = _wire(address(regular), bytes32(uint256(1)), 1);
        wires[1] = _wire(address(extended), bytes32(uint256(2)), 2);
        AssetDescriptor memory descriptor_ = AssetDescriptor({
            id: ASSET, token: address(this), isStock: true, decimals: 18, capabilityMask: 0x06,
            tokenPriceAdapter: address(0), regularAdapter: address(regular), extendedAdapter: address(extended),
            overnightAdapter: address(0), secondaryAdapter: address(0), expectedCodeHash: bytes32(uint256(1)),
            implementationFingerprint: bytes32(uint256(2)), evidenceHash: bytes32(uint256(3))
        });
        MockSessionAssets assets = new MockSessionAssets(descriptor_, abi.encode(wires));
        registry = new SessionRegistry(address(assets), address(0));
    }

    // These behavior doubles exercise SessionRegistry's fail-closed boundaries only; they do not
    // establish official getter authenticity or cryptographic stream authenticity.
    function _stockHealthRegistry(uint8 calendarPhase)
        internal
        returns (SessionRegistry registry, MockSessionCalendar calendar, MockSessionStockToken token, MockSessionQuoteSource direct)
    {
        return _stockHealthRegistryWithCapability(calendarPhase, 0x1e);
    }

    function _stockHealthRegistryWithCapability(uint8 calendarPhase, uint8 capabilityMask)
        internal
        returns (SessionRegistry registry, MockSessionCalendar calendar, MockSessionStockToken token, MockSessionQuoteSource direct)
    {
        MockSessionAdapter stream = new MockSessionAdapter();
        token = new MockSessionStockToken();
        SourceSample memory directSample = SourceSample({
            descriptorId: bytes32(0), feedId: bytes32(0), phase: 0, price18: 100e18,
            observedAt: uint64(block.timestamp), inputAt: uint64(block.timestamp), validFrom: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 600), validUntil: uint64(block.timestamp + 600), reportHash: bytes32(uint256(77))
        });
        direct = new MockSessionQuoteSource(directSample);
        uint8 scope = calendarPhase == 2 ? 1 : calendarPhase == 4 ? 3 : 2;
        bytes32 feedId = bytes32(uint256(11));
        SourceWire[] memory wires = new SourceWire[](2);
        wires[0] = _wire(address(stream), feedId, scope);
        wires[1] = SourceWire({
            kind: 1, phaseScope: 0, endpoint: address(direct), feedId: bytes32(0), schema: 0,
            decimals: 8, priceBasis: 2, heartbeatSec: 60, expectedCodeHash: address(direct).codehash,
            expectedImplementation: address(direct), canonicalTokenId: bytes32(uint256(1))
        });
        stream.setConfigHash(SourceConfigHash.hash(wires[0]));
        direct.setConfigHash(SourceConfigHash.hash(wires[1]));
        AssetDescriptor memory descriptor_ = AssetDescriptor({
            id: ASSET, token: address(token), isStock: true, decimals: 18, capabilityMask: capabilityMask,
            tokenPriceAdapter: address(direct), regularAdapter: address(stream), extendedAdapter: address(stream),
            overnightAdapter: address(stream), secondaryAdapter: address(0), expectedCodeHash: bytes32(uint256(1)),
            implementationFingerprint: bytes32(uint256(2)), evidenceHash: bytes32(uint256(3))
        });
        calendar = new MockSessionCalendar();
        calendar.setInterval(CalendarLeaf({
            assetId: ASSET, year: 2026, index: 1, start: uint64(block.timestamp - 1), end: uint64(block.timestamp + 1_000),
            phase: calendarPhase, provenanceHash: bytes32(uint256(4))
        }));
        registry = new SessionRegistry(address(new MockSessionAssets(descriptor_, abi.encode(wires))), address(calendar));
    }

    function _submitStockSample(SessionRegistry registry, uint8 phase, uint64 observedAt, uint64 inputAt, uint128 price18) internal {
        SourceSample memory sample = _sample(bytes32(uint256(11)), phase, observedAt, inputAt, uint64(block.timestamp + 120), 99);
        sample.price18 = price18;
        sample.reportHash = keccak256(abi.encode(phase, observedAt, inputAt));
        bytes[] memory reports = new bytes[](1);
        reports[0] = abi.encode(sample);
        registry.submitReports(ASSET, reports);
    }

    function _pullRegistry(bool stock) internal returns (SessionRegistry registry, YahooAttestedSourceAdapter direct, YahooSourceVerifier verifier) {
        (SessionRegistry original, MockSessionCalendar calendar,,) = _stockHealthRegistry(2);
        AssetDescriptor memory descriptor_ = original.assetRegistry().descriptor(ASSET);
        bytes memory config = original.assetRegistry().sourceConfig(ASSET);
        SourceWire[] memory wires = abi.decode(config, (SourceWire[]));
        verifier = new YahooSourceVerifier(vm.addr(0xA11CE));
        direct = new YahooAttestedSourceAdapter(verifier, SourceConfigHash.hash(wires[1]), bytes32(0), 0, true, address(0));
        descriptor_.tokenPriceAdapter = address(direct);
        descriptor_.isStock = stock;
        registry = new SessionRegistry(address(new MockSessionAssets(descriptor_, config)), address(calendar));
    }

    function _pullDirect(uint64 at) internal pure returns (SourceSample memory sample) {
        sample = _sample(bytes32(0), 0, at, at, at + 120, 77);
        sample.descriptorId = bytes32(0);
        sample.price18 = 100e18;
        sample.reportHash = keccak256(abi.encode("direct", at));
    }

    function _pullSignature(YahooSourceVerifier verifier, YahooAttestedSourceAdapter direct, SourceSample memory sample, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(key, verifier.digest(direct.sourceConfigHash(), sample));
        return abi.encodePacked(r, sigS, v);
    }

    function _pullReports(uint64 at) internal pure returns (bytes[] memory reports) {
        SourceSample memory sample = _sample(bytes32(uint256(11)), 2, at, at, at + 120, 99);
        sample.price18 = 100e18;
        sample.reportHash = keccak256(abi.encode("stream", at));
        reports = new bytes[](1);
        reports[0] = abi.encode(sample);
    }

    function _callPull(SessionRegistry registry, SourceSample memory direct, bytes memory signature, bytes[] memory reports) internal returns (bool ok, bytes memory data) {
        return address(registry).call(abi.encodeCall(registry.refreshStockWithReports, (ASSET, direct, signature, reports)));
    }

    function testPullRefreshPublishesDirectReportsAndHealthAtomically() external {
        vm.warp(1000);
        (SessionRegistry registry, YahooAttestedSourceAdapter direct, YahooSourceVerifier verifier) = _pullRegistry(true);
        SourceSample memory sample = _pullDirect(1000);
        (bool ok, bytes memory data) = _callPull(registry, sample, _pullSignature(verifier, direct, sample, 0xA11CE), _pullReports(1000));
        require(ok, "atomic stock refresh failed");
        require(abi.decode(data, (uint256)) == 0, "unexpected reasons");
        require(direct.readCurrent().reportHash == sample.reportHash, "direct not published");
        require(registry.latestSample(ASSET, 2).observedAt == 1000, "stream not submitted");
        HealthView memory health_ = registry.health(ASSET);
        require(health_.ready && health_.healthySince == 1000 && health_.validUntil == 1060, "health or freshness changed");
    }

    function testPullRefreshRejectsNonStockAndBadDirectSignature() external {
        vm.warp(1000);
        (SessionRegistry registry, YahooAttestedSourceAdapter direct, YahooSourceVerifier verifier) = _pullRegistry(false);
        SourceSample memory sample = _pullDirect(1000);
        (bool ok,) = _callPull(registry, sample, _pullSignature(verifier, direct, sample, 0xA11CE), _pullReports(1000));
        require(!ok, "non-stock accepted");
        (ok,) = address(direct).call(abi.encodeCall(direct.readCurrent, ()));
        require(!ok, "non-stock direct published");
        (registry, direct, verifier) = _pullRegistry(true);
        (ok,) = _callPull(registry, sample, _pullSignature(verifier, direct, sample, 0xB0B), _pullReports(1000));
        require(!ok && registry.latestSample(ASSET, 2).observedAt == 0 && !registry.health(ASSET).ready, "bad signature wrote state");
        (ok,) = address(direct).call(abi.encodeCall(direct.readCurrent, ()));
        require(!ok, "bad signature direct published");
    }

    function testPullRefreshInvalidReportsRollbackDirectAndAllowRetry() external {
        vm.warp(1000);
        (SessionRegistry registry, YahooAttestedSourceAdapter direct, YahooSourceVerifier verifier) = _pullRegistry(true);
        SourceSample memory sample = _pullDirect(1000);
        bytes memory signature = _pullSignature(verifier, direct, sample, 0xA11CE);
        for (uint256 mode; mode < 5; ++mode) {
            bytes[] memory reports = _pullReports(1000);
            SourceSample memory invalid = abi.decode(reports[0], (SourceSample));
            if (mode == 0) invalid.descriptorId = bytes32(uint256(123));
            if (mode == 1) invalid.feedId = bytes32(uint256(123));
            if (mode == 2) invalid.phase = 4;
            if (mode == 3) { invalid.observedAt = 880; invalid.validFrom = 879; invalid.validUntil = 1001; invalid.expiresAt = 1001; }
            if (mode == 4) invalid.inputAt = 939;
            reports[0] = abi.encode(invalid);
            (bool ok,) = _callPull(registry, sample, signature, reports);
            require(!ok && registry.latestSample(ASSET, 2).observedAt == 0 && !registry.health(ASSET).ready, "invalid report wrote state");
            (ok,) = address(direct).call(abi.encodeCall(direct.readCurrent, ()));
            require(!ok, "report failure retained direct write");
        }
        (bool accepted,) = _callPull(registry, sample, signature, _pullReports(1000));
        require(accepted && registry.health(ASSET).ready, "rollback prevented valid retry");
    }

    function testPullRefreshReplayRollsBackNewDirectAndPreservesHealth() external {
        vm.warp(1000);
        (SessionRegistry registry, YahooAttestedSourceAdapter direct, YahooSourceVerifier verifier) = _pullRegistry(true);
        SourceSample memory sample = _pullDirect(1000);
        (bool ok,) = _callPull(registry, sample, _pullSignature(verifier, direct, sample, 0xA11CE), _pullReports(1000));
        require(ok, "initial pull failed");
        bytes32 previousHealth = keccak256(abi.encode(registry.health(ASSET)));
        vm.warp(1001);
        (ok,) = _callPull(registry, sample, _pullSignature(verifier, direct, sample, 0xA11CE), _pullReports(1001));
        require(!ok && registry.latestSample(ASSET, 2).observedAt == 1000, "direct replay accepted or wrote stream");
        sample = _pullDirect(1001);
        (ok,) = _callPull(registry, sample, _pullSignature(verifier, direct, sample, 0xA11CE), _pullReports(1000));
        require(!ok, "stream replay accepted");
        require(direct.readCurrent().observedAt == 1000 && registry.latestSample(ASSET, 2).observedAt == 1000, "replay wrote samples");
        require(keccak256(abi.encode(registry.health(ASSET))) == previousHealth, "replay changed health");
        (ok,) = _callPull(registry, sample, _pullSignature(verifier, direct, sample, 0xA11CE), _pullReports(1001));
        require(ok && registry.latestSample(ASSET, 2).observedAt == 1001, "new observation rejected after rollback");
    }

    function testStockHealthRequiresCalendarAndAgreedRegularSources() external {
        vm.warp(1_000);
        (SessionRegistry registry,,,) = _stockHealthRegistry(2);
        _submitStockSample(registry, 2, 1_000, 1_000, 100e18);
        uint256 reasons = registry.refreshHealth(ASSET);
        require(reasons == 0 && registry.health(ASSET).ready, "regular stock dependencies did not agree");

        // A configured but unavailable calendar must never be treated as open.
        SessionRegistry withoutCalendar = new SessionRegistry(address(new MockSessionAssets(
            AssetDescriptor({
                id: ASSET, token: address(this), isStock: true, decimals: 18, capabilityMask: 0,
                tokenPriceAdapter: address(0), regularAdapter: address(0), extendedAdapter: address(0), overnightAdapter: address(0),
                secondaryAdapter: address(0), expectedCodeHash: bytes32(0), implementationFingerprint: bytes32(0), evidenceHash: bytes32(0)
            }), abi.encode(new SourceWire[](0))
        )), address(0));
        reasons = withoutCalendar.refreshHealth(ASSET);
        require(!withoutCalendar.health(ASSET).ready && reasons & (1 << 5) != 0, "missing calendar was permissive");
    }

    function testStockHealthValidityCannotOutliveCurrentSupportedCalendarPhase() external {
        vm.warp(1_000);
        (SessionRegistry registry, MockSessionCalendar calendar,,) = _stockHealthRegistry(2);
        calendar.setInterval(CalendarLeaf({
            assetId: ASSET, year: 2026, index: 1, start: 999, end: 1_020, phase: 2, provenanceHash: bytes32(uint256(4))
        }));
        _submitStockSample(registry, 2, 1_000, 1_000, 100e18);
        require(registry.refreshHealth(ASSET) == 0 && registry.health(ASSET).validUntil == 1_020,
            "stock health outlived its current calendar phase");
    }

    function testStockHealthExpiresAtInputFreshnessDeadlineWithoutRefreshAndResetsAfterGap() external {
        vm.warp(1_000);
        (SessionRegistry registry,,, ) = _stockHealthRegistry(2);
        _submitStockSample(registry, 2, 1_000, 1_000, 100e18);
        registry.refreshHealth(ASSET);
        require(registry.health(ASSET).validUntil == 1_060, "input deadline missing from health validity");
        vm.warp(1_060);
        require(!registry.health(ASSET).ready, "health remained ready at exact input freshness deadline");

        vm.warp(1_061);
        _submitStockSample(registry, 2, 1_061, 1_061, 100e18);
        registry.refreshHealth(ASSET);
        require(registry.health(ASSET).ready && registry.health(ASSET).healthySince == 1_061,
            "fresh sample after missed deadline did not reset healthySince");
    }

    function testMalformedCalendarLeafNarrowFieldsPersistCalendarFailure() external {
        vm.warp(1_000);
        (SessionRegistry registry, MockSessionCalendar calendar,,) = _stockHealthRegistry(2);
        _submitStockSample(registry, 2, 1_000, 1_000, 100e18);
        calendar.setMalformed(true);
        uint256 reasons = registry.refreshHealth(ASSET);
        HealthView memory view_ = registry.health(ASSET);
        require(!view_.ready && view_.reasonBits == reasons && reasons & (1 << 5) != 0,
            "malformed calendar narrow field was truncated or reverted");
    }

    function testOversizedAndMalformedCorporateGetterResponsesPersistFailureWithinBoundedCallerGas() external {
        vm.warp(1_000);
        (SessionRegistry registry,, MockSessionStockToken token,) = _stockHealthRegistry(2);
        _submitStockSample(registry, 2, 1_000, 1_000, 100e18);
        token.setMalformedMode(1);
        (bool ok, bytes memory data) = address(registry).call{gas: 125_000}(abi.encodeCall(registry.refreshHealth, (ASSET)));
        require(ok, "oversized corporate getter exhausted caller gas");
        uint256 reasons = abi.decode(data, (uint256));
        require(!registry.health(ASSET).ready && reasons & (1 << 10) != 0, "oversized corporate getter accepted");

        token.setMalformedMode(2);
        reasons = registry.refreshHealth(ASSET);
        require(!registry.health(ASSET).ready && reasons & (1 << 10) != 0, "malformed corporate getter accepted");
    }

    function testStockHealthRejectsCalendarPhaseOutsideAssetCapability() external {
        vm.warp(1_000);
        (SessionRegistry registry,,,) = _stockHealthRegistryWithCapability(2, 0x02);
        _submitStockSample(registry, 2, 1_000, 1_000, 100e18);
        uint256 reasons = registry.refreshHealth(ASSET);
        require(!registry.health(ASSET).ready && reasons & (1 << 6) != 0, "unsupported calendar phase was ready");
    }

    function testStockHealthSelectsExtendedPostFeedAndRejectsStaleAndDeviation() external {
        vm.warp(1_000);
        (SessionRegistry registry,, , MockSessionQuoteSource direct) = _stockHealthRegistry(3);
        _submitStockSample(registry, 3, 1_000, 1_000, 100e18);
        require(registry.refreshHealth(ASSET) == 0 && registry.health(ASSET).ready, "post feed was not selected");

        SourceSample memory directSample = SourceSample({
            descriptorId: bytes32(0), feedId: bytes32(0), phase: 0, price18: 102e18,
            observedAt: 1_000, inputAt: 1_000, validFrom: 1_000, expiresAt: 1_600, validUntil: 1_600, reportHash: bytes32(uint256(78))
        });
        direct.setSample(directSample);
        uint256 reasons = registry.refreshHealth(ASSET);
        require(!registry.health(ASSET).ready && reasons & (1 << 10) != 0, "asymmetric or loose deviation accepted");

        directSample.price18 = 100e18;
        directSample.observedAt = 399;
        directSample.inputAt = 399;
        direct.setSample(directSample);
        reasons = registry.refreshHealth(ASSET);
        require(!registry.health(ASSET).ready && reasons & (1 << 9) != 0, "stale direct price accepted");
    }

    function testStockHealthRejectsStaleSignedInputAndCorporateFailuresAndResetsHealthySince() external {
        vm.warp(1_000);
        (SessionRegistry registry,, MockSessionStockToken token,) = _stockHealthRegistry(2);
        _submitStockSample(registry, 2, 1_000, 1_000, 100e18);
        registry.refreshHealth(ASSET);
        uint64 healthySince = registry.health(ASSET).healthySince;
        vm.warp(1_001);
        registry.refreshHealth(ASSET);
        require(registry.health(ASSET).healthySince == healthySince, "continuous healthy interval reset");

        vm.warp(1_061); // Regular input cap is 60 seconds; the direct source remains fresh for 600 seconds.
        uint256 reasons = registry.refreshHealth(ASSET);
        require(!registry.health(ASSET).ready && registry.health(ASSET).healthySince == 0 && reasons & (1 << 8) != 0,
            "stale regular signed input accepted");

        token.set(1e18, 1e18, 0, true);
        reasons = registry.refreshHealth(ASSET);
        require(!registry.health(ASSET).ready && registry.health(ASSET).healthySince == 0 && reasons & (1 << 3) != 0, "paused issuer accepted");
        token.setFailGetters(true);
        reasons = registry.refreshHealth(ASSET);
        require(!registry.health(ASSET).ready && reasons & (1 << 10) != 0, "failed multiplier getter accepted");
    }

    function testAcceptedBatchUpdatesEachFeedAndExposesLatestPhaseSamples() external {
        vm.warp(1000);
        SessionRegistry registry = _registry();
        bytes[] memory reports = new bytes[](2);
        reports[0] = abi.encode(_sample(bytes32(uint256(1)), 2, 1000, 999, 1120, 1));
        reports[1] = abi.encode(_sample(bytes32(uint256(2)), 1, 1000, 998, 1120, 2));
        registry.submitReports(ASSET, reports);
        SourceSample memory regular = registry.latestSample(ASSET, 2);
        SourceSample memory extended = registry.latestSample(ASSET, 1);
        require(regular.feedId == bytes32(uint256(1)) && regular.observedAt == 1000, "regular sample not stored");
        require(extended.feedId == bytes32(uint256(2)) && extended.inputAt == 998, "extended sample not stored");
    }

    function testInvalidBatchDoesNotPartiallyAdvanceFeedsOrHashes() external {
        vm.warp(1000);
        SessionRegistry registry = _registry();
        bytes[] memory reports = new bytes[](2);
        reports[0] = abi.encode(_sample(bytes32(uint256(1)), 2, 1000, 999, 1120, 1));
        reports[1] = abi.encode(_sample(bytes32(uint256(2)), 2, 1000, 998, 1120, 2));
        (bool accepted,) = address(registry).call(abi.encodeCall(registry.submitReports, (ASSET, reports)));
        require(!accepted, "wrong phase report batch accepted");
        SourceSample memory regular = registry.latestSample(ASSET, 2);
        require(regular.feedId == bytes32(0), "valid first report partially committed");

        reports[1] = abi.encode(_sample(bytes32(uint256(2)), 1, 1000, 998, 1120, 2));
        registry.submitReports(ASSET, reports);
        require(registry.latestSample(ASSET, 2).observedAt == 1000, "valid batch rejected after rollback");
    }

    function testDuplicateObservationCannotRefreshCachedSample() external {
        vm.warp(1000);
        SessionRegistry registry = _registry();
        bytes[] memory report = new bytes[](1);
        report[0] = abi.encode(_sample(bytes32(uint256(1)), 2, 1000, 999, 1120, 1));
        registry.submitReports(ASSET, report);
        (bool replay,) = address(registry).call(abi.encodeCall(registry.submitReports, (ASSET, report)));
        require(!replay, "duplicate observation extended sample lifetime");
        require(registry.latestSample(ASSET, 2).observedAt == 1000, "cached observation was overwritten");
    }

    function testStockCannotBeHealthReadyWithoutCorporateMultiplierEvidence() external {
        vm.warp(1000);
        SessionRegistry registry = _registry();
        bytes[] memory reports = new bytes[](2);
        reports[0] = abi.encode(_sample(bytes32(uint256(1)), 2, 1000, 999, 1120, 1));
        reports[1] = abi.encode(_sample(bytes32(uint256(2)), 1, 1000, 998, 1120, 2));
        registry.submitReports(ASSET, reports);
        uint256 reasons = registry.refreshHealth(ASSET);
        HealthView memory view_ = registry.health(ASSET);
        require(!view_.ready && reasons & (1 << 10) != 0, "stock marked healthy without corporate status checks");
    }

    function testNonStockQuoteSourceMakesHealthReadyAndPreservesHealthySinceWithinValidityWindow() external {
        vm.warp(1_000);
        SourceWire memory wire = SourceWire({
            kind: 2, phaseScope: 0, endpoint: address(this), feedId: bytes32(0), schema: 0,
            decimals: 8, priceBasis: 3, heartbeatSec: 60, expectedCodeHash: address(this).codehash,
            expectedImplementation: address(this), canonicalTokenId: bytes32(uint256(2))
        });
        SourceSample memory sample = SourceSample({
            descriptorId: bytes32(0), feedId: bytes32(0), phase: 0, price18: 2e18,
            observedAt: 999, inputAt: 999, validFrom: 999, expiresAt: 1_059, validUntil: 1_059,
            reportHash: bytes32(uint256(4))
        });
        MockSessionQuoteSource source = new MockSessionQuoteSource(sample);
        wire.endpoint = address(source);
        source.setConfigHash(SourceConfigHash.hash(wire));
        AssetDescriptor memory descriptor_ = AssetDescriptor({
            id: ASSET, token: address(this), isStock: false, decimals: 18, capabilityMask: 0,
            tokenPriceAdapter: address(source), regularAdapter: address(0), extendedAdapter: address(0),
            overnightAdapter: address(0), secondaryAdapter: address(0), expectedCodeHash: bytes32(uint256(1)),
            implementationFingerprint: bytes32(uint256(2)), evidenceHash: bytes32(uint256(3))
        });
        SourceWire[] memory wires = new SourceWire[](1);
        wires[0] = wire;
        SessionRegistry registry = new SessionRegistry(address(new MockSessionAssets(descriptor_, abi.encode(wires))), address(0));

        uint256 reasons = registry.refreshHealth(ASSET);
        HealthView memory first = registry.health(ASSET);
        vm.warp(1_001);
        registry.refreshHealth(ASSET);
        HealthView memory second = registry.health(ASSET);

        require(reasons == 0 && first.ready, "valid quote source not ready");
        require(first.validUntil == 1_059 && first.baselineObservation == 999 && first.latestObservation == 999, "health fields not derived from quote");
        require(second.ready && second.healthySince == first.healthySince, "healthy checkpoint reset within validity window");

        source.setUnavailable(true);
        reasons = registry.refreshHealth(ASSET);
        HealthView memory unhealthy = registry.health(ASSET);
        require(!unhealthy.ready && unhealthy.healthySince == 0 && unhealthy.reasonBits == reasons && reasons & (1 << 9) != 0, "healthy to unhealthy transition was not persisted");

        vm.warp(1_060);
        source.setUnavailable(false);
        sample.observedAt = 1_060;
        sample.inputAt = 1_060;
        sample.validFrom = 1_060;
        sample.expiresAt = 1_120;
        sample.validUntil = 1_120;
        source.setSample(sample);
        registry.refreshHealth(ASSET);
        HealthView memory recovered = registry.health(ASSET);
        require(recovered.ready && recovered.healthySince == 1_060 && recovered.healthySince != first.healthySince, "recovery after expiry did not reset healthySince");
    }

    function testNonStockUnavailableQuoteSourceRecordsUnhealthyWithoutRevert() external {
        vm.warp(1_000);
        SourceWire memory wire = SourceWire({
            kind: 2, phaseScope: 0, endpoint: address(this), feedId: bytes32(0), schema: 0,
            decimals: 8, priceBasis: 3, heartbeatSec: 60, expectedCodeHash: address(this).codehash,
            expectedImplementation: address(this), canonicalTokenId: bytes32(uint256(2))
        });
        SourceSample memory sample = SourceSample({
            descriptorId: bytes32(0), feedId: bytes32(0), phase: 0, price18: 2e18,
            observedAt: 999, inputAt: 999, validFrom: 999, expiresAt: 1_059, validUntil: 1_059,
            reportHash: bytes32(uint256(4))
        });
        MockSessionQuoteSource source = new MockSessionQuoteSource(sample);
        wire.endpoint = address(source);
        source.setConfigHash(SourceConfigHash.hash(wire));
        source.setUnavailable(true);
        AssetDescriptor memory descriptor_ = AssetDescriptor({
            id: ASSET, token: address(this), isStock: false, decimals: 18, capabilityMask: 0,
            tokenPriceAdapter: address(source), regularAdapter: address(0), extendedAdapter: address(0),
            overnightAdapter: address(0), secondaryAdapter: address(0), expectedCodeHash: bytes32(uint256(1)),
            implementationFingerprint: bytes32(uint256(2)), evidenceHash: bytes32(uint256(3))
        });
        SourceWire[] memory wires = new SourceWire[](1);
        wires[0] = wire;
        SessionRegistry registry = new SessionRegistry(address(new MockSessionAssets(descriptor_, abi.encode(wires))), address(0));

        uint256 reasons = registry.refreshHealth(ASSET);
        HealthView memory view_ = registry.health(ASSET);

        require(!view_.ready && reasons & (1 << 9) != 0, "unavailable quote source was not recorded unhealthy");
    }

    function testNonStockMalformedOrStaleQuoteSourceRecordsUnhealthyWithoutRevert() external {
        vm.warp(1_000);
        SourceWire memory wire = SourceWire({
            kind: 2, phaseScope: 0, endpoint: address(this), feedId: bytes32(0), schema: 0,
            decimals: 8, priceBasis: 3, heartbeatSec: 60, expectedCodeHash: address(this).codehash,
            expectedImplementation: address(this), canonicalTokenId: bytes32(uint256(2))
        });
        SourceSample memory sample = SourceSample({
            descriptorId: bytes32(0), feedId: bytes32(0), phase: 1, price18: 2e18,
            observedAt: 999, inputAt: 999, validFrom: 999, expiresAt: 1_059, validUntil: 1_059,
            reportHash: bytes32(uint256(4))
        });
        MockSessionQuoteSource source = new MockSessionQuoteSource(sample);
        wire.endpoint = address(source);
        source.setConfigHash(SourceConfigHash.hash(wire));
        AssetDescriptor memory descriptor_ = AssetDescriptor({
            id: ASSET, token: address(this), isStock: false, decimals: 18, capabilityMask: 0,
            tokenPriceAdapter: address(source), regularAdapter: address(0), extendedAdapter: address(0),
            overnightAdapter: address(0), secondaryAdapter: address(0), expectedCodeHash: bytes32(uint256(1)),
            implementationFingerprint: bytes32(uint256(2)), evidenceHash: bytes32(uint256(3))
        });
        SourceWire[] memory wires = new SourceWire[](1);
        wires[0] = wire;
        SessionRegistry registry = new SessionRegistry(address(new MockSessionAssets(descriptor_, abi.encode(wires))), address(0));

        uint256 reasons = registry.refreshHealth(ASSET);
        HealthView memory malformed = registry.health(ASSET);
        require(!malformed.ready && malformed.reasonBits == reasons && reasons & (1 << 9) != 0, "malformed quote outcome was not persisted");
        sample.phase = 0;
        sample.observedAt = 399;
        sample.inputAt = 399;
        sample.validFrom = 399;
        source.setSample(sample);
        reasons = registry.refreshHealth(ASSET);
        HealthView memory stale = registry.health(ASSET);

        require(!stale.ready && stale.reasonBits == reasons && reasons & (1 << 9) != 0, "stale quote outcome was not persisted");
    }

    function testMalformedDirectAdapterReturndataRecordsUnhealthyWithoutRevert() external {
        vm.warp(1_000);
        SourceWire memory wire = SourceWire({
            kind: 2, phaseScope: 0, endpoint: address(this), feedId: bytes32(0), schema: 0,
            decimals: 8, priceBasis: 3, heartbeatSec: 60, expectedCodeHash: address(this).codehash,
            expectedImplementation: address(this), canonicalTokenId: bytes32(uint256(2))
        });
        MalformedReturnQuoteSource source = new MalformedReturnQuoteSource();
        wire.endpoint = address(source);
        source.setConfigHash(SourceConfigHash.hash(wire));
        AssetDescriptor memory descriptor_ = AssetDescriptor({
            id: ASSET, token: address(this), isStock: false, decimals: 18, capabilityMask: 0,
            tokenPriceAdapter: address(source), regularAdapter: address(0), extendedAdapter: address(0),
            overnightAdapter: address(0), secondaryAdapter: address(0), expectedCodeHash: bytes32(uint256(1)),
            implementationFingerprint: bytes32(uint256(2)), evidenceHash: bytes32(uint256(3))
        });
        SourceWire[] memory wires = new SourceWire[](1);
        wires[0] = wire;
        SessionRegistry registry = new SessionRegistry(address(new MockSessionAssets(descriptor_, abi.encode(wires))), address(0));

        (bool ok, bytes memory data) = address(registry).call(abi.encodeCall(registry.refreshHealth, (ASSET)));
        require(ok, "short successful returndata reverted checkpoint");
        uint256 reasons = abi.decode(data, (uint256));
        HealthView memory shortReturn = registry.health(ASSET);
        require(!shortReturn.ready && shortReturn.reasonBits == reasons && reasons & (1 << 9) != 0, "short returndata not persisted");

        source.setMode(1);
        (ok, data) = address(registry).call(abi.encodeCall(registry.refreshHealth, (ASSET)));
        require(ok, "invalid narrow returndata reverted checkpoint");
        reasons = abi.decode(data, (uint256));
        HealthView memory narrowReturn = registry.health(ASSET);
        require(!narrowReturn.ready && narrowReturn.reasonBits == reasons && reasons & (1 << 9) != 0, "narrow returndata not persisted");
    }

    function testDirectQuoteReadIsBoundedAndRecordsUnhealthy() external {
        vm.warp(1_000);
        SourceWire memory wire = SourceWire({
            kind: 2, phaseScope: 0, endpoint: address(this), feedId: bytes32(0), schema: 0,
            decimals: 8, priceBasis: 3, heartbeatSec: 60, expectedCodeHash: address(this).codehash,
            expectedImplementation: address(this), canonicalTokenId: bytes32(uint256(2))
        });
        GasBoundQuoteSource source = new GasBoundQuoteSource();
        wire.endpoint = address(source);
        source.setConfigHash(SourceConfigHash.hash(wire));
        AssetDescriptor memory descriptor_ = AssetDescriptor({
            id: ASSET, token: address(this), isStock: false, decimals: 18, capabilityMask: 0,
            tokenPriceAdapter: address(source), regularAdapter: address(0), extendedAdapter: address(0),
            overnightAdapter: address(0), secondaryAdapter: address(0), expectedCodeHash: bytes32(uint256(1)),
            implementationFingerprint: bytes32(uint256(2)), evidenceHash: bytes32(uint256(3))
        });
        SourceWire[] memory wires = new SourceWire[](1);
        wires[0] = wire;
        SessionRegistry registry = new SessionRegistry(address(new MockSessionAssets(descriptor_, abi.encode(wires))), address(0));

        uint256 reasons = registry.refreshHealth(ASSET);
        HealthView memory view_ = registry.health(ASSET);

        require(!view_.ready && view_.reasonBits == reasons && reasons & (1 << 9) != 0, "gas-bounded read was accepted");
    }

    function testOversizedDirectQuoteReturndataPersistsUnhealthyWithinBoundedCallerGas() external {
        vm.warp(1_000);
        SourceWire memory wire = SourceWire({
            kind: 2, phaseScope: 0, endpoint: address(this), feedId: bytes32(0), schema: 0,
            decimals: 8, priceBasis: 3, heartbeatSec: 60, expectedCodeHash: address(this).codehash,
            expectedImplementation: address(this), canonicalTokenId: bytes32(uint256(2))
        });
        OversizedReturnQuoteSource source = new OversizedReturnQuoteSource();
        wire.endpoint = address(source);
        source.setConfigHash(SourceConfigHash.hash(wire));
        AssetDescriptor memory descriptor_ = AssetDescriptor({
            id: ASSET, token: address(this), isStock: false, decimals: 18, capabilityMask: 0,
            tokenPriceAdapter: address(source), regularAdapter: address(0), extendedAdapter: address(0),
            overnightAdapter: address(0), secondaryAdapter: address(0), expectedCodeHash: bytes32(uint256(1)),
            implementationFingerprint: bytes32(uint256(2)), evidenceHash: bytes32(uint256(3))
        });
        SourceWire[] memory wires = new SourceWire[](1);
        wires[0] = wire;
        SessionRegistry registry = new SessionRegistry(address(new MockSessionAssets(descriptor_, abi.encode(wires))), address(0));

        (bool ok, bytes memory data) = address(registry).call{gas: 125_000}(abi.encodeCall(registry.refreshHealth, (ASSET)));
        require(ok, "oversized returndata exhausted bounded caller gas");
        uint256 reasons = abi.decode(data, (uint256));
        HealthView memory view_ = registry.health(ASSET);
        require(!view_.ready && view_.reasonBits == reasons && reasons & (1 << 9) != 0, "oversized returndata was not persisted unhealthy");
    }

    function testAdapterCannotReenterBatchAndRegressFeedHighWater() external {
        vm.warp(1003);
        SourceSample memory outerSample = _sample(bytes32(uint256(1)), 2, 1002, 1001, 1122, 1);
        SourceSample memory nestedSample = _sample(bytes32(uint256(1)), 2, 1001, 1000, 1121, 2);
        ReentrantSessionAdapter adapter = new ReentrantSessionAdapter(ASSET, abi.encode(nestedSample));
        SourceWire[] memory wires = new SourceWire[](1);
        wires[0] = _wire(address(adapter), bytes32(uint256(1)), 1);
        AssetDescriptor memory descriptor_ = AssetDescriptor({
            id: ASSET, token: address(this), isStock: true, decimals: 18, capabilityMask: 0x04,
            tokenPriceAdapter: address(0), regularAdapter: address(adapter), extendedAdapter: address(0),
            overnightAdapter: address(0), secondaryAdapter: address(0), expectedCodeHash: bytes32(uint256(1)),
            implementationFingerprint: bytes32(uint256(2)), evidenceHash: bytes32(uint256(3))
        });
        MockSessionAssets assets = new MockSessionAssets(descriptor_, abi.encode(wires));
        SessionRegistry registry = new SessionRegistry(address(assets), address(0));
        adapter.setRegistry(address(registry));
        bytes[] memory reports = new bytes[](1);
        reports[0] = abi.encode(outerSample);
        registry.submitReports(ASSET, reports);
        require(!adapter.nestedAccepted(), "adapter reentrant batch was accepted");
        require(registry.latestSample(ASSET, 2).observedAt == 1002, "unexpected outer sample state");
    }

    function testRejectsSampleValidityThatExceedsSignedObservationAge() external {
        vm.warp(1001);
        SessionRegistry registry = _registry();
        bytes[] memory report = new bytes[](1);
        report[0] = abi.encode(_sample(bytes32(uint256(1)), 2, 1000, 999, 5000, 1));
        (bool accepted,) = address(registry).call(abi.encodeCall(registry.submitReports, (ASSET, report)));
        require(!accepted, "adapter extended report validity beyond policy age");
        require(registry.latestSample(ASSET, 2).observedAt == 0, "invalid sample cached");
    }

    // These behavior doubles exercise fail-closed capture boundaries only; they do not prove
    // official-source cryptographic authenticity or real calendar truth.
    function _prepareCloseCapture(uint64 nowTime, uint64 closeOffset)
        internal
        returns (SessionRegistry registry, MockSessionCalendar calendar, MockSessionStockToken token, MockSessionQuoteSource direct, bytes32 boundary)
    {
        vm.warp(nowTime);
        (registry, calendar, token, direct) = _stockHealthRegistry(2);
        calendar.setInterval(CalendarLeaf({
            assetId: ASSET, year: 2026, index: 1, start: nowTime - 500, end: nowTime + closeOffset,
            phase: 2, provenanceHash: bytes32(uint256(4))
        }));
        CalendarLeaf memory upcoming = CalendarLeaf({
            assetId: ASSET, year: 2026, index: 2, start: nowTime + closeOffset, end: nowTime + 1_000,
            phase: 5, provenanceHash: bytes32(uint256(5))
        });
        calendar.setNextInterval(upcoming);
        boundary = CalendarProof.hashLeaf(block.chainid, address(calendar), upcoming);
        _submitStockSample(registry, 2, nowTime, nowTime, 100e18);
    }

    function testCaptureCloseUsesAdjustedUnderlyingWhenDirectAtInclusiveDeviationLimit() external {
        (SessionRegistry registry, MockSessionCalendar calendar, MockSessionStockToken token, MockSessionQuoteSource direct, bytes32 boundary) = _prepareCloseCapture(1_000, 100);
        token.set(2e18, 2e18, 0, false);
        SourceSample memory directSample = SourceSample({
            descriptorId: bytes32(0), feedId: bytes32(0), phase: 0, price18: 202e18,
            observedAt: 1_000, inputAt: 1_000, validFrom: 1_000, expiresAt: 1_600, validUntil: 1_600, reportHash: bytes32(uint256(78))
        });
        direct.setSample(directSample);
        Anchor memory captured = registry.captureClose(ASSET, boundary);
        Anchor memory stored = registry.closeAnchor(ASSET, boundary);
        require(captured.assetId == ASSET && captured.boundaryHash == boundary, "anchor identity");
        require(captured.price18 == 200e18 && captured.multiplier18 == 2e18, "adjusted price or multiplier");
        require(captured.capturedAt == 1_000 && captured.observedAt == 1_000 && captured.inputAt == 1_000, "source timestamps");
        require(captured.closureStart == 1_100 && captured.sourceHash != bytes32(0), "closure metadata");
        require(keccak256(abi.encode(captured)) == keccak256(abi.encode(stored)), "anchor not stored");
        require(boundary == CalendarProof.hashLeaf(block.chainid, address(calendar), CalendarLeaf({
            assetId: ASSET, year: 2026, index: 2, start: 1_100, end: 2_000, phase: 5, provenanceHash: bytes32(uint256(5))
        })), "noncanonical boundary");
    }

    function testCaptureCloseRejectsBoundaryWindowAndClosedCalendarFailures() external {
        (SessionRegistry registry, MockSessionCalendar calendar,,, bytes32 boundary) = _prepareCloseCapture(1_000, 100);
        (bool ok,) = address(registry).call(abi.encodeCall(registry.captureClose, (ASSET, bytes32(uint256(7)))));
        require(!ok && registry.closeAnchor(ASSET, boundary).assetId == bytes32(0), "arbitrary boundary accepted");
        vm.warp(1_100);
        (ok,) = address(registry).call(abi.encodeCall(registry.captureClose, (ASSET, boundary)));
        require(!ok && registry.closeAnchor(ASSET, boundary).assetId == bytes32(0), "capture after close accepted");
        vm.warp(1_000);
        calendar.setNextInterval(CalendarLeaf(0, 0, 0, 0, 0, 0, 0));
        (ok,) = address(registry).call(abi.encodeCall(registry.captureClose, (ASSET, boundary)));
        require(!ok && registry.closeAnchor(ASSET, boundary).assetId == bytes32(0), "missing next leaf accepted");
        CalendarLeaf memory supportedNext = CalendarLeaf({
            assetId: ASSET, year: 2026, index: 2, start: 1_100, end: 2_000, phase: 2, provenanceHash: bytes32(uint256(5))
        });
        calendar.setNextInterval(supportedNext);
        bytes32 supportedBoundary = CalendarProof.hashLeaf(block.chainid, address(calendar), supportedNext);
        (ok,) = address(registry).call(abi.encodeCall(registry.captureClose, (ASSET, supportedBoundary)));
        require(!ok && registry.closeAnchor(ASSET, supportedBoundary).assetId == bytes32(0), "supported next leaf accepted");
    }

    function testCaptureCloseRejectsStalePausedAndJustOverDeviationInputs() external {
        (SessionRegistry registry,,, MockSessionQuoteSource direct, bytes32 boundary) = _prepareCloseCapture(1_000, 100);
        SourceSample memory directSample = SourceSample({
            descriptorId: bytes32(0), feedId: bytes32(0), phase: 0, price18: 101e18 + 1,
            observedAt: 1_000, inputAt: 1_000, validFrom: 1_000, expiresAt: 1_600, validUntil: 1_600, reportHash: bytes32(uint256(78))
        });
        direct.setSample(directSample);
        (bool ok,) = address(registry).call(abi.encodeCall(registry.captureClose, (ASSET, boundary)));
        require(!ok && registry.closeAnchor(ASSET, boundary).assetId == bytes32(0), "deviation accepted");
    }

    function testCaptureCloseAcceptsUnsupportedPlannedSessionBoundary() external {
        vm.warp(1_000);
        (SessionRegistry registry, MockSessionCalendar calendar,,) = _stockHealthRegistryWithCapability(2, 0x04);
        calendar.setInterval(CalendarLeaf({
            assetId: ASSET, year: 2026, index: 1, start: 500, end: 1_100, phase: 2, provenanceHash: bytes32(uint256(4))
        }));
        CalendarLeaf memory upcoming = CalendarLeaf({
            assetId: ASSET, year: 2026, index: 2, start: 1_100, end: 2_000, phase: 3, provenanceHash: bytes32(uint256(5))
        });
        calendar.setNextInterval(upcoming);
        _submitStockSample(registry, 2, 1_000, 1_000, 100e18);
        bytes32 boundary = CalendarProof.hashLeaf(block.chainid, address(calendar), upcoming);

        Anchor memory captured = registry.captureClose(ASSET, boundary);
        require(captured.closureStart == 1_100 && captured.boundaryHash == boundary,
            "unsupported planned-session boundary not captured");
        require(registry.closeAnchor(ASSET, boundary).assetId == ASSET, "unsupported-session anchor not stored");
    }

    function testCaptureCloseRejectsExactlyAtCloseWithFreshSignedInput() external {
        (SessionRegistry registry,,,, bytes32 boundary) = _prepareCloseCapture(1_000, 100);
        vm.warp(1_099);
        _submitStockSample(registry, 2, 1_099, 1_099, 100e18);
        vm.warp(1_100);
        (bool ok,) = address(registry).call(abi.encodeCall(registry.captureClose, (ASSET, boundary)));
        require(!ok && registry.closeAnchor(ASSET, boundary).assetId == bytes32(0), "capture at close accepted");
    }

    function testCaptureCloseWindowBoundariesAndExistingObservationOrdering() external {
        (SessionRegistry exact,,,, bytes32 exactBoundary) = _prepareCloseCapture(1_000, 300);
        Anchor memory first = exact.captureClose(ASSET, exactBoundary);
        vm.warp(1_001);
        _submitStockSample(exact, 2, 1_001, 1_001, 100e18);
        Anchor memory refreshed = exact.captureClose(ASSET, exactBoundary);
        require(refreshed.capturedAt == 1_001 && refreshed.observedAt > first.observedAt, "newer observation did not refresh anchor");
        vm.warp(1_002);
        Anchor memory repeated = exact.captureClose(ASSET, exactBoundary);
        require(repeated.capturedAt == refreshed.capturedAt && repeated.observedAt == refreshed.observedAt, "equal observation replaced anchor");

        (SessionRegistry early,,,, bytes32 earlyBoundary) = _prepareCloseCapture(2_000, 301);
        (bool ok,) = address(early).call(abi.encodeCall(early.captureClose, (ASSET, earlyBoundary)));
        require(!ok && early.closeAnchor(ASSET, earlyBoundary).assetId == bytes32(0), "capture before window accepted");
    }

    function testCaptureCloseRejectsStaleFutureAndPausedCorporateInputs() external {
        (SessionRegistry stale,,,, bytes32 staleBoundary) = _prepareCloseCapture(1_000, 100);
        vm.warp(1_061);
        (bool ok,) = address(stale).call(abi.encodeCall(stale.captureClose, (ASSET, staleBoundary)));
        require(!ok && stale.closeAnchor(ASSET, staleBoundary).assetId == bytes32(0), "stale signed input accepted");

        (SessionRegistry paused,, MockSessionStockToken token, MockSessionQuoteSource direct, bytes32 pausedBoundary) = _prepareCloseCapture(2_000, 100);
        token.set(1e18, 1e18, 0, true);
        (ok,) = address(paused).call(abi.encodeCall(paused.captureClose, (ASSET, pausedBoundary)));
        require(!ok && paused.closeAnchor(ASSET, pausedBoundary).assetId == bytes32(0), "paused issuer accepted");
        token.set(1e18, 1e18, 0, false);
        token.setFailGetters(true);
        (ok,) = address(paused).call(abi.encodeCall(paused.captureClose, (ASSET, pausedBoundary)));
        require(!ok && paused.closeAnchor(ASSET, pausedBoundary).assetId == bytes32(0), "invalid multiplier accepted");
        token.setFailGetters(false);
        SourceSample memory future = SourceSample({
            descriptorId: bytes32(0), feedId: bytes32(0), phase: 0, price18: 100e18,
            observedAt: 2_001, inputAt: 2_001, validFrom: 2_001, expiresAt: 2_600, validUntil: 2_600, reportHash: bytes32(uint256(79))
        });
        direct.setSample(future);
        (ok,) = address(paused).call(abi.encodeCall(paused.captureClose, (ASSET, pausedBoundary)));
        require(!ok && paused.closeAnchor(ASSET, pausedBoundary).assetId == bytes32(0), "future direct input accepted");
    }

    // These views are the minimal M05-03 closure dependency. They prove anchor age and live corporate binding
    // against stored capture metadata; they do not prove calendar truth or source authenticity.
    function testAnchorStatusValidatesAgeBoundaryAndCorporateState() external {
        (SessionRegistry registry,,,, bytes32 boundary) = _prepareCloseCapture(1_000, 100);
        registry.captureClose(ASSET, boundary);
        (Anchor memory anchor, bool valid, uint256 reasons, uint64 validUntil) = registry.anchorStatus(ASSET, boundary);
        require(valid && reasons == 0, "valid anchor rejected");
        require(validUntil == 1_000 + 345_600 + 1, "exclusive anchor deadline");
        require(anchor.boundaryHash == boundary && anchor.closureStart == 1_100, "anchor identity");

        (, valid, reasons,) = registry.anchorStatus(ASSET, bytes32(uint256(7)));
        require(!valid && reasons & ReasonBits.ANCHOR_MISSING_OR_EXPIRED != 0, "unknown boundary accepted");

        vm.warp(1_000 + 345_600);
        (, valid, reasons,) = registry.anchorStatus(ASSET, boundary);
        require(valid && reasons == 0, "inclusive 96h age rejected");

        vm.warp(1_000 + 345_600 + 1);
        (, valid, reasons,) = registry.anchorStatus(ASSET, boundary);
        require(!valid && reasons & ReasonBits.ANCHOR_MISSING_OR_EXPIRED != 0, "expired anchor accepted");
    }

    function testAnchorStatusRejectsMultiplierChangePauseAndPendingBoundary() external {
        (SessionRegistry registry,, MockSessionStockToken token,, bytes32 boundary) = _prepareCloseCapture(1_000, 100);
        registry.captureClose(ASSET, boundary);
        token.set(2e18, 2e18, 0, false);
        bool valid;
        uint256 reasons;
        (, valid, reasons,) = registry.anchorStatus(ASSET, boundary);
        require(!valid && reasons & ReasonBits.CORPORATE_INCONSISTENT != 0, "multiplier change accepted");

        token.set(1e18, 1e18, 0, true);
        (, valid, reasons,) = registry.anchorStatus(ASSET, boundary);
        require(!valid && reasons & ReasonBits.ISSUER_PAUSE != 0, "issuer pause accepted");

        token.set(1e18, 2e18, 1_100, false);
        uint64 validUntil;
        (, valid, reasons, validUntil) = registry.anchorStatus(ASSET, boundary);
        require(valid && reasons == 0, "pending multiplier rejected early");
        require(validUntil == 1_100, "pending multiplier not capped");

        vm.warp(1_100);
        (, valid, reasons,) = registry.anchorStatus(ASSET, boundary);
        require(!valid && reasons & ReasonBits.CORPORATE_INCONSISTENT != 0, "effective multiplier change accepted");
    }
}
