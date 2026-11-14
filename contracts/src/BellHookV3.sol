// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHookV2} from "./BellHookV2.sol";
import {BellPolicyOracle} from "./BellPolicyOracle.sol";
import {BellPolicyOracleV2} from "./BellPolicyOracleV2.sol";
import {PoolConfig} from "./types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BellModeEvaluator} from "./BellModeEvaluator.sol";

/// @title BellHookV3
/// @notice PQ Hooks v2 pool template with the exact BellHookV2 market and auction policy.
/// @dev Trust inputs are supplied by the hybrid adapter addresses bound into the new deployment.
///      It inherits the V2 permission mask (before initialize/add/swap only), so no remove-liquidity
///      permission or exit callback exists in this template.
contract BellHookV3 is BellHookV2 {
    constructor(
        PoolConfig memory config_,
        PoolKey memory key_,
        bytes32 templateCodeHash_,
        address sessionRegistry_,
        BellPolicyOracleV2 policyOracle_,
        BellModeEvaluator modeEvaluator_,
        address auctionRegistry_
    )
        BellHookV2(
            config_,
            key_,
            templateCodeHash_,
            sessionRegistry_,
            BellPolicyOracle(address(policyOracle_)),
            modeEvaluator_,
            auctionRegistry_
        )
    {}
}
