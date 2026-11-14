// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SourceSample, SourceWire, AssetDescriptor} from "../../../src/types/ProtocolTypes.sol";
import {
    HybridYahooAttestedSourceAdapter,
    IHybridYahooAuth
} from "../../../src/adapters/HybridYahooAttestedSourceAdapter.sol";
import {SessionRegistry} from "../../../src/registries/SessionRegistry.sol";

interface VmHybridYahoo {
    function expectRevert() external;
}

contract HybridYahooAuthMock is IHybridYahooAuth {
    mapping(bytes32 role => uint256 value) public override nonce;
    bytes32 public lastAction;
    bytes32 public lastPayload;
    address public signer;

    function authorize(
        bytes32 role,
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external returns (uint32) {
        require(block.timestamp <= deadline, "expired");
        require(abi.decode(ecdsaSignature, (bytes32)) == payloadHash, "bad ecdsa payload");
        require(abi.decode(pqSignature, (bytes32)) == action, "bad pq action");
        lastAction = action;
        lastPayload = payloadHash;
        nonce[role]++;
        return uint32(nonce[role]);
    }

    function actionDigest(bytes32, address, bytes32, bytes32, uint256, uint32, uint256)
        external
        pure
        returns (bytes32)
    {
        return bytes32(0);
    }

    function registry() external pure returns (address) {
        return address(0);
    }

    function hashSigVerifier() external pure returns (address) {
        return address(0);
    }
}

    contract HybridYahooTokenMock {}

    contract HybridYahooAssetsMock {
        AssetDescriptor private _descriptor;
        bytes private _sourceConfig;

        constructor(AssetDescriptor memory descriptor_, bytes memory sourceConfig_) {
            _descriptor = descriptor_;
            _sourceConfig = sourceConfig_;
        }

        function descriptor(bytes32) external view returns (AssetDescriptor memory) {
            return _descriptor;
        }

        function sourceConfig(bytes32) external view returns (bytes memory) {
            return _sourceConfig;
        }
    }

    contract HybridYahooAttestedSourceAdapterTest {
        VmHybridYahoo private constant vm = VmHybridYahoo(address(uint160(uint256(keccak256("hevm cheat code")))));
        bytes32 private constant ROLE = keccak256("REPORTER");
        bytes32 private constant WIRE = keccak256("wire-config");
        bytes32 private constant FEED = keccak256("AAPL");
        HybridYahooAuthMock private auth;

        function setUp() public {
            auth = new HybridYahooAuthMock();
        }

        function testDirectQuoteRequiresHybridAuthorizationAndPersists() public {
            HybridYahooAttestedSourceAdapter adapter =
                new HybridYahooAttestedSourceAdapter(auth, ROLE, WIRE, bytes32(0), 0, true, address(0));
            SourceSample memory sample = _sample(bytes32(0), 0, 100e18);
            bytes32 payload = keccak256(abi.encode(WIRE, sample));
            bytes memory envelope =
                abi.encode(block.timestamp + 1 hours, abi.encode(payload), abi.encode(adapter.SOURCE_SAMPLE_ACTION()));
            adapter.publishDirect(sample, envelope);
            SourceSample memory current = adapter.readCurrent();
            require(current.price18 == sample.price18 && current.reportHash == sample.reportHash, "quote not published");
            require(auth.nonce(ROLE) == 1 && auth.lastPayload() == payload, "hybrid auth not consumed");
        }

        function testStockReportUsesHybridAuthorizationBeforeReturn() public {
            HybridYahooTokenMock token = new HybridYahooTokenMock();
            HybridYahooAttestedSourceAdapter adapter =
                new HybridYahooAttestedSourceAdapter(auth, ROLE, WIRE, FEED, 1, false, address(token));
            SourceSample memory sample = _sample(FEED, 2, 101e18);
            bytes32 payload = keccak256(abi.encode(WIRE, sample));
            bytes memory report = abi.encode(
                sample, block.timestamp + 1 hours, abi.encode(payload), abi.encode(adapter.SOURCE_SAMPLE_ACTION())
            );
            SourceSample memory decoded = adapter.decodeVerified(report);
            require(decoded.price18 == sample.price18, "report not decoded");
            require(auth.nonce(ROLE) == 1 && auth.lastPayload() == payload, "report auth not consumed");
        }

        function testSessionRegistryAcceptsOnlyTheHybridAdapterEnvelope() public {
            HybridYahooTokenMock token = new HybridYahooTokenMock();
            HybridYahooAttestedSourceAdapter adapter =
                new HybridYahooAttestedSourceAdapter(auth, ROLE, WIRE, FEED, 1, false, address(token));
            bytes32 assetId = keccak256("AAPL asset");
            SourceWire[] memory wires = new SourceWire[](1);
            wires[0] = SourceWire({
                kind: 3,
                phaseScope: 1,
                endpoint: address(0x1234),
                feedId: FEED,
                schema: 11,
                decimals: 8,
                priceBasis: 1,
                heartbeatSec: 0,
                expectedCodeHash: bytes32(0),
                expectedImplementation: address(0),
                canonicalTokenId: assetId
            });
            AssetDescriptor memory descriptor_ = AssetDescriptor({
                id: assetId,
                token: address(token),
                isStock: true,
                decimals: 18,
                capabilityMask: 0,
                tokenPriceAdapter: address(adapter),
                regularAdapter: address(adapter),
                extendedAdapter: address(0),
                overnightAdapter: address(0),
                secondaryAdapter: address(0),
                expectedCodeHash: address(token).codehash,
                implementationFingerprint: bytes32(0),
                evidenceHash: keccak256("evidence")
            });
            HybridYahooAssetsMock assets = new HybridYahooAssetsMock(descriptor_, abi.encode(wires));
            SessionRegistry sessions = new SessionRegistry(address(assets), address(0));
            SourceSample memory sample = _sample(FEED, 2, 103e18);
            bytes32 payload = keccak256(abi.encode(WIRE, sample));
            bytes[] memory reports = new bytes[](1);
            reports[0] = abi.encode(
                sample, block.timestamp + 1 hours, abi.encode(payload), abi.encode(adapter.SOURCE_SAMPLE_ACTION())
            );
            sessions.submitReports(assetId, reports);
            SourceSample memory accepted = sessions.latestSample(assetId, 2);
            require(
                accepted.descriptorId == assetId && accepted.price18 == sample.price18,
                "session registry did not commit"
            );
            require(auth.nonce(ROLE) == 1, "session registry bypassed hybrid auth");
        }

        function testInvalidHybridQuoteDoesNotPublishOrConsumeRoleNonce() public {
            HybridYahooAttestedSourceAdapter adapter =
                new HybridYahooAttestedSourceAdapter(auth, ROLE, WIRE, bytes32(0), 0, true, address(0));
            SourceSample memory sample = _sample(bytes32(0), 0, 102e18);
            bytes memory invalidEnvelope = abi.encode(
                block.timestamp + 1 hours, abi.encode(bytes32(uint256(1))), abi.encode(adapter.SOURCE_SAMPLE_ACTION())
            );
            vm.expectRevert();
            adapter.publishDirect(sample, invalidEnvelope);
            require(auth.nonce(ROLE) == 0, "invalid quote consumed nonce");
        }

        function testTokenCorporateStatusRequiresHybridAuthorization() public {
            HybridYahooTokenMock token = new HybridYahooTokenMock();
            HybridYahooAttestedSourceAdapter adapter =
                new HybridYahooAttestedSourceAdapter(auth, ROLE, WIRE, FEED, 1, false, address(token));
            uint64 observedAt = uint64(block.timestamp);
            uint128 multiplier = 1e18;
            bytes32 codeHash = address(token).codehash;
            bytes32 payload =
                keccak256(abi.encode(address(token), multiplier, multiplier, uint64(0), observedAt, false, codeHash));
            adapter.publishTokenStatusHybrid(
                address(token),
                multiplier,
                multiplier,
                0,
                observedAt,
                false,
                codeHash,
                block.timestamp + 1 hours,
                abi.encode(payload),
                abi.encode(adapter.TOKEN_STATUS_ACTION())
            );
            (uint128 stored, uint128 pendingMultiplier,,,,) = adapter.readTokenStatus(address(token), observedAt);
            require(stored == multiplier && pendingMultiplier == multiplier, "corporate status not stored");
            require(auth.nonce(ROLE) == 1 && auth.lastPayload() == payload, "token status auth not consumed");
        }

        function _sample(bytes32 sampleFeedId, uint8 phase, uint128 price) private view returns (SourceSample memory) {
            uint64 now_ = uint64(block.timestamp);
            return SourceSample({
                descriptorId: bytes32(0),
                feedId: sampleFeedId,
                phase: phase,
                price18: price,
                observedAt: now_,
                inputAt: now_,
                validFrom: now_,
                expiresAt: now_ + 110,
                validUntil: now_ + 100,
                reportHash: keccak256(abi.encode(sampleFeedId, phase, price, now_))
            });
        }
    }
