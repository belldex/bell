// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {YahooSourceVerifier} from "../../../src/adapters/YahooSourceVerifier.sol";
import {YahooAttestedSourceAdapter} from "../../../src/adapters/YahooAttestedSourceAdapter.sol";
import {SourceSample} from "../../../src/types/ProtocolTypes.sol";
import {SourceWire} from "../../../src/types/ProtocolTypes.sol";
import {SourceConfigHash} from "../../../src/libraries/SourceConfigHash.sol";

interface VmYahoo {
    function addr(uint256 privateKey) external view returns (address);
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function etch(address target, bytes calldata code) external;
    function chainId(uint256 newChainId) external;
}

contract YahooAttestedSourceAdapterTest {
    VmYahoo private constant vm = VmYahoo(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant REPORTER_PK = 0xA11CE;
    uint256 private constant STRANGER_PK = 0xB0B;
    uint64 private constant NOW = 1_793_029_632;
    bytes32 private constant REGULAR_FEED = keccak256("AAPL/USD:YAHOO:REGULAR");
    bytes32 private constant DIRECT_CONFIG = keccak256("AAPL/USD:YAHOO:DIRECT:wire");
    bytes32 private constant REGULAR_CONFIG = keccak256("AAPL/USD:YAHOO:REGULAR:wire");

    function setUp() external {
        vm.warp(NOW);
    }

    function testReporterPublishesFreshDirectPriceForSessionRegistryRead() external {
        YahooSourceVerifier verifier = new YahooSourceVerifier(vm.addr(REPORTER_PK));
        YahooAttestedSourceAdapter adapter = new YahooAttestedSourceAdapter(
            verifier, DIRECT_CONFIG, bytes32(0), 0, true, address(0)
        );
        SourceSample memory sample = _sample(bytes32(0), 0, 343_140_000_000_000_000_000, keccak256("yahoo-aapl-direct-1"));
        bytes memory signature = _sign(verifier, DIRECT_CONFIG, sample, REPORTER_PK);

        adapter.publishDirect(sample, signature);
        SourceSample memory observed = adapter.readCurrent();
        require(observed.price18 == 343_140_000_000_000_000_000, "direct real quote not stored");
        require(observed.observedAt == NOW, "timestamp changed");
        require(adapter.sourceConfigHash() == DIRECT_CONFIG, "source wire identity mismatch");
        require(adapter.fingerprint() != bytes32(0), "fingerprint absent");
    }

    function testWrongReporterCannotPublishDirectPrice() external {
        YahooSourceVerifier verifier = new YahooSourceVerifier(vm.addr(REPORTER_PK));
        YahooAttestedSourceAdapter adapter = new YahooAttestedSourceAdapter(
            verifier, DIRECT_CONFIG, bytes32(0), 0, true, address(0)
        );
        SourceSample memory sample = _sample(bytes32(0), 0, 343_140_000_000_000_000_000, keccak256("bad-signer"));
        (bool ok,) = address(adapter).call(abi.encodeCall(
            adapter.publishDirect, (sample, _sign(verifier, DIRECT_CONFIG, sample, STRANGER_PK))
        ));
        require(!ok, "untrusted reporter accepted");
    }

    function testReplayCannotReplaceDirectPrice() external {
        YahooSourceVerifier verifier = new YahooSourceVerifier(vm.addr(REPORTER_PK));
        YahooAttestedSourceAdapter adapter = new YahooAttestedSourceAdapter(
            verifier, DIRECT_CONFIG, bytes32(0), 0, true, address(0)
        );
        SourceSample memory first = _sample(bytes32(0), 0, 343_140_000_000_000_000_000, keccak256("quote-1"));
        adapter.publishDirect(first, _sign(verifier, DIRECT_CONFIG, first, REPORTER_PK));
        (bool ok,) = address(adapter).call(abi.encodeCall(
            adapter.publishDirect, (first, _sign(verifier, DIRECT_CONFIG, first, REPORTER_PK))
        ));
        require(!ok, "same observation replay accepted");
    }

    function testSignedRegularReportDecodesOnlyConfiguredFeedAndPhase() external {
        YahooSourceVerifier verifier = new YahooSourceVerifier(vm.addr(REPORTER_PK));
        YahooAttestedSourceAdapter adapter = new YahooAttestedSourceAdapter(
            verifier, REGULAR_CONFIG, REGULAR_FEED, 1, false, address(this)
        );
        SourceSample memory sample = _sample(REGULAR_FEED, 2, 343_140_000_000_000_000_000, keccak256("aapl-regular-1"));
        bytes memory report = abi.encode(sample, _sign(verifier, REGULAR_CONFIG, sample, REPORTER_PK));
        SourceSample memory decoded = adapter.decodeVerified(report);
        require(decoded.feedId == REGULAR_FEED && decoded.phase == 2, "regular report identity mismatch");

        sample.phase = 4;
        report = abi.encode(sample, _sign(verifier, REGULAR_CONFIG, sample, REPORTER_PK));
        (bool ok,) = address(adapter).call(abi.encodeCall(adapter.decodeVerified, (report)));
        require(!ok, "overnight report accepted by regular adapter");
    }

    /// @dev Golden vector signed by packages/protocol/src/yahoo-attestation.mjs using viem 2.57.11.
    function testOffchainViemTypedDataSignatureMatchesOnchainVerifier() external {
        vm.chainId(46630);
        address verifierAddress = address(0x1234);
        YahooSourceVerifier template = new YahooSourceVerifier(vm.addr(REPORTER_PK));
        vm.etch(verifierAddress, address(template).code);
        YahooSourceVerifier verifier = YahooSourceVerifier(verifierAddress);
        bytes32 configHash = 0x50d4dc275d34c21a9ecabb5b28d0fdea2c3bedd10a0fb8665a644b7c6596e597;
        SourceSample memory sample = SourceSample({
            descriptorId: bytes32(0),
            feedId: 0x289cc73677fc9064daf75c958d71d7aaaa90e5a77edfa4155a92a6d38bfaae9d,
            phase: 2,
            price18: 343_140_000_000_000_000_000,
            observedAt: NOW,
            inputAt: NOW,
            validFrom: NOW - 60,
            expiresAt: NOW + 120,
            validUntil: NOW + 120,
            reportHash: 0xcc418dee1a5f08dfdcc2c2d5494dceae1abe1e3cae0b91e3fd5c5f8d9c8289b8
        });
        bytes memory signature = hex"8b8f3500e60d83f9da37901f9d6327a111dd11fb1298028a1f19e6a4d5180ba954200fe080f1e1d4ce07229c235267895c484d3677bd50c5e1a7db854baacebd1c";
        require(verifier.verify(configHash, sample, signature), "viem signature failed onchain");
    }

    function testOffchainCorporateStatusDigestMatchesSolidityTypedDataOrder() external {
        vm.chainId(46630);
        address verifierAddress = address(0x1234);
        YahooSourceVerifier template = new YahooSourceVerifier(vm.addr(REPORTER_PK));
        vm.etch(verifierAddress, address(template).code);
        YahooSourceVerifier verifier = YahooSourceVerifier(verifierAddress);
        bytes32 digest = verifier.tokenSnapshotDigest(
            address(0xCAFE), 1e18, 1e18, 0, NOW, false,
            0x4444444444444444444444444444444444444444444444444444444444444444
        );
        require(digest == 0x14ef49e1b520593d29dff3f62177ebe68f3ac1e87328895248716ef7f7bddd07,
            "corporate status digest differs from viem EIP-712 vector");
    }

    function testOffchainYahooSourceWireHashMatchesSoliditySourceConfigHash() external pure {
        SourceWire memory wire = SourceWire({
            kind: 3,
            phaseScope: 1,
            endpoint: address(0x1234567890123456789012345678901234567890),
            feedId: 0xe0191b64923c20f5760f4993778c3fb836c4d6d27b35733bc4cd73dc27e65e2b,
            schema: 12,
            decimals: 18,
            priceBasis: 1,
            heartbeatSec: 120,
            expectedCodeHash: 0x4444444444444444444444444444444444444444444444444444444444444444,
            expectedImplementation: address(0x1234567890123456789012345678901234567890),
            canonicalTokenId: 0x87795462123f9c80baf6774787eabcc72d71b86a1d5119f2d0cda06f860a3e5b
        });
        require(
            SourceConfigHash.hash(wire) == 0xb2dc4e98ccc14fb986c367dfeba599867ba353faf701a740e7cd8d6d795f2ea5,
            "SourceWire hash differs from offchain manifest"
        );
    }

    function testReporterPublishesFreshCorporateStatusSnapshotForSessionRegistry() external {
        YahooSourceVerifier verifier = new YahooSourceVerifier(vm.addr(REPORTER_PK));
        YahooAttestedSourceAdapter adapter = new YahooAttestedSourceAdapter(
            verifier, REGULAR_CONFIG, bytes32(uint256(123)), 4, false, address(this)
        );
        uint128 multiplier = 1e18;
        uint128 pendingMultiplier = 1e18;
        uint64 effectiveAt;
        uint64 observedAt = uint64(block.timestamp);
        bytes32 codeHash = address(this).codehash;
        bytes32 digest = verifier.tokenSnapshotDigest(
            address(this), multiplier, pendingMultiplier, effectiveAt, observedAt, false, codeHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(REPORTER_PK, digest);
        verifier.publishTokenSnapshot(address(this), multiplier, pendingMultiplier, effectiveAt, observedAt, false, codeHash, abi.encodePacked(r, s, v));
        (uint128 current, uint128 next, uint64 appliedAt, bool pending, bool paused, bytes32 fingerprint) =
            adapter.readTokenStatus(address(this), uint64(block.timestamp));
        require(current == multiplier && next == pendingMultiplier && appliedAt == 0 && !pending && !paused, "corporate snapshot values");
        require(fingerprint != bytes32(0), "corporate snapshot fingerprint");
    }

    function _sample(bytes32 feedId, uint8 phase, uint128 price, bytes32 reportHash)
        private pure returns (SourceSample memory)
    {
        return SourceSample({
            descriptorId: bytes32(0),
            feedId: feedId,
            phase: phase,
            price18: price,
            observedAt: NOW,
            inputAt: NOW,
            validFrom: NOW - 60,
            expiresAt: NOW + 120,
            validUntil: NOW + 120,
            reportHash: reportHash
        });
    }

    function _sign(YahooSourceVerifier verifier, bytes32 configHash, SourceSample memory sample, uint256 pk)
        private view returns (bytes memory signature)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, verifier.digest(configHash, sample));
        signature = abi.encodePacked(r, s, v);
    }
}
