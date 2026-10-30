// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafetyController} from "../src/SafetyController.sol";
import {AssetRegistry} from "../src/registries/AssetRegistry.sol";
import {CalendarRegistry} from "../src/registries/CalendarRegistry.sol";
import {SessionRegistry} from "../src/registries/SessionRegistry.sol";
import {BellHook} from "../src/BellHook.sol";
import {BellHookDeployer} from "../src/BellHookDeployer.sol";
import {BellPolicyOracle} from "../src/BellPolicyOracle.sol";
import {BellPoolFactory} from "../src/BellPoolFactory.sol";
import {BellRouter} from "../src/BellRouter.sol";
import {WETH} from "solmate/src/tokens/WETH.sol";
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
    function envString(string calldata name) external view returns (string memory);
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function getNonce(address account) external view returns (uint64);
    function addr(uint256 privateKey) external view returns (address);
    function writeFile(string calldata path, string calldata data) external;
    function envOr(string calldata name, string calldata defaultValue) external view returns (string memory);
    function toString(uint256 value) external pure returns (string memory);
}

/// @notice BELL deployment for Robinhood Chain, testnet (46630) and mainnet (4663).
/// @dev Everything is env-driven and fails closed: wrong chain, missing or non-distinct roles, a
/// missing fee token on mainnet, or a zero deployer all abort before any broadcast.
///
/// The deployer supplies the real treasury, guardian and service recipient. Mainnet additionally
/// requires a real fee token because the factory fails closed when FeeToken is unbound, and
/// PRICE_GUARDED stays disabled until an independent reference is admitted.
///
/// Run testnet: forge script script/DeployTestnet.s.sol --rpc-url $RH_TESTNET_RPC_PRIMARY --broadcast
/// Run mainnet: forge script script/DeployTestnet.s.sol --rpc-url $RH_MAINNET_RPC_PRIMARY --broadcast
contract DeployTestnet {
    VmDeploy private constant vm = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TESTNET_CHAIN_ID = 46630;
    uint256 internal constant MAINNET_CHAIN_ID = 4663;
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
        address weth;
        address router;
    }

    function run() external returns (Deployment memory d) {
        bool isMainnet = block.chainid == MAINNET_CHAIN_ID;
        require(isMainnet || block.chainid == TESTNET_CHAIN_ID, "wrong chain: expected Robinhood 4663 or 46630");

        uint256 pk = _deployerKey(isMainnet);
        address deployer = vm.addr(pk);
        require(deployer != address(0), "missing deployer");

        Roles memory roles = _roles(isMainnet, deployer);
        address feeToken = _feeToken(isMainnet);

        uint8 poolClass = uint8(vm.envOr("BELL_POOL_CLASS", vm.envOr("TESTNET_POOL_CLASS", uint256(1))));
        require(poolClass == 1, "only SESSION_ONLY is enabled; PRICE_GUARDED stays blocked");

        vm.startBroadcast(pk);
        d = _deploy(deployer, roles, feeToken, poolClass, isMainnet);
        vm.stopBroadcast();

        _writeManifest(d, deployer, roles.treasury, roles.recipient, feeToken, isMainnet);
    }

    struct Roles {
        address governance;
        address guardian;
        address treasury;
        address recipient;
    }

    function _deployerKey(bool isMainnet) private view returns (uint256 pk) {
        // On mainnet the chain-specific key is checked FIRST. Falling back to the shared
        // RH_DEPLOYER_PRIVATE_KEY there would silently spend from the rehearsal wallet.
        if (isMainnet) {
            pk = vm.envOr("RH_MAINNET_DEPLOYER_PRIVATE_KEY", uint256(0));
            if (pk == 0) pk = vm.envOr("RH_DEPLOYER_PRIVATE_KEY", uint256(0));
        } else {
            pk = vm.envOr("RH_TESTNET_DEPLOYER_PRIVATE_KEY", uint256(0));
            if (pk == 0) pk = vm.envOr("RH_DEPLOYER_PRIVATE_KEY", uint256(0));
        }
        if (pk == 0) pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
    }

    function _roles(bool isMainnet, address deployer) private view returns (Roles memory roles) {
        roles.governance = vm.envOr(
            isMainnet ? "MAINNET_GOVERNANCE_ADDRESS" : "TESTNET_GOVERNANCE_ADDRESS", deployer
        );
        // envOr + explicit require so a missing variable reports the role name instead of a raw
        // cheatcode revert that reads like a tooling failure.
        roles.guardian = vm.envOr(isMainnet ? "MAINNET_GUARDIAN_ADDRESS" : "TESTNET_GUARDIAN_ADDRESS", address(0));
        roles.treasury = vm.envOr(isMainnet ? "MAINNET_TREASURY_ADDRESS" : "TESTNET_TREASURY_ADDRESS", address(0));
        roles.recipient = vm.envOr(isMainnet ? "MAINNET_SERVICE_RECIPIENT" : "TESTNET_SERVICE_RECIPIENT", address(0));
        require(
            roles.treasury != address(0) && roles.recipient != address(0) && roles.guardian != address(0),
            "missing role address: set MAINNET_GUARDIAN_ADDRESS, MAINNET_TREASURY_ADDRESS and MAINNET_SERVICE_RECIPIENT"
        );
        require(
            roles.governance != roles.guardian && roles.governance != roles.treasury
                && roles.guardian != roles.treasury,
            "roles must be distinct"
        );
        if (isMainnet) {
            // A burn address or the deployer standing in for treasury is acceptable only on testnet.
            require(roles.treasury != deployer, "mainnet treasury must not be the deployer");
            require(roles.guardian != deployer, "mainnet guardian must not be the deployer");
        }
    }

    function _feeToken(bool isMainnet) private view returns (address feeToken) {
        feeToken = vm.envOr(isMainnet ? "MAINNET_FEE_TOKEN_ADDRESS" : "TESTNET_FEE_TOKEN_ADDRESS", address(0));
        if (isMainnet) require(feeToken != address(0), "mainnet requires a real fee token");
    }

    function _deploy(
        address deployer, Roles memory roles, address feeToken, uint8 poolClass, bool isMainnet
    ) private returns (Deployment memory d) {
        // Governance latency is a deployment parameter, not a network property. It defaults to 0 so
        // a launch can go live in one block; raise it with BELL_GOVERNANCE_DELAY_SECONDS once the
        // operator set is ready for a real timelock.
        uint32 governanceDelay = uint32(vm.envOr("BELL_GOVERNANCE_DELAY_SECONDS", uint256(0)));
        uint32 calendarLead = uint32(vm.envOr("BELL_CALENDAR_PUBLICATION_LEAD_SECONDS", uint256(0)));
        uint32 operationExpiry = uint32(vm.envOr("BELL_OPERATION_EXPIRY_SECONDS", uint256(604800)));
        d.safetyController = address(new SafetyController(
            roles.governance, roles.guardian, roles.treasury, governanceDelay, calendarLead, operationExpiry
        ));
        d.assetRegistry = address(new AssetRegistry(d.safetyController));
        d.calendarRegistry = address(new CalendarRegistry(d.safetyController));
        d.sessionRegistry = address(new SessionRegistry(d.assetRegistry, d.calendarRegistry));
        d.poolManager = address(new PoolManager(deployer));
        // WETH for the wrap/unwrap path. On mainnet a canonical WETH must be supplied; deploying a
        // fixture would silently give users a token that is not the chain's real wrapped ETH.
        d.weth = vm.envOr(isMainnet ? "MAINNET_WETH_ADDRESS" : "TESTNET_WETH_ADDRESS", address(0));
        if (isMainnet) require(d.weth != address(0), "mainnet requires the canonical WETH address");
        if (d.weth == address(0)) d.weth = address(new WETH());
        d.positionManager = address(new PositionManager(
            IPoolManager(d.poolManager),
            IAllowanceTransfer(CANONICAL_PERMIT2),
            POSITION_MANAGER_UNSUBSCRIBE_GAS_LIMIT,
            IPositionDescriptor(address(0)),
            IWETH9(d.weth)
        ));
        // One shared oracle for the whole deployment: each hook receives it instead of creating its own,
        // which keeps per-hook initcode inside the EIP-3860 limit.
        address policyOracle = address(new BellPolicyOracle());
        address futureFactory = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        d.hookDeployer = address(new BellHookDeployer(
            futureFactory, d.sessionRegistry, keccak256(type(BellHook).creationCode), policyOracle
        ));
        d.poolFactory = address(new BellPoolFactory(
            _profile(d, futureFactory, poolClass), BellHookDeployer(d.hookDeployer), feeToken, roles.recipient
        ));
        require(d.poolFactory == futureFactory, "factory address prediction mismatch");
        d.router = address(new BellRouter(IPoolManager(d.poolManager), d.weth));
    }

    function _profile(Deployment memory d, address futureFactory, uint8 poolClass)
        private
        view
        returns (PoolConfig memory)
    {
        return PoolConfig({
            token0: address(0), token1: address(0), asset0: bytes32(0), asset1: bytes32(0),
            poolManager: d.poolManager, positionManager: d.positionManager, factory: futureFactory,
            assetRegistry: d.assetRegistry, calendarRegistry: d.calendarRegistry,
            safetyController: d.safetyController, treasuryAdapter: address(0),
            poolClass: poolClass, liquidityMode: 0, referenceMode: 0, tickSpacing: 60,
            tradeCap: [uint128(10), uint128(10)], windowCap: [uint128(100), uint128(100)],
            closureCap: [uint128(1), uint128(1)],
            policyId: keccak256(bytes(vm.envOr("BELL_POLICY_ID", string("bell-testnet-v1")))),
            referenceAdapter0: address(0), referenceAdapter1: address(0)
        });
    }

    function _writeManifest(
        Deployment memory d, address deployer, address treasury, address recipient, address feeToken, bool isMainnet
    ) private {
        string memory p1 = string.concat(
            '{\n  "chainId": ', vm.toString(block.chainid),
            ',\n  "deployer": "', _hex(deployer),
            '",\n  "treasury": "', _hex(treasury),
            '",\n  "serviceRecipient": "', _hex(recipient),
            '",\n  "feeToken": "', _hex(feeToken)
        );
        string memory p2 = string.concat(
            '",\n  "permit2": "', _hex(CANONICAL_PERMIT2),
            '",\n  "safetyController": "', _hex(d.safetyController),
            '",\n  "assetRegistry": "', _hex(d.assetRegistry),
            '",\n  "calendarRegistry": "', _hex(d.calendarRegistry),
            '",\n  "sessionRegistry": "', _hex(d.sessionRegistry)
        );
        string memory p3 = string.concat(
            '",\n  "poolManager": "', _hex(d.poolManager),
            '",\n  "positionManager": "', _hex(d.positionManager),
            '",\n  "hookDeployer": "', _hex(d.hookDeployer),
            '",\n  "poolFactory": "', _hex(d.poolFactory),
            '",\n  "weth": "', _hex(d.weth),
            '",\n  "router": "', _hex(d.router),
            '",\n  "status": "', isMainnet ? "PRODUCTION" : "REHEARSAL",
            '",\n  "note": "', isMainnet
                ? "PRICE_GUARDED stays blocked until an independent reference is admitted."
                : "FeeToken zero means FeeTokenNotBound fail-closed; PRICE_GUARDED remains blocked.",
            '"\n}\n'
        );
        string memory json = string.concat(p1, p2, p3);
        string memory defaultPath = isMainnet
            ? "../evidence/deploy/mainnet-4663.json"
            : "../evidence/deploy/testnet-46630.json";
        string memory manifestPath = vm.envOr("BELL_MANIFEST_PATH", defaultPath);
        vm.writeFile(manifestPath, json);
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
