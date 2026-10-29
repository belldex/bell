// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolConfig} from "../../src/types/ProtocolTypes.sol";

/// @dev Temporary cross-check harness: prints keccak256(abi.encode(PoolConfig)) for fixed values.
contract ProfileHashHarness {
    function hash() external pure returns (bytes32) {
        PoolConfig memory c = PoolConfig({
            token0: address(0), token1: address(0), asset0: bytes32(0), asset1: bytes32(0),
            poolManager: 0x00000000000000000000000000000000000000C1,
            positionManager: 0x00000000000000000000000000000000000000c2,
            factory: 0x00000000000000000000000000000000000000C3,
            assetRegistry: 0x00000000000000000000000000000000000000C4,
            calendarRegistry: 0x00000000000000000000000000000000000000c5,
            safetyController: 0x00000000000000000000000000000000000000c6,
            treasuryAdapter: address(0), poolClass: 1, liquidityMode: 0, referenceMode: 0,
            tickSpacing: 60, tradeCap: [uint128(10), uint128(10)], windowCap: [uint128(100), uint128(100)],
            closureCap: [uint128(1), uint128(1)], policyId: 0xabababababababababababababababababababababababababababababababab,
            referenceAdapter0: 0x00000000000000000000000000000000000000e1,
            referenceAdapter1: 0x00000000000000000000000000000000000000E2
        });
        return keccak256(abi.encode(c));
    }
}
