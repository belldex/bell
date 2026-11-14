// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellSwapLens} from "../src/BellSwapLens.sol";
import {BellHook} from "../src/BellHook.sol";

interface VmDeployBellSwapLens {
    function envUint(string calldata name) external view returns (uint256);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function envString(string calldata name) external view returns (string memory);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function writeFile(string calldata path, string calldata data) external;
}

interface IBellLensHookIdentity {
    function poolId() external view returns (bytes32);
}

/// @notice Deploys the existing one-hook BellSwapLens for a newly created BELL V2/V3 pool.
/// @dev The lens is a public read-only contract. It is deployed separately from pool creation so
///      creating a pool does not also pay the lens deployment cost. Run with `--broadcast` only
///      after the target hook is live; output is a poolId-to-lens manifest entry for the API map.
contract DeployBellSwapLens {
    VmDeployBellSwapLens private constant vm =
        VmDeployBellSwapLens(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address lensAddress) {
        uint256 deployerKey = vm.envOr("RH_MAINNET_DEPLOYER_PRIVATE_KEY", 0);
        if (deployerKey == 0) deployerKey = vm.envOr("ELYSIUM_DEPLOYER_PRIVATE_KEY", 0);
        if (deployerKey == 0) deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 expectedChainId = vm.envUint("BELL_LENS_EXPECTED_CHAIN_ID");
        address hook = vm.envAddress("BELL_LENS_HOOK");
        string memory outputPath = vm.envString("BELL_LENS_OUTPUT");
        require(block.chainid == expectedChainId, "unexpected chain");
        require(hook.code.length != 0, "hook has no code");
        bytes32 poolId = IBellLensHookIdentity(hook).poolId();
        require(poolId != bytes32(0), "invalid pool id");

        vm.startBroadcast(deployerKey);
        BellSwapLens lens = new BellSwapLens(hook);
        vm.stopBroadcast();
        require(address(lens.boundHook()) == hook, "wrong hook binding");
        require(lens.boundPoolId() == poolId, "wrong pool binding");
        lensAddress = address(lens);

        vm.writeFile(
            outputPath,
            string.concat(
                '{"chainId":',
                _decimal(block.chainid),
                ',"poolId":"',
                _hex32(poolId),
                '","hook":"',
                _hexAddress(hook),
                '","lens":"',
                _hexAddress(lensAddress),
                '"}'
            )
        );
    }

    function _hexAddress(address value) private pure returns (string memory) {
        return _hexBytes(abi.encodePacked(value));
    }

    function _hex32(bytes32 value) private pure returns (string memory) {
        return _hexBytes(abi.encodePacked(value));
    }

    function _hexBytes(bytes memory value) private pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes memory out = new bytes(2 + value.length * 2);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i; i < value.length; ++i) {
            out[2 + i * 2] = alphabet[uint8(value[i] >> 4)];
            out[3 + i * 2] = alphabet[uint8(value[i] & 0x0f)];
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
