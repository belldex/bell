// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HybridAssetRegistry} from "../src/registries/HybridAssetRegistry.sol";
import {CalendarRegistry} from "../src/registries/CalendarRegistry.sol";
import {SessionRegistry} from "../src/registries/SessionRegistry.sol";
import {BellPolicyOracleV2} from "../src/BellPolicyOracleV2.sol";
import {BellModeEvaluator} from "../src/BellModeEvaluator.sol";
import {BellHookV3} from "../src/BellHookV3.sol";
import {BellHookDeployerV3} from "../src/BellHookDeployerV3.sol";
import {BellPoolFactoryV3} from "../src/BellPoolFactoryV3.sol";
import {BellSwapLensRegistry} from "../src/BellSwapLensRegistry.sol";
import {BellAuctionRegistry} from "../src/auction/BellAuctionRegistry.sol";
import {BellAuctionFactoryModule} from "../src/auction/BellAuctionFactoryModule.sol";
import {AssetDescriptor, SourceWire, PoolConfig} from "../src/types/ProtocolTypes.sol";
import {IBellHookDeployer} from "../src/interfaces/IBellHookDeployer.sol";

interface VmDeployPQHooksTestnet {
    function envUint(string calldata name) external returns (uint256);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256);
    function envString(string calldata name) external returns (string memory);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function getNonce(address account) external view returns (uint64);
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonAddress(string calldata json, string calldata key) external pure returns (address);
    function parseJsonBytes32(string calldata json, string calldata key) external pure returns (bytes32);
    function parseJsonUint(string calldata json, string calldata key) external pure returns (uint256);
    function parseJsonString(string calldata json, string calldata key) external pure returns (string memory);
    function parseJsonBytes(string calldata json, string calldata key) external pure returns (bytes memory);
    function writeFile(string calldata path, string calldata data) external;
    function toString(address value) external pure returns (string memory);
    function toString(bytes32 value) external pure returns (string memory);
    function toString(uint256 value) external pure returns (string memory);
}

interface IPQKeyRegistryTestnet {
    function bootstrapRole(bytes32 role, address signer, bytes32 commitment, uint32 maxSignatures) external;
    function setHybridAuth(address auth) external;
    function finalizeBootstrap() external;
}

interface IHybridAuthTestnet { }

interface IERC20DecimalsPQ {
    function decimals() external view returns (uint8);
}

/// @notice One-shot Mainnet deployment rehearsal for the PQ trust stack and BellHookV3 factory.
/// @dev This script only deploys immutable infrastructure and genesis stock descriptors. It never
///      seeds a pool or broadcasts unless Forge is explicitly invoked with --broadcast.
contract DeployPQHooksTestnet {
    VmDeployPQHooksTestnet private constant vm =
        VmDeployPQHooksTestnet(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant EXPECTED_CHAIN_ID = 46630;
    uint32 private constant KEY_BUDGET = 64;
    bytes32 private constant KEEPER_ROLE = keccak256("KEEPER");
    bytes32 private constant REPORTER_ROLE = keccak256("REPORTER");
    bytes32 private constant GOVERNANCE_ROLE = keccak256("GOVERNANCE");
    bytes32 private constant GUARDIAN_ROLE = keccak256("GUARDIAN");

    struct KeyRole {
        address signer;
        bytes32 commitment;
    }

    struct TestnetRoles {
        KeyRole keeper;
        KeyRole reporter;
        KeyRole governance;
        KeyRole guardian;
    }

    struct StockGenesis {
        AssetDescriptor descriptor;
        bytes sourceConfig;
    }

    struct Deployment {
        address shrincsVerifier;
        address hashSigVerifier;
        address pqKeyRegistry;
        address hybridAuth;
        address safetyController;
        address assetRegistry;
        address calendarRegistry;
        address sessionRegistry;
        address policyOracle;
        address modeEvaluator;
        address auctionRegistry;
        address auctionFactoryModule;
        address hookDeployer;
        address poolFactory;
        address lensRegistry;
        bytes32 profileHash;
        bytes32[2] assetIds;
        address[2] assetTokens;
    }

    function run() external returns (Deployment memory d) {
        require(block.chainid == EXPECTED_CHAIN_ID, "wrong chain: Robinhood testnet 46630 only");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        string memory mainnetManifest = vm.readFile("../evidence/deploy/testnet-46630-pq-inputs.json");
        string memory keyManifest = vm.readFile("pq/deployments/robinhood-46630-keys.json");
        string memory chainlinkAdapters = vm.readFile("../evidence/deploy/testnet-46630-chainlink-session-adapters.json");
        require(vm.parseJsonUint(chainlinkAdapters, ".chainId") == EXPECTED_CHAIN_ID, "wrong adapter evidence chain");
        require(deployer == vm.parseJsonAddress(mainnetManifest, ".deployer"), "deployer differs from the inputs file");
        TestnetRoles memory roles = _roles(keyManifest, deployer);

        vm.startBroadcast(deployerKey);
        d.shrincsVerifier = _deployArtifact(
            "out-pq-mainnet/BellSHRINCSStatefulVerifier.sol/BellSHRINCSStatefulVerifier.json", bytes("")
        );
        d.hashSigVerifier = _deployArtifact(
            "out-pq-mainnet/HashSigVerifier.sol/HashSigVerifier.json", abi.encode(d.shrincsVerifier)
        );
        d.pqKeyRegistry = _deployArtifact(
            "out-pq-mainnet/PQKeyRegistry.sol/PQKeyRegistry.json", abi.encode(deployer)
        );
        d.hybridAuth = _deployArtifact(
            "out-pq-mainnet/HybridAuth.sol/HybridAuth.json", abi.encode(d.pqKeyRegistry, d.hashSigVerifier)
        );
        IPQKeyRegistryTestnet keyRegistry = IPQKeyRegistryTestnet(d.pqKeyRegistry);
        keyRegistry.bootstrapRole(KEEPER_ROLE, roles.keeper.signer, roles.keeper.commitment, KEY_BUDGET);
        keyRegistry.bootstrapRole(REPORTER_ROLE, roles.reporter.signer, roles.reporter.commitment, KEY_BUDGET);
        keyRegistry.bootstrapRole(GOVERNANCE_ROLE, roles.governance.signer, roles.governance.commitment, KEY_BUDGET);
        keyRegistry.bootstrapRole(GUARDIAN_ROLE, roles.guardian.signer, roles.guardian.commitment, KEY_BUDGET);
        keyRegistry.setHybridAuth(d.hybridAuth);
        keyRegistry.finalizeBootstrap();

        uint32 delay = _envUint32("BELL_GOVERNANCE_DELAY_SECONDS", 172800);
        uint32 calendarLead = _envUint32("BELL_CALENDAR_PUBLICATION_LEAD_SECONDS", 86400);
        uint32 operationExpiry = _envUint32("BELL_OPERATION_EXPIRY_SECONDS", 604800);
        d.safetyController = _deployArtifact(
            "out-pq-mainnet/SafetyControllerV2.sol/SafetyControllerV2.json",
            abi.encode(IHybridAuthTestnet(d.hybridAuth), delay, calendarLead, operationExpiry)
        );
        CalendarRegistry calendar = new CalendarRegistry(d.safetyController);
        d.calendarRegistry = address(calendar);

        StockGenesis[] memory genesis = new StockGenesis[](2);
        genesis[0] = _chainlinkStockGenesis(chainlinkAdapters, 1);
        genesis[1] = _usdgGenesis(mainnetManifest);
        AssetDescriptor[] memory descriptors = new AssetDescriptor[](2);
        bytes[] memory configs = new bytes[](2);
        for (uint256 i; i < genesis.length; ++i) {
            descriptors[i] = genesis[i].descriptor;
            configs[i] = genesis[i].sourceConfig;
        }
        HybridAssetRegistry assets = new HybridAssetRegistry(d.safetyController, descriptors, configs);
        d.assetRegistry = address(assets);
        SessionRegistry sessions = new SessionRegistry(address(assets), address(calendar));
        d.sessionRegistry = address(sessions);
        BellPolicyOracleV2 oracle = new BellPolicyOracleV2();
        d.policyOracle = address(oracle);
        BellModeEvaluator evaluator = new BellModeEvaluator();
        d.modeEvaluator = address(evaluator);

        address feeToken = vm.parseJsonAddress(mainnetManifest, ".feeToken");
        address serviceRecipient = vm.parseJsonAddress(mainnetManifest, ".serviceRecipient");
        uint64 factoryNonce = vm.getNonce(deployer) + 3;
        address futureFactory = vm.computeCreateAddress(deployer, factoryNonce);
        BellAuctionRegistry auctionRegistry = new BellAuctionRegistry(futureFactory);
        d.auctionRegistry = address(auctionRegistry);
        BellAuctionFactoryModule auctionModule = new BellAuctionFactoryModule(
            futureFactory, address(auctionRegistry), feeToken, 600, 900, 512, 25, 100
        );
        d.auctionFactoryModule = address(auctionModule);
        BellHookDeployerV3 hookDeployer = new BellHookDeployerV3(
            futureFactory, address(sessions), keccak256(type(BellHookV3).creationCode), oracle,
            evaluator, address(auctionRegistry), address(auctionModule)
        );
        d.hookDeployer = address(hookDeployer);
        PoolConfig memory profile = _profile(
            futureFactory,
            vm.parseJsonAddress(mainnetManifest, ".poolManager"),
            vm.parseJsonAddress(mainnetManifest, ".positionManager"),
            address(assets), address(calendar), d.safetyController
        );
        BellPoolFactoryV3 factory = new BellPoolFactoryV3(
            profile, IBellHookDeployer(address(hookDeployer)), feeToken, serviceRecipient
        );
        require(address(factory) == futureFactory, "factory nonce prediction mismatch");
        d.poolFactory = address(factory);
        d.profileHash = factory.profileHash();
        BellSwapLensRegistry lensRegistry = new BellSwapLensRegistry(address(factory));
        d.lensRegistry = address(lensRegistry);

        for (uint256 i; i < genesis.length; ++i) {
            d.assetIds[i] = assets.descriptorIdForToken(genesis[i].descriptor.token);
            d.assetTokens[i] = genesis[i].descriptor.token;
        }
        vm.stopBroadcast();
        _writeManifest(d, deployer, roles, delay, calendarLead, operationExpiry);
    }

    function _roles(string memory keys, address deployer) private pure returns (TestnetRoles memory roles) {
        roles.keeper = _role(keys, ".roles.KEEPER");
        roles.reporter = _role(keys, ".roles.REPORTER");
        roles.governance = _role(keys, ".roles.GOVERNANCE");
        roles.guardian = _role(keys, ".roles.GUARDIAN");
        require(roles.governance.signer == deployer, "governance signer mismatch");
    }

    function _role(string memory keys, string memory path) private pure returns (KeyRole memory role) {
        role.signer = vm.parseJsonAddress(keys, string.concat(path, ".ecdsaSigner"));
        role.commitment = vm.parseJsonBytes32(keys, string.concat(path, ".publicKeyCommitment"));
        require(role.signer != address(0) && role.commitment != bytes32(0), "invalid PQ role entry");
    }

    function _chainlinkStockGenesis(string memory evidence, uint256 index)
        private returns (StockGenesis memory genesis)
    {
        string memory assetPath = index == 0 ? ".assets.AAPL" : index == 1 ? ".assets.NVDA" : ".assets.TSLA";
        string memory symbol = vm.parseJsonString(evidence, string.concat(assetPath, ".symbol"));
        address token = vm.parseJsonAddress(evidence, string.concat(assetPath, ".stockToken"));
        uint8 capabilityMask = uint8(vm.parseJsonUint(evidence, string.concat(assetPath, ".capabilityMask")));
        bytes32 tokenCodeHash = vm.parseJsonBytes32(evidence, string.concat(assetPath, ".tokenCodeHash"));
        address[4] memory adapters = [
            vm.parseJsonAddress(evidence, string.concat(assetPath, ".directAdapter")),
            vm.parseJsonAddress(evidence, string.concat(assetPath, ".regularAdapter")),
            vm.parseJsonAddress(evidence, string.concat(assetPath, ".extendedAdapter")),
            vm.parseJsonAddress(evidence, string.concat(assetPath, ".overnightAdapter"))
        ];
        SourceWire[] memory wires = new SourceWire[](4);
        wires[0] = _sourceWire(evidence, string.concat(assetPath, ".directWire"));
        wires[1] = _sourceWire(evidence, string.concat(assetPath, ".regularWire"));
        wires[2] = _sourceWire(evidence, string.concat(assetPath, ".extendedWire"));
        wires[3] = _sourceWire(evidence, string.concat(assetPath, ".overnightWire"));
        for (uint256 i; i < wires.length; ++i) require(adapters[i].code.length != 0, "Chainlink adapter missing onchain");
        bytes32 sourceIdentity = keccak256(abi.encode(
            "BELL:CHAINLINK:ROBINHOOD:SESSION_GENESIS_V1", token, keccak256(abi.encode(wires))
        ));
        genesis.descriptor = AssetDescriptor({
            id: bytes32(0), token: token, isStock: true, decimals: 18, capabilityMask: capabilityMask,
            tokenPriceAdapter: adapters[0], regularAdapter: adapters[1], extendedAdapter: adapters[2],
            overnightAdapter: adapters[3], secondaryAdapter: address(0), expectedCodeHash: tokenCodeHash,
            implementationFingerprint: sourceIdentity,
            evidenceHash: keccak256(abi.encode("BELL:CHAINLINK:SOURCE_EVIDENCE_V1", sourceIdentity))
        });
        genesis.sourceConfig = abi.encode(wires);
        require(bytes(symbol).length != 0, "empty symbol");
    }

    function _sourceWire(string memory json, string memory path) private pure returns (SourceWire memory wire) {
        wire = SourceWire({
            kind: uint8(vm.parseJsonUint(json, string.concat(path, ".kind"))),
            phaseScope: uint8(vm.parseJsonUint(json, string.concat(path, ".phaseScope"))),
            endpoint: vm.parseJsonAddress(json, string.concat(path, ".endpoint")),
            feedId: vm.parseJsonBytes32(json, string.concat(path, ".feedId")),
            schema: uint16(vm.parseJsonUint(json, string.concat(path, ".schema"))),
            decimals: uint8(vm.parseJsonUint(json, string.concat(path, ".decimals"))),
            priceBasis: uint8(vm.parseJsonUint(json, string.concat(path, ".priceBasis"))),
            heartbeatSec: uint32(vm.parseJsonUint(json, string.concat(path, ".heartbeatSec"))),
            expectedCodeHash: vm.parseJsonBytes32(json, string.concat(path, ".expectedCodeHash")),
            expectedImplementation: vm.parseJsonAddress(json, string.concat(path, ".expectedImplementation")),
            canonicalTokenId: vm.parseJsonBytes32(json, string.concat(path, ".canonicalTokenId"))
        });
        require(wire.feedId != bytes32(0) || wire.kind == 1, "missing source feed id");
    }

    function _usdgGenesis(string memory manifest) private view returns (StockGenesis memory genesis) {
        address token = vm.parseJsonAddress(manifest, ".feeToken");
        uint8 decimals_ = IERC20DecimalsPQ(token).decimals();
        bytes32 tokenCodeHash = token.codehash;
        genesis.descriptor = AssetDescriptor({
            id: bytes32(0), token: token, isStock: false, decimals: decimals_, capabilityMask: 0,
            tokenPriceAdapter: address(0), regularAdapter: address(0), extendedAdapter: address(0),
            overnightAdapter: address(0), secondaryAdapter: address(0), expectedCodeHash: tokenCodeHash,
            implementationFingerprint: keccak256(abi.encode("BELL:USDG:46630", token, tokenCodeHash)),
            evidenceHash: keccak256(abi.encode("BELL:USDG:GENESIS:46630", token, tokenCodeHash))
        });
        genesis.sourceConfig = bytes("");
    }

    function _profile(
        address factory, address poolManager, address positionManager,
        address assets, address calendar, address safety
    ) private returns (PoolConfig memory) {
        return PoolConfig({
            token0: address(0), token1: address(0), asset0: bytes32(0), asset1: bytes32(0),
            poolManager: poolManager, positionManager: positionManager, factory: factory,
            assetRegistry: assets, calendarRegistry: calendar, safetyController: safety,
            treasuryAdapter: address(0), poolClass: 1, liquidityMode: 0, referenceMode: 0, tickSpacing: 60,
            tradeCap: [uint128(10), uint128(10)], windowCap: [uint128(100), uint128(100)],
            closureCap: [uint128(1), uint128(1)],
            policyId: keccak256(bytes(vm.envString("BELL_POLICY_ID"))),
            referenceAdapter0: address(0), referenceAdapter1: address(0)
        });
    }

    function _envUint32(string memory name, uint256 fallbackValue) private returns (uint32 value) {
        uint256 parsed = vm.envOr(name, fallbackValue);
        require(parsed <= type(uint32).max, "uint32 config overflow");
        value = uint32(parsed);
    }

    function _deployArtifact(string memory artifactPath, bytes memory constructorArgs)
        private returns (address deployed)
    {
        string memory artifact = vm.readFile(artifactPath);
        bytes memory creationCode = vm.parseJsonBytes(artifact, ".bytecode.object");
        require(creationCode.length != 0, "empty compiled artifact");
        bytes memory initCode = abi.encodePacked(creationCode, constructorArgs);
        assembly ("memory-safe") {
            deployed := create(0, add(initCode, 32), mload(initCode))
        }
        require(deployed != address(0) && deployed.code.length != 0, "artifact deployment failed");
    }

    function _writeManifest(
        Deployment memory d, address deployer, TestnetRoles memory roles,
        uint32 delay, uint32 calendarLead, uint32 operationExpiry
    ) private {
        string memory output = string.concat(
            '{"chainId":46630,"status":"SIMULATED_NOT_DEPLOYED","sourceMode":"testnet-fixture-feed","deployer":"', vm.toString(deployer),
            '","contracts":{"shrincsVerifier":"', vm.toString(d.shrincsVerifier),
            '","hashSigVerifier":"', vm.toString(d.hashSigVerifier),
            '","pqKeyRegistry":"', vm.toString(d.pqKeyRegistry),
            '","hybridAuth":"', vm.toString(d.hybridAuth),
            '","safetyController":"', vm.toString(d.safetyController),
            '","assetRegistry":"', vm.toString(d.assetRegistry),
            '","calendarRegistry":"', vm.toString(d.calendarRegistry),
            '","sessionRegistry":"', vm.toString(d.sessionRegistry),
            '","policyOracle":"', vm.toString(d.policyOracle),
            '","modeEvaluator":"', vm.toString(d.modeEvaluator),
            '","auctionRegistry":"', vm.toString(d.auctionRegistry),
            '","auctionFactoryModule":"', vm.toString(d.auctionFactoryModule),
            '","hookDeployer":"', vm.toString(d.hookDeployer),
            '","poolFactory":"', vm.toString(d.poolFactory),
            '","swapLensRegistry":"', vm.toString(d.lensRegistry), '"},',
            '"profileHash":"', vm.toString(d.profileHash), '","assetIds":["', vm.toString(d.assetIds[0]), '","', vm.toString(d.assetIds[1]), '"],',
            '"assetDescriptors":{"NVDA":{"descriptorId":"', vm.toString(d.assetIds[0]), '","token":"', vm.toString(d.assetTokens[0]),
            '"},"USDG":{"descriptorId":"', vm.toString(d.assetIds[1]), '","token":"', vm.toString(d.assetTokens[1]), '"}},',
            '"roles":{"KEEPER":"', vm.toString(roles.keeper.signer), '","REPORTER":"',
            vm.toString(roles.reporter.signer), '","GOVERNANCE":"', vm.toString(roles.governance.signer),
            '","GUARDIAN":"', vm.toString(roles.guardian.signer), '"},',
            '"timing":{"governanceDelaySeconds":', vm.toString(delay),
            ',"calendarPublicationLeadSeconds":', vm.toString(calendarLead),
            ',"operationExpirySeconds":', vm.toString(operationExpiry), '}}'
        );
        vm.writeFile("../evidence/deploy/pq-hooks-testnet-46630.json", output);
    }
}
