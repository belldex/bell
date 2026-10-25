// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SeedAccounting} from "../../../src/libraries/SeedAccounting.sol";
import {BalanceDelta, BalanceDeltaLibrary, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

contract SeedAccountingHarness {
    function principal(BalanceDelta delta, BalanceDelta feesAccrued) external pure returns (uint128[2] memory) {
        return SeedAccounting.seedPrincipal(delta, feesAccrued);
    }
}

contract SeedAccountingTest {
    function testCapturesPrincipalExcludingAccruedFees() external {
        SeedAccountingHarness harness = new SeedAccountingHarness();
        BalanceDelta delta = toBalanceDelta(-101, -204);
        BalanceDelta accrued = toBalanceDelta(1, 4);
        uint128[2] memory seed = harness.principal(delta, accrued);
        require(seed[0] == 102 && seed[1] == 208, "fees leaked into seed principal");
    }

    function testWidenedMinimumInt128PrincipalFitsUint128Exactly() external {
        SeedAccountingHarness harness = new SeedAccountingHarness();
        BalanceDelta delta = toBalanceDelta(type(int128).min, type(int128).min);
        uint128[2] memory seed = harness.principal(delta, BalanceDeltaLibrary.ZERO_DELTA);
        require(seed[0] == uint128(1) << 127 && seed[1] == uint128(1) << 127, "minimum signed delta truncated");
    }

    function testRejectsZeroOrNonNegativePrincipalInEitherCurrency() external {
        SeedAccountingHarness harness = new SeedAccountingHarness();
        (bool ok,) = address(harness).call(abi.encodeCall(
            harness.principal, (toBalanceDelta(0, -1), BalanceDeltaLibrary.ZERO_DELTA)
        ));
        require(!ok, "zero principal accepted");
        (ok,) = address(harness).call(abi.encodeCall(
            harness.principal, (toBalanceDelta(-1, 0), BalanceDeltaLibrary.ZERO_DELTA)
        ));
        require(!ok, "one zero currency accepted");
        (ok,) = address(harness).call(abi.encodeCall(
            harness.principal, (toBalanceDelta(1, -1), BalanceDeltaLibrary.ZERO_DELTA)
        ));
        require(!ok, "non-negative principal accepted");
    }
}
