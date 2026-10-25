// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Buckets} from "../src/types/ProtocolTypes.sol";
import {FlowBudget} from "../src/libraries/FlowBudget.sol";

contract FlowBudgetHarness {
    function effectiveLimits(uint128[2] calldata tradeCaps, uint128[2] calldata windowCaps, uint8 phase, bool guarded)
        external pure returns (uint128[2] memory tradeLimits, uint128[2] memory windowLimits)
    {
        return FlowBudget.effectiveLimits(tradeCaps, windowCaps, phase, guarded);
    }

    function consume(Buckets calldata buckets, uint64 timestamp, int128 delta0, int128 delta1, uint8 phase, bool guarded, uint128[2] calldata tradeCaps, uint128[2] calldata windowCaps)
        external pure returns (Buckets memory next, uint128[2] memory gross)
    {
        return FlowBudget.consume(buckets, timestamp, delta0, delta1, phase, guarded, tradeCaps, windowCaps);
    }
}
