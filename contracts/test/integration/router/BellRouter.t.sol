// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellRouter} from "../../../src/BellRouter.sol";
import {SwapRequest} from "../../../src/types/ProtocolTypes.sol";
import {BellModeEvaluator} from "../../../src/BellModeEvaluator.sol";
import {IBellSwapEvaluator} from "../../../src/types/SwapEvaluation.sol";
import {Buckets} from "../../../src/types/ProtocolTypes.sol";
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
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {WETH} from "solmate/src/tokens/WETH.sol";

interface VmRouter {
    function warp(uint256) external;
    function etch(address, bytes calldata) external;
    function prank(address) external;
    function deal(address, uint256) external;
}

contract RouterTestToken is ERC20 {
    constructor(string memory name, string memory sym) ERC20(name, sym) {}
    function mint(address who, uint256 amount) external { _mint(who, amount); }
}

contract RouterMockHook {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;
    using StateLibrary for IPoolManager;

    IPoolManager public immutable manager;
    IBellSwapEvaluator public immutable evaluator;
    IBellSwapEvaluator.Context private context;
    IBellSwapEvaluator.Snapshot private pending;
    Buckets private rolling;
    uint128[2] private episode;
    bool private pendingSwap;
    PoolKey private storedKey;
    bytes32 public storedConfigHash;

    constructor(IPoolManager m, IBellSwapEvaluator e) { manager = m; evaluator = e; }

    function setKeyAndConfig(PoolKey calldata k, bytes32 ch) external {
        storedKey = k;
        storedConfigHash = ch;
    }

    function poolKey() external view returns (PoolKey memory) {
        return storedKey;
    }

    function configHash() external view returns (bytes32) {
        return storedConfigHash;
    }

    function configure(IBellSwapEvaluator.Context calldata c) external { context = c; }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata data)
        external returns (bytes4, BeforeSwapDelta, uint24)
    {
        require(msg.sender == address(manager) && !pendingSwap, "callback context");
        IBellSwapEvaluator.Context memory c = context;
        (c.preSqrtPriceX96,,,) = manager.getSlot0(key.toId());
        c.timestamp = uint64(block.timestamp);
        c.stateHash = keccak256(abi.encode(context, rolling, episode));
        pending = evaluator.prepare(c, keccak256(abi.encode(sender, key, params)), params.zeroForOne, params.amountSpecified);
        pendingSwap = true;
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, pending.lpFeeUnits | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata data)
        external returns (bytes4, int128)
    {
        require(msg.sender == address(manager) && pendingSwap, "callback context");
        (uint160 postPrice,,,) = manager.getSlot0(key.toId());
        (Buckets memory next, uint128[2] memory nextEpisode,) = evaluator.settle(pending,
            keccak256(abi.encode(sender, key, params)), uint64(block.timestamp), postPrice,
            delta.amount0(), delta.amount1(), rolling, episode);
        rolling = next;
        episode = nextEpisode;
        pendingSwap = false;
        return (IHooks.afterSwap.selector, 0);
    }
}

contract BellRouterTest is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    VmRouter private constant vm = VmRouter(address(uint160(uint256(keccak256("hevm cheat code")))));

    PoolManager private manager;
    BellRouter private router;
    RouterMockHook private hook;
    RouterTestToken private token0;
    RouterTestToken private token1;
    WETH private weth;
    PoolKey private key;
    PoolKey private wethKey;
    RouterMockHook private wethHook;
    bytes32 private constant CONFIG_HASH = keccak256("candidate immutable profile");

    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    function setUp() external {
        vm.warp(10000);
        manager = new PoolManager(address(this));
        weth = new WETH();
        router = new BellRouter(manager, address(weth));

        BellModeEvaluator evaluator = new BellModeEvaluator();
        RouterMockHook template = new RouterMockHook(manager, IBellSwapEvaluator(address(evaluator)));

        address target = address(uint160(0x10000c0));
        vm.etch(target, address(template).code);
        hook = RouterMockHook(target);

        RouterTestToken a = new RouterTestToken("Token A", "TKA");
        RouterTestToken b = new RouterTestToken("Token B", "TKB");
        (token0, token1) = address(a) < address(b) ? (a, b) : (b, a);

        token0.mint(address(this), 1e24);
        token1.mint(address(this), 1e24);

        key = PoolKey(Currency.wrap(address(token0)), Currency.wrap(address(token1)), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(target));
        hook.setKeyAndConfig(key, CONFIG_HASH);
        manager.initialize(key, uint160(1 << 96));

        IBellSwapEvaluator.Context memory context;
        context.configHash = CONFIG_HASH;
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
        context.tradeCap = [uint128(1e14), uint128(1e14)];
        context.windowCap = [uint128(5e14), uint128(5e14)];
        context.closureCap = [uint128(1e14), uint128(1e14)];
        hook.configure(context);

        // Add liquidity to key pool
        manager.unlock(abi.encode(key, address(token0), address(token1)));

        // Setup WETH pool
        address wethTarget = address(uint160(0x20000c0));
        vm.etch(wethTarget, address(template).code);
        wethHook = RouterMockHook(wethTarget);

        address weth0;
        address weth1;
        (weth0, weth1) = address(weth) < address(token1) ? (address(weth), address(token1)) : (address(token1), address(weth));
        wethKey = PoolKey(Currency.wrap(weth0), Currency.wrap(weth1), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(wethTarget));
        wethHook.setKeyAndConfig(wethKey, CONFIG_HASH);
        manager.initialize(wethKey, uint160(1 << 96));
        wethHook.configure(context);

        // Fund WETH & token1 for liquidity
        vm.deal(address(this), 1000 ether);
        weth.deposit{value: 100 ether}();
        token1.mint(address(this), 1e24);
        manager.unlock(abi.encode(wethKey, weth0, weth1));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager only");
        (PoolKey memory poolKey_, address t0, address t1) = abi.decode(data, (PoolKey, address, address));
        (BalanceDelta a,) = manager.modifyLiquidity(poolKey_, ModifyLiquidityParams(-120, 120, 1e14, bytes32(0)), "");
        (BalanceDelta b,) = manager.modifyLiquidity(poolKey_, ModifyLiquidityParams(-600, 600, 5e13, bytes32(uint256(1))), "");
        BalanceDelta delta = a + b;
        _settle(poolKey_.currency0, t0, delta.amount0());
        _settle(poolKey_.currency1, t1, delta.amount1());
        return "";
    }

    function _settle(Currency currency, address token, int128 delta) private {
        if (delta < 0) {
            manager.sync(currency);
            ERC20(token).transfer(address(manager), uint256(-int256(delta)));
            manager.settle();
        } else if (delta > 0) {
            manager.take(currency, address(this), uint128(delta));
        }
    }

    function testExactInputBothDirections() external {
        // Alice swaps token0 for token1
        token0.mint(ALICE, 1e10);
        vm.prank(ALICE);
        token0.approve(address(router), type(uint256).max);

        SwapRequest memory req0 = SwapRequest({
            hook: address(hook),
            zeroForOne: true,
            exactInput: true,
            amountSpecified: 1e8,
            limitAmount: 1e7, // min amountOut
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1,
            recipient: ALICE,
            nonce: 0,
            deadline: 10100,
            expectedConfigHash: CONFIG_HASH,
            wrapInput: false,
            unwrapOutput: false,
            unwrapRefund: false
        });

        vm.prank(ALICE);
        (uint128 in0, uint128 out0) = router.swap(req0);
        require(in0 == 1e8, "exact input0");
        require(out0 >= 1e7, "min output0");
        require(token1.balanceOf(ALICE) == out0, "alice received token1");
        require(token0.balanceOf(address(router)) == 0 && token1.balanceOf(address(router)) == 0, "no router dust");
        require(router.nonces(ALICE) == 1, "nonce advanced");

        // Alice swaps token1 for token0
        token1.mint(ALICE, 1e10);
        vm.prank(ALICE);
        token1.approve(address(router), type(uint256).max);

        SwapRequest memory req1 = SwapRequest({
            hook: address(hook),
            zeroForOne: false,
            exactInput: true,
            amountSpecified: 1e8,
            limitAmount: 1e7,
            sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1,
            recipient: BOB,
            nonce: 1,
            deadline: 10100,
            expectedConfigHash: CONFIG_HASH,
            wrapInput: false,
            unwrapOutput: false,
            unwrapRefund: false
        });

        vm.prank(ALICE);
        (uint128 in1, uint128 out1) = router.swap(req1);
        require(in1 == 1e8, "exact input1");
        require(out1 >= 1e7, "min output1");
        require(token0.balanceOf(BOB) == out1, "bob received token0");
        require(router.nonces(ALICE) == 2, "nonce advanced again");
    }

    function testExactOutputBothDirections() external {
        token0.mint(ALICE, 1e10);
        vm.prank(ALICE);
        token0.approve(address(router), type(uint256).max);

        SwapRequest memory req = SwapRequest({
            hook: address(hook),
            zeroForOne: true,
            exactInput: false,
            amountSpecified: 1e8, // exact amountOut
            limitAmount: 2e8, // max amountIn
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1,
            recipient: ALICE,
            nonce: 0,
            deadline: 10100,
            expectedConfigHash: CONFIG_HASH,
            wrapInput: false,
            unwrapOutput: false,
            unwrapRefund: false
        });

        vm.prank(ALICE);
        (uint128 in0, uint128 out0) = router.swap(req);
        require(out0 == 1e8, "exact out0");
        require(in0 <= 2e8, "max in0 respected");
        require(token1.balanceOf(ALICE) == 1e8, "alice balance");
        require(router.nonces(ALICE) == 1, "nonce 1");
    }

    function testSlippageRevertsAndDoesNotConsumeNonce() external {
        token0.mint(ALICE, 1e10);
        vm.prank(ALICE);
        token0.approve(address(router), type(uint256).max);

        SwapRequest memory req = SwapRequest({
            hook: address(hook),
            zeroForOne: true,
            exactInput: true,
            amountSpecified: 1e8,
            limitAmount: 1e9, // Unreasonable minimum -> must revert
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1,
            recipient: ALICE,
            nonce: 0,
            deadline: 10100,
            expectedConfigHash: CONFIG_HASH,
            wrapInput: false,
            unwrapOutput: false,
            unwrapRefund: false
        });

        vm.prank(ALICE);
        (bool ok, bytes memory reason) = address(router).call(abi.encodeCall(router.swap, (req)));
        require(!ok, "must revert on slippage");
        require(bytes4(reason) == BellRouter.SlippageExceeded.selector, "wrong slippage error");
        require(router.nonces(ALICE) == 0, "nonce consumed on failure");
    }

    function testDeadlineExpiredReverts() external {
        token0.mint(ALICE, 1e10);
        vm.prank(ALICE);
        token0.approve(address(router), type(uint256).max);

        SwapRequest memory req = SwapRequest({
            hook: address(hook),
            zeroForOne: true,
            exactInput: true,
            amountSpecified: 1e8,
            limitAmount: 1e7,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1,
            recipient: ALICE,
            nonce: 0,
            deadline: 9999, // block.timestamp is 10000 -> expired!
            expectedConfigHash: CONFIG_HASH,
            wrapInput: false,
            unwrapOutput: false,
            unwrapRefund: false
        });

        vm.prank(ALICE);
        (bool ok, bytes memory reason) = address(router).call(abi.encodeCall(router.swap, (req)));
        require(!ok, "must revert on expired deadline");
        require(bytes4(reason) == BellRouter.DeadlineExpired.selector, "wrong deadline error");
    }

    function testInvalidNonceReverts() external {
        token0.mint(ALICE, 1e10);
        vm.prank(ALICE);
        token0.approve(address(router), type(uint256).max);

        SwapRequest memory req = SwapRequest({
            hook: address(hook),
            zeroForOne: true,
            exactInput: true,
            amountSpecified: 1e8,
            limitAmount: 1e7,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1,
            recipient: ALICE,
            nonce: 5, // Expected 0
            deadline: 10100,
            expectedConfigHash: CONFIG_HASH,
            wrapInput: false,
            unwrapOutput: false,
            unwrapRefund: false
        });

        vm.prank(ALICE);
        (bool ok, bytes memory reason) = address(router).call(abi.encodeCall(router.swap, (req)));
        require(!ok, "must revert on invalid nonce");
        require(bytes4(reason) == BellRouter.InvalidNonce.selector, "wrong nonce error");
    }

    function testConfigMismatchReverts() external {
        token0.mint(ALICE, 1e10);
        vm.prank(ALICE);
        token0.approve(address(router), type(uint256).max);

        SwapRequest memory req = SwapRequest({
            hook: address(hook),
            zeroForOne: true,
            exactInput: true,
            amountSpecified: 1e8,
            limitAmount: 1e7,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1,
            recipient: ALICE,
            nonce: 0,
            deadline: 10100,
            expectedConfigHash: keccak256("wrong config hash"),
            wrapInput: false,
            unwrapOutput: false,
            unwrapRefund: false
        });

        vm.prank(ALICE);
        (bool ok, bytes memory reason) = address(router).call(abi.encodeCall(router.swap, (req)));
        require(!ok, "must revert on config mismatch");
        require(bytes4(reason) == BellRouter.ConfigMismatch.selector, "wrong config error");
    }

    function testNativeWrapInputAndUnwrapRefund() external {
        vm.deal(ALICE, 10 ether);

        bool wethIsZero = address(weth) < address(token1);
        SwapRequest memory req = SwapRequest({
            hook: address(wethHook),
            zeroForOne: wethIsZero,
            exactInput: true,
            amountSpecified: 1e8,
            limitAmount: 1e7,
            sqrtPriceLimitX96: wethIsZero ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            recipient: ALICE,
            nonce: 0,
            deadline: 10100,
            expectedConfigHash: CONFIG_HASH,
            wrapInput: true,
            unwrapOutput: false,
            unwrapRefund: true
        });

        // Alice sends 2e8 wei (1e8 swap, 1e8 refund)
        vm.prank(ALICE);
        (uint128 inAmount, uint128 outAmount) = router.swap{value: 2e8}(req);

        require(inAmount == 1e8, "used 1e8");
        require(outAmount >= 1e7, "output received");
        require(ALICE.balance == 10 ether - 1e8, "1e8 refunded to alice");
        require(address(router).balance == 0, "no eth left in router");
        require(token1.balanceOf(ALICE) >= 1e7, "alice got token1");
    }

    function testNativeUnwrapOutput() external {
        bool wethIsZero = address(weth) < address(token1);
        bool zeroForOne = !wethIsZero; // token1 in, WETH out

        token1.mint(ALICE, 1e10);
        vm.prank(ALICE);
        token1.approve(address(router), type(uint256).max);

        uint256 aliceEthBefore = ALICE.balance;

        SwapRequest memory req = SwapRequest({
            hook: address(wethHook),
            zeroForOne: zeroForOne,
            exactInput: true,
            amountSpecified: 1e8,
            limitAmount: 1e6,
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            recipient: ALICE,
            nonce: 0,
            deadline: 10100,
            expectedConfigHash: CONFIG_HASH,
            wrapInput: false,
            unwrapOutput: true,
            unwrapRefund: false
        });

        vm.prank(ALICE);
        (, uint128 outAmount) = router.swap(req);

        require(ALICE.balance == aliceEthBefore + outAmount, "alice received native eth");
        require(address(router).balance == 0, "no eth left in router");
        require(weth.balanceOf(address(router)) == 0, "no weth left in router");
    }

    function testInvalidRecipientReverts() external {
        SwapRequest memory req = SwapRequest({
            hook: address(hook),
            zeroForOne: true,
            exactInput: true,
            amountSpecified: 1e8,
            limitAmount: 1e7,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1,
            recipient: address(0), // Zero recipient!
            nonce: 0,
            deadline: 10100,
            expectedConfigHash: CONFIG_HASH,
            wrapInput: false,
            unwrapOutput: false,
            unwrapRefund: false
        });

        vm.prank(ALICE);
        (bool ok, bytes memory reason) = address(router).call(abi.encodeCall(router.swap, (req)));
        require(!ok && bytes4(reason) == BellRouter.InvalidRecipient.selector, "zero recipient allowed");

        req.recipient = address(router); // Router itself as recipient!
        vm.prank(ALICE);
        (ok, reason) = address(router).call(abi.encodeCall(router.swap, (req)));
        require(!ok && bytes4(reason) == BellRouter.InvalidRecipient.selector, "router recipient allowed");
    }

    function testUnlockCallbackUnauthorizedForStranger() external {
        vm.prank(ALICE);
        (bool ok, bytes memory reason) = address(router).call(abi.encodeCall(router.unlockCallback, ("")));
        require(!ok && bytes4(reason) == BellRouter.Unauthorized.selector, "stranger unlock allowed");
    }
}
