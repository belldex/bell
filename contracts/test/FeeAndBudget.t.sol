// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FeePolicy} from "../src/libraries/FeePolicy.sol";
import {FlowBudget} from "../src/libraries/FlowBudget.sol";
import {ClosureBudget} from "../src/libraries/ClosureBudget.sol";
import {Buckets} from "../src/types/ProtocolTypes.sol";

contract FeeAndBudgetTest {
    function testBellFeeAndMaximumComposition() external pure {
        require(FeePolicy.bellFee(500, 0) == 10000, "bell open");
        require(FeePolicy.bellFee(500, 150) == 5250, "bell midpoint");
        require(FeePolicy.bellFee(500, 300) == 500, "bell closed");
        require(FeePolicy.bellFee(5000, 150) == 7500, "overnight bell");
        require(FeePolicy.effectiveLpFee(500, 300, true, false) == 10000, "corporate max");
        require(FeePolicy.effectiveLpFee(500, 300, false, true) == 10000, "repricing max");
    }

    function testRollingBudgetUsesBothCurrenciesAndGrossDirection() external pure {
        Buckets memory buckets;
        uint128[2] memory tradeCaps = [uint128(1000), uint128(1000)];
        uint128[2] memory windowCaps = [uint128(2000), uint128(2000)];
        uint128[2] memory gross;
        (buckets, gross) = FlowBudget.consume(buckets, 1, -1000, 1000, 2, false, tradeCaps, windowCaps);
        (buckets, gross) = FlowBudget.consume(buckets, 2, 1000, -1000, 2, false, tradeCaps, windowCaps);
        require(buckets.currentGross[0] == 2000 && buckets.currentGross[1] == 2000, "gross direction");
    }

    function testRollingWindowKeepsPreviousBucketAtBoundary() external pure {
        Buckets memory buckets;
        uint128[2] memory tradeCaps = [uint128(1000), uint128(1000)];
        uint128[2] memory windowCaps = [uint128(3000), uint128(3000)];
        uint128[2] memory gross;
        (buckets, gross) = FlowBudget.consume(buckets, 299, -1000, 1000, 2, false, tradeCaps, windowCaps);
        (buckets, gross) = FlowBudget.consume(buckets, 300, -1000, 1000, 2, false, tradeCaps, windowCaps);
        require(buckets.epoch == 1, "epoch shift");
        require(buckets.previousGross[0] == 1000, "previous gross");
        require(buckets.currentGross[0] == 1000, "current gross");
    }

    function testSignedMinimumDeltaIsWidenedBeforeAbsoluteValue() external pure {
        Buckets memory buckets;
        uint128 maxDelta = uint128(1) << 127;
        uint128[2] memory tradeCaps = [maxDelta, uint128(10)];
        uint128[2] memory windowCaps = [maxDelta, uint128(10)];
        uint128[2] memory gross;
        (buckets, gross) = FlowBudget.consume(buckets, 1, type(int128).min, 1, 2, false, tradeCaps, windowCaps);
        require(buckets.currentGross[0] == maxDelta, "int128 minimum magnitude");
    }

    function testEpisodeCapUsesTheMinimumAndRoundsSeedFractionDown() external pure {
        uint128[2] memory tradeCaps = [uint128(100), uint128(900)];
        uint128[2] memory windowCaps = [uint128(500), uint128(1000)];
        uint128[2] memory seeds = [uint128(999), uint128(2000)];
        uint128[2] memory cap = ClosureBudget.maximumClosureCap(tradeCaps, windowCaps, seeds);
        require(cap[0] == 99 && cap[1] == 200, "closure cap");
    }

    function testClosureBudgetIsGrossAndNonRefilling() external pure {
        uint128[2] memory used = [uint128(0), uint128(0)];
        uint128[2] memory caps = [uint128(500), uint128(500)];
        used = ClosureBudget.consumeEpisode(used, caps, -250, 250);
        used = ClosureBudget.consumeEpisode(used, caps, 250, -250);
        require(used[0] == 500 && used[1] == 500, "episode gross");
    }
}
