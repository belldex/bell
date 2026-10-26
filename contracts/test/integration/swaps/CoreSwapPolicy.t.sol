// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellModeEvaluator} from "../../../src/BellModeEvaluator.sol";
import {IBellSwapEvaluator} from "../../../src/types/SwapEvaluation.sol";
import {Buckets} from "../../../src/types/ProtocolTypes.sol";
import {ClosureBudget} from "../../../src/libraries/ClosureBudget.sol";
import {FlowBudget} from "../../../src/libraries/FlowBudget.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface VmSwap {
    function warp(uint256) external;
    function etch(address, bytes calldata) external;
}

contract SwapToken is ERC20 {
    constructor() ERC20("Synthetic swap fixture", "SYNTH") {}
    function mint(address who, uint256 amount) external { _mint(who, amount); }
}

/// @dev TEST ONLY. Authenticated production source/corporate/profile collection is NOT implemented here.
/// This fixture proves pure evaluator + actual pinned core integration, NOT BellHook execution readiness.
contract SnapshotFixtureHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;
    IPoolManager public immutable manager;
    IBellSwapEvaluator public immutable evaluator;
    IBellSwapEvaluator.Context private context;
    IBellSwapEvaluator.Snapshot private pending;
    Buckets private rolling;
    uint128[2] private episode;
    bool private pendingSwap;
    bytes32 public lastSnapshotHash;

    constructor(IPoolManager m, IBellSwapEvaluator e) { manager = m; evaluator = e; }
    function configure(IBellSwapEvaluator.Context calldata c) external { context = c; }
    function counters() external view returns (Buckets memory, uint128[2] memory) { return (rolling, episode); }
    function checkpointHash() external view returns (bytes32) {
        return keccak256(abi.encode(context, rolling, episode, pending, pendingSwap, lastSnapshotHash));
    }
    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata data)
        external returns (bytes4, BeforeSwapDelta, uint24)
    {
        require(msg.sender == address(manager) && !pendingSwap && data.length == 0, "callback context");
        IBellSwapEvaluator.Context memory c = context;
        (c.preSqrtPriceX96,,,) = manager.getSlot0(key.toId());
        c.timestamp = uint64(block.timestamp);
        c.stateHash = keccak256(abi.encode(context, rolling, episode));
        pending = evaluator.prepare(c, keccak256(abi.encode(sender, key, params)), params.zeroForOne, params.amountSpecified);
        pendingSwap = true;
        lastSnapshotHash = keccak256(abi.encode(pending));
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, pending.lpFeeUnits | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }
    function afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata data)
        external returns (bytes4, int128)
    {
        require(msg.sender == address(manager) && pendingSwap && data.length == 0, "callback context");
        (uint160 postPrice,,,) = manager.getSlot0(key.toId());
        (Buckets memory next, uint128[2] memory nextEpisode,) = evaluator.settle(pending,
            keccak256(abi.encode(sender, key, params)), uint64(block.timestamp), postPrice,
            delta.amount0(), delta.amount1(), rolling, episode);
        rolling = next;
        episode = nextEpisode;
        delete pending;
        pendingSwap = false;
        return (IHooks.afterSwap.selector, 0);
    }
}

/// @notice Local pinned-core integration vectors with synthetic authenticated-context fixtures.
contract CoreSwapPolicyTest is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;
    VmSwap private constant vm = VmSwap(address(uint160(uint256(keccak256("hevm cheat code")))));
    PoolManager private manager;
    SnapshotFixtureHook private hook;
    SwapToken private token0;
    SwapToken private token1;
    PoolKey private key;
    IBellSwapEvaluator.Context private context;
    BalanceDelta private actual;
    bool private omitSettlement;

    function setUp() external {
        vm.warp(10000);
        manager = new PoolManager(address(this));
        BellModeEvaluator evaluator = new BellModeEvaluator();
        SnapshotFixtureHook template = new SnapshotFixtureHook(manager, IBellSwapEvaluator(address(evaluator)));
        // Test-only code copy to the exact beforeSwap/afterSwap permission address; no production deployment.
        address target = address(uint160(0x10000c0));
        vm.etch(target, address(template).code);
        hook = SnapshotFixtureHook(target);
        SwapToken a = new SwapToken(); SwapToken b = new SwapToken();
        (token0, token1) = address(a) < address(b) ? (a, b) : (b, a);
        token0.mint(address(this), 1e24); token1.mint(address(this), 1e24);
        key = PoolKey(Currency.wrap(address(token0)), Currency.wrap(address(token1)), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(target));
        manager.initialize(key, uint160(1 << 96));
        context.configHash = keccak256("synthetic immutable profile");
        context.stateHash = keccak256("synthetic healthy dependencies");
        context.poolClass = 0;
        context.mode = 1;
        context.phase = 2;
        context.timestamp = 10000;
        context.validUntil = 11000;
        context.bellStart = 9000;
        context.preSqrtPriceX96 = uint160(1 << 96);
        context.referencePrice18 = [uint128(1e18), uint128(1e18)];
        context.decimals = [uint8(18), uint8(18)];
        context.tradeCap = [uint128(1e12), uint128(1e12)];
        context.windowCap = [uint128(5e12), uint128(5e12)];
        context.closureCap = [uint128(1e12), uint128(1e12)];
        hook.configure(context);
        manager.unlock(abi.encode(uint8(0), SwapParams(false, 0, 0), bytes("")));
    }

    function testCoreExactInputBothCurrencyDirections() external {
        _swap(true, -1e8, -100, ""); _assertActualBudgets();
        _swap(false, -1e8, 100, "");
        (Buckets memory b,) = hook.counters();
        require(b.currentGross[0] > 1e8 && b.currentGross[1] > 1e8, "reverse flow refunded");
    }
    function testCoreExactOutputBothCurrencyDirections() external {
        _swap(true, 1e8, -100, "");
        require(actual.amount1() == 1e8 && actual.amount0() < -1e8, "exact output currency1");
        _assertActualBudgets();
        _swap(false, 1e8, 100, "");
        require(actual.amount0() == 1e8 && actual.amount1() < 0, "exact output currency0");
    }
    function testCorePartialExactInputAndTickCrossingUseActualDelta() external {
        _swap(true, -1e11, -150, "");
        require(-int256(actual.amount0()) < 1e11, "not partial");
        (,int24 tick,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        require(tick <= -150, "did not cross initialized tick -120");
        _assertActualBudgets();
    }
    function testCorePartialExactOutputUsesActualDelta() external {
        _swap(false, 1e11, 150, "");
        require(actual.amount0() > 0 && actual.amount0() < 1e11, "not partial exact output");
        _assertActualBudgets();
    }
    function testCoreProtocolFeeIncludedInGrossInput() external {
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(key, uint24(1000 | (1000 << 12)));
        _swap(true, -1e8, -100, "");
        _assertActualBudgets();
        require(manager.protocolFeesAccrued(key.currency0) > 0, "protocol fee not exercised");
    }
    function testCoreZeroOutputFeeOnlyFailsClosedAndRollsBack() external {
        _assertWrapped(_mustRollback(true, -1, -100, ""), IHooks.afterSwap.selector,
            BellModeEvaluator.InvalidActualDelta.selector);
    }
    function testCoreArbitraryHookDataCannotReplaceReferenceOrPolicy() external {
        _mustRollback(true, -1e8, -100, abi.encode(context));
    }
    function testCorePricePathRejectRestoresPriceAndBudgets() external {
        _assertWrapped(_mustRollback(true, -1e11, -300, ""), IHooks.afterSwap.selector,
            BellModeEvaluator.InvalidPricePath.selector);
    }
    function testCoreCorrectiveRepricingCanProgressOutsideBand() external {
        // Pool price=1, reference ratio=2. Still outside the band after this partial corrective step.
        context.referencePrice18[0] = 2e18;
        hook.configure(context);
        _swap(false, -1e8, 100, "");
        _assertActualBudgets();
    }
    function testCoreRepricingWrongDirectionRejectedWithoutDeadlockingCorrectiveDirection() external {
        context.referencePrice18[0] = 2e18;
        hook.configure(context);
        _assertWrapped(_mustRollback(true, -1e8, -100, ""), IHooks.afterSwap.selector,
            BellModeEvaluator.InvalidPricePath.selector);
        _swap(false, -1e8, 100, "");
    }
    function testCoreRollingRejectDoesNotCommitEitherCurrency() external {
        context.windowCap = [uint128(1e8), uint128(1e8)];
        context.tradeCap = [uint128(1e8), uint128(1e8)];
        context.closureCap = [uint128(1e8), uint128(1e8)];
        hook.configure(context);
        _swap(true, -6e7, -100, "");
        _assertWrapped(_mustRollback(false, -6e7, 100, ""), IHooks.afterSwap.selector,
            FlowBudget.WindowCapExceeded.selector);
    }
    function testCoreClosureSecondCurrencyFailureRollsBackRollingAndEpisode() external {
        context.mode = 2; context.phase = 5; context.closedLatched = true;
        context.frozenStock = true; context.closureNonce = 1;
        context.closureCap = [uint128(1e9), uint128(1)];
        hook.configure(context);
        _assertWrapped(_mustRollback(true, -1e8, -100, ""), IHooks.afterSwap.selector,
            ClosureBudget.EpisodeBudgetExceeded.selector);
    }
    function testCoreClosureCommitsBothGrossCandidates() external {
        context.mode = 2; context.phase = 5; context.closedLatched = true;
        context.frozenStock = true; context.closureNonce = 1;
        hook.configure(context);
        _swap(true, -1e8, -100, "");
        (Buckets memory b, uint128[2] memory e) = hook.counters();
        require(e[0] == b.currentGross[0] && e[1] == b.currentGross[1], "closure not atomic");
    }
    function testCoreSettlementFailureRestoresSnapshotPriceAndBudgets() external {
        omitSettlement = true;
        bytes memory reason = _mustRollback(true, -1e8, -100, "");
        require(bytes4(reason) == IPoolManager.CurrencyNotSettled.selector, "wrong settlement failure");
    }

    function executeSwap(bool direction, int256 amount, int24 limit, bytes calldata data) external {
        require(msg.sender == address(this), "self only");
        _swap(direction, amount, limit, data);
    }
    function _swap(bool direction, int256 amount, int24 limit, bytes memory data) private {
        manager.unlock(abi.encode(uint8(1), SwapParams(direction, amount, TickMath.getSqrtPriceAtTick(limit)), data));
    }
    function _assertActualBudgets() private view {
        (Buckets memory b,) = hook.counters();
        require(b.currentGross[0] == uint256(actual.amount0() < 0 ? -int256(actual.amount0()) : int256(actual.amount0())), "gross0");
        require(b.currentGross[1] == uint256(actual.amount1() < 0 ? -int256(actual.amount1()) : int256(actual.amount1())), "gross1");
    }
    function _mustRollback(bool direction, int256 amount, int24 limit, bytes memory data) private returns (bytes memory reason) {
        bytes32 beforeState = hook.checkpointHash();
        (uint160 beforePrice,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        uint256 balance0 = token0.balanceOf(address(manager));
        uint256 balance1 = token1.balanceOf(address(manager));
        bool ok;
        (ok, reason) = address(this).call(abi.encodeCall(this.executeSwap, (direction, amount, limit, data)));
        require(!ok, "swap unexpectedly succeeded");
        (uint160 afterPrice,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        require(beforeState == hook.checkpointHash() && beforePrice == afterPrice, "snapshot/accounting/price changed");
        require(balance0 == token0.balanceOf(address(manager)) && balance1 == token1.balanceOf(address(manager)), "settlement changed");
    }
    function decodeWrapped(bytes calldata reason) external pure returns (address, bytes4, bytes memory, bytes memory) {
        return abi.decode(reason[4:], (address, bytes4, bytes, bytes));
    }
    function _assertWrapped(bytes memory reason, bytes4 callback, bytes4 expectedInner) private view {
        require(bytes4(reason) == CustomRevert.WrappedError.selector, "not a hook error");
        (address target, bytes4 selector, bytes memory inner,) = this.decodeWrapped(reason);
        require(target == address(hook) && selector == callback && bytes4(inner) == expectedInner, "wrong rejection path");
    }
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager only");
        (uint8 operation, SwapParams memory params, bytes memory hookData) = abi.decode(data, (uint8, SwapParams, bytes));
        BalanceDelta delta;
        if (operation == 0) {
            (BalanceDelta a,) = manager.modifyLiquidity(key, ModifyLiquidityParams(-120,120,1e12,bytes32(0)), "");
            (BalanceDelta b,) = manager.modifyLiquidity(key, ModifyLiquidityParams(-600,600,5e11,bytes32(uint256(1))), "");
            delta = a + b;
        } else {
            delta = manager.swap(key, params, hookData);
            actual = delta;
        }
        if (!omitSettlement) {
            _settle(key.currency0, token0, delta.amount0());
            _settle(key.currency1, token1, delta.amount1());
        }
        return "";
    }
    function _settle(Currency currency, SwapToken token, int128 delta) private {
        if (delta < 0) {
            manager.sync(currency);
            token.transfer(address(manager), uint256(-int256(delta)));
            manager.settle();
        } else if (delta > 0) manager.take(currency, address(this), uint128(delta));
    }
}
