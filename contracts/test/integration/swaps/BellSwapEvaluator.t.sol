// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellModeEvaluator} from "../../../src/BellModeEvaluator.sol";
import {IBellSwapEvaluator} from "../../../src/types/SwapEvaluation.sol";
import {Buckets} from "../../../src/types/ProtocolTypes.sol";

/// @dev The transport is intentionally called through its proposed ABI in the first RED test:
/// an absent implementation must fail, not silently pass as a revert-only test.
contract BellSwapEvaluatorTest {
    function testActualExactInputDeltaIsAccepted() external {
        BellModeEvaluator evaluator = new BellModeEvaluator();
        (bool ok,) = address(evaluator).staticcall(
            abi.encodeWithSignature("validateActual(bool,int256,int128,int128)", true, int256(-100), int128(-100), int128(99))
        );
        require(ok, "missing actual-delta enforcement");
    }

    function testRegularPolicyAndActualBudgetCandidate() external {
        IBellSwapEvaluator evaluator = IBellSwapEvaluator(address(new BellModeEvaluator()));
        IBellSwapEvaluator.Context memory context;
        context.configHash = keccak256("config");
        context.stateHash = keccak256("state");
        context.poolClass = 1;
        context.mode = 1;
        context.phase = 2;
        context.timestamp = 10000;
        context.validUntil = 10100;
        context.bellStart = 9000;
        context.preSqrtPriceX96 = uint160(1 << 96);
        context.tradeCap = [uint128(1000), uint128(1000)];
        context.windowCap = [uint128(5000), uint128(5000)];
        context.closureCap = [uint128(1000), uint128(1000)];
        bytes32 binding = keccak256("callback");
        IBellSwapEvaluator.Snapshot memory snapshot = evaluator.prepare(context, binding, true, -100);
        require(snapshot.lpFeeUnits == 500 && snapshot.effectiveTradeCap[0] == 1000, "regular composition");
        Buckets memory empty;
        (Buckets memory next, uint128[2] memory episode, uint128[2] memory gross) =
            evaluator.settle(snapshot, binding, 10000, context.preSqrtPriceX96, -100, 99, empty, [uint128(0),uint128(0)]);
        require(next.currentGross[0] == 100 && next.currentGross[1] == 99 && gross[1] == 99, "actual budget");
        require(episode[0] == 0 && episode[1] == 0, "open episode unchanged");
    }

    function testFeeMaximumAndGuardMinimumAtTimerBoundaries() external {
        IBellSwapEvaluator evaluator = IBellSwapEvaluator(address(new BellModeEvaluator()));
        IBellSwapEvaluator.Context memory c = _context();
        c.bellStart = c.timestamp;
        IBellSwapEvaluator.Snapshot memory s = evaluator.prepare(c, keccak256("binding"), true, -100);
        require(s.lpFeeUnits == 10000 && s.guarded && s.effectiveTradeCap[0] == 200
            && s.effectiveWindowCap[0] == 1250, "bell floor/max");
        c.bellStart = c.timestamp - 299;
        s = evaluator.prepare(c, keccak256("binding"), true, -100);
        require(s.lpFeeUnits == 532 && s.guarded, "bell ceil last second");
        c.bellStart = c.timestamp - 300;
        s = evaluator.prepare(c, keccak256("binding"), true, -100);
        require(s.lpFeeUnits == 500 && !s.guarded && s.effectiveTradeCap[0] == 1000, "bell exclusive end");
        c.corporateUntil = c.timestamp + 1;
        s = evaluator.prepare(c, keccak256("binding"), true, -100);
        require(s.lpFeeUnits == 10000 && s.guarded && s.effectiveTradeCap[0] == 200, "corporate max/min");
        c.corporateUntil = c.timestamp;
        s = evaluator.prepare(c, keccak256("binding"), true, -100);
        require(s.lpFeeUnits == 500 && !s.guarded, "corporate exclusive end");
    }

    function testEverySessionCompositionAndFrozenBand() external {
        IBellSwapEvaluator evaluator = IBellSwapEvaluator(address(new BellModeEvaluator()));
        IBellSwapEvaluator.Context memory c = _context();
        uint24[5] memory fees = [uint24(3000),500,3000,5000,10000];
        uint128[5] memory trade = [uint128(500),1000,500,250,200];
        uint128[5] memory window = [uint128(2500),5000,2500,1250,1250];
        for (uint8 phase = 1; phase <= 5; ++phase) {
            c.phase = phase;
            if (phase == 5) {
                c.mode = 2; c.closedLatched = true; c.closureNonce = 1; c.frozenStock = true;
            }
            IBellSwapEvaluator.Snapshot memory s = evaluator.prepare(c, keccak256("binding"), true, -100);
            require(s.lpFeeUnits == fees[phase-1] && s.effectiveTradeCap[0] == trade[phase-1]
                && s.effectiveWindowCap[0] == window[phase-1], "session composition");
        }
        c.poolClass = 0; c.referencePrice18 = [uint128(1e18),uint128(1e18)];
        require(evaluator.prepare(c, keccak256("binding"), true, -100).bandBps == 500, "frozen band");
    }

    function testInclusiveExactBandBoundariesAndOneSqrtUnitOutside() external {
        IBellSwapEvaluator evaluator = IBellSwapEvaluator(address(new BellModeEvaluator()));
        IBellSwapEvaluator.Context memory c = _context();
        c.poolClass = 0;
        c.referencePrice18 = [uint128(10000), uint128(9800)]; // raw price=1 is exactly the lower bound
        IBellSwapEvaluator.Snapshot memory s = evaluator.prepare(c, keccak256("binding"), false, -100);
        require(!s.guarded && s.bandBps == 200, "inclusive lower");
        _settle(evaluator, s, c.preSqrtPriceX96, false);
        _settle(evaluator, s, c.preSqrtPriceX96 - 1, true);
        c.preSqrtPriceX96--;
        s = evaluator.prepare(c, keccak256("binding"), false, -100);
        require(s.guarded && s.lpFeeUnits == 10000 && s.effectiveTradeCap[0] == 200, "repricing below");
        _settle(evaluator, s, c.preSqrtPriceX96 + 1, false);
        _settle(evaluator, s, c.preSqrtPriceX96, true);
        c = _context(); c.poolClass = 0;
        c.referencePrice18 = [uint128(10000), uint128(10200)]; // raw price=1 is exactly the upper bound
        s = evaluator.prepare(c, keccak256("binding"), true, -100);
        require(!s.guarded, "inclusive upper");
        _settle(evaluator, s, c.preSqrtPriceX96, false);
        _settle(evaluator, s, c.preSqrtPriceX96 + 1, true);
        c.preSqrtPriceX96++;
        s = evaluator.prepare(c, keccak256("binding"), true, -100);
        require(s.guarded, "repricing above");
        _settle(evaluator, s, c.preSqrtPriceX96 - 1, false);
        _settle(evaluator, s, c.preSqrtPriceX96, true);
        _settle(evaluator, s, uint160(1 << 95), true); // cannot overshoot the opposite band
    }

    function testDecimalCurrencyOrderAndNoSyntheticSessionOnlyReference() external {
        IBellSwapEvaluator evaluator = IBellSwapEvaluator(address(new BellModeEvaluator()));
        IBellSwapEvaluator.Context memory c = _context();
        c.poolClass = 0; c.decimals = [uint8(6),uint8(18)];
        c.referencePrice18 = [uint128(1e6),uint128(1e18)];
        require(!evaluator.prepare(c, keccak256("binding"), true, -100).guarded, "decimal order");
        c.decimals = [uint8(18),uint8(6)];
        c.referencePrice18 = [uint128(1e18),uint128(1e6)];
        require(!evaluator.prepare(c, keccak256("binding"), false, -100).guarded, "reverse decimal order");
        c.poolClass = 1;
        _rejectPrepare(evaluator, c);
    }

    function testUnknownModeClassPhaseReferenceAndExpiredContextFailClosed() external {
        IBellSwapEvaluator evaluator = IBellSwapEvaluator(address(new BellModeEvaluator()));
        IBellSwapEvaluator.Context memory c = _context();
        c.mode = 255; _rejectPrepare(evaluator,c);
        c = _context(); c.poolClass = 255; _rejectPrepare(evaluator,c);
        c = _context(); c.phase = 0; _rejectPrepare(evaluator,c);
        c = _context(); c.validUntil = c.timestamp; _rejectPrepare(evaluator,c);
        c = _context(); c.bellStart = c.timestamp+1; _rejectPrepare(evaluator,c);
        c = _context(); c.closedLatched = true; _rejectPrepare(evaluator,c);
        c = _context(); c.poolClass = 0;
        IBellSwapEvaluator.Snapshot memory fallbackSnapshot = evaluator.prepare(c, keccak256("binding"), true, -100);
        require(fallbackSnapshot.guarded && fallbackSnapshot.lpFeeUnits == 10000
            && fallbackSnapshot.effectiveTradeCap[0] == 200 && fallbackSnapshot.effectiveWindowCap[0] == 1250,
            "empty reference context did not calculate bounded AMM fallback");
        c = _context(); c.decimals[1] = 19; _rejectPrepare(evaluator,c);
    }

    function testCallbackSubstitutionTimestampAndLimitTamperingRejected() external {
        IBellSwapEvaluator evaluator = IBellSwapEvaluator(address(new BellModeEvaluator()));
        IBellSwapEvaluator.Context memory c = _context();
        IBellSwapEvaluator.Snapshot memory s = evaluator.prepare(c, keccak256("binding"), true, -100);
        Buckets memory empty;
        (bool ok,) = address(evaluator).staticcall(abi.encodeCall(evaluator.settle,
            (s, keccak256("substituted sender/key/params"), c.timestamp, c.preSqrtPriceX96, int128(-100), int128(99), empty, [uint128(0),uint128(0)])));
        require(!ok, "callback substituted");
        (ok,) = address(evaluator).staticcall(abi.encodeCall(evaluator.settle,
            (s, s.callbackHash, c.timestamp+1, c.preSqrtPriceX96, int128(-100), int128(99), empty, [uint128(0),uint128(0)])));
        require(!ok, "timestamp substituted");
        s.effectiveTradeCap[0]++;
        _settle(evaluator,s,c.preSqrtPriceX96,true);
    }

    function testSignedMinimumActualFillAndInvalidPatterns() external {
        BellModeEvaluator evaluator = new BellModeEvaluator();
        evaluator.validateActual(true, -int256(uint256(1) << 127), type(int128).min, 1);
        evaluator.validateActual(false, 1, 1, type(int128).min);
        _rejectActual(evaluator,true,-100,100,-99);
        _rejectActual(evaluator,true,-100,-101,99);
        _rejectActual(evaluator,true,100,-101,101);
        _rejectActual(evaluator,true,-100,-100,0);
        _rejectActual(evaluator,false,-100,0,-100);
        _rejectActual(evaluator,true,0,-100,99);
        _rejectActual(evaluator,true,type(int256).min,-100,99);
    }

    function _context() private pure returns (IBellSwapEvaluator.Context memory c) {
        c.configHash = keccak256("config"); c.stateHash = keccak256("state");
        c.poolClass = 1; c.mode = 1; c.phase = 2;
        c.timestamp = 10000; c.validUntil = 10100; c.bellStart = 9000;
        c.preSqrtPriceX96 = uint160(1 << 96);
        c.tradeCap = [uint128(1000),uint128(1000)];
        c.windowCap = [uint128(5000),uint128(5000)];
        c.closureCap = [uint128(1000),uint128(1000)];
    }
    function _rejectPrepare(IBellSwapEvaluator e, IBellSwapEvaluator.Context memory c) private view {
        (bool ok,) = address(e).staticcall(abi.encodeCall(e.prepare,(c,keccak256("binding"),true,int256(-100))));
        require(!ok, "invalid context accepted");
    }
    function _rejectActual(BellModeEvaluator e, bool z, int256 a, int128 d0, int128 d1) private view {
        (bool ok,) = address(e).staticcall(abi.encodeCall(e.validateActual,(z,a,d0,d1)));
        require(!ok, "invalid delta accepted");
    }
    function _settle(IBellSwapEvaluator e, IBellSwapEvaluator.Snapshot memory s, uint160 post, bool reject) private view {
        Buckets memory empty;
        (int128 d0,int128 d1) = s.zeroForOne ? (int128(-100),int128(99)) : (int128(99),int128(-100));
        (bool ok,) = address(e).staticcall(abi.encodeCall(e.settle,
            (s,s.callbackHash,s.context.timestamp,post,d0,d1,empty,[uint128(0),uint128(0)])));
        require(ok != reject, "unexpected settlement result");
    }
}
