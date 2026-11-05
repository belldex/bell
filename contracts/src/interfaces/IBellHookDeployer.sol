// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolConfig} from "../types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @title IBellHookDeployer
/// @notice The calls `BellPoolFactory` needs from its CREATE2 hook deployer.
/// @dev Both the v1 `BellHookDeployer` and the v2 template deployer implement this, so the factory is
///      written once. The v2 deployer additionally exposes `auctionRegistry()` and `router()`; the
///      factory probes for those with a staticcall and treats a missing getter as "no auction wiring",
///      which keeps the v1 path byte-for-byte unchanged.
interface IBellHookDeployer {
    function factory() external view returns (address);
    function sessionRegistry() external view returns (address);
    function templateCodeHash() external view returns (bytes32);
    function initCodeHash(PoolConfig memory config, PoolKey memory key) external view returns (bytes32);
    function predict(PoolConfig memory config, PoolKey memory key, bytes32 salt) external view returns (address);
    function deploy(PoolConfig memory config, PoolKey memory key, bytes32 salt) external returns (address);
}
