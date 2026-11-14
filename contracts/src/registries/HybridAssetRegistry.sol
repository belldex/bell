// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetRegistry} from "./AssetRegistry.sol";
import {AssetDescriptor} from "../types/ProtocolTypes.sol";

/// @title HybridAssetRegistry
/// @notice AssetRegistry whose genesis stock descriptors are pinned to HybridAuth adapters.
/// @dev The initial descriptor set is installed atomically in the constructor. Every later
///      addition still uses AssetRegistry.queueAsset and its SafetyController timelock. There is
///      no external bootstrap selector and the initial token set cannot be replaced.
contract HybridAssetRegistry is AssetRegistry {
    error EmptyGenesisSet();
    error GenesisArrayLengthMismatch();

    constructor(
        address safetyController_,
        AssetDescriptor[] memory initialDescriptors,
        bytes[] memory initialSourceConfigs
    ) AssetRegistry(safetyController_) {
        if (initialDescriptors.length == 0) revert EmptyGenesisSet();
        if (initialDescriptors.length != initialSourceConfigs.length) revert GenesisArrayLengthMismatch();
        for (uint256 i; i < initialDescriptors.length; ++i) {
            _bootstrapAsset(initialDescriptors[i], initialSourceConfigs[i]);
        }
    }
}
