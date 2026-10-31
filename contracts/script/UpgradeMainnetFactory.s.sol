// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHook} from "../src/BellHook.sol";
import {BellPolicyOracle} from "../src/BellPolicyOracle.sol";
import {BellModeEvaluator} from "../src/BellModeEvaluator.sol";
import {BellHookDeployer} from "../src/BellHookDeployer.sol";
import {BellPoolFactory} from "../src/BellPoolFactory.sol";
import {PoolConfig} from "../src/types/ProtocolTypes.sol";

interface VmFactoryUpgrade {
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function envString(string calldata name) external view returns (string memory);
    function getNonce(address account) external view returns (uint64);
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function addr(uint256 privateKey) external view returns (address);
    function writeFile(string calldata path, string calldata data) external;
    function toString(address value) external pure returns (string memory);
}

/// @notice Replaces only BELL's immutable factory/template while reusing the verified Mainnet registries,
/// PoolManager, PositionManager, WETH, fee token, and router.
contract UpgradeMainnetFactory {
    VmFactoryUpgrade private constant vm = VmFactoryUpgrade(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Result {
        address policyOracle;
        address modeEvaluator;
        address hookDeployer;
        address poolFactory;
        bytes32 profileHash;
    }

    struct UpgradeConfig {
        address deployer;
        address sessionRegistry;
        address poolManager;
        address positionManager;
        address assetRegistry;
        address calendarRegistry;
        address safetyController;
        address feeToken;
        address serviceRecipient;
    }

    function run() external returns (Result memory result) {
        require(block.chainid == 4663, "wrong chain: expected Robinhood Mainnet 4663");
        uint256 pk = vm.envUint("RH_MAINNET_DEPLOYER_PRIVATE_KEY");
        UpgradeConfig memory config = _config(pk);
        PoolConfig memory profile = _profile(config, address(0));

        vm.startBroadcast(pk);
        result.policyOracle = address(new BellPolicyOracle());
        result.modeEvaluator = address(new BellModeEvaluator());
        uint64 factoryNonce = vm.getNonce(config.deployer) + 1;
        address futureFactory = vm.computeCreateAddress(config.deployer, factoryNonce);
        result.hookDeployer = address(new BellHookDeployer(
            futureFactory, config.sessionRegistry, keccak256(type(BellHook).creationCode), result.policyOracle, result.modeEvaluator
        ));
        profile.factory = futureFactory;
        BellPoolFactory deployedFactory = new BellPoolFactory(
            profile, BellHookDeployer(result.hookDeployer), config.feeToken, config.serviceRecipient
        );
        result.poolFactory = address(deployedFactory);
        result.profileHash = deployedFactory.profileHash();
        require(result.poolFactory == futureFactory, "factory nonce prediction mismatch");
        vm.stopBroadcast();

        string memory output = string.concat(
            '{"policyOracle":"', vm.toString(result.policyOracle),
            '","modeEvaluator":"', vm.toString(result.modeEvaluator),
            '","hookDeployer":"', vm.toString(result.hookDeployer),
            '","poolFactory":"', vm.toString(result.poolFactory),
            '","profileHash":"', _hex(result.profileHash), '"}'
        );
        vm.writeFile(vm.envString("BELL_FACTORY_UPDATE_OUTPUT"), output);
    }

    function _config(uint256 pk) private view returns (UpgradeConfig memory config) {
        config.deployer = vm.addr(pk);
        require(config.deployer == vm.envAddress("BELL_UPGRADE_DEPLOYER"), "wrong deployer for production profile");
        config.sessionRegistry = vm.envAddress("BELL_UPGRADE_SESSION_REGISTRY");
        config.poolManager = vm.envAddress("BELL_UPGRADE_POOL_MANAGER");
        config.positionManager = vm.envAddress("BELL_UPGRADE_POSITION_MANAGER");
        config.assetRegistry = vm.envAddress("BELL_UPGRADE_ASSET_REGISTRY");
        config.calendarRegistry = vm.envAddress("BELL_UPGRADE_CALENDAR_REGISTRY");
        config.safetyController = vm.envAddress("BELL_UPGRADE_SAFETY_CONTROLLER");
        config.feeToken = vm.envAddress("BELL_UPGRADE_FEE_TOKEN");
        config.serviceRecipient = vm.envAddress("BELL_UPGRADE_SERVICE_RECIPIENT");
    }

    function _profile(UpgradeConfig memory config, address factory) private view returns (PoolConfig memory) {
        return PoolConfig({
            token0: address(0), token1: address(0), asset0: bytes32(0), asset1: bytes32(0),
            poolManager: config.poolManager, positionManager: config.positionManager, factory: factory,
            assetRegistry: config.assetRegistry, calendarRegistry: config.calendarRegistry,
            safetyController: config.safetyController, treasuryAdapter: address(0),
            poolClass: 1, liquidityMode: 0, referenceMode: 0, tickSpacing: 60,
            tradeCap: [uint128(10), uint128(10)], windowCap: [uint128(100), uint128(100)],
            closureCap: [uint128(1), uint128(1)],
            policyId: keccak256(bytes(vm.envString("BELL_POLICY_ID"))),
            referenceAdapter0: address(0), referenceAdapter1: address(0)
        });
    }

    function _hex(bytes32 value) private pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes memory out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i; i < 32; ++i) {
            out[2 + i * 2] = alphabet[uint8(value[i] >> 4)];
            out[3 + i * 2] = alphabet[uint8(value[i] & 0x0f)];
        }
        return string(out);
    }
}
