// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellPoolFactory} from "../../src/BellPoolFactory.sol";
import {BellHook} from "../../src/BellHook.sol";
import {IBellHookDeployer} from "../../src/interfaces/IBellHookDeployer.sol";
import {CreateRequest, CreateResult, PoolConfig} from "../../src/types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Actions} from "../../lib/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "../../lib/v4-periphery/src/libraries/LiquidityAmounts.sol";


interface Vm {
    struct Log { bytes32[] topics; bytes data; address emitter; }
    function createSelectFork(string calldata) external returns (uint256);
    function envString(string calldata) external view returns (string memory);
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert() external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function pauseGasMetering() external;
    function resumeGasMetering() external;
    function store(address, bytes32, bytes32) external;
    function load(address, bytes32) external view returns (bytes32);
    function warp(uint256) external;
}

abstract contract MiniTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    event log_named_address(string key, address val);
    event log_named_uint(string key, uint256 val);
    function assertEq(uint256 a, uint256 b, string memory m) internal pure { require(a == b, m); }
    function assertGt(uint256 a, uint256 b, string memory m) internal pure { require(a > b, m); }
    function assertLt(uint256 a, uint256 b, string memory m) internal pure { require(a < b, m); }
    function emitAddr(string memory k, address v) internal { emit log_named_address(k, v); }
    function emitUint(string memory k, uint256 v) internal { emit log_named_uint(k, v); }
}

interface IPositionManagerLite {
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function nextTokenId() external view returns (uint256);
}

/// @dev Minimal swap router for the rehearsal: pays from `payer`, takes to `payer`.
contract RehearsalSwapper is IUnlockCallback {
    IPoolManager public immutable pm;

    constructor(IPoolManager p) { pm = p; }

    function swap(PoolKey memory k, bool zeroForOne, int256 amountSpecified) external returns (BalanceDelta d) {
        d = abi.decode(pm.unlock(abi.encode(msg.sender, k, zeroForOne, amountSpecified)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "pm only");
        (address payer, PoolKey memory k, bool z, int256 a) = abi.decode(data, (address, PoolKey, bool, int256));
        BalanceDelta d = pm.swap(k, SwapParams(z, a, z ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1), "");
        int128 a0 = d.amount0();
        int128 a1 = d.amount1();
        _settle(k.currency0, payer, a0);
        _settle(k.currency1, payer, a1);
        return abi.encode(d);
    }

    function _settle(Currency c, address payer, int128 amount) private {
        if (amount < 0) {
            pm.sync(c);
            require(IERC20(Currency.unwrap(c)).transferFrom(payer, address(pm), uint128(-amount)), "pay");
            pm.settle();
        } else if (amount > 0) {
            pm.take(c, payer, uint128(amount));
        }
    }
}

/// @notice Rehearses the Einstein Hooks v2 first-pool launch against a fork of Robinhood Chain mainnet (4663),
///         using the deployed PQ stack. Nothing here broadcasts. Run with:
///         forge test --match-path "test/fork/*" --fork-url $RH_MAINNET_RPC_SECONDARY -vv
contract EinsteinPoolRehearsal is MiniTest {
    BellPoolFactory constant FACTORY = BellPoolFactory(0xF6b38e322Ce6d8F9F836921278e13aE55F525569);
    IBellHookDeployer constant DEPLOYER = IBellHookDeployer(0xe95e9A0eb5cc6ef7CF20e80d4bdB51538A79102D);
    address constant POOL_MANAGER = 0x8b26FEfa276860592D45114Cb30B335DdDd87B56;
    address constant POSITION_MANAGER = 0x84da249Aafa359886C6A2Ae1ebDC78a6059B662D;
    address constant ASSET_REGISTRY = 0xb02cD68bCB8D3C624b7E3AfD3a9F48a4C64D9b18;
    address constant CALENDAR_REGISTRY = 0x77813F7A761bfa5722DC5ee1a6E5b4B849D49003;
    address constant SAFETY = 0x5518541aA2D4b45531d7a2506FA81FFdFb4d505d;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    bytes32 constant USDG_ID = 0xa10e095b46e9d8b30cd832fb710af91b7a265dcdf04d4e719938d33122c7b9f7;
    bytes32 constant NVDA_ID = 0x9d718288c84e1620400de986e2d65853512a357734ffcfb2565e15de427f8fe7;
    bytes32 constant SWAP_TOPIC = keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");

    address internal creator;
    RehearsalSwapper internal swapper;
    CreateResult internal pool;
    PoolKey internal key;
    uint128 internal seedLiquidity;

    function setUp() external {
        vm.createSelectFork(vm.envString("RH_MAINNET_RPC_SECONDARY"));
        creator = address(uint160(uint256(keccak256("einstein-creator"))));
        swapper = new RehearsalSwapper(IPoolManager(POOL_MANAGER));
        // USDG is token0 and NVDA token1 by address order; both are 6 and 18 decimals.
        assertLt(uint256(uint160(USDG)), uint256(uint160(NVDA)), "token order");
        _deal(USDG, creator, 100e6);
        _deal(NVDA, creator, 1e18);
    }

    /// @dev Sets an ERC-20 balance by probing the usual mapping slots (plain slot 0..12 and the OpenZeppelin v5 namespace).
    function _deal(address token, address who, uint256 amount) internal {
        for (uint256 i; i < 14; ++i) {
            bytes32 slot = keccak256(abi.encode(who, i));
            if (_try(token, who, slot, amount)) return;
        }
        bytes32 base = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00;
        if (_try(token, who, keccak256(abi.encode(who, base)), amount)) return;
        revert("balance slot not found");
    }

    function _try(address token, address who, bytes32 slot, uint256 amount) private returns (bool) {
        bytes32 old = vm.load(token, slot);
        vm.store(token, slot, bytes32(amount));
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", who));
        if (ok && ret.length == 32 && abi.decode(ret, (uint256)) == amount) return true;
        vm.store(token, slot, old);
        return false;
    }

    function _config() internal view returns (PoolConfig memory) {
        return PoolConfig({
            token0: USDG, token1: NVDA, asset0: USDG_ID, asset1: NVDA_ID,
            poolManager: POOL_MANAGER, positionManager: POSITION_MANAGER, factory: address(FACTORY),
            assetRegistry: ASSET_REGISTRY, calendarRegistry: CALENDAR_REGISTRY, safetyController: SAFETY,
            treasuryAdapter: address(0), poolClass: 1, liquidityMode: 0, referenceMode: 0, tickSpacing: 60,
            tradeCap: [uint128(0), uint128(0)], windowCap: [uint128(0), uint128(0)], closureCap: [uint128(0), uint128(0)],
            policyId: keccak256(bytes(vm.envString("BELL_POLICY_ID"))),
            referenceAdapter0: address(0), referenceAdapter1: address(0)
        });
    }

    function _request() internal returns (CreateRequest memory r) {
        int24 tick = 223320; // about 200 USDG per NVDA once decimals are applied
        int24 lower = tick - 3000;
        int24 upper = tick + 3000;
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(tick);
        uint128 amount0 = 1e6;      // 1 USDG
        uint128 amount1 = 5e15;     // 0.005 NVDA
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), amount0, amount1
        );
        seedLiquidity = liquidity;
        PoolConfig memory c = _config();
        // Per-pool flow caps follow the production rule: 10% trade, 40% window, 5% closure of the seed.
        c.tradeCap = [amount0 / 10, amount1 / 10];
        c.windowCap = [(amount0 * 4) / 10, (amount1 * 4) / 10];
        c.closureCap = [amount0 / 20, amount1 / 20];
        r = CreateRequest({
            config: c, salt: bytes32(0), nonce: FACTORY.nonces(creator), deadline: uint64(block.timestamp + 3600),
            recipient: creator, sqrtPriceX96: sqrtP, tickLower: lower, tickUpper: upper, liquidity: liquidity,
            amountMax: [amount0 * 11 / 10, amount1 * 11 / 10], maxServiceFee: 49e6
        });
        r.salt = _mine(r);
    }

    function _mine(CreateRequest memory r) internal returns (bytes32) {
        vm.pauseGasMetering();
        PoolKey memory k = PoolKey(Currency.wrap(r.config.token0), Currency.wrap(r.config.token1), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(0)));
        bytes32 initHash = DEPLOYER.initCodeHash(r.config, k);
        bytes memory ns = abi.encode(block.chainid, address(FACTORY), creator, r.nonce, bytes32(0));
        bytes memory cp = abi.encodePacked(bytes1(0xff), address(DEPLOYER), bytes32(0), initHash);
        for (uint256 i; i < 400000; ++i) {
            bytes32 digest;
            assembly ("memory-safe") {
                mstore(add(ns, 160), i)
                let s := keccak256(add(ns, 32), 160)
                mstore(add(cp, 53), s)
                digest := keccak256(add(cp, 32), 85)
            }
            if (uint160(uint256(digest)) & 0x3fff == 0x2cc0) {
                vm.resumeGasMetering();
                return bytes32(i);
            }
        }
        revert("no salt");
    }

    function _create() internal {
        CreateRequest memory r = _request();
        vm.startPrank(creator);
        IERC20(USDG).approve(address(FACTORY), type(uint256).max);
        IERC20(NVDA).approve(address(FACTORY), type(uint256).max);
        pool = FACTORY.createAndSeed(r);
        vm.stopPrank();
        key = PoolKey(Currency.wrap(USDG), Currency.wrap(NVDA), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(pool.hook));
    }

    function test_P3_P4_poolIsInitializedOnAnEinsteinHook() external {
        _create();
        assertEq(uint160(pool.hook) & 0x3fff, 0x2cc0, "hook bits");
        // Remove-liquidity callbacks are bits 9, 8 and 0 of the address: all off.
        assertEq(uint160(pool.hook) & (1 << 9), 0, "beforeRemoveLiquidity");
        assertEq(uint160(pool.hook) & (1 << 8), 0, "afterRemoveLiquidity");
        assertEq(uint160(pool.hook) & 1, 0, "afterRemoveLiquidityReturnDelta");
        assertGt(pool.liquidity, 0, "liquidity");
        emitAddr("hook", pool.hook);
        emitUint("service fee paid (raw USDG)", 100e6 - IERC20(USDG).balanceOf(creator) - 1e6);
    }

    function test_P6_swapFeeInTheSwapEventForCurrentSession() external {
        _create();
        vm.startPrank(creator);
        IERC20(USDG).approve(address(swapper), type(uint256).max);
        IERC20(NVDA).approve(address(swapper), type(uint256).max);
        vm.recordLogs();
        swapper.swap(key, true, -int256(uint256(0.015e6))); // exact input 0.015 USDG, under the 0.02 USDG CLOSED-session cap of a 1 USDG seed
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == SWAP_TOPIC) {
                (, , , , , uint24 fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                emitUint("Swap event fee (pips)", fee);
                return;
            }
        }
        revert("no Swap event");
    }

    function test_N5_swapAboveTheTradeCapReverts() external {
        _create();
        vm.startPrank(creator);
        IERC20(USDG).approve(address(swapper), type(uint256).max);
        // 0.05 USDG is above the 0.02 USDG per-trade limit that applies in the CLOSED session for a 1 USDG seed.
        try swapper.swap(key, true, -int256(uint256(0.05e6))) { revert("cap not enforced"); } catch (bytes memory reason) {
            bytes memory inner = abi.decode(_tail(reason), (bytes));
            require(bytes4(inner) == 0xecb1f63f, "expected TradeCapExceeded");
        }
        vm.stopPrank();
    }

    function _tail(bytes memory data) private pure returns (bytes memory out) {
        // WrappedError(address,bytes4,bytes,bytes): the inner revert data is the third argument.
        (, , bytes memory inner, ) = abi.decode(_strip(data), (address, bytes4, bytes, bytes));
        out = abi.encode(inner);
    }

    function _strip(bytes memory data) private pure returns (bytes memory out) {
        out = new bytes(data.length - 4);
        for (uint256 i; i < out.length; ++i) out[i] = data[i + 4];
    }

    function test_P8_exitNeverTouchesTheHook() external {
        _create();
        vm.startPrank(creator);
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(pool.tokenId, uint256(pool.liquidity), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(Currency.wrap(USDG), Currency.wrap(NVDA), creator);
        uint256 before0 = IERC20(USDG).balanceOf(creator);
        IPositionManagerLite(POSITION_MANAGER).modifyLiquidities(abi.encode(actions, params), block.timestamp + 600);
        vm.stopPrank();
        assertGt(IERC20(USDG).balanceOf(creator), before0, "got USDG back");
    }
}
