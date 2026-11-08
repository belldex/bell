// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellPoolFactory} from "../../src/BellPoolFactory.sol";
import {BellHookDeployerV2} from "../../src/BellHookDeployerV2.sol";
import {BellHookV2} from "../../src/BellHookV2.sol";
import {BellHook} from "../../src/BellHook.sol";
import {BellAuctionRegistry} from "../../src/auction/BellAuctionRegistry.sol";
import {BellAuctionFactoryModule} from "../../src/auction/BellAuctionFactoryModule.sol";
import {BellOpeningAuction} from "../../src/auction/BellOpeningAuction.sol";
import {IBellHookDeployer} from "../../src/interfaces/IBellHookDeployer.sol";
import {BellPolicyOracle} from "../../src/BellPolicyOracle.sol";
import {BellModeEvaluator} from "../../src/BellModeEvaluator.sol";
import {CalendarProof} from "../../src/libraries/CalendarProof.sol";
import {
    CreateRequest, CreateResult, PoolConfig, AssetDescriptor, HealthView, CalendarLeaf, Anchor
} from "../../src/types/ProtocolTypes.sol";
import {FactoryAdmission, FactoryRegistrySafety, FactoryPermit2} from "../integration/factory/BellPoolFactory.t.sol";
import {MockCalendarRegistry, MockSessionRegistry} from "../unit/hook/BellHookLifecycle.t.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts} from "../../lib/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {Actions} from "../../lib/v4-periphery/src/libraries/Actions.sol";
import {PositionManager} from "../../lib/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "../../lib/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "../../lib/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface VmReplay {
    function warp(uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function readFile(string calldata) external view returns (string memory);
    function writeFile(string calldata, string calldata) external;
    function parseJsonUintArray(string calldata, string calldata) external pure returns (uint256[] memory);
    function parseJsonStringArray(string calldata, string calldata) external pure returns (string[] memory);
    function pauseGasMetering() external;
    function envOr(string calldata, uint256) external view returns (uint256);
    function toString(uint256) external pure returns (string memory);
    function toString(int256) external pure returns (string memory);
    function toString(bytes calldata) external pure returns (string memory);
    function getNonce(address) external view returns (uint64);
    function computeCreateAddress(address, uint256) external pure returns (address);
}

/// @dev A token with 18 or 6 decimals and the status getters BELL reads from a stock token.
contract ReplayToken is ERC20 {
    uint8 private immutable DEC;
    bool public oraclePaused;
    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) { DEC = d; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public view override returns (uint8) { return DEC; }
    function uiMultiplier() external pure returns (uint256) { return 1e18; }
    function newUIMultiplier() external pure returns (uint256) { return 1e18; }
    function effectiveAt() external pure returns (uint256) { return 0; }
}

/// @dev One wallet that can add or remove liquidity and swap on any pool through the PoolManager, with empty hook data.
contract ReplayRouter is IUnlockCallback {
    IPoolManager public immutable manager;
    enum Op { SWAP, MODIFY }
    constructor(IPoolManager m) { manager = m; }

    function swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified, uint160 limit) external returns (BalanceDelta d) {
        d = abi.decode(manager.unlock(abi.encode(Op.SWAP, key, abi.encode(zeroForOne, amountSpecified, limit))), (BalanceDelta));
    }
    function modify(PoolKey memory key, ModifyLiquidityParams memory p) external returns (BalanceDelta d, BalanceDelta fees) {
        (d, fees) = abi.decode(manager.unlock(abi.encode(Op.MODIFY, key, abi.encode(p))), (BalanceDelta, BalanceDelta));
    }
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager only");
        (Op op, PoolKey memory key, bytes memory inner) = abi.decode(data, (Op, PoolKey, bytes));
        BalanceDelta d; BalanceDelta fees;
        if (op == Op.SWAP) {
            (bool z, int256 amt, uint160 limit) = abi.decode(inner, (bool, int256, uint160));
            d = manager.swap(key, SwapParams(z, amt, limit), "");
        } else {
            ModifyLiquidityParams memory p = abi.decode(inner, (ModifyLiquidityParams));
            (d, fees) = manager.modifyLiquidity(key, p, "");
        }
        _settle(key.currency0, d.amount0());
        _settle(key.currency1, d.amount1());
        return abi.encode(d, fees);
    }
    function _settle(Currency c, int128 amount) private {
        if (amount < 0) {
            manager.sync(c);
            ERC20(Currency.unwrap(c)).transfer(address(manager), uint256(uint128(-amount)));
            manager.settle();
        } else if (amount > 0) manager.take(c, address(this), uint128(amount));
    }
}

/// @title WeekendReplay
/// @notice Replays real weekends on two pools with the same liquidity: a standard Uniswap v4 pool and a BELL pool.
///         One command, one CSV: `forge test --match-contract WeekendReplay -vv` (see research/replay/README.md).
/// @dev The BELL contracts are the production bytecode: BellPoolFactory, BellHookDeployerV2, BellHookV2, the policy oracle,
///      the mode evaluator, the auction registry and module, and the Uniswap v4 PoolManager and PositionManager. The
///      calendar, asset, session and safety registries are the repository's test doubles, driven to say what the real
///      calendar and the real close anchor would say. See the README for what that does and does not prove.
contract WeekendReplay {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    VmReplay private constant vm = VmReplay(address(uint160(uint256(keccak256("hevm cheat code")))));

    // ------------------------------------------------------------------ parameters (change here, or see the README)
    uint256 internal constant CAPITAL_USDG = 100_000e6;     // each pool starts with $100,000 of liquidity
    uint256 internal constant RANGE_DOWN_BPS = 7500;        // position range: 75% to 130% of the Friday close
    uint256 internal constant RANGE_UP_BPS = 13000;
    uint256 internal constant TRADE_CAP_BPS = 250;          // per-swap cap, share of the seeded principal
    uint256 internal constant WINDOW_CAP_BPS = 1000;        // rolling-window cap
    uint256 internal constant CLOSURE_CAP_BPS = 500;        // budget for a whole closed-market episode
    uint24 internal constant POOL_A_FEE = 3000;             // standard pool: fixed 0.30%, no hook
    uint256 internal constant FEE_CLOSED = 10000;           // BELL fee units, from PolicyConstants
    uint256 internal constant FEE_PRE = 3000;
    uint256 internal constant BELL_FEE_SECONDS = 300;       // the opening fee decays from 1.00% to the session fee over 300 s
    uint256 internal constant ARB_STEP_SECONDS = 15;        // the arbitrageur looks at the BELL pool this often after the open
    uint256 internal constant ARB_WINDOW_SECONDS = 1800;    // and for this long
    int24 internal constant SPACING = 60;

    PoolManager internal manager;
    PositionManager internal positions;
    FactoryPermit2 internal permit2;
    FactoryAdmission internal assets;
    MockSessionRegistry internal sessions;
    MockCalendarRegistry internal calendar;
    FactoryRegistrySafety internal safety;
    BellPolicyOracle internal oracle;
    BellModeEvaluator internal modeEvaluator;
    BellAuctionRegistry internal auctionRegistry;
    BellAuctionFactoryModule internal auctionModule;
    IBellHookDeployer internal deployer;
    BellPoolFactory internal factory;
    ReplayToken internal usdg;
    bytes32 internal usdgAsset;
    uint256 internal clock;

    address internal constant SERVICE = address(0xFEE);
    address internal constant LP_B = address(0xB0B);

    uint256 internal revertCount;
    uint256 internal lastReasonBits;
    bytes4 internal lastRevert;

    struct Result {
        int256 gapBps;            // (open - close) / close, in basis points
        int256 arbA; int256 arbB; // arbitrageur profit per pool, USDG raw units (6 decimals)
        int256 feesA; int256 feesB;
        int256 lpNetA; int256 lpNetB; // LP position value minus holding the same tokens, valued at the open price
        int256 capitalA; int256 capitalB;
        uint256 swapsB;
        uint256 aucOrders; uint256 aucMatchedUsd; int256 aucClearBps; bool aucSettled;
    }

    function setUp() external {
        vm.pauseGasMetering();
        clock = 1_800_000_000;
        vm.warp(clock);
        manager = new PoolManager(address(this));
        permit2 = new FactoryPermit2();
        positions = new PositionManager(manager, IAllowanceTransfer(address(permit2)), 100000, IPositionDescriptor(address(0)), IWETH9(address(0)));
        usdg = new ReplayToken("USDG test", "USDG", 6);
        assets = new FactoryAdmission();
        sessions = new MockSessionRegistry();
        calendar = new MockCalendarRegistry();
        safety = new FactoryRegistrySafety();
        oracle = new BellPolicyOracle();
        modeEvaluator = new BellModeEvaluator();
        address future = vm.computeCreateAddress(address(this), uint256(vm.getNonce(address(this))) + 3);
        auctionRegistry = new BellAuctionRegistry(future);
        auctionModule = new BellAuctionFactoryModule(future, address(auctionRegistry), address(usdg), 600, 900, 512, 25, 100);
        deployer = IBellHookDeployer(address(new BellHookDeployerV2(
            future, address(sessions), keccak256(type(BellHookV2).creationCode), address(oracle), address(modeEvaluator),
            address(auctionRegistry), address(auctionModule)
        )));
        PoolConfig memory c = _config(address(usdg), address(usdg), bytes32(0), bytes32(0), future, [uint128(1), 1], [uint128(1), 1], [uint128(1), 1]);
        factory = new BellPoolFactory(c, deployer, address(usdg), SERVICE);
        require(address(factory) == future, "factory prediction");
        usdgAsset = keccak256("REPLAY_USDG");
        _admit(usdgAsset, address(usdg), false, 6);
        usdg.mint(address(this), 1e18);
        usdg.approve(address(factory), type(uint256).max);
    }

    // ------------------------------------------------------------------ the replay

    function testWeekendReplay() external {
        vm.pauseGasMetering();
        string memory json = vm.readFile("../research/replay/data/replay-input.json");
        string[] memory friday = vm.parseJsonStringArray(json, ".friday");
        string[] memory symbol = vm.parseJsonStringArray(json, ".symbol");
        uint256[] memory closeE4 = vm.parseJsonUintArray(json, ".close_e4");
        uint256[] memory openE4 = vm.parseJsonUintArray(json, ".open_e4");
        uint256 n = friday.length;
        uint256 limit = vm.envOr("REPLAY_LIMIT", n);
        if (limit < n) n = limit;

        string memory csv = "friday,symbol,close_usd,open_usd,gap_bps,arb_profit_a_usd,arb_profit_b_usd,lp_fees_a_usd,lp_fees_b_usd,lp_net_a_usd,lp_net_b_usd,lp_net_a_pct,lp_net_b_pct,difference_usd,difference_pct_points,swaps_b,refused_swaps_b,last_refusal,last_reason_bits,auction_orders,auction_matched_usd,auction_clearing_vs_open_bps,auction_settled\n";
        int256 sumDiff;
        for (uint256 i; i < n; ++i) {
            Result memory r = _runCase(i, closeE4[i], openE4[i]);
            sumDiff += r.lpNetB - r.lpNetA;
            csv = string.concat(csv, friday[i], ",", symbol[i], ",", _usd4(closeE4[i]), ",", _usd4(openE4[i]), ",", vm.toString(r.gapBps), ",");
            csv = string.concat(csv, _usd6(r.arbA), ",", _usd6(r.arbB), ",", _usd6(r.feesA), ",", _usd6(r.feesB), ",");
            csv = string.concat(csv, _usd6(r.lpNetA), ",", _usd6(r.lpNetB), ",", _pct(r.lpNetA, r.capitalA), ",", _pct(r.lpNetB, r.capitalB), ",");
            csv = string.concat(csv, _usd6(r.lpNetB - r.lpNetA), ",", _pct(r.lpNetB - r.lpNetA, r.capitalA), ",");
            csv = string.concat(csv, vm.toString(r.swapsB), ",", vm.toString(revertCount), ",", vm.toString(abi.encodePacked(lastRevert)), ",", vm.toString(lastReasonBits), ",");
            csv = string.concat(csv, vm.toString(r.aucOrders), ",", _usd6(int256(r.aucMatchedUsd)), ",", vm.toString(r.aucClearBps), ",", r.aucSettled ? "1" : "0", "\n");
            revertCount = 0; lastRevert = bytes4(0);
        }
        vm.writeFile("../research/replay/results.csv", csv);
        require(n > 0, "no cases");
    }

    function _runCase(uint256 index, uint256 closeE4, uint256 openE4) internal returns (Result memory r) {
        // 1e-4 USD to 1e-6 USD: the price of one whole stock token in USDG raw units
        uint256 pClose = closeE4 * 100;
        uint256 pOpen = openE4 * 100;
        r.gapBps = (int256(pOpen) - int256(pClose)) * 10_000 / int256(pClose);

        ReplayToken stock = new ReplayToken("Replay stock", "RSTK", 18);
        bytes32 stockAsset = keccak256(abi.encode("REPLAY_STOCK", index));
        bool stockIsToken0 = address(stock) < address(usdg);

        // ---- both pools start at the Friday close with the same liquidity and the same range
        uint160 sqrtClose = _sqrtPrice(pClose, stockIsToken0);
        (int24 tickLower, int24 tickUpper) = _range(pClose, stockIsToken0);
        uint256 stockAmount = FullMath.mulDiv(CAPITAL_USDG / 2, 1e18, pClose);
        uint256 usdgAmount = CAPITAL_USDG / 2;
        (uint256 amount0, uint256 amount1) = stockIsToken0 ? (stockAmount, usdgAmount) : (usdgAmount, stockAmount);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtClose, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), amount0, amount1
        );

        // ---- pool A: standard v4 pool, fixed 0.30%, no hook
        ReplayRouter lpA = new ReplayRouter(manager);
        ReplayRouter arbA = new ReplayRouter(manager);
        _fund(stock, lpA, arbA);
        PoolKey memory keyA = PoolKey(
            Currency.wrap(stockIsToken0 ? address(stock) : address(usdg)), Currency.wrap(stockIsToken0 ? address(usdg) : address(stock)),
            POOL_A_FEE, SPACING, IHooks(address(0))
        );
        manager.initialize(keyA, sqrtClose);
        (BalanceDelta addedA,) = lpA.modify(keyA, ModifyLiquidityParams(tickLower, tickUpper, int256(uint256(liquidity)), bytes32(0)));
        (uint256 heldStockA, uint256 heldUsdgA) = _amounts(addedA, stockIsToken0);
        r.capitalA = int256(_value(heldStockA, heldUsdgA, pOpen));

        // ---- pool B: BELL pool through the real factory
        (BellHook hook, uint256 tokenId, uint256 heldStockB, uint256 heldUsdgB) =
            _createBellPool(stock, stockAsset, stockIsToken0, sqrtClose, tickLower, tickUpper, liquidity);
        PoolKey memory keyB = hook.poolKey();
        ReplayRouter arbB = new ReplayRouter(manager);
        _fund(stock, arbB, arbB);
        r.capitalB = int256(_value(heldStockB, heldUsdgB, pOpen));

        uint256 arbA0 = _arbValue(stock, arbA, pOpen);
        uint256 arbB0 = _arbValue(stock, arbB, pOpen);

        // ---- Friday close: BELL closes the pool with an anchor at the close price; the standard pool just keeps trading
        uint256 closeTs = clock;
        uint256 openTs = closeTs + 2 days + 8 hours; // Monday 04:00 ET
        _closeMarket(hook, stockAsset, pClose, closeTs, openTs);

        // ---- the weekend: an arbitrageur who knows the Monday open price pushes BELL's closed pool toward it as far as
        // the closed-market fee and budget allow. The standard pool has no weekend behaviour to model: it sits at the close.
        uint256 feeA = POOL_A_FEE;
        r.swapsB += _arbToward(keyB, arbB, stockIsToken0, pOpen, FEE_CLOSED);
        vm.warp(clock = closeTs + 1 days);
        _refreshHealth(stockAsset);
        r.swapsB += _arbToward(keyB, arbB, stockIsToken0, pOpen, FEE_CLOSED);

        // ---- the auction: armed during the weekend, orders go in during the last ten minutes before the open
        address auctionAddr = auctionRegistry.auctionFor(hook.poolId());
        BellOpeningAuction auction = BellOpeningAuction(auctionAddr);
        if (auctionAddr != address(0)) {
            require(auction.armNext(), "auction not armed");
            vm.warp(clock = openTs - 300);
            _refreshHealth(stockAsset);
            r.aucOrders = _auctionOrders(auction, stock, index, pOpen);
        }

        // ---- the open
        vm.warp(clock = openTs);
        _arbToward(keyA, arbA, stockIsToken0, pOpen, feeA);                    // standard pool: the first swap takes the whole gap
        _openMarket(hook, stockAsset, openTs);                                   // BELL: the pool reopens, then the fee decays
        if (auctionAddr != address(0)) {
            try auction.settle() {
                r.aucSettled = true;
                (,,, uint160 clearX96, uint128 matchedBase,) = auction.cycleSummary(auction.cycleId());
                r.aucMatchedUsd = FullMath.mulDiv(uint256(matchedBase), pOpen, 1e18);
                if (clearX96 != 0) {
                    uint256 clearUsd = FullMath.mulDiv(uint256(clearX96), 1e18, 1 << 96);
                    r.aucClearBps = (int256(clearUsd) - int256(pOpen)) * 10_000 / int256(pOpen);
                }
            } catch {}
        }
        for (uint256 t = ARB_STEP_SECONDS; t <= ARB_WINDOW_SECONDS; t += ARB_STEP_SECONDS) {
            vm.warp(clock = openTs + 61 + t);
            _refreshHealth(stockAsset);
            uint256 fee = _bellFee(FEE_PRE, t);
            r.swapsB += _arbToward(keyB, arbB, stockIsToken0, pOpen, fee);
        }

        // ---- settle the books: collect fees, then take the principal back
        (uint256 feeStockA, uint256 feeUsdgA, uint256 outStockA, uint256 outUsdgA) = _exitA(lpA, keyA, tickLower, tickUpper, liquidity, stockIsToken0);
        (uint256 feeStockB, uint256 feeUsdgB, uint256 outStockB, uint256 outUsdgB) = _exitB(hook, tokenId, keyB, stock, stockIsToken0);
        r.feesA = int256(_value(feeStockA, feeUsdgA, pOpen));
        r.feesB = int256(_value(feeStockB, feeUsdgB, pOpen));
        r.lpNetA = int256(_value(outStockA, outUsdgA, pOpen)) - int256(_value(heldStockA, heldUsdgA, pOpen));
        r.lpNetB = int256(_value(outStockB, outUsdgB, pOpen)) - int256(_value(heldStockB, heldUsdgB, pOpen));
        r.arbA = int256(_arbValue(stock, arbA, pOpen)) - int256(arbA0);
        r.arbB = int256(_arbValue(stock, arbB, pOpen)) - int256(arbB0);
        clock = openTs + 1 days;
        vm.warp(clock);
    }

    // ------------------------------------------------------------------ BELL pool

    function _createBellPool(ReplayToken stock, bytes32 stockAsset, bool stockIsToken0, uint160 sqrtClose, int24 tickLower, int24 tickUpper, uint128 liquidity)
        internal returns (BellHook hook, uint256 tokenId, uint256 heldStock, uint256 heldUsdg)
    {
        _admit(stockAsset, address(stock), true, 18);
        // the quote asset's health sample ages as the replay clock moves on, so refresh it for every pool
        sessions.setHealth(usdgAsset, HealthView(true, 0, uint64(clock - 3600), uint64(clock + 365 days), uint64(clock - 60), uint64(clock - 30)));
        calendar.setLeaf(CalendarLeaf(stockAsset, 2026, 0, uint64(clock - 3600), uint64(clock + 30 days), 2, bytes32(uint256(1))));
        calendar.setLeaf(CalendarLeaf(usdgAsset, 2026, 0, uint64(clock - 3600), uint64(clock + 30 days), 2, bytes32(uint256(1))));
        (address token0, address token1) = stockIsToken0 ? (address(stock), address(usdg)) : (address(usdg), address(stock));
        (bytes32 asset0, bytes32 asset1) = stockIsToken0 ? (stockAsset, usdgAsset) : (usdgAsset, stockAsset);
        uint256[2] memory seed;
        {
            uint256 a0 = SqrtPriceMath.getAmount0Delta(sqrtClose, TickMath.getSqrtPriceAtTick(tickUpper), liquidity, true);
            uint256 a1 = SqrtPriceMath.getAmount1Delta(TickMath.getSqrtPriceAtTick(tickLower), sqrtClose, liquidity, true);
            seed = [a0, a1];
        }
        PoolConfig memory c = _config(token0, token1, asset0, asset1, address(factory),
            [uint128(seed[0] * TRADE_CAP_BPS / 10_000), uint128(seed[1] * TRADE_CAP_BPS / 10_000)],
            [uint128(seed[0] * WINDOW_CAP_BPS / 10_000), uint128(seed[1] * WINDOW_CAP_BPS / 10_000)],
            [uint128(seed[0] * TRADE_CAP_BPS / 10_000 * 2), uint128(seed[1] * TRADE_CAP_BPS / 10_000 * 2)]);
        CreateRequest memory q = CreateRequest(c, bytes32(0), factory.nonces(address(this)), uint64(clock + 1 hours), LP_B, sqrtClose, tickLower, tickUpper, liquidity,
            [uint128(seed[0] + seed[0] / 10 + 1), uint128(seed[1] + seed[1] / 10 + 1)], uint128(factory.serviceFee()));
        stock.mint(address(this), seed[stockIsToken0 ? 0 : 1] * 2);
        stock.approve(address(factory), type(uint256).max);
        q.salt = _mine(q);
        CreateResult memory res = factory.createAndSeed(q);
        hook = BellHook(res.hook);
        tokenId = res.tokenId;
        (heldStock, heldUsdg) = stockIsToken0 ? (uint256(res.seedPrincipal[0]), uint256(res.seedPrincipal[1])) : (uint256(res.seedPrincipal[1]), uint256(res.seedPrincipal[0]));
    }

    function _closeMarket(BellHook hook, bytes32 stockAsset, uint256 pClose, uint256 closeTs, uint256 openTs) internal {
        CalendarLeaf memory closed = CalendarLeaf(stockAsset, 2026, 1, uint64(closeTs), uint64(openTs), 5, bytes32(uint256(1)));
        calendar.setLeaf(closed);
        calendar.setNextLeaf(CalendarLeaf(stockAsset, 2026, 2, uint64(openTs), uint64(openTs + 5 hours + 30 minutes), 1, bytes32(uint256(1))));
        calendar.setLeaf(CalendarLeaf(usdgAsset, 2026, 1, uint64(closeTs), uint64(openTs), 5, bytes32(uint256(1))));
        bytes32 boundary = CalendarProof.hashLeaf(block.chainid, address(calendar), closed);
        // the anchor BELL's keeper captures at the close: the Friday close price
        Anchor memory anchor = Anchor(stockAsset, boundary, uint128(pClose * 1e12), 1e18, uint64(closeTs), uint64(closeTs - 1), uint64(closeTs - 1), uint64(closeTs), bytes32(uint256(1)));
        sessions.setAnchor(stockAsset, boundary, anchor, true, 0, uint64(openTs + 1 days));
        hook.refreshState();
    }

    function _openMarket(BellHook hook, bytes32 stockAsset, uint256 openTs) internal {
        calendar.setLeaf(CalendarLeaf(stockAsset, 2026, 2, uint64(openTs), uint64(openTs + 5 hours + 30 minutes), 1, bytes32(uint256(1))));
        calendar.setLeaf(CalendarLeaf(usdgAsset, 2026, 2, uint64(openTs), uint64(openTs + 5 hours + 30 minutes), 1, bytes32(uint256(1))));
        // a keeper checkpoints the hook twice, at least sixty seconds apart, before it trades again
        _refreshHealth(stockAsset);
        hook.refreshState();
        vm.warp(clock = openTs + 61);
        _refreshHealth(stockAsset);
        hook.refreshState();
    }

    // ------------------------------------------------------------------ the auction orders

    uint256 internal constant ARB_ORDER_USD = 5_000e6;

    /// @dev The arbitrage agent quotes both sides at the open price. Random participants add buy and sell orders whose limits sit
    ///      within 1% of the open. The count is REPLAY_RANDOM_ORDERS (default 8, at most 23): real volume may be smaller.
    function _auctionOrders(BellOpeningAuction auction, ReplayToken stock, uint256 index, uint256 pOpen) internal returns (uint256 count) {
        uint256 priceX96Open = FullMath.mulDiv(pOpen, 1 << 96, 1e18);
        _placeOrder(auction, stock, address(uint160(0xA0000)), false, FullMath.mulDiv(ARB_ORDER_USD, 1e18, pOpen), uint160(priceX96Open));
        _placeOrder(auction, stock, address(uint160(0xA0001)), true, ARB_ORDER_USD, uint160(priceX96Open));
        count = 2;
        uint256 random = vm.envOr("REPLAY_RANDOM_ORDERS", uint256(8));
        if (random > 23) random = 23;
        for (uint256 k; k < random; ++k) {
            uint256 seed = uint256(keccak256(abi.encode(index, k)));
            bool buyer = seed & 1 == 1;
            uint256 notional = 600e6 + (seed >> 8) % 4_400e6;
            uint256 deviation = (seed >> 72) % 100; // basis points away from the open price
            uint256 limitUsd = buyer ? pOpen * (10_000 + deviation) / 10_000 : pOpen * (10_000 - deviation) / 10_000;
            uint160 limitX96 = uint160(FullMath.mulDiv(limitUsd, 1 << 96, 1e18));
            _placeOrder(auction, stock, address(uint160(0xB0000 + k)), buyer, buyer ? notional : FullMath.mulDiv(notional, 1e18, pOpen), limitX96);
            ++count;
        }
    }

    function _placeOrder(BellOpeningAuction auction, ReplayToken stock, address who, bool buyer, uint256 amountIn, uint160 limitX96) internal {
        if (buyer) { usdg.mint(who, amountIn); } else { stock.mint(who, amountIn); }
        vm.startPrank(who);
        (buyer ? usdg : stock).approve(address(auction), amountIn);
        auction.submitOrder(buyer, uint128(amountIn), limitX96);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ the arbitrageur

    /// @dev Move `key`'s price toward `pTarget` as far as is profitable at `feeUnits`, in as few swaps as the pool allows.
    ///      A swap the hook refuses (a flow cap) is retried at half the size. Returns the number of swaps that executed.
    function _arbToward(PoolKey memory key, ReplayRouter who, bool stockIsToken0, uint256 pTarget, uint256 feeUnits) internal returns (uint256 done) {
        for (uint256 round; round < 12; ++round) {
            (uint160 sqrtNow,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
            uint256 pNow = _priceUsd(sqrtNow, stockIsToken0);
            bool buyStock; uint256 pStop;
            if (pNow < pTarget) { buyStock = true; pStop = pTarget * (1_000_000 - feeUnits) / 1_000_000; if (pNow >= pStop) return done; }
            else { buyStock = false; pStop = pTarget * 1_000_000 / (1_000_000 - feeUnits); if (pNow <= pStop) return done; }
            uint160 limit = _sqrtPrice(pStop, stockIsToken0);
            bool zeroForOne = buyStock ? !stockIsToken0 : stockIsToken0;
            // the input needed to reach the limit, plus the fee, from the pool's liquidity
            uint128 liq = IPoolManager(address(manager)).getLiquidity(key.toId());
            uint256 amount = _inputToLimit(sqrtNow, limit, liq, zeroForOne, feeUnits);
            if (amount == 0) return done;
            bool ok;
            for (uint256 tries; tries < 14 && amount > 0; ++tries) {
                try who.swap(key, zeroForOne, -int256(amount), limit) returns (BalanceDelta) { ok = true; ++done; break; }
                catch (bytes memory err) {
                    ++revertCount;
                    if (err.length >= 4) {
                        bytes4 sel; assembly ("memory-safe") { sel := mload(add(err, 32)) }
                        if (sel == bytes4(0x90bfb865) && err.length >= 4 + 32 * 4) {
                            // PoolManager WrappedError(address target, bytes4 selector, bytes reason, bytes details): take the reason's own selector
                            bytes4 inner;
                            assembly ("memory-safe") {
                                let off := mload(add(err, 100))          // offset of `reason` inside the args (args start at err + 36)
                                inner := mload(add(add(err, 68), off))
                            }
                            sel = inner;
                            uint256 bits;
                            assembly ("memory-safe") { bits := mload(add(add(add(err, 68), mload(add(err, 100))), 4)) }
                            lastReasonBits = bits;
                        }
                        lastRevert = sel;
                    }
                    amount /= 2;
                }
            }
            if (!ok) return done; // the hook will not take any size right now
        }
    }

    function _inputToLimit(uint160 sqrtNow, uint160 limit, uint128 liq, bool zeroForOne, uint256 feeUnits) internal pure returns (uint256) {
        uint256 net = zeroForOne ? SqrtPriceMath.getAmount0Delta(limit, sqrtNow, liq, true) : SqrtPriceMath.getAmount1Delta(sqrtNow, limit, liq, true);
        return net * 1_000_000 / (1_000_000 - feeUnits) + 1;
    }

    function _bellFee(uint256 base, uint256 elapsed) internal pure returns (uint256) {
        uint256 remaining = elapsed >= BELL_FEE_SECONDS ? 0 : BELL_FEE_SECONDS - elapsed;
        return base + ((10_000 - base) * remaining + BELL_FEE_SECONDS - 1) / BELL_FEE_SECONDS;
    }

    // ------------------------------------------------------------------ exits

    function _exitA(ReplayRouter lp, PoolKey memory key, int24 lo, int24 hi, uint128 liquidity, bool stockIsToken0)
        internal returns (uint256 feeStock, uint256 feeUsdg, uint256 outStock, uint256 outUsdg)
    {
        (, BalanceDelta fees) = lp.modify(key, ModifyLiquidityParams(lo, hi, 0, bytes32(0))); // collect fees only
        (feeStock, feeUsdg) = _amounts(fees, stockIsToken0);
        (BalanceDelta all,) = lp.modify(key, ModifyLiquidityParams(lo, hi, -int256(uint256(liquidity)), bytes32(0)));
        (uint256 principalStock, uint256 principalUsdg) = _amounts(all, stockIsToken0);
        (outStock, outUsdg) = (feeStock + principalStock, feeUsdg + principalUsdg); // fees were taken in the first call
    }

    function _exitB(BellHook hook, uint256 tokenId, PoolKey memory key, ReplayToken stock, bool stockIsToken0)
        internal returns (uint256 feeStock, uint256 feeUsdg, uint256 outStock, uint256 outUsdg)
    {
        uint256 s0 = stock.balanceOf(LP_B); uint256 u0 = usdg.balanceOf(LP_B);
        _decrease(tokenId, 0, key);
        feeStock = stock.balanceOf(LP_B) - s0; feeUsdg = usdg.balanceOf(LP_B) - u0;
        uint128 liq = positions.getPositionLiquidity(tokenId);
        _decrease(tokenId, liq, key);
        outStock = stock.balanceOf(LP_B) - s0; outUsdg = usdg.balanceOf(LP_B) - u0;
        hook; stockIsToken0;
    }

    function _decrease(uint256 tokenId, uint256 liquidity, PoolKey memory key) internal {
        bytes[] memory p = new bytes[](2);
        p[0] = abi.encode(tokenId, liquidity, uint128(0), uint128(0), bytes(""));
        p[1] = abi.encode(key.currency0, key.currency1, LP_B);
        bytes memory data = abi.encode(abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR)), p);
        vm.prank(LP_B);
        positions.modifyLiquidities(data, block.timestamp + 1 hours);
    }

    // ------------------------------------------------------------------ small helpers

    function _config(address t0, address t1, bytes32 a0, bytes32 a1, address factory_, uint128[2] memory trade, uint128[2] memory window, uint128[2] memory closure)
        internal view returns (PoolConfig memory c)
    {
        c.token0 = t0; c.token1 = t1; c.asset0 = a0; c.asset1 = a1;
        c.poolManager = address(manager); c.positionManager = address(positions); c.factory = factory_;
        c.assetRegistry = address(assets); c.calendarRegistry = address(calendar); c.safetyController = address(safety);
        c.poolClass = 1; c.liquidityMode = 0; c.referenceMode = 0; c.tickSpacing = SPACING;
        c.tradeCap = trade; c.windowCap = window; c.closureCap = closure;
        c.policyId = keccak256("replay-v1");
    }

    /// @dev What BELL's keeper does continuously: publish a fresh health sample for both legs of the pool.
    function _refreshHealth(bytes32 stockAsset) internal {
        HealthView memory h = HealthView(true, 0, uint64(clock - 3600), uint64(clock + 365 days), uint64(clock - 60), uint64(clock - 30));
        sessions.setHealth(stockAsset, h);
        sessions.setHealth(usdgAsset, h);
    }

    function _admit(bytes32 id, address token, bool stock, uint8 dec) internal {
        assets.admit(token, id);
        assets.setDescriptor(AssetDescriptor(id, token, stock, dec, 30, address(0), address(0), address(0), address(0), address(0), token.codehash, bytes32(uint256(1)), bytes32(uint256(1))));
        sessions.setHealth(id, HealthView(true, 0, uint64(clock - 3600), uint64(clock + 365 days), uint64(clock - 60), uint64(clock - 30)));
    }

    function _fund(ReplayToken stock, ReplayRouter a, ReplayRouter b) internal {
        stock.mint(address(a), 1e30); usdg.mint(address(a), 1e24);
        if (address(b) != address(a)) { stock.mint(address(b), 1e30); usdg.mint(address(b), 1e24); }
    }

    function _arbValue(ReplayToken stock, ReplayRouter who, uint256 pOpen) internal view returns (uint256) {
        return usdg.balanceOf(address(who)) + FullMath.mulDiv(stock.balanceOf(address(who)), pOpen, 1e18);
    }

    function _value(uint256 stockAmount, uint256 usdgAmount, uint256 pUsd) internal pure returns (uint256) {
        return usdgAmount + FullMath.mulDiv(stockAmount, pUsd, 1e18);
    }

    /// @dev What a modifyLiquidity or swap delta paid out (positive) or took in (negative), as magnitudes, split by token.
    function _amounts(BalanceDelta d, bool stockIsToken0) internal pure returns (uint256 stockAmount, uint256 usdgAmount) {
        int128 a0 = d.amount0(); int128 a1 = d.amount1();
        int256 s = stockIsToken0 ? a0 : a1; int256 u = stockIsToken0 ? a1 : a0;
        stockAmount = uint256(s < 0 ? -s : s); usdgAmount = uint256(u < 0 ? -u : u);
    }

    /// @dev sqrtPriceX96 for a stock price in USDG 1e-6 units per whole stock, given which token is token0.
    function _sqrtPrice(uint256 pUsd6, bool stockIsToken0) internal pure returns (uint160) {
        uint256 ratioX192 = stockIsToken0 ? FullMath.mulDiv(pUsd6, 1 << 192, 1e18) : FullMath.mulDiv(1e18, 1 << 192, pUsd6);
        return uint160(_sqrt(ratioX192));
    }

    function _priceUsd(uint160 sqrtP, bool stockIsToken0) internal pure returns (uint256) {
        uint256 raw = FullMath.mulDiv(uint256(sqrtP), uint256(sqrtP), 1 << 64); // ratio * 2^128
        return stockIsToken0 ? FullMath.mulDiv(raw, 1e18, 1 << 128) : FullMath.mulDiv(1e18, 1 << 128, raw);
    }

    function _range(uint256 pClose, bool stockIsToken0) internal pure returns (int24 lo, int24 hi) {
        int24 a = TickMath.getTickAtSqrtPrice(_sqrtPrice(pClose * RANGE_DOWN_BPS / 10_000, stockIsToken0));
        int24 b = TickMath.getTickAtSqrtPrice(_sqrtPrice(pClose * RANGE_UP_BPS / 10_000, stockIsToken0));
        (int24 x, int24 y) = a < b ? (a, b) : (b, a);
        lo = (x / SPACING) * SPACING - (x < 0 && x % SPACING != 0 ? SPACING : int24(0));
        hi = (y / SPACING) * SPACING + (y > 0 && y % SPACING != 0 ? SPACING : int24(0));
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2; y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    function _mine(CreateRequest memory q) internal view returns (bytes32) {
        PoolKey memory key = PoolKey(Currency.wrap(q.config.token0), Currency.wrap(q.config.token1), LPFeeLibrary.DYNAMIC_FEE_FLAG, SPACING, IHooks(address(0)));
        bytes32 initHash = deployer.initCodeHash(q.config, key);
        bytes memory namespace = abi.encode(block.chainid, address(factory), address(this), q.nonce, bytes32(0));
        bytes memory preimage = abi.encodePacked(bytes1(0xff), address(deployer), bytes32(0), initHash);
        for (uint256 i; i < 400000; ++i) {
            bytes32 digest;
            assembly ("memory-safe") {
                mstore(add(namespace, 160), i)
                let salt := keccak256(add(namespace, 32), 160)
                mstore(add(preimage, 53), salt)
                digest := keccak256(add(preimage, 32), 85)
            }
            if (uint160(uint256(digest)) & 0x3fff == 0x2cc0) return bytes32(i);
        }
        revert("salt search");
    }

    // ------------------------------------------------------------------ csv formatting

    function _usd4(uint256 e4) internal pure returns (string memory) {
        return string.concat(vm.toString(e4 / 1e4), ".", _pad(e4 % 1e4, 4));
    }
    function _usd6(int256 v) internal pure returns (string memory) {
        bool neg = v < 0; uint256 m = uint256(neg ? -v : v);
        return string.concat(neg ? "-" : "", vm.toString(m / 1e6), ".", _pad(m % 1e6, 6));
    }
    function _pct(int256 v, int256 base) internal pure returns (string memory) {
        int256 bps = v * 1_000_000 / base; // percent with 4 decimals, as an integer of 1e-4 percent
        bool neg = bps < 0; uint256 m = uint256(neg ? -bps : bps);
        return string.concat(neg ? "-" : "", vm.toString(m / 10_000), ".", _pad(m % 10_000, 4));
    }
    function _pad(uint256 v, uint256 width) internal pure returns (string memory) {
        string memory s = vm.toString(v);
        while (bytes(s).length < width) s = string.concat("0", s);
        return s;
    }
}
