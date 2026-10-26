// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetRegistry} from "../src/registries/AssetRegistry.sol";
import {AssetDescriptor} from "../src/types/ProtocolTypes.sol";
import {SourceWire} from "../src/types/ProtocolTypes.sol";
import {SourceConfigHash} from "../src/libraries/SourceConfigHash.sol";

interface VmAsset {
    function warp(uint256 timestamp) external;
    function prank(address caller) external;
    function chainId(uint256 newChainId) external;
}

contract MockSafetyDirectory {
    address public governance;
    address public guardian;

    constructor(address governance_, address guardian_) {
        governance = governance_;
        guardian = guardian_;
    }
}

contract MockAssetToken {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}

contract MockSourceEndpoint {}

contract MockSourceAdapter {
    bytes32 public immutable storedConfigHash;

    constructor(bytes32 sourceHash) {
        storedConfigHash = sourceHash;
    }

    function sourceConfigHash() external view returns (bytes32) {
        return storedConfigHash;
    }

    function fingerprint() external view returns (bytes32) {
        return keccak256(abi.encode(address(this), storedConfigHash));
    }
}

contract AssetRegistryTest {
    VmAsset private constant vm = VmAsset(address(uint160(uint256(keccak256("hevm cheat code")))));

    function _descriptor(address token) internal view returns (AssetDescriptor memory) {
        return AssetDescriptor({
            id: bytes32(0),
            token: token,
            isStock: false,
            decimals: 18,
            capabilityMask: 0,
            tokenPriceAdapter: address(0),
            regularAdapter: address(0),
            extendedAdapter: address(0),
            overnightAdapter: address(0),
            secondaryAdapter: address(0),
            expectedCodeHash: token.codehash,
            implementationFingerprint: token.codehash,
            evidenceHash: bytes32(uint256(3))
        });
    }

    function _registry() internal returns (AssetRegistry registry) {
        MockSafetyDirectory safety = new MockSafetyDirectory(address(this), address(0xBEEF));
        registry = new AssetRegistry(address(safety));
    }

    function testAssetActivationWaitsForFixedDelayAndIsAppendOnly() external {
        AssetRegistry registry = _registry();
        MockAssetToken token = new MockAssetToken();
        bytes32 operationId = registry.queueAsset(_descriptor(address(token)), bytes(""));
        (,, uint64 eta,, uint8 status) = registry.operation(operationId);
        require(status == 1, "not queued");
        vm.warp(eta - 1);
        (bool early,) = address(registry).call(abi.encodeCall(registry.activateAsset, (operationId)));
        require(!early, "activated before timelock");
        vm.warp(eta);
        bytes32 id = registry.activateAsset(operationId);
        require(id != bytes32(0), "zero descriptor id");
        AssetDescriptor memory stored = registry.descriptor(id);
        require(stored.id == id && stored.token == address(token), "descriptor mismatch");
        (bool duplicate,) = address(registry).call(abi.encodeCall(registry.queueAsset, (_descriptor(address(token)), bytes(""))));
        require(!duplicate, "existing token overwritten");
    }

    function testOnlyGovernanceQueuesAndGuardianCanCancelPending() external {
        AssetRegistry registry = _registry();
        MockAssetToken unauthorizedToken = new MockAssetToken();
        vm.prank(address(0xCAFE));
        (bool queued,) = address(registry).call(abi.encodeCall(registry.queueAsset, (_descriptor(address(unauthorizedToken)), bytes(""))));
        require(!queued, "unauthorized queue");
        MockAssetToken token = new MockAssetToken();
        bytes32 operationId = registry.queueAsset(_descriptor(address(token)), bytes(""));
        vm.prank(address(0xBEEF));
        registry.cancel(operationId);
        (,,,, uint8 status) = registry.operation(operationId);
        require(status == 3, "guardian cancellation not recorded");
    }

    function testStockCandidateRequiresCanonicalBoundSourcesForSupportedPhases() external {
        (AssetRegistry registry, AssetDescriptor memory stock, SourceWire[] memory wires) = _stockFixture();
        bytes32 operationId = registry.queueAsset(stock, abi.encode(wires));
        registry.cancel(operationId);
        wires[1].canonicalTokenId = bytes32(uint256(99));
        (bool wrongCanonical,) = address(registry).call(abi.encodeCall(registry.queueAsset, (stock, abi.encode(wires))));
        require(!wrongCanonical, "wrong canonical source binding accepted");
    }

    function testRejectsClosedCapabilityBitAndMismatchedAdapter() external {
        (AssetRegistry registry, AssetDescriptor memory stock, SourceWire[] memory wires) = _stockFixture();
        AssetDescriptor memory closedBit = stock;
        closedBit.capabilityMask = 0x3e;
        (bool acceptedClosedBit,) = address(registry).call(abi.encodeCall(registry.queueAsset, (closedBit, abi.encode(wires))));
        require(!acceptedClosedBit, "CLOSED accepted as a stock capability bit");
        stock.regularAdapter = stock.overnightAdapter;
        (bool mismatchedAdapter,) = address(registry).call(abi.encodeCall(registry.queueAsset, (stock, abi.encode(wires))));
        require(!mismatchedAdapter, "mismatched adapter/source config accepted");
    }

    function testAssetImmediateActivationOnTestnetChain46630() external {
        vm.chainId(46630);
        (AssetRegistry registry, AssetDescriptor memory stock, SourceWire[] memory wires) = _stockFixture();
        bytes32 operationId = registry.queueAsset(stock, abi.encode(wires));
        (,, uint64 eta,, uint8 status) = registry.operation(operationId);
        require(eta == block.timestamp, "eta must be immediate on chain 46630");
        require(status == 1, "queued");
        bytes32 descriptorId = registry.activateAsset(operationId);
        require(descriptorId != bytes32(0), "activated immediately");
        require(registry.descriptorIdForToken(stock.token) == descriptorId, "descriptor registered");
    }

    function _stockFixture() internal returns (AssetRegistry registry, AssetDescriptor memory stock, SourceWire[] memory wires) {
        registry = _registry();
        MockAssetToken token = new MockAssetToken();
        MockSourceEndpoint endpoint = new MockSourceEndpoint();
        bytes32 tokenId = keccak256(abi.encode(block.chainid, address(token)));
        wires = new SourceWire[](4);
        wires[0] = _wire(1, 0, address(endpoint), bytes32(0), 0, 2, tokenId);
        wires[1] = _wire(3, 1, address(endpoint), bytes32(uint256(1)), 11, 1, tokenId);
        wires[2] = _wire(3, 2, address(endpoint), bytes32(uint256(2)), 11, 1, tokenId);
        wires[3] = _wire(3, 3, address(endpoint), bytes32(uint256(3)), 11, 1, tokenId);
        MockSourceAdapter tokenAdapter = _adapter(wires[0]);
        MockSourceAdapter regularAdapter = _adapter(wires[1]);
        MockSourceAdapter extendedAdapter = _adapter(wires[2]);
        MockSourceAdapter overnightAdapter = _adapter(wires[3]);
        stock = AssetDescriptor({
            id: bytes32(0), token: address(token), isStock: true, decimals: 18, capabilityMask: 0x1e,
            tokenPriceAdapter: address(tokenAdapter), regularAdapter: address(regularAdapter),
            extendedAdapter: address(extendedAdapter), overnightAdapter: address(overnightAdapter),
            secondaryAdapter: address(0), expectedCodeHash: address(token).codehash,
            implementationFingerprint: bytes32(uint256(4)), evidenceHash: bytes32(uint256(5))
        });
    }

    function _wire(uint8 kind, uint8 scope, address endpoint, bytes32 feedId, uint16 schema, uint8 basis, bytes32 tokenId)
        internal view returns (SourceWire memory)
    {
        return SourceWire({
            kind: kind,
            phaseScope: scope,
            endpoint: endpoint,
            feedId: feedId,
            schema: schema,
            decimals: 8,
            priceBasis: basis,
            heartbeatSec: 86400,
            expectedCodeHash: endpoint.codehash,
            expectedImplementation: endpoint,
            canonicalTokenId: tokenId
        });
    }

    function _adapter(SourceWire memory wire) internal returns (MockSourceAdapter) {
        return new MockSourceAdapter(SourceConfigHash.hash(wire));
    }
}
