// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafetyController} from "../../../src/SafetyController.sol";
import {AssetRegistry} from "../../../src/registries/AssetRegistry.sol";
import {CalendarRegistry} from "../../../src/registries/CalendarRegistry.sol";
import {CalendarLeaf, CalendarRoot, AssetDescriptor} from "../../../src/types/ProtocolTypes.sol";
import {PolicyConstants} from "../../../src/libraries/PolicyConstants.sol";

interface VmInstant {
    function warp(uint256 timestamp) external;
    function chainId(uint256 newChainId) external;
}

contract InstantMockSafety {
    address public governance;
    address public guardian;
    uint32 public governanceDelaySeconds;
    uint32 public calendarPublicationLeadSeconds;
    uint32 public operationExpirySeconds;

    constructor(uint32 delay_, uint32 lead_, uint32 expiry_) {
        governance = msg.sender;
        guardian = address(0xBEEF);
        governanceDelaySeconds = delay_;
        calendarPublicationLeadSeconds = lead_;
        operationExpirySeconds = expiry_;
    }
}

contract InstantMockToken {
    string public symbol = "TEST";
    uint8 public decimals = 18;
}

/// @notice Governance latency must be a deployment choice, not a per-chain constant.
///
/// These tests exist because the previous design hardcoded "zero delay on testnet, 2 days + 7 days
/// notice on mainnet" into the contracts. That made a mainnet launch take a week for no reason the
/// protocol could justify: the delay was our own policy, not a property of Robinhood Chain.
contract GovernanceLatencyTest {
    VmInstant private constant vm = VmInstant(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint64 private constant T0 = 1_800_000_000;

    function _controller(uint32 delay, uint32 lead, uint32 expiry)
        internal
        returns (SafetyController controller)
    {
        controller = new SafetyController(address(this), address(0xBEEF), address(0xCAFE), delay, lead, expiry);
    }

    function _descriptor(address token) internal view returns (AssetDescriptor memory d) {
        d.token = token;
        d.isStock = false;
        d.decimals = 18;
        d.expectedCodeHash = token.codehash;
        d.implementationFingerprint = keccak256("impl");
        d.evidenceHash = keccak256("evidence");
    }

    function testZeroDelayMakesAssetAdmissionInstant() external {
        vm.warp(T0);
        InstantMockSafety safety = new InstantMockSafety(0, 0, 604800);
        AssetRegistry registry = new AssetRegistry(address(safety));

        bytes32 operationId = registry.queueAsset(_descriptor(address(new InstantMockToken())), bytes(""));
        (,, uint64 eta,, uint8 status) = registry.operation(operationId);
        require(eta == T0, "eta must be now when the delay is zero");
        require(status == 1, "operation must be queued");

        // Same block: no warp at all.
        bytes32 descriptorId = registry.activateAsset(operationId);
        require(descriptorId != bytes32(0), "activation must succeed in the same block");
    }

    function testZeroNoticeAndDelayMakesCalendarActivationInstant() external {
        vm.warp(T0);
        InstantMockSafety safety = new InstantMockSafety(0, 0, 604800);
        CalendarRegistry registry = new CalendarRegistry(address(safety));

        bytes32 assetId = keccak256("asset");
        uint64 start = uint64(T0 + 60);
        uint64 end = uint64(T0 + 3600);

        bytes32 operationId = registry.queueRoot(assetId, CalendarRoot({
            root: keccak256("root"),
            leafCount: 1,
            coverageStart: start,
            coverageEnd: end,
            queuedAt: 0,
            executableAt: 0,
            datasetHash: keccak256("dataset")
        }));
        (,, uint64 eta,,) = registry.operation(operationId);
        require(eta == T0, "root eta must be now when the delay is zero");

        // activateRoot requires block.timestamp < coverageStart, which start = T0 + 60 satisfies.
        registry.activateRoot(operationId);
    }

    function testTheDelayIsWhateverTheDeploymentChose() external {
        vm.warp(T0);
        // A deliberately non-zero configuration still works: the point is that it is a parameter.
        InstantMockSafety safety = new InstantMockSafety(3600, 7200, 604800);
        AssetRegistry registry = new AssetRegistry(address(safety));

        bytes32 operationId = registry.queueAsset(_descriptor(address(new InstantMockToken())), bytes(""));
        (,, uint64 eta,,) = registry.operation(operationId);
        require(eta == T0 + 3600, "eta must honour the configured delay");

        vm.warp(eta - 1);
        (bool early,) = address(registry).call(abi.encodeCall(registry.activateAsset, (operationId)));
        require(!early, "activation before eta must still fail");

        vm.warp(eta);
        registry.activateAsset(operationId);
    }

    function testChainIdNoLongerChangesTheDelay() external {
        // The old contracts branched on block.chainid == 46630. Prove the branch is gone: the same
        // configuration behaves identically on mainnet's chain id.
        vm.warp(T0);
        vm.chainId(4663);
        InstantMockSafety safety = new InstantMockSafety(0, 0, 604800);
        AssetRegistry registry = new AssetRegistry(address(safety));

        bytes32 operationId = registry.queueAsset(_descriptor(address(new InstantMockToken())), bytes(""));
        (,, uint64 eta,,) = registry.operation(operationId);
        require(eta == T0, "chain 4663 must honour a zero delay too");

        bytes32 descriptorId = registry.activateAsset(operationId);
        require(descriptorId != bytes32(0), "mainnet instant activation must succeed");
    }

    function testAnExpiryOfZeroIsRejected() external {
        (bool ok,) = address(this).call(abi.encodeWithSignature("_deployWithExpiry(uint32)", uint32(0)));
        require(!ok, "a zero operation expiry must be rejected");
    }

    function _deployWithExpiry(uint32 expiry) external {
        _controller(0, 0, expiry);
    }
}
