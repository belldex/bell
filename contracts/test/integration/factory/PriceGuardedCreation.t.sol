// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellPoolFactory} from "../../../src/BellPoolFactory.sol";
import {BellHookDeployer} from "../../../src/BellHookDeployer.sol";
import {BellHook} from "../../../src/BellHook.sol";
import {BellPolicyOracle} from "../../../src/BellPolicyOracle.sol";
import {ChainlinkTokenReferenceAdapter} from "../../../src/adapters/ChainlinkTokenReferenceAdapter.sol";
import {PolicyConstants} from "../../../src/libraries/PolicyConstants.sol";
import {CalendarProof} from "../../../src/libraries/CalendarProof.sol";
import {CreateRequest, CreateResult, PoolConfig, AssetDescriptor, HealthView, CalendarLeaf, Anchor, Lifecycle, Mode, PoolClass, PolicyView} from "../../../src/types/ProtocolTypes.sol";
import {MockAssetRegistry, MockCalendarRegistry, MockSessionRegistry, MockSafetyController} from "../../unit/hook/BellHookLifecycle.t.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PositionManager} from "../../../lib/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "../../../lib/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "../../../lib/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {AggregatorV3Interface} from "../../../src/interfaces/AggregatorV3Interface.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface VmPriceGuard {
    function warp(uint256) external;
    function getNonce(address) external view returns (uint64);
    function computeCreateAddress(address,uint256) external pure returns (address);
    function prank(address) external;
}

/// @dev Fixed-answer Chainlink feed stub; the production adapter validates decimals on-chain.
contract GuardStubAggregator is AggregatorV3Interface {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public dec;
    bool public broken;

    constructor(int256 a, uint8 d) {
        answer = a;
        dec = d;
        updatedAt = block.timestamp;
    }

    function setBroken(bool value) external { broken = value; }
    function setUpdatedAt(uint256 value) external { updatedAt = value; }
    function setAnswer(int256 value) external { answer = value; }

    function decimals() external view returns (uint8) { return dec; }
    function description() external pure returns (string memory) { return "guard-stub"; }
    function version() external pure returns (uint256) { return 1; }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        if (broken) revert("feed down");
        return (1, answer, updatedAt, updatedAt, 1);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (broken) revert("feed down");
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract GuardToken is ERC20 {
    constructor() ERC20("Guard fixture", "GUARD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
    function oraclePaused() external pure returns (bool) { return false; }
}

contract GuardPermit2 {
    function approve(address, address, uint160, uint48) external {}
    function allowance(address, address, address) external pure returns (uint160, uint48, uint48) {
        return (type(uint160).max, type(uint48).max, 0);
    }
    function transferFrom(address from, address to, uint160 amount, address token) external {
        require(IERC20(token).transferFrom(from, to, amount), "transfer");
    }
}

contract GuardAdmission is MockAssetRegistry {
    mapping(address => bytes32) public descriptorIdForToken;
    function admit(address token, bytes32 id) external { descriptorIdForToken[token] = id; }
}

/// @dev Full create path for poolClass == PRICE_GUARDED against real core/periphery fixtures.
/// Every test proves the band gate and adapter bindings the factory itself enforces; they are not
/// evidence of feed authenticity (that stays a deployment-manifest trust boundary).
contract PriceGuardedCreationTest {
    VmPriceGuard private constant vm = VmPriceGuard(address(uint160(uint256(keccak256("hevm cheat code")))));

    BellPoolFactory internal factory;
    BellHookDeployer internal deployer;
    PoolManager internal manager;
    PositionManager internal positions;
    GuardPermit2 internal permit2;
    GuardToken internal token0;
    GuardToken internal token1;
    GuardToken internal usdg;
    GuardAdmission internal assets;
    MockSessionRegistry internal sessions;
    MockCalendarRegistry internal calendar;
    MockSafetyController internal safety;
    BellPolicyOracle internal oracle;
    ChainlinkTokenReferenceAdapter internal stockAdapter;
    ChainlinkTokenReferenceAdapter internal counterAdapter;
    CreateRequest internal request;

    // 8-decimal feeds; the counter feed answers with the same number so the reference ratio is
    // exactly 1.0 (raw), keeping the in-band initial price at 1<<96 inside the +-6000 tick range.
    int256 internal constant STOCK_ANSWER = 350_73393114;
    int256 internal constant COUNTER_ANSWER = 350_73393114;

    address internal constant RECIPIENT = address(0xBEEF);
    address internal constant SERVICE = address(0xFEE);

    function setUp() external {
        vm.warp(100_000);
        manager = new PoolManager(address(this));
        permit2 = new GuardPermit2();
        positions = new PositionManager(manager, IAllowanceTransfer(address(permit2)), 100000, IPositionDescriptor(address(0)), IWETH9(address(0)));
        GuardToken a = new GuardToken(); GuardToken b = new GuardToken();
        (token0, token1) = address(a) < address(b) ? (a,b) : (b,a);
        usdg = new GuardToken();
        assets = new GuardAdmission();
        sessions = new MockSessionRegistry();
        calendar = new MockCalendarRegistry();
        safety = new MockSafetyController();
        oracle = new BellPolicyOracle();

        // The stock side is decided by address ordering; bind each feed to its own token.
        GuardToken stock = token0;
        GuardToken counter = token1;
        counterAdapter = new ChainlinkTokenReferenceAdapter(
            address(new GuardStubAggregator(COUNTER_ANSWER, 8)), 86400, 8, "USD reference", address(0));
        stockAdapter = new ChainlinkTokenReferenceAdapter(
            address(new GuardStubAggregator(STOCK_ANSWER, 8)), 86400, 8, "stock reference", address(stock));

        address future = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        deployer = new BellHookDeployer(future, address(sessions), keccak256(type(BellHook).creationCode), address(oracle));
        PoolConfig memory c = _config(future);
        factory = new BellPoolFactory(c, deployer, address(usdg), SERVICE);
        require(address(factory) == future, "factory prediction");
        _admit(c.asset0, address(token0), true);
        _admit(c.asset1, address(token1), false);
        calendar.setLeaf(CalendarLeaf(c.asset0, 2026, 0, 90_000, 200_000, 2, keccak256("fixture")));
        request = CreateRequest(c, bytes32(0), 0, 100_100, RECIPIENT, _sqrtForPrice1e18(), -6000, 6000, 1000000,
            [uint128(10_000_000), uint128(10_000_000)], 49e6);
        request.salt = _mine(request);
        token0.mint(address(this), 10_000_000); token1.mint(address(this), 10_000_000); usdg.mint(address(this), 1e9);
        token0.approve(address(factory), type(uint256).max); token1.approve(address(factory), type(uint256).max);
        usdg.approve(address(factory), type(uint256).max);
    }

    function _config(address futureFactory) internal view returns (PoolConfig memory c) {
        c.token0 = address(token0); c.token1 = address(token1);
        c.asset0 = bytes32(uint256(1)); c.asset1 = bytes32(uint256(2));
        c.poolManager = address(manager); c.positionManager = address(positions); c.factory = futureFactory;
        c.assetRegistry = address(assets); c.calendarRegistry = address(calendar); c.safetyController = address(safety);
        c.treasuryAdapter = address(0); c.poolClass = uint8(PoolClass.PRICE_GUARDED);
        c.liquidityMode = 0; c.referenceMode = 0; c.tickSpacing = 60;
        c.tradeCap = [uint128(10), uint128(10)]; c.windowCap = [uint128(100), uint128(100)];
        c.closureCap = [uint128(1), uint128(1)]; c.policyId = keccak256("price-guarded");
        c.referenceAdapter0 = address(token0) < address(token1) ? address(stockAdapter) : address(counterAdapter);
        c.referenceAdapter1 = address(token0) < address(token1) ? address(counterAdapter) : address(stockAdapter);
    }

    /// @dev sqrtPrice for a reference ratio of exactly 1.0 raw (equal feeds, equal decimals):
    /// sqrtPriceX96 = 2^96. raw = (P0*10^d1)/(P1*10^d0) = 1.
    function _sqrtForPrice1e18() internal pure returns (uint160) {
        return uint160(1 << 96);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function testPriceGuardedCreationWithInBandPriceActivates() external {
        (address predicted,,) = factory.predict(request);
        CreateResult memory r = factory.createAndSeed(request);
        require(r.hook == predicted, "hook address");
        require(r.tokenId == 1 && r.liquidity == request.liquidity, "position");
        require(BellHook(r.hook).state().lifecycle == uint8(Lifecycle.LIVE), "not live");
        require(BellHook(r.hook).referenceAdapter0() == request.config.referenceAdapter0, "adapter0 not bound");
        require(BellHook(r.hook).referenceAdapter1() == request.config.referenceAdapter1, "adapter1 not bound");
        PolicyView memory policy = BellHook(r.hook).getPolicy();
        require(policy.referencePrice18[0] == 350_73393114 * 1e10, "stock reference missing");
        require(policy.referencePrice18[1] == 350_73393114 * 1e10, "counter reference missing");
        require(factory.nonces(address(this)) == 1, "nonce");
    }

    function testClosedMarketCreationStagesUntilValidOracleContextReturns() external {
        calendar.setLeaf(CalendarLeaf(request.config.asset0, 2026, 1, 90_000, 200_000,
            PolicyConstants.PHASE_CLOSED, keccak256("closed-fixture")));
        CreateResult memory r = factory.createAndSeed(request);
        require(BellHook(r.hook).state().lifecycle == uint8(Lifecycle.STAGED), "pool was not staged");
        require(!BellHook(r.hook).getPolicy().canSwap, "staged pool can swap");

        vm.warp(200_001);
        GuardStubAggregator(address(stockAdapter.feed())).setUpdatedAt(block.timestamp);
        GuardStubAggregator(address(counterAdapter.feed())).setUpdatedAt(block.timestamp);
        sessions.setHealth(request.config.asset0, HealthView(true, 0, 200_000, 300_000, 200_000, 200_001));
        calendar.setLeaf(CalendarLeaf(request.config.asset0, 2026, 2, 200_000, 300_000,
            PolicyConstants.PHASE_REGULAR, keccak256("open-fixture")));
        vm.warp(200_061);
        GuardStubAggregator(address(stockAdapter.feed())).setUpdatedAt(block.timestamp);
        GuardStubAggregator(address(counterAdapter.feed())).setUpdatedAt(block.timestamp);
        sessions.setHealth(request.config.asset0, HealthView(true, 0, 200_000, 300_000, 200_001, 200_061));
        GuardStubAggregator(address(stockAdapter.feed())).setAnswer(STOCK_ANSWER * 2);
        BellHook(r.hook).activateStagedPool();
        require(BellHook(r.hook).state().lifecycle == uint8(Lifecycle.STAGED), "out-of-band pool activated");
        GuardStubAggregator(address(stockAdapter.feed())).setAnswer(STOCK_ANSWER);
        PolicyView memory activated = BellHook(r.hook).activateStagedPool();
        require(BellHook(r.hook).state().lifecycle == uint8(Lifecycle.LIVE), "pool did not activate");
        require(activated.mode == uint8(Mode.ACTIVE) && activated.canSwap, "fresh open pool not tradable");
    }

    function testPriceGuardedPoolUsesVerifiedFrozenStockReferenceDuringClosure() external {
        CalendarLeaf memory closed = CalendarLeaf(request.config.asset0, 2026, 1, 100_000, 200_000,
            PolicyConstants.PHASE_CLOSED, keccak256("closed-fixture"));
        CalendarLeaf memory next = CalendarLeaf(request.config.asset0, 2026, 2, 200_000, 300_000,
            PolicyConstants.PHASE_REGULAR, keccak256("open-fixture"));
        calendar.setLeaf(closed);
        calendar.setNextLeaf(next);
        bytes32 boundary = CalendarProof.hashLeaf(block.chainid, address(calendar), closed);
        Anchor memory anchor = Anchor(request.config.asset0, boundary, uint128(uint256(STOCK_ANSWER) * 1e10),
            1e18, 99_995, 99_990, 99_990, closed.start, keccak256("close-anchor-source"));
        sessions.setAnchor(request.config.asset0, boundary, anchor, true, 0, 200_000);

        CreateResult memory r = factory.createAndSeed(request);
        require(BellHook(r.hook).state().lifecycle == uint8(Lifecycle.LIVE), "valid closed pool staged");
        PolicyView memory policy = BellHook(r.hook).getPolicy();
        require(policy.mode == uint8(Mode.CLOSED) && policy.canSwap, "verified close does not allow bounded swap");
        uint256 stockSide = address(token0) < address(token1) ? 0 : 1;
        require(policy.referencePrice18[stockSide] == anchor.price18, "frozen close price missing");
        require(policy.reasonBits == 0, "closed policy has blocking reason");
    }

    function testPriceGuardedUnpricedCounterassetUsesReferenceWithoutSessionHealth() external {
        // A regular priced counterasset (e.g. USDG) gets its independent price from the
        // PoolConfig Chainlink adapter. It must not need a stock-session health report.
        bytes32 counterAssetId = request.config.asset0 == bytes32(uint256(1))
            ? request.config.asset1
            : request.config.asset0;
        sessions.setHealth(counterAssetId, HealthView(false, 1, 0, 0, 0, 0));
        CreateResult memory r = factory.createAndSeed(request);
        require(BellHook(r.hook).state().lifecycle == uint8(Lifecycle.LIVE), "guarded priced-counter pool not live");
        require(factory.nonces(address(this)) == 1, "nonce");
    }

    function testOneFactoryCanCreateSessionOnlyAndPriceGuardedProfiles() external {
        // Deploy one factory from a neutral SESSION_ONLY profile, then use the same factory to
        // create both classes. Pool class/reference adapters are pool-specific, not factory-wide.
        PoolConfig memory session = request.config;
        session.poolClass = uint8(PoolClass.SESSION_ONLY);
        session.referenceAdapter0 = address(0);
        session.referenceAdapter1 = address(0);
        _redeploy(session);
        bytes32 sharedFactoryProfile = factory.profileHash();

        PoolConfig memory guarded = session;
        guarded.poolClass = uint8(PoolClass.PRICE_GUARDED);
        guarded.referenceAdapter0 = address(token0) < address(token1) ? address(stockAdapter) : address(counterAdapter);
        guarded.referenceAdapter1 = address(token0) < address(token1) ? address(counterAdapter) : address(stockAdapter);
        request.config = guarded;
        request.nonce = 0;
        request.salt = _mine(request);
        CreateResult memory guardedPool = factory.createAndSeed(request);
        require(BellHook(guardedPool.hook).state().lifecycle == uint8(Lifecycle.LIVE), "guarded pool not live");

        request.config = session;
        request.nonce = 1;
        request.salt = _mine(request);
        token0.mint(address(this), 10_000_000); token1.mint(address(this), 10_000_000); usdg.mint(address(this), 49e6);
        CreateResult memory sessionPool = factory.createAndSeed(request);
        require(BellHook(sessionPool.hook).state().lifecycle == uint8(Lifecycle.LIVE), "session pool not live");
        require(factory.profileHash() == sharedFactoryProfile, "factory profile changed by per-pool class/adapters");
    }

    function _profileHash(PoolConfig memory c) internal pure returns (bytes32) {
        c.token0 = address(0); c.token1 = address(0); c.asset0 = bytes32(0); c.asset1 = bytes32(0);
        c.poolClass = 0; c.referenceAdapter0 = address(0); c.referenceAdapter1 = address(0);
        return keccak256(abi.encode(c));
    }

    function testPriceGuardedOutOfBandInitialPriceReverts() external {
        // +10% on sqrt (+21% on price) is far outside the 200 bps band but inside the tick range.
        request.sqrtPriceX96 = uint160(uint256(request.sqrtPriceX96) * 11 / 10);
        bytes memory reason = _mustFail(request);
        require(bytes4(reason) == BellPoolFactory.InitialPriceOutOfBand.selector, "out-of-band seed admitted");
        require(factory.nonces(address(this)) == 0, "state consumed");
    }

    function testPriceGuardedLowerOutOfBandInitialPriceReverts() external {
        // -10% on sqrt (-19% on price) is far outside the 200 bps band but inside the tick range.
        request.sqrtPriceX96 = uint160(uint256(request.sqrtPriceX96) * 9 / 10);
        bytes memory reason = _mustFail(request);
        require(bytes4(reason) == BellPoolFactory.InitialPriceOutOfBand.selector, "below-band seed admitted");
    }

    function testPriceGuardedNearBandEdgeInsideIsAccepted() external {
        // +199 bps of the reference ratio is inside the 200 bps ACTIVE_BAND.
        uint256 bps = 199;
        uint256 scale = _sqrt(((10000 + bps) * 1e18) / 10000);
        request.sqrtPriceX96 = uint160((uint256(request.sqrtPriceX96) * scale) / 1e9);
        (bool ok,) = address(factory).call(abi.encodeCall(factory.createAndSeed, (request)));
        require(ok, "near-edge inside price rejected");
    }

    function testPriceGuardedMissingAdapterReverts() external {
        PoolConfig memory c = request.config;
        c.referenceAdapter0 = address(0);
        _redeploy(c);
        bytes memory reason = _mustFail(request);
        require(bytes4(reason) == BellPoolFactory.InvalidConfiguration.selector, "missing adapter0 admitted");
    }

    function testPriceGuardedAdapterWithoutCodeReverts() external {
        PoolConfig memory c = request.config;
        c.referenceAdapter1 = address(0xDEAD);
        _redeploy(c);
        bytes memory reason = _mustFail(request);
        require(bytes4(reason) == BellPoolFactory.InvalidConfiguration.selector, "codeless adapter admitted");
    }

    function testPriceGuardedStockAdapterMustPinTheStockToken() external {
        // Swap the bindings: the stock side's adapter now pins the counterasset token.
        PoolConfig memory c = request.config;
        (c.referenceAdapter0, c.referenceAdapter1) = (c.referenceAdapter1, c.referenceAdapter0);
        _redeploy(c);
        bytes memory reason = _mustFail(request);
        require(bytes4(reason) == BellPoolFactory.InvalidConfiguration.selector, "mispinned stock feed admitted");
    }

    function testSessionOnlyStillRejectsAnyReferenceAdapter() external {
        PoolConfig memory c = request.config;
        c.poolClass = uint8(PoolClass.SESSION_ONLY);
        _redeploy(c);
        bytes memory reason = _mustFail(request);
        require(bytes4(reason) == bytes4(keccak256("PriceGuardUnavailable()")), "session pool gained a reference path");
    }

    function testSessionOnlySessionPathUnchangedWithoutAdapters() external {
        PoolConfig memory c = request.config;
        c.poolClass = uint8(PoolClass.SESSION_ONLY);
        c.referenceAdapter0 = address(0); c.referenceAdapter1 = address(0);
        _redeploy(c);
        request.sqrtPriceX96 = uint160(1 << 96); // SESSION_ONLY fixtures ignore the reference ratio
        CreateResult memory r = factory.createAndSeed(request);
        require(BellHook(r.hook).state().lifecycle == uint8(Lifecycle.LIVE), "session path broken");
        PolicyView memory policy = BellHook(r.hook).getPolicy();
        require(policy.referencePrice18[0] == 0 && policy.referencePrice18[1] == 0, "session pool invented references");
    }

    function testStaleFeedIsRejectedAtCreation() external {
        GuardStubAggregator(address(stockAdapter.feed())).setBroken(true);
        // A dead feed reverts the whole creation (the adapter's typed error bubbles up); it must
        // never admit a pool priced against nothing.
        bytes memory reason = _mustFail(request);
        require(bytes4(reason) != BellPoolFactory.InvalidRequest.selector, "dead feed admitted");
        require(factory.nonces(address(this)) == 0, "state consumed");
    }

    // -----------------------------------------------------------------------
    // Harness
    // -----------------------------------------------------------------------

    /// @dev Re-deploys deployer + factory against the edited config and refreshes the request.
    function _redeploy(PoolConfig memory c) private {
        oracle = new BellPolicyOracle();
        address future = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        deployer = new BellHookDeployer(future, address(sessions), keccak256(type(BellHook).creationCode), address(oracle));
        c.factory = future;
        factory = new BellPoolFactory(c, deployer, address(usdg), SERVICE);
        request.config = c;
        request.nonce = 0;
        request.salt = _mine(request);
        token0.approve(address(factory), type(uint256).max);
        token1.approve(address(factory), type(uint256).max);
        usdg.approve(address(factory), type(uint256).max);
    }

    function _mustFail(CreateRequest memory r) private returns (bytes memory reason) {
        bool ok; (ok, reason) = address(factory).call(abi.encodeCall(factory.createAndSeed, (r)));
        require(!ok, "unexpected success");
    }

    function _mine(CreateRequest memory r) private view returns (bytes32) {
        PoolKey memory key = PoolKey(Currency.wrap(r.config.token0), Currency.wrap(r.config.token1), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(0)));
        bytes32 initHash = deployer.initCodeHash(r.config, key);
        bytes memory namespace = abi.encode(block.chainid, address(factory), address(this), r.nonce, bytes32(0));
        bytes memory createPreimage = abi.encodePacked(bytes1(0xff), address(deployer), bytes32(0), initHash);
        for (uint256 i; i < 200000; ++i) {
            bytes32 digest;
            assembly ("memory-safe") {
                mstore(add(namespace, 160), i)
                let salt := keccak256(add(namespace, 32), 160)
                mstore(add(createPreimage, 53), salt)
                digest := keccak256(add(createPreimage, 32), 85)
            }
            address h = address(uint160(uint256(digest)));
            if (uint160(h) & 0x3fff == 0x2cc0) return bytes32(i);
        }
        revert("salt search");
    }

    function _admit(bytes32 id, address token, bool stock) private {
        assets.admit(token, id);
        assets.setDescriptor(AssetDescriptor(id, token, stock, 6, stock ? 0x1e : 0, address(0), address(0), address(0), address(0), address(0), token.codehash, bytes32(uint256(1)), bytes32(uint256(1))));
        sessions.setHealth(id, HealthView(true, 0, 90_000, 200_000, 99_900, 99_950));
    }
}
