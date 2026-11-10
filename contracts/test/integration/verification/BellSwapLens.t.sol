// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellSwapLens} from "../../../src/BellSwapLens.sol";
import {IBellSwapLens} from "../../../src/interfaces/IBellSwapLens.sol";
import {IBellErrors} from "../../../src/interfaces/ProtocolEvents.sol";
import {BellHook} from "../../../src/BellHook.sol";
import {BellHookV2} from "../../../src/BellHookV2.sol";
import {BellOpeningAuction} from "../../../src/auction/BellOpeningAuction.sol";
import {BellAuctionRegistry} from "../../../src/auction/BellAuctionRegistry.sol";
import {BellPolicyOracle} from "../../../src/BellPolicyOracle.sol";
import {BellModeEvaluator} from "../../../src/BellModeEvaluator.sol";
import {FlowBudget} from "../../../src/libraries/FlowBudget.sol";
import {ClosureBudget} from "../../../src/libraries/ClosureBudget.sol";
import {
    CalendarLeaf,
    CreateResult,
    CreateRequest,
    PoolConfig,
    AssetDescriptor,
    HealthView
} from "../../../src/types/ProtocolTypes.sol";
import {BellHookDeployerV2} from "../../../src/BellHookDeployerV2.sol";
import {BellPoolFactory} from "../../../src/BellPoolFactory.sol";
import {BellAuctionFactoryModule} from "../../../src/auction/BellAuctionFactoryModule.sol";
import {IBellHookDeployer} from "../../../src/interfaces/IBellHookDeployer.sol";
import {FactoryToken, FactoryPermit2, FactoryAdmission} from "../factory/BellPoolFactory.t.sol";
import {MockCalendarRegistry, MockSafetyController, MockSessionRegistry} from "../../unit/hook/BellHookLifecycle.t.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Pool} from "@uniswap/v4-core/src/libraries/Pool.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PositionManager} from "../../../lib/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "../../../lib/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "../../../lib/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

interface VmLens {
    function warp(uint256) external;
    function prank(address) external;
    function getNonce(address) external view returns (uint64);
    function computeCreateAddress(address, uint256) external pure returns (address);
    function mockCall(address, bytes calldata, bytes calldata) external;
    function mockCallRevert(address, bytes calldata, bytes calldata) external;
    function clearMockedCalls() external;
}

/// @dev Synthetic reference boundary; admission binds the stock token and real oracle/evaluator
/// policy/price-path logic consumes these fixed reference prices throughout the regression tests.
contract LensReference {
    address public immutable stockToken;

    constructor(address token) {
        stockToken = token;
    }

    function referencePrice() external pure returns (uint128) {
        return 1e18;
    }
}

/// @dev Real factory, HookV2, oracle, evaluator, PoolManager and PositionManager.
/// The reused factory fixture supplies synthetic admission/calendar/health and Permit2.
contract BellSwapLensTest is IUnlockCallback {
    using BalanceDeltaLibrary for BalanceDelta;
    VmLens private constant lensVm = VmLens(address(uint160(uint256(keccak256("hevm cheat code")))));
    BellSwapLens private lens;
    BellHook private poolHook;
    bytes32 private id;
    bool private initialized;
    BellPoolFactory private factory;
    PoolManager private manager;
    FactoryToken private token0;
    FactoryToken private token1;
    FactoryAdmission private assets;
    MockSessionRegistry private sessions;
    CreateRequest private request;

    function setUp() external {
        lensVm.warp(10000);
        manager = new PoolManager(address(this));
        FactoryPermit2 permit2 = new FactoryPermit2();
        PositionManager positions = new PositionManager(
            manager, IAllowanceTransfer(address(permit2)), 100000, IPositionDescriptor(address(0)), IWETH9(address(0))
        );
        FactoryToken a = new FactoryToken();
        FactoryToken b = new FactoryToken();
        (token0, token1) = address(a) < address(b) ? (a, b) : (b, a);
        FactoryToken usdg = new FactoryToken();
        assets = new FactoryAdmission();
        sessions = new MockSessionRegistry();
        MockCalendarRegistry calendar = new MockCalendarRegistry();
        MockSafetyController safety = new MockSafetyController();
        BellPolicyOracle oracle = new BellPolicyOracle();
        BellModeEvaluator evaluator = new BellModeEvaluator();
        address future = lensVm.computeCreateAddress(address(this), lensVm.getNonce(address(this)) + 3);
        BellAuctionRegistry registry = new BellAuctionRegistry(future);
        BellAuctionFactoryModule module =
            new BellAuctionFactoryModule(future, address(registry), address(usdg), 600, 900, 512, 25, 100);
        IBellHookDeployer deployer = IBellHookDeployer(
            address(
                new BellHookDeployerV2(
                    future,
                    address(sessions),
                    keccak256(type(BellHookV2).creationCode),
                    address(oracle),
                    address(evaluator),
                    address(registry),
                    address(module)
                )
            )
        );
        PoolConfig memory c = PoolConfig(
            address(token0),
            address(token1),
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            address(manager),
            address(positions),
            future,
            address(assets),
            address(calendar),
            address(safety),
            address(0),
            1,
            0,
            0,
            60,
            [uint128(10), uint128(10)],
            [uint128(100), uint128(100)],
            [uint128(1), uint128(1)],
            keccak256("lens-fixture"),
            address(0),
            address(0)
        );
        factory = new BellPoolFactory(c, deployer, address(usdg), address(0xFEE));
        require(address(factory) == future, "factory address");
        for (uint256 i; i < 2; ++i) {
            FactoryToken token = i == 0 ? token0 : token1;
            bytes32 asset = i == 0 ? c.asset0 : c.asset1;
            assets.admit(address(token), asset);
            assets.setDescriptor(
                AssetDescriptor(
                    asset,
                    address(token),
                    i == 0,
                    6,
                    30,
                    address(0),
                    address(0),
                    address(0),
                    address(0),
                    address(0),
                    address(token).codehash,
                    bytes32(uint256(1)),
                    bytes32(uint256(1))
                )
            );
            sessions.setHealth(asset, HealthView(true, 0, 9000, 20000, 9900, 9950));
            calendar.setLeaf(CalendarLeaf(asset, 2026, 0, 9000, 20000, 2, keccak256("fixture")));
            token.mint(address(this), 1e9);
            token.approve(address(factory), type(uint256).max);
        }
        usdg.mint(address(this), 1e9);
        usdg.approve(address(factory), type(uint256).max);
        request = CreateRequest(
            c,
            bytes32(0),
            0,
            10100,
            address(0xBEEF),
            uint160(1 << 96),
            -120,
            120,
            1000000,
            [uint128(10000), uint128(10000)],
            49e6
        );
        request.salt = _mine();
    }

    function _mine() private view returns (bytes32) {
        PoolKey memory key = PoolKey(
            Currency.wrap(request.config.token0),
            Currency.wrap(request.config.token1),
            LPFeeLibrary.DYNAMIC_FEE_FLAG,
            60,
            IHooks(address(0))
        );
        IBellHookDeployer deployer = factory.hookDeployer();
        bytes32 initHash = deployer.initCodeHash(request.config, key);
        bytes memory ns = abi.encode(block.chainid, address(factory), address(this), request.nonce, bytes32(0));
        bytes memory cp = abi.encodePacked(bytes1(0xff), address(deployer), bytes32(0), initHash);
        for (uint256 i; i < 200000; ++i) {
            bytes32 digest;
            assembly ("memory-safe") {
                mstore(add(ns, 160), i)
                mstore(add(cp, 53), keccak256(add(ns, 32), 160))
                digest := keccak256(add(cp, 32), 85)
            }
            if (uint160(uint256(digest)) & 0x3fff == 0x2cc0) return bytes32(i);
        }
        revert("salt search");
    }

    // Each test configures the request before the atomic factory creation when needed.
    function _init() private {
        if (initialized) return;
        sessions.setHealth(request.config.asset1, HealthView(true, 0, 9000, 20000, 9900, 9950));
        CreateResult memory created = factory.createAndSeed(request);
        poolHook = BellHook(created.hook);
        id = created.poolId;
        lens = new BellSwapLens(created.hook);
        initialized = true;
        // Opening Bell fee decays to the ordinary session fee after five minutes.
        lensVm.warp(10400);
    }

    function testLensRegularBothDirectionsMatchesCore() external {
        _init();
        _parity(true, 3, true, bytes4(0));
        _parity(false, 3, true, bytes4(0));
        IBellSwapLens.SwapStatus memory s = lens.getSwapStatus(id, true, 3);
        require(s.session == 2 && s.currentFeePips == 500, "regular session fee");
        require(s.maxIn0 == 10 && s.maxIn1 == 10 && s.nextTransition == 20000, "regular limits/calendar");
    }

    function testLensClosedBothDirectionsMatchesCore() external {
        _init();
        MockCalendarRegistry(request.config.calendarRegistry)
            .setLeaf(CalendarLeaf(request.config.asset0, 2026, 1, 10400, 20000, 5, keccak256("closed")));
        // Closure requires its persistent latch before a swap is admitted.
        _parity(true, 3, false, BellPolicyOracle.PolicyBlocked.selector);
        poolHook.refreshState();
        _parity(true, 3, false, FlowBudget.TradeCapExceeded.selector);
        _parity(false, 3, false, FlowBudget.TradeCapExceeded.selector);
        IBellSwapLens.SwapStatus memory s = lens.getSwapStatus(id, true, 3);
        require(s.session == 5 && s.currentFeePips == 10000 && s.maxIn0 == 1, "closed fee/episode cap");
    }

    function testLensUnknownBothDirectionsMatchesCore() external {
        _init();
        MockCalendarRegistry(request.config.calendarRegistry).clearLeaf(request.config.asset0);
        _parity(true, 3, false, BellPolicyOracle.PolicyBlocked.selector);
        _parity(false, 3, false, BellPolicyOracle.PolicyBlocked.selector);
        IBellSwapLens.SwapStatus memory s = lens.getSwapStatus(id, true, 3);
        require(s.session == 0 && s.maxIn0 == 0 && s.maxIn1 == 0 && s.nextTransition == 0, "unknown fail closed");
    }

    function testLensOverCapBothDirectionsMatchesCore() external {
        _init();
        _parity(true, 11, false, FlowBudget.TradeCapExceeded.selector);
        _parity(false, 11, false, FlowBudget.TradeCapExceeded.selector);
    }

    function testLensZeroAmountMatchesCore() external {
        _init();
        _parity(true, 0, false, IPoolManager.SwapAmountCannotBeZero.selector);
    }

    function _initPriceGuarded() private {
        request.config.poolClass = 0;
        request.config.referenceAdapter0 = address(new LensReference(address(token0)));
        request.config.referenceAdapter1 = address(new LensReference(address(0)));
        request.salt = _mine();
        _init();
        _parity(true, 3, true, bytes4(0));
    }

    function _badDecimals(uint8 kind) private {
        bytes memory selector = abi.encodeWithSignature("decimals()");
        // Alter only the external token read, retaining real policy, quote and swap execution.
        // This also keeps the admitted code fingerprint intact, isolating error precedence.
        if (kind == 0) {
            lensVm.mockCallRevert(
                address(token0), selector, abi.encodeWithSignature("Error(string)", "decimals unavailable")
            );
        } else if (kind == 1) {
            lensVm.mockCall(address(token0), selector, hex"01");
        } else {
            lensVm.mockCall(address(token0), selector, abi.encode(uint256(19)));
        }
    }

    function testLensPriceGuardedBadDecimalsOrdinaryAmountMatchesCore() external {
        _initPriceGuarded();
        for (uint8 kind; kind < 3; ++kind) {
            _badDecimals(kind);
            _parity(true, 3, false, IBellErrors.BadConfig.selector);
            _parity(false, 3, false, IBellErrors.BadConfig.selector);
            require(lens.getSwapStatus(id, true, 3).currentFeePips == 0, "unavailable fee must not be invented");
            lensVm.clearMockedCalls();
        }
    }

    function testLensPriceGuardedBadDecimalsAuctionActiveMatchesCore() external {
        _initPriceGuarded();
        BellOpeningAuction auction = new BellOpeningAuction(
            address(factory),
            address(poolHook),
            request.config.calendarRegistry,
            request.config.asset0,
            address(token1),
            address(token0),
            600,
            900,
            512,
            1,
            1,
            25
        );
        address registry = BellHookV2(address(poolHook)).auctionRegistry();
        address module = BellHookDeployerV2(address(factory.hookDeployer())).auctionFactoryModule();
        // Current factory policy omits PRICE_GUARDED auctions. Bind at the registry boundary
        // to test HookV2's independent guard with a real auction rather than mocking its outcome.
        lensVm.prank(module);
        BellAuctionRegistry(registry).setAuction(id, address(auction));
        MockCalendarRegistry calendar = MockCalendarRegistry(request.config.calendarRegistry);
        CalendarLeaf memory next = CalendarLeaf(request.config.asset0, 2026, 2, 11500, 20000, 1, keccak256("pre"));
        calendar.setLeaf(CalendarLeaf(request.config.asset0, 2026, 1, 10400, 11500, 5, keccak256("close")));
        calendar.setNextLeaf(next);
        require(auction.armNext(), "arm real auction");
        lensVm.warp(11500);
        calendar.setLeaf(next);
        // A real LOCKED auction blocks swaps while PRE policy still has live reference prices.
        require(auction.blocksSwaps(), "auction must block before token read");
        for (uint8 kind; kind < 3; ++kind) {
            _badDecimals(kind);
            _parity(true, 3, false, BellHookV2.AuctionActive.selector);
            _parity(false, 3, false, BellHookV2.AuctionActive.selector);
            // Core's zero check precedes even an active auction.
            _parity(true, 0, false, IPoolManager.SwapAmountCannotBeZero.selector);
            lensVm.clearMockedCalls();
        }
    }

    function testLensPriceGuardedBadDecimalsZeroAmountMatchesCore() external {
        _initPriceGuarded();
        for (uint8 kind; kind < 3; ++kind) {
            _badDecimals(kind);
            _parity(true, 0, false, IPoolManager.SwapAmountCannotBeZero.selector);
            _parity(false, 0, false, IPoolManager.SwapAmountCannotBeZero.selector);
            lensVm.clearMockedCalls();
        }
    }

    function testLensClosedAllowedAndEpisodeExhaustionMatchesCore() external {
        request.config.tradeCap = [uint128(1000), uint128(1000)];
        request.config.windowCap = [uint128(10000), uint128(10000)];
        request.config.closureCap = [uint128(100), uint128(100)];
        request.salt = _mine();
        _init();
        MockCalendarRegistry(request.config.calendarRegistry)
            .setLeaf(CalendarLeaf(request.config.asset0, 2026, 1, 10400, 20000, 5, keccak256("closed")));
        poolHook.refreshState();
        _parity(true, 3, true, bytes4(0));
        _parity(false, 3, true, bytes4(0));
        _parity(true, 101, false, ClosureBudget.EpisodeBudgetExceeded.selector);
        require(lens.getSwapStatus(id, true, 3).maxIn0 == 100, "finite closure budget");
    }

    function testLensOutputSideCapMatchesCore() external {
        request.config.tradeCap[1] = 1;
        request.salt = _mine();
        _init();
        _parity(true, 3, true, bytes4(0));
        _parity(true, 4, false, FlowBudget.TradeCapExceeded.selector);
    }

    function testLensExtendedSessionFeesAndCapsMatchCore() external {
        _init();
        for (uint8 phase = 1; phase <= 4; ++phase) {
            if (phase == 2) continue;
            MockCalendarRegistry(request.config.calendarRegistry)
                .setLeaf(CalendarLeaf(request.config.asset0, 2026, phase, 10400, 20000, phase, keccak256("extended")));
            _parity(true, 3, phase != 4, phase == 4 ? FlowBudget.TradeCapExceeded.selector : bytes4(0));
            IBellSwapLens.SwapStatus memory s = lens.getSwapStatus(id, true, 3);
            require(s.session == phase && s.currentFeePips == (phase == 4 ? 5000 : 3000), "extended fee");
            require(s.maxIn0 == (phase == 4 ? 2 : 5), "extended trade scaling");
        }
    }

    function testLensPartialFillAcrossLiquidityBoundaryMatchesCore() external {
        request.config.tradeCap = [uint128(7000), uint128(7000)];
        request.config.windowCap = [uint128(70000), uint128(70000)];
        request.config.closureCap = [uint128(100), uint128(100)];
        request.salt = _mine();
        _init();
        // v4 exhausts the seeded range first: actual input is below 7,000, despite 20,000 specified.
        _parity(true, 20000, true, bytes4(0));
        _parity(false, 20000, true, bytes4(0));
        this.executeLensSwap(true, 20000);
        _parity(true, 3, false, Pool.PriceLimitAlreadyExceeded.selector);
    }

    function testLensProtocolFeeCompositionMatchesCore() external {
        request.config.tradeCap = [uint128(1000), uint128(997)];
        request.config.windowCap = [uint128(10000), uint128(10000)];
        request.salt = _mine();
        _init();
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(poolHook.poolKey(), 1000);
        // At 1:1 and liquidity 1e6: combined fee leaves output 997; LP fee alone leaves 998.
        _parity(true, 1000, true, bytes4(0));
    }

    function testLensAuctionOpenAndLockedMatchesCore() external {
        _init();
        // The default fixture pair is not USDG, so its factory intentionally leaves the registry
        // unbound. Exercise a real auction/registry with the authorized module's one-time binding.
        BellOpeningAuction realAuction = new BellOpeningAuction(
            address(factory),
            address(poolHook),
            request.config.calendarRegistry,
            request.config.asset0,
            address(token1),
            address(token0),
            600,
            900,
            512,
            1,
            1,
            25
        );
        address registry = BellHookV2(address(poolHook)).auctionRegistry();
        address module = BellHookDeployerV2(address(factory.hookDeployer())).auctionFactoryModule();
        lensVm.prank(module);
        BellAuctionRegistry(registry).setAuction(id, address(realAuction));
        (, uint16 flags, bool hasAuction, address auctionAddress) = lens.getPoolInfo(id);
        require(flags == 0x2cc0 && hasAuction, "pool metadata");
        MockCalendarRegistry calendar = MockCalendarRegistry(request.config.calendarRegistry);
        calendar.setLeaf(CalendarLeaf(request.config.asset0, 2026, 1, 10400, 11500, 5, keccak256("close")));
        calendar.setNextLeaf(CalendarLeaf(request.config.asset0, 2026, 2, 11500, 20000, 1, keccak256("pre")));
        BellOpeningAuction auction = BellOpeningAuction(auctionAddress);
        require(auction.armNext(), "arm real auction");
        lensVm.warp(11000);
        _parity(true, 11, false, BellHookV2.AuctionActive.selector);
        _parity(false, 11, false, BellHookV2.AuctionActive.selector);
        require(lens.getSwapStatus(id, true, 3).auctionWindow, "collecting orders");
        lensVm.warp(11500);
        _parity(true, 3, false, BellHookV2.AuctionActive.selector);
        require(!lens.getSwapStatus(id, true, 3).auctionWindow, "locked is not collecting");
    }

    function testLensUnboundPoolFailsClosed() external {
        _init();
        bytes32 unknown = keccak256("unbound");
        IBellSwapLens.SwapStatus memory s = lens.getSwapStatus(unknown, true, 3);
        require(!s.allowed && s.reason == IBellSwapLens.PoolNotBound.selector, "unbound status");
        (address hook, uint16 flags, bool hasAuction, address auction) = lens.getPoolInfo(unknown);
        require(hook == address(0) && flags == 0 && !hasAuction && auction == address(0), "unbound metadata");
    }

    function testLensRollingBudgetAndExpiryMatchesCore() external {
        _init();
        for (uint256 i; i < 10; ++i) {
            this.executeLensSwap(true, 10);
        }
        _parity(false, 3, false, FlowBudget.WindowCapExceeded.selector);
        require(lens.getSwapStatus(id, true, 3).maxIn0 == 0, "spent rolling budget");
        lensVm.warp(11100);
        _parity(false, 3, true, bytes4(0));
        require(lens.getSwapStatus(id, true, 3).maxIn0 == 10, "expired rolling budget");
    }

    function _parity(bool direction, uint256 amount, bool expected, bytes4 expectedReason) private {
        IBellSwapLens.SwapStatus memory status = lens.getSwapStatus(id, direction, amount);
        (bool ok, bytes memory reason) = address(this).call(abi.encodeCall(this.simulateLensSwap, (direction, amount)));
        // Simulation always reverts to avoid spending budgets or moving the price.
        require(!ok, "simulation committed");
        bytes4 actualReason = bytes4(reason);
        bool actualAllowed = actualReason == SimulationSuccess.selector;
        if (actualAllowed) {
            actualReason = bytes4(0);
        } else if (actualReason == CustomRevert.WrappedError.selector) {
            (,, bytes memory inner,) = this.decodeLensWrapped(reason);
            actualReason = bytes4(inner);
        }
        require(actualAllowed == expected && actualReason == expectedReason, "unexpected core outcome");
        require(status.allowed == actualAllowed && status.reason == actualReason, "lens/core mismatch");
    }

    error SimulationSuccess();

    function simulateLensSwap(bool direction, uint256 amount) external {
        this.executeLensSwap(direction, amount);
        revert SimulationSuccess();
    }

    function executeLensSwap(bool direction, uint256 amount) external {
        require(msg.sender == address(this), "self only");
        manager.unlock(abi.encode(direction, amount));
    }

    function decodeLensWrapped(bytes calldata reason)
        external
        pure
        returns (address, bytes4, bytes memory, bytes memory)
    {
        return abi.decode(reason[4:], (address, bytes4, bytes, bytes));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager only");
        (bool direction, uint256 amount) = abi.decode(data, (bool, uint256));
        PoolKey memory key = poolHook.poolKey();
        BalanceDelta delta = manager.swap(
            key,
            SwapParams(
                direction, -int256(amount), direction ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            ""
        );
        for (uint256 i; i < 2; ++i) {
            Currency currency = i == 0 ? key.currency0 : key.currency1;
            int128 change = i == 0 ? delta.amount0() : delta.amount1();
            if (change < 0) {
                manager.sync(currency);
                if (i == 0) token0.transfer(address(manager), uint256(-int256(change)));
                else token1.transfer(address(manager), uint256(-int256(change)));
                manager.settle();
            } else if (change > 0) {
                manager.take(currency, address(this), uint128(change));
            }
        }
        return "";
    }
}
