// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PositionInfo, PositionInfoLibrary} from "../lib/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {CalendarLeaf, MarketPhase} from "../src/types/ProtocolTypes.sol";
import {SpecialistRegistry, ISpecialistHybridAuth} from "../src/specialist/SpecialistRegistry.sol";

interface VmSp {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata reason) external;
}

/// @dev The repo has no forge-std; this is the small subset these tests use.
abstract contract SpBase {
    VmSp internal constant vm = VmSp(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal clock; // via-ir may cache block.timestamp across a cheatcode call, so the tests track time here

    function _warp(uint256 t) internal {
        clock = t;
        vm.warp(t);
    }

    function _adv(uint256 d) internal {
        _warp(clock + d);
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "assertEq");
    }

    function assertEq(address a, address b) internal pure {
        require(a == b, "assertEq(address)");
    }

    function assertEq(bytes32 a, bytes32 b) internal pure {
        require(a == b, "assertEq(bytes32)");
    }

    function assertTrue(bool a) internal pure {
        require(a, "assertTrue");
    }

    function assertFalse(bool a) internal pure {
        require(!a, "assertFalse");
    }

    function bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        if (x >= lo && x <= hi) return x;
        return lo + (x % (hi - lo + 1));
    }
}

contract TokenMock is ERC20 {
    uint8 private immutable _d;

    constructor(string memory n, uint8 d) ERC20(n, n) {
        _d = d;
    }

    function decimals() public view override returns (uint8) {
        return _d;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

/// @dev Stands in for HybridAuth: accepts only when both signature fields are non-empty.
contract HybridAuthMock is ISpecialistHybridAuth {
    uint32 public leaves;
    bytes32 public lastRole;
    bytes32 public lastAction;
    bytes32 public lastPayload;

    function authorize(bytes32 role, bytes32 action, bytes32 payloadHash, uint256 deadline, bytes calldata e, bytes calldata p)
        external
        returns (uint32)
    {
        require(e.length != 0 && p.length != 0 && block.timestamp <= deadline, "auth");
        lastRole = role;
        lastAction = action;
        lastPayload = payloadHash;
        return leaves++;
    }
}

contract PoolManagerMock {
    mapping(bytes32 => bytes32) public store;

    function extsload(bytes32 slot) external view returns (bytes32) {
        return store[slot];
    }

    function setTick(bytes32 poolId, int24 tick) external {
        store[keccak256(abi.encodePacked(poolId, bytes32(uint256(6))))] = bytes32(uint256(1 << 96) | (uint256(uint24(tick)) << 160));
    }
}

contract PositionsMock {
    struct P {
        address owner;
        PoolKey key;
        int24 lo;
        int24 hi;
        uint128 liq;
        bool burned;
    }

    mapping(uint256 => P) public p;

    function set(uint256 id, address owner, PoolKey memory key, int24 lo, int24 hi, uint128 liq) external {
        P storage x = p[id];
        x.owner = owner;
        x.key = key;
        x.lo = lo;
        x.hi = hi;
        x.liq = liq;
        x.burned = false;
    }

    function setLiquidity(uint256 id, uint128 liq) external {
        p[id].liq = liq;
    }

    function burn(uint256 id) external {
        p[id].burned = true;
    }

    function ownerOf(uint256 id) external view returns (address) {
        require(!p[id].burned && p[id].owner != address(0), "no token");
        return p[id].owner;
    }

    function getPoolAndPositionInfo(uint256 id) external view returns (PoolKey memory, PositionInfo) {
        P storage x = p[id];
        return (x.key, PositionInfoLibrary.initialize(x.key, x.lo, x.hi));
    }

    function getPositionLiquidity(uint256 id) external view returns (uint128) {
        return p[id].liq;
    }
}

contract AuctionMock {
    struct Cycle {
        uint64 openTime;
        uint64 deadline;
        bool finalized;
        uint160 price;
    }

    struct Ord {
        address owner;
        uint128 amountIn;
        uint160 limit;
        uint64 cycle;
        bool isBuyer;
        bool cancelled;
    }

    bytes32 public assetId = keccak256("NVDA");
    uint64 public cycleId;
    mapping(uint64 => Cycle) public cyc;
    mapping(uint64 => uint32[]) public ids;
    Ord[] public ords;

    function addCycle(uint64 openTime, uint64 deadline, bool finalized, uint160 price) external returns (uint64) {
        cyc[++cycleId] = Cycle(openTime, deadline, finalized, price);
        return cycleId;
    }

    function finalize(uint64 c) external {
        cyc[c].finalized = true;
    }

    function addOrder(uint64 c, address owner, uint128 amountIn, uint160 limit, bool isBuyer, bool cancelled) external {
        ids[c].push(uint32(ords.length));
        ords.push(Ord(owner, amountIn, limit, c, isBuyer, cancelled));
    }

    function cycleOpenTimeById(uint64 c) external view returns (uint64) {
        return cyc[c].openTime;
    }

    function cycleClearingPriceById(uint64 c) external view returns (uint160) {
        return cyc[c].price;
    }

    function cycleSummary(uint64 c) external view returns (uint64, uint64, uint8, uint160, uint128, bool) {
        Cycle storage x = cyc[c];
        return (x.openTime, x.deadline, 0, x.price, 0, x.finalized);
    }

    function cycleOrderCount(uint64 c) external view returns (uint32) {
        return uint32(ids[c].length);
    }

    function cycleOrderId(uint64 c, uint32 i) external view returns (uint32) {
        return ids[c][i];
    }

    function order(uint32 id) external view returns (address, uint128, uint160, uint64, bool, bool, bool) {
        Ord storage o = ords[id];
        return (o.owner, o.amountIn, o.limit, o.cycle, o.isBuyer, o.cancelled, false);
    }
}

contract CalendarMock {
    bool public open = true;
    uint8 public phase = uint8(MarketPhase.REGULAR);

    function set(bool o, uint8 ph) external {
        open = o;
        phase = ph;
    }

    function currentInterval(bytes32 assetId) external view returns (CalendarLeaf memory l) {
        l.assetId = assetId;
        l.start = uint64(block.timestamp - 1 hours);
        l.end = uint64(block.timestamp + 1 hours);
        l.phase = open ? phase : uint8(MarketPhase.CLOSED);
    }
}

contract HaltMock {
    uint8 private _phase;

    function set(uint8 p) external {
        _phase = p;
    }

    function phase(bytes32) external view returns (uint8) {
        return _phase;
    }
}

contract SpecialistRegistryTest is SpBase {
    using PoolIdLibrary for PoolKey;

    uint64 constant G = 7 days * 100;
    uint160 constant PRICE = uint160(1 << 96);
    bytes32 constant STOCK = keccak256("NVDA");
    bytes32 constant ROLE = keccak256("GOVERNANCE");
    address constant BURN = 0x000000000000000000000000000000000000dEaD;

    SpecialistRegistry reg;
    TokenMock bell;
    TokenMock usdg;
    HybridAuthMock auth;
    PoolManagerMock pm;
    PositionsMock posm;
    AuctionMock auction;
    CalendarMock cal;
    HaltMock halt;
    PoolKey key;
    bytes32 poolId;

    address spec = address(0x5BEC);
    address caller = address(0xCA11);
    address funder = address(0xF00D);

    function setUp() public {
        _warp(G + 1 days);
        bell = new TokenMock("BELL", 18);
        usdg = new TokenMock("USDG", 6);
        auth = new HybridAuthMock();
        pm = new PoolManagerMock();
        posm = new PositionsMock();
        auction = new AuctionMock();
        cal = new CalendarMock();
        halt = new HaltMock();
        key = PoolKey({currency0: Currency.wrap(address(usdg)), currency1: Currency.wrap(address(bell)), fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        poolId = PoolId.unwrap(key.toId());

        SpecialistRegistry.StockConfig[] memory stocks = new SpecialistRegistry.StockConfig[](1);
        stocks[0] = SpecialistRegistry.StockConfig({
            stockId: STOCK,
            auction: address(auction),
            poolId: poolId,
            minBuyQuote: 1e4,
            minSellBase: 1e12,
            minLiquidity: 1_000
        });
        SpecialistRegistry.Params memory p = SpecialistRegistry.Params({
            genesis: G,
            epochSeconds: 7 days,
            slotSeconds: 15 minutes,
            unbondDelay: 14 days,
            d1PassBps: 8000,
            d2PassBps: 9000,
            minCheckpoints: 4,
            auctionBandBps: 150,
            minTickWidth: 600,
            smallSlashBps: 500,
            largeSlashBps: 2500,
            rewardShareBps: 1000,
            maxRewardPerEpoch: 5e6,
            checkpointTip: 1e4,
            minBondBell: 1000e18,
            minBondUsdg: 10e6
        });
        reg = new SpecialistRegistry(address(auth), ROLE, address(bell), address(usdg), address(pm), address(posm), address(cal), address(halt), p, stocks);

        bell.mint(spec, 10_000e18);
        usdg.mint(spec, 100e6);
        usdg.mint(funder, 1_000e6);
        vm.startPrank(spec);
        bell.approve(address(reg), type(uint256).max);
        usdg.approve(address(reg), type(uint256).max);
        vm.stopPrank();
        vm.prank(funder);
        usdg.approve(address(reg), type(uint256).max);
        pm.setTick(poolId, 0);
    }

    // ----------------------------------------------------------- helpers

    function _bondAndAssign() internal {
        vm.prank(spec);
        reg.bond(4000e18, 40e6);
        reg.assign(STOCK, spec, clock + 1 hours, hex"01", hex"02");
        posm.set(7, spec, key, -1200, 1200, 5_000);
        vm.prank(spec);
        reg.registerPosition(7);
    }

    function _toEpoch(uint64 e) internal {
        _warp(uint256(G) + uint256(e) * 7 days + 1 hours);
    }

    /// One auction cycle that opened `at`, with the Specialist's two orders unless told otherwise.
    function _cycle(uint64 at, bool buy, bool sell, uint160 sellLimit) internal returns (uint64 c) {
        c = auction.addCycle(at, at + 15 minutes, true, PRICE);
        if (buy) auction.addOrder(c, spec, 1e6, PRICE, true, false);
        if (sell) auction.addOrder(c, spec, 1e15, sellLimit, false, false);
    }

    function _checkpoints(uint256 n, bool alsoFund) internal {
        if (alsoFund) {
            vm.prank(funder);
            reg.fund(STOCK, 100e6);
        }
        for (uint256 i; i < n; ++i) {
            vm.prank(caller);
            reg.checkpoint(STOCK);
            _adv(15 minutes);
        }
    }

    // ---------------------------------------------------------- lifecycle

    function testBondThenAssignThroughHybridAuthStartsAtTheNextEpoch() external {
        _bondAndAssign();
        assertEq(reg.specialistOf(STOCK), spec);
        assertEq(reg.startEpoch(STOCK), 1);
        assertEq(auth.lastRole(), ROLE);
        assertEq(auth.lastAction(), reg.ASSIGN_ACTION());
        assertEq(auth.leaves(), 1);
    }

    function testAssignWithoutBothSignaturesReverts() external {
        vm.prank(spec);
        reg.bond(4000e18, 40e6);
        vm.expectRevert(bytes("auth"));
        reg.assign(STOCK, spec, block.timestamp + 1 hours, "", hex"02");
        vm.expectRevert(bytes("auth"));
        reg.assign(STOCK, spec, clock + 1 hours, hex"01", "");
    }

    function testBondBelowTheMinimumReverts() external {
        vm.startPrank(spec);
        vm.expectRevert(SpecialistRegistry.BondTooSmall.selector);
        reg.bond(999e18, 40e6);
        vm.expectRevert(SpecialistRegistry.BondTooSmall.selector);
        reg.bond(4000e18, 9e6);
        vm.stopPrank();
    }

    function testOneSpecialistPerStockAndOneStockPerBond() external {
        _bondAndAssign();
        address other = address(0xB0B);
        bell.mint(other, 4000e18);
        usdg.mint(other, 40e6);
        vm.startPrank(other);
        bell.approve(address(reg), type(uint256).max);
        usdg.approve(address(reg), type(uint256).max);
        reg.bond(4000e18, 40e6);
        vm.stopPrank();
        vm.expectRevert(SpecialistRegistry.StockTaken.selector);
        reg.assign(STOCK, other, clock + 1 hours, hex"01", hex"02");
        vm.expectRevert(SpecialistRegistry.UnknownStock.selector);
        reg.assign(keccak256("TSLA"), other, clock + 1 hours, hex"01", hex"02");
    }

    function testAnUnbondedAddressCannotBeAssigned() external {
        vm.prank(spec);
        reg.bond(4000e18, 40e6);
        vm.expectRevert(SpecialistRegistry.NotBonded.selector);
        reg.assign(STOCK, address(0x1234), clock + 1 hours, hex"01", hex"02");
    }

    function testRegisterPositionNeedsTheOwnerAndTheRightPool() external {
        vm.prank(spec);
        reg.bond(4000e18, 40e6);
        reg.assign(STOCK, spec, clock + 1 hours, hex"01", hex"02");
        posm.set(8, address(0xBAD), key, -1200, 1200, 5_000);
        vm.prank(spec);
        vm.expectRevert(SpecialistRegistry.NotYourPosition.selector);
        reg.registerPosition(8);
        PoolKey memory other = key;
        other.fee = 500;
        posm.set(9, spec, other, -1200, 1200, 5_000);
        vm.prank(spec);
        vm.expectRevert(SpecialistRegistry.WrongPool.selector);
        reg.registerPosition(9);
        vm.prank(address(0x77));
        vm.expectRevert(SpecialistRegistry.NotSpecialist.selector);
        reg.registerPosition(7);
    }

    // ---------------------------------------------------------------- D2

    function testCheckpointPassesWithDepthRangeAndPrice() external {
        _bondAndAssign();
        _toEpoch(1);
        vm.prank(caller);
        reg.checkpoint(STOCK);
        (, , , uint16 n, uint16 ok,) = _epoch(1);
        assertEq(n, 1);
        assertEq(ok, 1);
    }

    function testCheckpointFailsWhenThePriceLeavesTheRange() external {
        _bondAndAssign();
        _toEpoch(1);
        pm.setTick(poolId, 1200); // the upper tick is exclusive
        vm.prank(caller);
        reg.checkpoint(STOCK);
        (, , , uint16 n, uint16 ok,) = _epoch(1);
        assertEq(n, 1);
        assertEq(ok, 0);
    }

    function testCheckpointFailsWhenTheRangeIsTooNarrowOrTooShallow() external {
        _bondAndAssign();
        _toEpoch(1);
        posm.set(7, spec, key, -60, 60, 5_000);
        vm.prank(caller);
        reg.checkpoint(STOCK);
        _adv(15 minutes);
        posm.set(7, spec, key, -1200, 1200, 999);
        vm.prank(caller);
        reg.checkpoint(STOCK);
        (, , , uint16 n, uint16 ok,) = _epoch(1);
        assertEq(n, 2);
        assertEq(ok, 0);
    }

    function testExitsStayOpenAndOnlyFailTheSlot() external {
        _bondAndAssign();
        _toEpoch(1);
        posm.setLiquidity(7, 0); // the Specialist withdrew everything; no hook is involved
        vm.prank(caller);
        reg.checkpoint(STOCK);
        _adv(15 minutes);
        posm.burn(7); // and burned the position
        vm.prank(caller);
        reg.checkpoint(STOCK);
        (, , , uint16 n, uint16 ok,) = _epoch(1);
        assertEq(n, 2);
        assertEq(ok, 0);
    }

    function testCheckpointFailsWithNoRegisteredPosition() external {
        vm.prank(spec);
        reg.bond(4000e18, 40e6);
        reg.assign(STOCK, spec, clock + 1 hours, hex"01", hex"02");
        _toEpoch(1);
        vm.prank(caller);
        reg.checkpoint(STOCK);
        (, , , uint16 n, uint16 ok,) = _epoch(1);
        assertEq(n, 1);
        assertEq(ok, 0);
    }

    function testOneCheckpointPerSlot() external {
        _bondAndAssign();
        _toEpoch(1);
        vm.prank(caller);
        reg.checkpoint(STOCK);
        vm.prank(caller);
        vm.expectRevert(SpecialistRegistry.SlotDone.selector);
        reg.checkpoint(STOCK);
        _adv(15 minutes);
        vm.prank(caller);
        reg.checkpoint(STOCK);
    }

    function testNoCheckpointOutsideOpenSessionsOrDuringAHalt() external {
        _bondAndAssign();
        _toEpoch(1);
        cal.set(false, 0);
        vm.expectRevert(SpecialistRegistry.NotOpenSession.selector);
        reg.checkpoint(STOCK);
        cal.set(true, uint8(MarketPhase.REGULAR));
        halt.set(1);
        vm.expectRevert(SpecialistRegistry.NotOpenSession.selector);
        reg.checkpoint(STOCK);
        halt.set(0);
        reg.checkpoint(STOCK);
    }

    function testNoCheckpointBeforeTheFirstScoredEpoch() external {
        _bondAndAssign();
        vm.expectRevert(SpecialistRegistry.NotScoredYet.selector);
        reg.checkpoint(STOCK);
    }

    function testTheCallerGetsTheTipFromTheRewardPool() external {
        _bondAndAssign();
        vm.prank(funder);
        reg.fund(STOCK, 1e6);
        _toEpoch(1);
        vm.prank(caller);
        reg.checkpoint(STOCK);
        assertEq(usdg.balanceOf(caller), 1e4);
        assertEq(reg.rewardPool(STOCK), 1e6 - 1e4);
    }

    function testNoTipFromAnEmptyPoolButTheCheckpointStillCounts() external {
        _bondAndAssign();
        _toEpoch(1);
        vm.prank(caller);
        reg.checkpoint(STOCK);
        assertEq(usdg.balanceOf(caller), 0);
    }

    // ---------------------------------------------------------------- D1

    function testAuctionDutyPassesWithBothOrdersInsideTheBand() external {
        _bondAndAssign();
        _toEpoch(1);
        uint64 open = uint64(G + 7 days + 2 hours);
        _cycle(open, true, true, PRICE);
        _warp(open + 1 hours);
        reg.recordAuction(STOCK);
        (uint16 cycles, uint16 passed,,,,) = _epoch(1);
        assertEq(cycles, 1);
        assertEq(passed, 1);
    }

    function testAuctionDutyFailsWithoutASellOrWithoutABuy() external {
        _bondAndAssign();
        uint64 open = uint64(G + 7 days + 2 hours);
        _cycle(open, true, false, PRICE);
        _cycle(open + 1 days, false, true, PRICE);
        _warp(open + 2 days);
        reg.recordAuction(STOCK);
        reg.recordAuction(STOCK);
        (uint16 cycles, uint16 passed,,,,) = _epoch(1);
        assertEq(cycles, 2);
        assertEq(passed, 0);
    }

    function testOrdersFarFromThePriceOrBelowTheMinimumOrCancelledDoNotCount() external {
        _bondAndAssign();
        uint64 open = uint64(G + 7 days + 2 hours);
        // far: 2% above the clearing price, band is 1.5%
        _cycle(open, true, true, uint160(uint256(PRICE) * 10200 / 10000));
        // small
        uint64 c2 = auction.addCycle(open + 1 days, open + 1 days + 15 minutes, true, PRICE);
        auction.addOrder(c2, spec, 1, PRICE, true, false);
        auction.addOrder(c2, spec, 1e15, PRICE, false, false);
        // cancelled
        uint64 c3 = auction.addCycle(open + 2 days, open + 2 days + 15 minutes, true, PRICE);
        auction.addOrder(c3, spec, 1e6, PRICE, true, true);
        auction.addOrder(c3, spec, 1e15, PRICE, false, false);
        // someone else's orders
        uint64 c4 = auction.addCycle(open + 3 days, open + 3 days + 15 minutes, true, PRICE);
        auction.addOrder(c4, address(0xDEAD1), 1e6, PRICE, true, false);
        auction.addOrder(c4, address(0xDEAD1), 1e15, PRICE, false, false);
        _warp(open + 4 days);
        for (uint256 i; i < 4; ++i) reg.recordAuction(STOCK);
        (uint16 cycles, uint16 passed,,,,) = _epoch(1);
        assertEq(cycles, 4);
        assertEq(passed, 0);
    }

    function testARefundedCycleChecksSizesButNotTheBand() external {
        _bondAndAssign();
        uint64 open = uint64(G + 7 days + 2 hours);
        uint64 c = auction.addCycle(open, open + 15 minutes, false, 0);
        auction.addOrder(c, spec, 1e6, 12345, true, false);
        auction.addOrder(c, spec, 1e15, 99999, false, false);
        _warp(open + 16 minutes);
        reg.recordAuction(STOCK);
        (uint16 cycles, uint16 passed,,,,) = _epoch(1);
        assertEq(cycles, 1);
        assertEq(passed, 1);
    }

    function testACycleStillRunningCannotBeRecorded() external {
        _bondAndAssign();
        uint64 open = uint64(G + 7 days + 2 hours);
        auction.addCycle(open, open + 15 minutes, false, 0);
        _warp(open + 5 minutes);
        vm.expectRevert(SpecialistRegistry.CycleNotFinal.selector);
        reg.recordAuction(STOCK);
    }

    function testCyclesAreRecordedInOrderOnceEach() external {
        _bondAndAssign();
        uint64 open = uint64(G + 7 days + 2 hours);
        _cycle(open, true, true, PRICE);
        _warp(open + 1 hours);
        reg.recordAuction(STOCK);
        vm.expectRevert(SpecialistRegistry.NoSuchCycle.selector);
        reg.recordAuction(STOCK);
        assertEq(reg.nextCycleToRecord(STOCK), 2);
    }

    function testCyclesBeforeTheFirstScoredEpochAreSkippedNotCounted() external {
        // A cycle that opened in epoch 0, before the assignment took effect.
        auction.addCycle(uint64(G + 1 days + 1 hours), uint64(G + 1 days + 2 hours), true, PRICE);
        _warp(G + 2 days);
        vm.prank(spec);
        reg.bond(4000e18, 40e6);
        reg.assign(STOCK, spec, clock + 1 hours, hex"01", hex"02");
        // assign starts at the next cycle (the early one is already past): nothing to record yet
        vm.expectRevert(SpecialistRegistry.NoSuchCycle.selector);
        reg.recordAuction(STOCK);
        assertEq(reg.nextCycleToRecord(STOCK), 2);
    }

    // ----------------------------------------------------------- scoring

    function _passingEpoch(uint64 e) internal {
        // 5 weekday cycles, all fine, plus 12 passing checkpoints
        _toEpoch(e);
        uint64 base = uint64(uint256(G) + uint256(e) * 7 days);
        for (uint256 i; i < 5; ++i) _cycle(base + uint64(i * 1 days) + 2 hours, true, true, PRICE);
        _checkpoints(12, false);
        _warp(uint256(G) + uint256(e + 1) * 7 days + 1);
        for (uint256 i; i < 5; ++i) reg.recordAuction(STOCK);
    }

    function testAPassingEpochPaysTheRewardShare() external {
        _bondAndAssign();
        vm.prank(funder);
        reg.fund(STOCK, 100e6);
        _passingEpoch(1);
        uint256 poolBefore = reg.rewardPool(STOCK);
        uint256 specBefore = usdg.balanceOf(spec);
        reg.closeEpoch(STOCK);
        uint256 pay = poolBefore * 1000 / 10_000;
        if (pay > 5e6) pay = 5e6;
        assertEq(usdg.balanceOf(spec) - specBefore, pay);
        assertEq(reg.rewardPool(STOCK), poolBefore - pay);
        (uint256 bellBond,) = _bond(spec);
        assertEq(bellBond, 4000e18);
    }

    function testTheRewardIsCappedPerEpoch() external {
        _bondAndAssign();
        vm.prank(funder);
        reg.fund(STOCK, 900e6); // 10% would be 90 USDG, the cap is 5
        _passingEpoch(1);
        uint256 before = usdg.balanceOf(spec);
        reg.closeEpoch(STOCK);
        assertEq(usdg.balanceOf(spec) - before, 5e6);
    }

    function testMissingD1OnlyIsASmallSlashWithTheBellPartBurned() external {
        _bondAndAssign();
        _toEpoch(1);
        uint64 base = uint64(G + 7 days);
        // 5 cycles, 3 with both orders, 2 missing the sell side: 60% < 80%
        for (uint256 i; i < 5; ++i) _cycle(base + uint64(i * 1 days) + 2 hours, true, i < 3, PRICE);
        _checkpoints(12, false);
        _warp(uint256(G) + 14 days + 1);
        for (uint256 i; i < 5; ++i) reg.recordAuction(STOCK);
        uint256 burnBefore = bell.balanceOf(BURN);
        reg.closeEpoch(STOCK);
        (uint256 b, uint256 u) = _bond(spec);
        assertEq(b, 4000e18 - 200e18); // one twentieth of the BELL
        assertEq(u, 40e6 - 2e6); // one twentieth of the USDG
        assertEq(bell.balanceOf(BURN) - burnBefore, 200e18);
        assertEq(reg.rewardPool(STOCK), 2e6); // slashed USDG pays the next Specialist
        assertEq(reg.specialistOf(STOCK), spec);
    }

    function testMissingBothDutiesIsALargeSlashAndRemoval() external {
        _bondAndAssign();
        _toEpoch(1);
        uint64 base = uint64(G + 7 days);
        for (uint256 i; i < 5; ++i) _cycle(base + uint64(i * 1 days) + 2 hours, false, false, PRICE);
        posm.setLiquidity(7, 0);
        _checkpoints(12, false);
        _warp(uint256(G) + 14 days + 1);
        for (uint256 i; i < 5; ++i) reg.recordAuction(STOCK);
        reg.closeEpoch(STOCK);
        (uint256 b,) = _bond(spec);
        assertEq(b, 3000e18);
        assertEq(reg.specialistOf(STOCK), address(0));
        (,,,, bool removed) = reg.bonds(spec);
        assertTrue(removed);
    }

    function testASecondFailingEpochInARowIsALargeSlashAndRemoval() external {
        _bondAndAssign();
        for (uint64 e = 1; e <= 2; ++e) {
            _toEpoch(e);
            uint64 base = uint64(uint256(G) + uint256(e) * 7 days);
            for (uint256 i; i < 5; ++i) _cycle(base + uint64(i * 1 days) + 2 hours, true, i < 3, PRICE);
            _checkpoints(12, false);
            _warp(uint256(G) + uint256(e + 1) * 7 days + 1);
            for (uint256 i; i < 5; ++i) reg.recordAuction(STOCK);
            reg.closeEpoch(STOCK);
            if (e == 1) {
                (uint256 b1,) = _bond(spec);
                assertEq(b1, 3800e18);
                assertEq(reg.specialistOf(STOCK), spec);
            }
        }
        (uint256 b2,) = _bond(spec);
        assertEq(b2, 3800e18 - 950e18); // a quarter of what was left
        assertEq(reg.specialistOf(STOCK), address(0));
    }

    function testAPassingEpochBetweenResetsTheStreak() external {
        _bondAndAssign();
        // epoch 1 fails D1, epoch 2 passes, epoch 3 fails D1 again: only small slashes, still assigned
        bool[3] memory good = [false, true, false];
        for (uint64 e = 1; e <= 3; ++e) {
            _toEpoch(e);
            uint64 base = uint64(uint256(G) + uint256(e) * 7 days);
            bool ok = good[e - 1];
            for (uint256 i; i < 5; ++i) _cycle(base + uint64(i * 1 days) + 2 hours, true, ok || i < 3, PRICE);
            _checkpoints(12, false);
            _warp(uint256(G) + uint256(e + 1) * 7 days + 1);
            for (uint256 i; i < 5; ++i) reg.recordAuction(STOCK);
            reg.closeEpoch(STOCK);
        }
        assertEq(reg.specialistOf(STOCK), spec);
    }

    function testAnEpochWithNothingMeasuredIsVoidAndCostsNothing() external {
        _bondAndAssign();
        _warp(uint256(G) + 14 days + 1);
        reg.closeEpoch(STOCK);
        (uint256 b, uint256 u) = _bond(spec);
        assertEq(b, 4000e18);
        assertEq(u, 40e6);
        assertEq(reg.nextEpochToClose(STOCK), 2);
    }

    function testTooFewCheckpointsMeansD2IsNotMeasuredSoItCannotFail() external {
        _bondAndAssign();
        _toEpoch(1);
        posm.setLiquidity(7, 0);
        _checkpoints(3, false); // all failing, but fewer than the minimum of 4
        _warp(uint256(G) + 14 days + 1);
        (, , bool m2,) = reg.previewEpoch(STOCK, 1);
        assertFalse(m2);
        reg.closeEpoch(STOCK);
        (uint256 b,) = _bond(spec);
        assertEq(b, 4000e18);
    }

    function testAnEpochCannotCloseEarlyOrWithCyclesUnrecorded() external {
        _bondAndAssign();
        _toEpoch(1);
        vm.expectRevert(SpecialistRegistry.EpochNotOver.selector);
        reg.closeEpoch(STOCK);
        uint64 open = uint64(G + 7 days + 2 hours);
        _cycle(open, true, true, PRICE);
        _warp(uint256(G) + 14 days + 1);
        vm.expectRevert(SpecialistRegistry.CyclesPending.selector);
        reg.closeEpoch(STOCK);
        reg.recordAuction(STOCK);
        reg.closeEpoch(STOCK);
    }

    function testAnArmedCycleOfALaterEpochDoesNotBlockTheClose() external {
        _bondAndAssign();
        _cycle(uint64(G + 14 days + 2 hours), true, true, PRICE); // opens in epoch 2
        _warp(uint256(G) + 14 days + 1);
        reg.closeEpoch(STOCK);
    }

    // ------------------------------------------------------------- unbond

    function testUnbondWaitsForTheDelayAndForEveryFinishedEpochToBeScored() external {
        _bondAndAssign();
        vm.prank(spec);
        reg.requestUnbond();
        vm.prank(spec);
        vm.expectRevert(SpecialistRegistry.UnbondPending.selector);
        reg.unbond();
        _adv(14 days);
        vm.prank(spec);
        vm.expectRevert(SpecialistRegistry.EpochsOpen.selector);
        reg.unbond();
    }

    function testABadWeekInsideTheUnbondDelayIsStillSlashed() external {
        _bondAndAssign();
        _toEpoch(1);
        vm.prank(spec);
        reg.requestUnbond(); // the delay runs 14 days: epochs 1 and 2 end inside it
        uint64 base = uint64(G + 7 days);
        for (uint256 i; i < 5; ++i) _cycle(base + uint64(i * 1 days) + 2 hours, true, i < 3, PRICE); // epoch 1 fails D1
        _checkpoints(12, false);
        _warp(uint256(G) + 14 days + 1);
        for (uint256 i; i < 5; ++i) reg.recordAuction(STOCK);
        reg.closeEpoch(STOCK); // slash lands during the delay
        _adv(14 days);
        // epoch 2 and 3 must be scored too before the bond can leave
        vm.prank(spec);
        vm.expectRevert(SpecialistRegistry.EpochsOpen.selector);
        reg.unbond();
        reg.closeEpoch(STOCK);
        reg.closeEpoch(STOCK);
        uint256 bellBefore = bell.balanceOf(spec);
        vm.prank(spec);
        reg.unbond();
        assertEq(bell.balanceOf(spec) - bellBefore, 3800e18); // the slash stayed slashed
        assertEq(reg.specialistOf(STOCK), address(0));
    }

    function testUnbondingAnUnassignedBondReturnsEverythingAfterTheDelay() external {
        vm.prank(spec);
        reg.bond(4000e18, 40e6);
        vm.prank(spec);
        reg.requestUnbond();
        _adv(14 days);
        vm.prank(spec);
        reg.unbond();
        assertEq(bell.balanceOf(spec), 10_000e18);
        assertEq(usdg.balanceOf(spec), 100e6);
        assertEq(bell.balanceOf(address(reg)), 0);
    }

    function testARemovedSpecialistCanStillUnbondWhatIsLeft() external {
        _bondAndAssign();
        _toEpoch(1);
        uint64 base = uint64(G + 7 days);
        for (uint256 i; i < 5; ++i) _cycle(base + uint64(i * 1 days) + 2 hours, false, false, PRICE);
        posm.setLiquidity(7, 0);
        _checkpoints(12, false);
        _warp(uint256(G) + 14 days + 1);
        for (uint256 i; i < 5; ++i) reg.recordAuction(STOCK);
        reg.closeEpoch(STOCK);
        vm.prank(spec);
        reg.requestUnbond();
        _adv(14 days);
        vm.prank(spec);
        reg.unbond();
        assertEq(bell.balanceOf(spec), 10_000e18 - 1000e18);
    }

    // ------------------------------------------------------- config & fuzz

    function testTheRegistryHasNoOwnerNoSetterAndTheConfigIsFixed() external view {
        assertEq(reg.GENESIS(), G);
        assertEq(reg.EPOCH_SECONDS(), 7 days);
        assertEq(reg.UNBOND_DELAY(), 14 days);
        (bytes32 id,,,,,) = reg.stockConfig(STOCK);
        assertEq(id, STOCK);
    }

    function testBadConfigReverts() external {
        SpecialistRegistry.StockConfig[] memory none = new SpecialistRegistry.StockConfig[](0);
        SpecialistRegistry.Params memory p;
        vm.expectRevert(SpecialistRegistry.BadConfig.selector);
        new SpecialistRegistry(address(auth), ROLE, address(bell), address(usdg), address(pm), address(posm), address(cal), address(0), p, none);
    }

    /// Whatever the slash sizes and bond sizes, the contract's token balance always covers every bond and the reward pool.
    function testSlashKeepsTheBooksBalanced(uint96 bellAmt, uint96 usdgAmt, bool both) external {
        bellAmt = uint96(bound(bellAmt, 1000e18, 9000e18));
        usdgAmt = uint96(bound(usdgAmt, 10e6, 90e6));
        vm.prank(spec);
        reg.bond(bellAmt, usdgAmt);
        reg.assign(STOCK, spec, clock + 1 hours, hex"01", hex"02");
        posm.set(7, spec, key, -1200, 1200, 5_000);
        vm.prank(spec);
        reg.registerPosition(7);
        _toEpoch(1);
        uint64 base = uint64(G + 7 days);
        for (uint256 i; i < 5; ++i) _cycle(base + uint64(i * 1 days) + 2 hours, !both, false, PRICE);
        _checkpoints(12, false);
        _warp(uint256(G) + 14 days + 1);
        for (uint256 i; i < 5; ++i) reg.recordAuction(STOCK);
        reg.closeEpoch(STOCK);
        assertEq(usdg.balanceOf(address(reg)), reg.totalBondUsdg() + reg.rewardPool(STOCK));
        assertEq(bell.balanceOf(address(reg)), reg.totalBondBell());
        assertEq(bell.balanceOf(address(reg)) + bell.balanceOf(BURN) + bell.balanceOf(spec), 10_000e18);
    }

    // -------------------------------------------------------------- views

    function _epoch(uint64 e) internal view returns (uint16, uint16, uint16, uint16, uint16, bool) {
        (uint16 cycles, uint16 cp, uint16 n, uint16 ok, bool closed) = reg.epochs(STOCK, e);
        return (cycles, cp, 0, n, ok, closed);
    }

    function _bond(address who) internal view returns (uint256 b, uint256 u) {
        (uint128 bb, uint128 uu,,,) = reg.bonds(who);
        return (bb, uu);
    }
}
