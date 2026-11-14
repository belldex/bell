// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellSwapLensRegistry} from "../src/BellSwapLensRegistry.sol";

interface VmDeployBellSwapLensRegistry {
    function envUint(string calldata name) external view returns (uint256);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function envString(string calldata name) external view returns (string memory);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function writeFile(string calldata path, string calldata data) external;
}

/// @notice Deploys the permissionless Lens registry for an already deployed pool factory.
/// @dev Chain guard is mandatory. Deployment does not modify the factory or any existing pool.
contract DeployBellSwapLensRegistry {
    VmDeployBellSwapLensRegistry private constant vm =
        VmDeployBellSwapLensRegistry(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address registryAddress) {
        uint256 deployerKey = vm.envOr("RH_MAINNET_DEPLOYER_PRIVATE_KEY", 0);
        if (deployerKey == 0) deployerKey = vm.envOr("ELYSIUM_DEPLOYER_PRIVATE_KEY", 0);
        if (deployerKey == 0) deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 expectedChainId = vm.envUint("BELL_LENS_EXPECTED_CHAIN_ID");
        address factory = vm.envAddress("BELL_LENS_FACTORY");
        string memory outputPath = vm.envString("BELL_LENS_REGISTRY_OUTPUT");
        require(block.chainid == expectedChainId, "unexpected chain");
        require(factory.code.length != 0, "factory has no code");

        vm.startBroadcast(deployerKey);
        BellSwapLensRegistry registry = new BellSwapLensRegistry(factory);
        vm.stopBroadcast();
        require(address(registry).code.length != 0 && registry.factory() == factory, "registry verification failed");
        registryAddress = address(registry);
        vm.writeFile(
            outputPath,
            string.concat(
                "{\"chainId\":",
                _decimal(block.chainid),
                ",\"factory\":\"",
                _hexAddress(factory),
                "\",\"swapLensRegistry\":\"",
                _hexAddress(registryAddress),
                "\"}"
            )
        );
    }

    function _hexAddress(address value) private pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i; i < 20; ++i) {
            uint8 b = uint8(uint160(value) >> ((19 - i) * 8));
            out[2 + i * 2] = alphabet[b >> 4];
            out[3 + i * 2] = alphabet[b & 0x0f];
        }
        return string(out);
    }

    function _decimal(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        for (uint256 n = value; n != 0; n /= 10) {
            ++digits;
        }
        bytes memory out = new bytes(digits);
        while (value != 0) {
            out[--digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(out);
    }
}
