// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHook} from "../lib/openzeppelin-uniswap-hooks/src/base/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

// Compile-only M00-02 spike against the selected v4-core candidate.
contract BaseHookCompatibilityHarness is BaseHook {
    constructor(IPoolManager poolManager_) BaseHook(poolManager_) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.beforeAddLiquidity = true;
        permissions.afterAddLiquidity = true;
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
    }
}
