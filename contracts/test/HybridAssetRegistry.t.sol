// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetDescriptor} from "../src/types/ProtocolTypes.sol";
import {HybridAssetRegistry} from "../src/registries/HybridAssetRegistry.sol";

contract HybridAssetToken {
    function decimals() external pure returns (uint8) { return 18; }
}

contract HybridAssetSafetyMock {
    function governance() external view returns (address) { return address(this); }
    function guardian() external pure returns (address) { return address(0xBEEF); }
    function governanceDelaySeconds() external pure returns (uint32) { return 1 days; }
    function operationExpirySeconds() external pure returns (uint32) { return 7 days; }
}

contract HybridAssetRegistryTest {
    function testConstructorBootstrapsImmutableInitialAssetIdentity() external {
        HybridAssetToken token = new HybridAssetToken();
        AssetDescriptor[] memory assets = new AssetDescriptor[](1);
        bytes[] memory configs = new bytes[](1);
        assets[0] = AssetDescriptor({
            id: bytes32(0), token: address(token), isStock: false, decimals: 18, capabilityMask: 0,
            tokenPriceAdapter: address(0), regularAdapter: address(0), extendedAdapter: address(0),
            overnightAdapter: address(0), secondaryAdapter: address(0), expectedCodeHash: address(token).codehash,
            implementationFingerprint: keccak256("fingerprint"), evidenceHash: keccak256("evidence")
        });

        HybridAssetRegistry registry = new HybridAssetRegistry(address(new HybridAssetSafetyMock()), assets, configs);
        bytes32 id = registry.descriptorIdForToken(address(token));
        require(id != bytes32(0), "asset not bootstrapped");
        AssetDescriptor memory stored = registry.descriptor(id);
        require(stored.id == id && stored.token == address(token), "descriptor identity mismatch");
        require(keccak256(registry.sourceConfig(id)) == keccak256(bytes("")), "unexpected source config");
    }

    function testConstructorRejectsDuplicateBootstrapToken() external {
        HybridAssetToken token = new HybridAssetToken();
        AssetDescriptor[] memory assets = new AssetDescriptor[](2);
        bytes[] memory configs = new bytes[](2);
        for (uint256 i; i < assets.length; ++i) {
            assets[i] = AssetDescriptor({
                id: bytes32(0), token: address(token), isStock: false, decimals: 18, capabilityMask: 0,
                tokenPriceAdapter: address(0), regularAdapter: address(0), extendedAdapter: address(0),
                overnightAdapter: address(0), secondaryAdapter: address(0), expectedCodeHash: address(token).codehash,
                implementationFingerprint: keccak256(abi.encode("fingerprint", i)), evidenceHash: keccak256(abi.encode("evidence", i))
            });
        }
        (bool success,) = address(this).call(abi.encodeCall(
            this.deployRegistry, (address(new HybridAssetSafetyMock()), assets, configs)
        ));
        require(!success, "duplicate token accepted");
    }

    function deployRegistry(address safety, AssetDescriptor[] memory assets, bytes[] memory configs)
        external returns (address)
    {
        return address(new HybridAssetRegistry(safety, assets, configs));
    }
}
