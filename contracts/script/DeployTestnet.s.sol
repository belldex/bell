// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafetyController} from "../src/SafetyController.sol";
import {AssetRegistry} from "../src/registries/AssetRegistry.sol";
import {CalendarRegistry} from "../src/registries/CalendarRegistry.sol";
import {SessionRegistry} from "../src/registries/SessionRegistry.sol";
import {BellHook} from "../src/BellHook.sol";
import {BellHookDeployer} from "../src/BellHookDeployer.sol";
import {BellPoolFactory} from "../src/BellPoolFactory.sol";
import {PoolConfig} from "../src/types/ProtocolTypes.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PositionManager} from "../lib/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "../lib/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "../lib/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

interface VmDeploy {
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function getNonce(address account) external view returns (uint64);
    function addr(uint256 privateKey) external view returns (address);
    function writeFile(string calldata path, string calldata data) external;
    function toString(uint256 value) external pure returns (string memory);
}

/// @notice Robinhood testnet (chainId 46630) rehearsal deployment.
/// @dev Phase 1-3 of M14-01: registries, v4 core/periphery, hook deployer and the PUBLIC factory
/// profile. Deploys are env-driven and fail closed on wrong chain, missing treasury/recipient or a
/// zero deployer. Canonical Permit2 on this chain is verified by the caller (see runbook); the
/// address below is the deterministic Permit2 deployment shared by the ecosystem.
/// Run: forge script script/DeployTestnet.s.sol --rpc-url $RH_TESTNET_RPC_PRIMARY --broadcast
contract DeployTestnet {
    VmDeploy private constant vm = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant EXPECTED_CHAIN_ID = 46630;
    address internal constant CANONICAL_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 internal constant POSITION_MANAGER_UNSUBSCRIBE_GAS_LIMIT = 100000;

    struct Deployment {
        address safetyController;
        address assetRegistry;
        address calendarRegistry;
        address sessionRegistry;
        address poolManager;
        address positionManager;
        address hookDeployer;
        address poolFactory;
    }

    function run() external returns (Deployment memory d) {
        require(block.chainid == EXPECTED_CHAIN_ID, "wrong chain: expected Robinhood testnet 46630");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        require(deployer != address(0), "missing deployer");
        address treasury = vm.envAddress("TESTNET_TREASURY_ADDRESS");
        address recipient = vm.envAddress("TESTNET_SERVICE_RECIPIENT");
        require(treasury != address(0) && recipient != address(0), "missing treasury/recipient");
        address feeToken = vm.envOr("TESTNET_FEE_TOKEN_ADDRESS", address(0));
        uint8 poolClass = uint8(vm.envOr("TESTNET_POOL_CLASS", uint256(1)));
        require(poolClass == 1, "only SESSION_ONLY rehearsal is enabled; PRICE_GUARDED stays blocked");

        vm.startBroadcast(pk);
        d.safetyController = address(new SafetyController(treasury, treasury, treasury));
        d.assetRegistry = address(new AssetRegistry(d.safetyController));
        d.calendarRegistry = address(new CalendarRegistry(d.safetyController));
        d.sessionRegistry = address(new SessionRegistry(d.assetRegistry, d.calendarRegistry));
        d.poolManager = address(new PoolManager(deployer));
        d.positionManager = address(new PositionManager(
            IPoolManager(d.poolManager),
            IAllowanceTransfer(CANONICAL_PERMIT2),
            POSITION_MANAGER_UNSUBSCRIBE_GAS_LIMIT,
            IPositionDescriptor(address(0)),
            IWETH9(address(0))
        ));
        address futureFactory = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        d.hookDeployer = address(new BellHookDeployer(
            futureFactory, d.sessionRegistry, keccak256(type(BellHook).creationCode)
        ));
        PoolConfig memory profile = PoolConfig({
            token0: address(0), token1: address(0), asset0: bytes32(0), asset1: bytes32(0),
            poolManager: d.poolManager, positionManager: d.positionManager, factory: futureFactory,
            assetRegistry: d.assetRegistry, calendarRegistry: d.calendarRegistry,
            safetyController: d.safetyController, treasuryAdapter: address(0),
            poolClass: poolClass, liquidityMode: 0, referenceMode: 0, tickSpacing: 60,
            tradeCap: [uint128(10), uint128(10)], windowCap: [uint128(100), uint128(100)],
            closureCap: [uint128(1), uint128(1)], policyId: keccak256("bell-testnet-v1")
        });
        d.poolFactory = address(new BellPoolFactory(profile, BellHookDeployer(d.hookDeployer), feeToken, recipient));
        require(d.poolFactory == futureFactory, "factory address prediction mismatch");
        vm.stopBroadcast();

        _writeManifest(d, deployer, treasury, recipient, feeToken);
    }

    function _writeManifest(
        Deployment memory d, address deployer, address treasury, address recipient, address feeToken
    ) private {
        string memory json = string.concat(
            '{\n  "chainId": ', vm.toString(block.chainid),
            ',\n  "deployer": "', _hex(deployer),
            '",\n  "treasury": "', _hex(treasury),
            '",\n  "serviceRecipient": "', _hex(recipient),
            '",\n  "feeToken": "', _hex(feeToken),
            '",\n  "permit2": "', _hex(CANONICAL_PERMIT2),
            '",\n  "safetyController": "', _hex(d.safetyController),
            '",\n  "assetRegistry": "', _hex(d.assetRegistry),
            '",\n  "calendarRegistry": "', _hex(d.calendarRegistry),
            '",\n  "sessionRegistry": "', _hex(d.sessionRegistry),
            '",\n  "poolManager": "', _hex(d.poolManager),
            '",\n  "positionManager": "', _hex(d.positionManager),
            '",\n  "hookDeployer": "', _hex(d.hookDeployer),
            '",\n  "poolFactory": "', _hex(d.poolFactory),
            '",\n  "status": "REHEARSAL",\n  "note": "FeeToken zero means FeeTokenNotBound fail-closed; PRICE_GUARDED remains blocked."\n}\n'
        );
        vm.writeFile("../evidence/deploy/testnet-46630.json", json);
    }

    function _hex(address value) private pure returns (string memory) {
        bytes20 raw = bytes20(value);
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        bytes memory alphabet = "0123456789abcdef";
        for (uint256 i; i < 20; ++i) {
            out[2 + i * 2] = alphabet[uint8(raw[i] >> 4)];
            out[3 + i * 2] = alphabet[uint8(raw[i] & 0x0f)];
        }
        return string(out);
    }
}
