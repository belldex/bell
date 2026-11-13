// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BellSHRINCSStatefulVerifier} from "../src/BellSHRINCSStatefulVerifier.sol";
import {HashSigVerifier} from "../src/HashSigVerifier.sol";
import {PQKeyRegistry} from "../src/PQKeyRegistry.sol";
import {HybridAuth, IHashSigVerifier} from "../src/HybridAuth.sol";
import {CalendarRegistryV2} from "../src/CalendarRegistryV2.sol";
import {SessionRegistryV2} from "../src/SessionRegistryV2.sol";
import {PriceAttestationAdapter} from "../src/PriceAttestationAdapter.sol";

interface VmDeployPQ {
    function envUint(string calldata name) external returns (uint256);
    function envBytes32(string calldata name) external returns (bytes32);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function writeFile(string calldata path, string calldata data) external;
}

contract DeployPQTestnet {
    VmDeployPQ private constant vm =
        VmDeployPQ(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant EXPECTED_CHAIN_ID = 99801;
    uint32 private constant STATEFUL_BUDGET = 64;
    bytes32 private constant KEEPER_ROLE = keccak256("KEEPER");
    bytes32 private constant REPORTER_ROLE = keccak256("REPORTER");
    bytes32 private constant GOVERNANCE_ROLE = keccak256("GOVERNANCE");
    bytes32 private constant GUARDIAN_ROLE = keccak256("GUARDIAN");

    function run() external {
        require(block.chainid == EXPECTED_CHAIN_ID, "Elysium testnet only");
        uint256 deployerKey = vm.envUint("ELYSIUM_DEPLOYER_PRIVATE_KEY");
        uint256 keeperKey = vm.envUint("KEEPER_A_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address keeper = vm.addr(keeperKey);
        address reporter = vm.addr(vm.envUint("ELYSIUM_REPORTER_PRIVATE_KEY"));
        address guardian = vm.addr(vm.envUint("ELYSIUM_GUARDIAN_PRIVATE_KEY"));
        bytes32 keeperCommitment = vm.envBytes32("PQ_KEEPER_COMMITMENT");
        bytes32 reporterCommitment = vm.envBytes32("PQ_REPORTER_COMMITMENT");
        bytes32 governanceCommitment = vm.envBytes32("PQ_GOVERNANCE_COMMITMENT");
        bytes32 guardianCommitment = vm.envBytes32("PQ_GUARDIAN_COMMITMENT");

        vm.startBroadcast(deployerKey);
        BellSHRINCSStatefulVerifier shrincs = new BellSHRINCSStatefulVerifier();
        HashSigVerifier verifier = new HashSigVerifier(address(shrincs));
        PQKeyRegistry registry = new PQKeyRegistry(deployer);
        HybridAuth auth = new HybridAuth(registry, IHashSigVerifier(address(verifier)));
        CalendarRegistryV2 calendar = new CalendarRegistryV2(auth, GOVERNANCE_ROLE);
        SessionRegistryV2 sessions = new SessionRegistryV2(auth, KEEPER_ROLE);
        PriceAttestationAdapter prices = new PriceAttestationAdapter(auth, REPORTER_ROLE);

        registry.bootstrapRole(KEEPER_ROLE, keeper, keeperCommitment, STATEFUL_BUDGET);
        registry.bootstrapRole(REPORTER_ROLE, reporter, reporterCommitment, STATEFUL_BUDGET);
        registry.bootstrapRole(GOVERNANCE_ROLE, deployer, governanceCommitment, STATEFUL_BUDGET);
        registry.bootstrapRole(GUARDIAN_ROLE, guardian, guardianCommitment, STATEFUL_BUDGET);
        registry.setHybridAuth(address(auth));
        registry.finalizeBootstrap();
        vm.stopBroadcast();

        string memory manifest = string.concat(
            '{"chainId":99801,"profile":"shrincs-256s-keccak-stateful","leafBudget":64,',
            '"contracts":{"shrincs":"', _hex(address(shrincs)),
            '","hashSigVerifier":"', _hex(address(verifier)),
            '","pqKeyRegistry":"', _hex(address(registry)),
            '","hybridAuth":"', _hex(address(auth)),
            '","calendarRegistryV2":"', _hex(address(calendar)),
            '","sessionRegistryV2":"', _hex(address(sessions)),
            '","priceAttestationAdapter":"', _hex(address(prices)), '"},',
            '"roles":{"KEEPER":"', _hex(KEEPER_ROLE),
            '","REPORTER":"', _hex(REPORTER_ROLE),
            '","GOVERNANCE":"', _hex(GOVERNANCE_ROLE),
            '","GUARDIAN":"', _hex(GUARDIAN_ROLE), '"}}'
        );
        vm.writeFile("pq/deployments/elysium-99801.json", manifest);
    }

    function _hex(address value) private pure returns (string memory) {
        return _hexBytes(abi.encodePacked(value));
    }

    function _hex(bytes32 value) private pure returns (string memory) {
        return _hexBytes(abi.encodePacked(value));
    }

    function _hexBytes(bytes memory value) private pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes memory out = new bytes(2 + value.length * 2);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i; i < value.length; ++i) {
            out[2 + 2 * i] = alphabet[uint8(value[i] >> 4)];
            out[3 + 2 * i] = alphabet[uint8(value[i] & 0x0f)];
        }
        return string(out);
    }
}
