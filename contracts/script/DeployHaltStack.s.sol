// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHookV3} from "../src/BellHookV3.sol";
import {BellPolicyOracleV2} from "../src/BellPolicyOracleV2.sol";
import {BellPolicyOracleV3} from "../src/BellPolicyOracleV3.sol";
import {BellModeEvaluator} from "../src/BellModeEvaluator.sol";
import {BellHookDeployerV3} from "../src/BellHookDeployerV3.sol";
import {BellPoolFactoryV3} from "../src/BellPoolFactoryV3.sol";
import {BellAuctionRegistry} from "../src/auction/BellAuctionRegistry.sol";
import {BellAuctionFactoryModuleV2} from "../src/auction/BellAuctionFactoryModuleV2.sol";
import {HaltRegistry, IHaltHybridAuth} from "../src/registries/HaltRegistry.sol";
import {IBellHookDeployer} from "../src/interfaces/IBellHookDeployer.sol";
import {PoolConfig} from "../src/types/ProtocolTypes.sol";

interface VmHaltStack {
    enum ForgeContext { TestGroup, Test, Coverage, Snapshot, ScriptGroup, ScriptDryRun, ScriptBroadcast, ScriptResume, Unknown }

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
    function toString(bytes32 value) external pure returns (string memory);
    function isContext(ForgeContext context) external view returns (bool);
}

/// @notice Deploys the Einstein Hooks v3 stack next to the live Einstein v2 stack and replaces nothing: a HaltRegistry, BellPolicyOracleV3, a
///         new auction registry and BellAuctionFactoryModuleV2, a BellHookDeployerV3 that uses them, and a BellPoolFactoryV3. Every other
///         dependency (session registry, asset registry, calendar, safety controller, HybridAuth, mode evaluator, pool manager, position
///         manager) is read from the environment and reused. Existing pools are untouched; only pools created through the new factory get halts.
///
///         Dry run (no transaction is sent):   forge script script/DeployHaltStack.s.sol --fork-url $RPC
///         Broadcast (a human decision):        add --broadcast, after the independent review the design notes call for.
///
///         Required environment: BELL_HALT_DEPLOYER_PRIVATE_KEY, BELL_HALT_OUTPUT, BELL_POLICY_ID, and BELL_HALT_* for each dependency
///         named in `_dependencies`.
contract DeployHaltStack {
    VmHaltStack private constant vm = VmHaltStack(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant REPORTER_ROLE = keccak256("REPORTER");

    struct Dependencies {
        address hybridAuth;
        address sessionRegistry;
        address assetRegistry;
        address calendarRegistry;
        address safetyController;
        address modeEvaluator;
        address poolManager;
        address positionManager;
        address feeToken;
        address serviceRecipient;
    }

    struct Result {
        address haltRegistry;
        address policyOracle;
        address auctionRegistry;
        address auctionFactoryModule;
        address hookDeployer;
        address poolFactory;
        bytes32 profileHash;
    }

    function run() external returns (Result memory r) {
        require(block.chainid == 4663 || block.chainid == 46630, "wrong chain: expected Robinhood Chain 4663 or 46630");
        uint256 pk = vm.envUint("BELL_HALT_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        Dependencies memory d = _dependencies();

        vm.startBroadcast(pk);
        // CREATE order: haltRegistry, oracle, auctionRegistry, module, hookDeployer, factory. The registry and module need the factory address
        // before it exists, so it is computed from the deployer nonce; the final require fails the whole script if the count is wrong.
        address futureFactory = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 5);
        r.haltRegistry = address(new HaltRegistry(IHaltHybridAuth(d.hybridAuth), REPORTER_ROLE));
        r.policyOracle = address(new BellPolicyOracleV3(r.haltRegistry));
        r.auctionRegistry = address(new BellAuctionRegistry(futureFactory));
        r.auctionFactoryModule = address(new BellAuctionFactoryModuleV2(
            futureFactory, r.auctionRegistry, d.feeToken, 600, 900, 512, 25, 100, HaltRegistry(r.haltRegistry)
        ));
        r.hookDeployer = address(new BellHookDeployerV3(
            futureFactory, d.sessionRegistry, keccak256(type(BellHookV3).creationCode), BellPolicyOracleV2(r.policyOracle),
            BellModeEvaluator(d.modeEvaluator), r.auctionRegistry, r.auctionFactoryModule
        ));
        BellPoolFactoryV3 factory = new BellPoolFactoryV3(
            _profile(d, futureFactory), IBellHookDeployer(r.hookDeployer), d.feeToken, d.serviceRecipient
        );
        r.poolFactory = address(factory);
        r.profileHash = factory.profileHash();
        vm.stopBroadcast();

        require(r.poolFactory == futureFactory, "factory nonce prediction mismatch");
        _check(r, d);
        vm.writeFile(vm.envString("BELL_HALT_OUTPUT"), _json(r, d, deployer));
    }

    /// @dev Reads every binding back so a wrong argument or a wrong nonce count fails here, not after someone creates a pool.
    function _check(Result memory r, Dependencies memory d) private view {
        BellHookDeployerV3 hd = BellHookDeployerV3(r.hookDeployer);
        require(hd.factory() == r.poolFactory, "deployer is not bound to the factory");
        require(hd.policyOracle() == r.policyOracle, "deployer does not use the V3 oracle");
        require(hd.auctionRegistry() == r.auctionRegistry && hd.auctionFactoryModule() == r.auctionFactoryModule, "deployer auction wiring");
        require(hd.sessionRegistry() == d.sessionRegistry && hd.modeEvaluator() == d.modeEvaluator, "deployer reuses the wrong registry or evaluator");
        require(BellPolicyOracleV3(r.policyOracle).haltRegistry() == r.haltRegistry, "oracle is not bound to the halt registry");
        require(address(BellAuctionFactoryModuleV2(r.auctionFactoryModule).haltRegistry()) == r.haltRegistry, "module is not bound to the halt registry");
        require(BellAuctionRegistry(r.auctionRegistry).factory() == r.poolFactory, "auction registry writer is not the factory");
        require(BellAuctionRegistry(r.auctionRegistry).auctionFactoryModule() == r.auctionFactoryModule, "factory did not bind the module");
        require(address(HaltRegistry(r.haltRegistry).hybridAuth()) == d.hybridAuth, "halt registry uses a different HybridAuth");
        require(HaltRegistry(r.haltRegistry).authorizationRole() == REPORTER_ROLE, "halt registry role");
    }

    function _dependencies() private view returns (Dependencies memory d) {
        d.hybridAuth = vm.envAddress("BELL_HALT_HYBRID_AUTH");
        d.sessionRegistry = vm.envAddress("BELL_HALT_SESSION_REGISTRY");
        d.assetRegistry = vm.envAddress("BELL_HALT_ASSET_REGISTRY");
        d.calendarRegistry = vm.envAddress("BELL_HALT_CALENDAR_REGISTRY");
        d.safetyController = vm.envAddress("BELL_HALT_SAFETY_CONTROLLER");
        d.modeEvaluator = vm.envAddress("BELL_HALT_MODE_EVALUATOR");
        d.poolManager = vm.envAddress("BELL_HALT_POOL_MANAGER");
        d.positionManager = vm.envAddress("BELL_HALT_POSITION_MANAGER");
        d.feeToken = vm.envAddress("BELL_HALT_FEE_TOKEN");
        d.serviceRecipient = vm.envAddress("BELL_HALT_SERVICE_RECIPIENT");
    }

    function _profile(Dependencies memory d, address factory) private view returns (PoolConfig memory) {
        return PoolConfig({
            token0: address(0), token1: address(0), asset0: bytes32(0), asset1: bytes32(0),
            poolManager: d.poolManager, positionManager: d.positionManager, factory: factory,
            assetRegistry: d.assetRegistry, calendarRegistry: d.calendarRegistry, safetyController: d.safetyController,
            treasuryAdapter: address(0), poolClass: 1, liquidityMode: 0, referenceMode: 0, tickSpacing: 60,
            tradeCap: [uint128(10), uint128(10)], windowCap: [uint128(100), uint128(100)], closureCap: [uint128(1), uint128(1)],
            policyId: keccak256(bytes(vm.envString("BELL_POLICY_ID"))),
            referenceAdapter0: address(0), referenceAdapter1: address(0)
        });
    }

    function _json(Result memory r, Dependencies memory d, address deployer) private view returns (string memory) {
        string memory status = vm.isContext(VmHaltStack.ForgeContext.ScriptBroadcast) ? "BROADCAST" : "SIMULATED_NOT_DEPLOYED";
        return string.concat(
            '{"chainId":', _uint(block.chainid), ',"status":"', status, '","deployer":"', vm.toString(deployer),
            '","contracts":{"haltRegistry":"', vm.toString(r.haltRegistry),
            '","policyOracleV3":"', vm.toString(r.policyOracle),
            '","auctionRegistry":"', vm.toString(r.auctionRegistry),
            '","auctionFactoryModuleV2":"', vm.toString(r.auctionFactoryModule),
            '","hookDeployer":"', vm.toString(r.hookDeployer),
            '","poolFactory":"', vm.toString(r.poolFactory),
            '"},"profileHash":"', vm.toString(r.profileHash),
            '","reused":{"hybridAuth":"', vm.toString(d.hybridAuth),
            '","sessionRegistry":"', vm.toString(d.sessionRegistry),
            '","assetRegistry":"', vm.toString(d.assetRegistry),
            '","calendarRegistry":"', vm.toString(d.calendarRegistry),
            '","safetyController":"', vm.toString(d.safetyController),
            '","modeEvaluator":"', vm.toString(d.modeEvaluator),
            '","poolManager":"', vm.toString(d.poolManager),
            '","positionManager":"', vm.toString(d.positionManager), '"}}'
        );
    }

    function _uint(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        for (uint256 t = value; t != 0; t /= 10) ++digits;
        bytes memory out = new bytes(digits);
        while (value != 0) {
            out[--digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(out);
    }
}
