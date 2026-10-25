// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ClosureBudget} from "../src/libraries/ClosureBudget.sol";

contract ClosureBudgetHarness {
    function maximumClosureCap(uint128[2] calldata tradeCap, uint128[2] calldata windowCap, uint128[2] calldata seedPrincipal)
        external pure returns (uint128[2] memory)
    {
        return ClosureBudget.maximumClosureCap(tradeCap, windowCap, seedPrincipal);
    }

    function consumeEpisode(uint128[2] calldata used, uint128[2] calldata caps, int128 delta0, int128 delta1)
        external pure returns (uint128[2] memory)
    {
        return ClosureBudget.consumeEpisode(used, caps, delta0, delta1);
    }
}
