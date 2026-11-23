// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHook} from "../../../src/BellHook.sol";
import {BellPolicyOracle} from "../../../src/BellPolicyOracle.sol";
import {BellModeEvaluator} from "../../../src/BellModeEvaluator.sol";
import {ModePolicy} from "../../../src/libraries/ModePolicy.sol";
import {PolicyConstants} from "../../../src/libraries/PolicyConstants.sol";
import {CalendarProof} from "../../../src/libraries/CalendarProof.sol";
import {
    AssetDescriptor,
    HealthView,
    CalendarLeaf,
    Anchor,
    SourceSample,
    PoolConfig,
    PoolState,
    Buckets,
    PolicyView,
    Lifecycle,
    Mode,
    PoolClass,
    LiquidityMode,
    ReasonBits
} from "../../../src/types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IBellErrors} from "../../../src/interfaces/ProtocolEvents.sol";
import {BellPolicyOracleV3} from "../../../src/BellPolicyOracleV3.sol";
import {HaltRegistry, IHaltHybridAuth} from "../../../src/registries/HaltRegistry.sol";
import {VmClosure, ClosureToken, ClosureDependency, MockClosureSafety, MockClosureAssets, MockClosureCalendar, MockClosureSessions} from "./BellHookClosure.t.sol";


contract MockHaltAuthHook {
    uint32 public leaves;

    function authorize(bytes32, bytes32, bytes32, uint256 deadline, bytes calldata e, bytes calldata p) external returns (uint32) {
        require(block.timestamp <= deadline && e.length != 0 && p.length != 0, "hybrid");
        return ++leaves;
    }
}

/// @dev Einstein Hooks v3: a recorded halt is priced as a planned CLOSED through BellPolicyOracleV3, with the unchanged BellHook.
contract BellHookHaltTest {
    VmClosure private constant vm = VmClosure(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant REASON = keccak256("LULD");

    uint160 private constant HOOK_FLAG_MASK = 0x3fff;
    uint160 private constant EXPECTED_HOOK_FLAGS = 0x2cc0;

    uint256 private constant STATE_SLOT = 0;
    uint256 private constant AUX_STATE_SLOT = 3;
    uint256 private constant BUCKETS_EPOCH_SLOT = 4;
    uint256 private constant BUCKETS_CURRENT_SLOT = 5;
    uint256 private constant BUCKETS_PREVIOUS_SLOT = 6;
    uint256 private constant EPISODE_GROSS_SLOT = 7;

    bytes32 private constant CLOSURE_STARTED = keccak256("ClosureStarted(bytes32,uint64)");
    bytes32 private constant CLOSURE_ENDED = keccak256("ClosureEnded(bytes32,uint64)");
    bytes32 private constant MODE_CHECKPOINT = keccak256("ModeCheckpoint(bytes32,uint8,uint256,uint64,uint64)");

    PoolManager private manager;
    address private token0;
    address private token1;
    bytes32 private asset0;
    bytes32 private asset1;
    address private factory;
    address private positionManager;
    address private treasuryAdapter;
    MockClosureSafety private safety;
    MockClosureAssets private assets;
    MockClosureCalendar private calendar;
    MockClosureSessions private sessions;
    bytes32 private templateCodeHash;
    BellHook private hook;
    BellPolicyOracle private oracle;
    BellModeEvaluator private modeEvaluator;
    HaltRegistry private haltReg;

    function setUp() external {
        vm.warp(1_700_000_000);
        manager = new PoolManager(address(this));
        address tokenA = address(new ClosureToken());
        address tokenB = address(new ClosureToken());
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        asset0 = keccak256("ASSET_0");
        asset1 = keccak256("ASSET_1");
        factory = address(new ClosureDependency());
        positionManager = address(new ClosureDependency());
        treasuryAdapter = address(new ClosureDependency());
        safety = new MockClosureSafety();
        assets = new MockClosureAssets();
        calendar = new MockClosureCalendar();
        sessions = new MockClosureSessions();
        templateCodeHash = keccak256(type(BellHook).creationCode);
        haltReg = new HaltRegistry(IHaltHybridAuth(address(new MockHaltAuthHook())), keccak256("REPORTER"));
        oracle = new BellPolicyOracleV3(address(haltReg));
        modeEvaluator = new BellModeEvaluator();
        _installBaseState();
        hook = _deployHook();
    }

    function deployHook(PoolConfig calldata config, PoolKey calldata key, bytes32 templateHash, address sessionRegistry)
        external
        returns (address)
    {
        return address(new BellHook(config, key, templateHash, sessionRegistry, oracle, modeEvaluator));
    }

    function _swapParams() internal pure returns (SwapParams memory params) {
        params.zeroForOne = true;
        params.amountSpecified = -1e18;
        params.sqrtPriceLimitX96 = 0;
    }

    function _expectPolicyBlocked(uint256 reasons) internal {
        PoolKey memory key = hook.poolKey();
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.PolicyBlocked.selector, reasons));
        vm.prank(address(manager));
        hook.beforeSwap(factory, key, _swapParams(), "");
    }

    function _deployHook() internal returns (BellHook) {
        (uint64 nonce, address predicted) = _nextValidAddress();
        vm.setNonce(address(this), nonce);
        BellHook deployed = BellHook(this.deployHook(_config(), _key(), templateCodeHash, address(sessions)));
        require(address(deployed) == predicted, "hook address prediction");
        return deployed;
    }

    function _nextValidAddress() internal view returns (uint64 nonce, address predicted) {
        nonce = vm.getNonce(address(this));
        while (true) {
            predicted = vm.computeCreateAddress(address(this), nonce);
            if (uint160(predicted) & HOOK_FLAG_MASK == EXPECTED_HOOK_FLAGS) return (nonce, predicted);
            ++nonce;
        }
    }

    function _installBaseState() internal {
        assets.setDescriptor(_descriptor(asset0, token0, true));
        assets.setDescriptor(_descriptor(asset1, token1, false));
        uint64 nowTime = uint64(block.timestamp);
        calendar.setCurrent(_activeLeaf(asset0, PolicyConstants.PHASE_REGULAR, nowTime - 100, nowTime + 1000));
        calendar.setNext(_activeLeaf(asset0, PolicyConstants.PHASE_REGULAR, nowTime + 1000, nowTime + 2000));
        sessions.setHealth(asset0, _healthyHealth(nowTime - 10, nowTime + 500));
        sessions.setHealth(asset1, _healthyHealth(nowTime - 10, nowTime + 500));
    }

    function _enableSecondStock() internal {
        assets.setDescriptor(_descriptor(asset1, token1, true));
        sessions.setHealth(asset1, _healthyHealth(uint64(block.timestamp) - 10, uint64(block.timestamp) + 500));
    }

    function _config() internal view returns (PoolConfig memory config) {
        config.token0 = token0;
        config.token1 = token1;
        config.asset0 = asset0;
        config.asset1 = asset1;
        config.poolManager = address(manager);
        config.positionManager = positionManager;
        config.factory = factory;
        config.assetRegistry = address(assets);
        config.calendarRegistry = address(calendar);
        config.safetyController = address(safety);
        config.treasuryAdapter = treasuryAdapter;
        config.poolClass = uint8(PoolClass.PRICE_GUARDED);
        config.liquidityMode = uint8(LiquidityMode.PUBLIC);
        config.referenceMode = 0;
        config.tickSpacing = 60;
        config.tradeCap = [uint128(1_000_000), uint128(2_000_000)];
        config.windowCap = [uint128(10_000_000), uint128(20_000_000)];
        config.closureCap = [uint128(500_000), uint128(1_000_000)];
        config.policyId = keccak256("POLICY_V1");
        config.referenceAdapter0 = address(0);
        config.referenceAdapter1 = address(0);
    }

    function _key() internal view returns (PoolKey memory key) {
        key.currency0 = Currency.wrap(token0);
        key.currency1 = Currency.wrap(token1);
        key.fee = LPFeeLibrary.DYNAMIC_FEE_FLAG;
        key.tickSpacing = 60;
        key.hooks = IHooks(address(0));
    }

    function _descriptor(bytes32 assetId, address token, bool isStock)
        internal
        view
        returns (AssetDescriptor memory descriptor_)
    {
        descriptor_.id = assetId;
        descriptor_.token = token;
        descriptor_.isStock = isStock;
        descriptor_.decimals = 18;
        descriptor_.capabilityMask = isStock ? 0x1e : 0;
        descriptor_.expectedCodeHash = token.codehash;
        descriptor_.implementationFingerprint = keccak256(abi.encode(assetId, "IMPLEMENTATION"));
        descriptor_.evidenceHash = keccak256(abi.encode(assetId, "EVIDENCE"));
    }

    function _activeLeaf(bytes32 assetId, uint8 phase, uint64 start, uint64 end)
        internal
        pure
        returns (CalendarLeaf memory leaf)
    {
        leaf.assetId = assetId;
        leaf.year = 2026;
        leaf.index = 0;
        leaf.start = start;
        leaf.end = end;
        leaf.phase = phase;
        leaf.provenanceHash = keccak256(abi.encode("ACTIVE", assetId, start, end));
    }

    function _closedLeaf(bytes32 assetId, uint64 start, uint64 end) internal pure returns (CalendarLeaf memory leaf) {
        leaf.assetId = assetId;
        leaf.year = 2026;
        leaf.index = 1;
        leaf.start = start;
        leaf.end = end;
        leaf.phase = PolicyConstants.PHASE_CLOSED;
        leaf.provenanceHash = keccak256(abi.encode("CLOSED", assetId, start, end));
    }

    function _setClosedContext(bytes32 assetId, uint64 start, uint64 end, uint64 inputAt)
        internal
        returns (bytes32 boundary)
    {
        CalendarLeaf memory closed = _closedLeaf(assetId, start, end);
        calendar.setCurrent(closed);
        calendar.setNext(_activeLeaf(assetId, PolicyConstants.PHASE_REGULAR, end, end + 1000));
        boundary = CalendarProof.hashLeaf(block.chainid, address(calendar), closed);
        _setAnchor(assetId, boundary, inputAt, start, inputAt + 345_600 + 1);
    }

    function _setAnchor(bytes32 assetId, bytes32 boundary, uint64 inputAt, uint64 closureStart, uint64 validUntil)
        internal
    {
        sessions.setAnchor(
            assetId, boundary, 100e18, 1e18, inputAt, inputAt, closureStart, inputAt, true, 0, validUntil
        );
    }

    function _setActiveContext(bytes32 assetId, uint64 observation, uint64 validUntil) internal {
        uint64 nowTime = uint64(block.timestamp);
        calendar.setCurrent(_activeLeaf(assetId, PolicyConstants.PHASE_REGULAR, nowTime - 100, nowTime + 1000));
        sessions.setHealth(assetId, _healthyHealth(observation, validUntil));
    }

    function _setQuoteHealthy() internal {
        uint64 nowTime = uint64(block.timestamp);
        sessions.setHealth(asset1, _healthyHealth(nowTime - 10, nowTime + 500));
    }

    function _healthyHealth(uint64 observation, uint64 validUntil) internal view returns (HealthView memory health_) {
        health_.ready = true;
        health_.reasonBits = 0;
        health_.healthySince = uint64(block.timestamp - 100);
        health_.validUntil = validUntil;
        health_.baselineObservation = observation > 50 ? observation - 50 : observation;
        health_.latestObservation = observation;
    }

    function _unhealthyHealth(uint256 reasons) internal pure returns (HealthView memory health_) {
        health_.ready = false;
        health_.reasonBits = reasons;
        health_.validUntil = 0;
    }

    function _setLive() internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        word = (word & ~uint256(0xff)) | uint256(Lifecycle.LIVE);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
        // A genuinely activated fixture also commits the normative bellStart marker. Tests that model an
        // unactivated LIVE pool use `_setLiveUnactivated` instead.
        _setBellStart(1);
    }

    function _setLiveUnactivated() internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        word = (word & ~uint256(0xff)) | uint256(Lifecycle.LIVE);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
    }

    function _setBellStart(uint64 value) internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(AUX_STATE_SLOT)));
        uint256 mask = uint256(0xffffffffffffffff) << 64;
        word = (word & ~mask) | (uint256(value) << 64);
        vm.store(address(hook), bytes32(AUX_STATE_SLOT), bytes32(word));
    }

    function _setOldValidUntil(uint64 value) internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        uint256 mask = uint256(0xffffffffffffffff) << 152;
        word = (word & ~mask) | (uint256(value) << 152);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
    }

    function _setMode(uint8 mode_) internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        word = (word & ~(uint256(0xff) << 8)) | (uint256(mode_) << 8);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
    }

    function _setClosureNonce(uint64 nonce) internal {
        uint256 word = uint256(vm.load(address(hook), bytes32(STATE_SLOT)));
        uint256 mask = uint256(0xffffffffffffffff) << 24;
        word = (word & ~mask) | (uint256(nonce) << 24);
        vm.store(address(hook), bytes32(STATE_SLOT), bytes32(word));
    }

    function _setEpisodeGross(uint64 nonce, uint128 gross0, uint128 gross1) internal {
        bytes32 valueSlot = keccak256(abi.encode(uint256(nonce), EPISODE_GROSS_SLOT));
        vm.store(address(hook), valueSlot, bytes32(uint256(gross0) | (uint256(gross1) << 128)));
    }

    function _setBuckets(uint64 epoch, uint128 current0, uint128 current1, uint128 previous0, uint128 previous1)
        internal
    {
        vm.store(address(hook), bytes32(BUCKETS_EPOCH_SLOT), bytes32(uint256(epoch)));
        vm.store(address(hook), bytes32(BUCKETS_CURRENT_SLOT), bytes32(uint256(current0) | (uint256(current1) << 128)));
        vm.store(
            address(hook), bytes32(BUCKETS_PREVIOUS_SLOT), bytes32(uint256(previous0) | (uint256(previous1) << 128))
        );
    }

    function _requireBuckets(uint64 epoch, uint128 current0, uint128 current1, uint128 previous0, uint128 previous1)
        internal
        view
    {
        Buckets memory buckets = hook.buckets();
        require(buckets.epoch == epoch, "epoch");
        require(buckets.currentGross[0] == current0 && buckets.currentGross[1] == current1, "current");
        require(buckets.previousGross[0] == previous0 && buckets.previousGross[1] == previous1, "previous");
    }

    function _hasEvent(VmClosure.Log[] memory logs, bytes32 topic) internal pure returns (bool) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length != 0 && logs[i].topics[0] == topic) return true;
        }
        return false;
    }

    function _live() internal {
        _setLive();
        _setMode(uint8(Mode.ACTIVE));
        uint64 nowTime = uint64(block.timestamp);
        _setActiveContext(asset0, nowTime - 10, nowTime + 5000);
        _setOldValidUntil(nowTime + 5000);
        _setQuoteHealthy();
    }

    function _halt(bytes32 assetId) internal {
        haltReg.halt(assetId, haltReg.lastHaltId(assetId) + 1, uint64(block.timestamp) - 60, REASON, block.timestamp + 600, hex"01", hex"02");
    }

    function testWithNoHaltThePoolBehavesAsBefore() external {
        _live();
        PolicyView memory p = hook.refreshState();
        require(p.mode == uint8(Mode.ACTIVE) && p.canSwap, "not active without a halt");
        require(p.lpFeeUnits != PolicyConstants.FEE_CLOSED, "closed fee without a halt");
    }

    function testAHaltIsPricedAsClosedNotBlockedV1() external {
        _live();
        _halt(asset0);
        PolicyView memory view_ = hook.getPolicy();
        require(view_.mode == uint8(Mode.CLOSED), "view not closed");
        require(view_.phase == PolicyConstants.PHASE_CLOSED, "phase not closed");
        require(view_.lpFeeUnits == PolicyConstants.FEE_CLOSED, "view fee");
        require(view_.validUntil == block.timestamp + 2 hours, "validity is not the halt expiry");
        PolicyView memory p = hook.refreshState();
        require(p.mode == uint8(Mode.CLOSED), "not closed");
        require(p.canSwap, "swaps are blocked during a halt");
        require(p.reasonBits == 0, "halt carries a blocking reason");
        require(p.lpFeeUnits == PolicyConstants.FEE_CLOSED, "fee is not 10000 pips");
        require(p.closureNonce == 1 && hook.state().closedLatched, "closure not latched");
    }

    function testAHaltOnAnotherAssetDoesNotTouchThisPool() external {
        _live();
        _halt(keccak256("OTHER"));
        PolicyView memory p = hook.refreshState();
        require(p.mode == uint8(Mode.ACTIVE) && p.canSwap, "unrelated halt affected the pool");
    }

    function testTheHaltExpiresOnItsOwnAndTheClosureRecoversThroughTheExistingPathV4() external {
        _live();
        _halt(asset0);
        require(hook.refreshState().mode == uint8(Mode.CLOSED), "not closed");
        uint64 t = uint64(block.timestamp) + 2 hours + 1;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 5000);
        _setQuoteHealthy();
        PolicyView memory after_ = hook.refreshState();
        require(after_.mode == uint8(Mode.RECOVERING), "no recovery after the halt expired");
        require(!after_.canSwap, "swaps open before recovery finished");
    }

    function testTheResumeWindowIsPricedAsClosedByTheOracle() external {
        _live();
        _halt(asset0);
        uint64 id = haltReg.lastHaltId(asset0);
        vm.warp(block.timestamp + 20 minutes);
        uint64 t = uint64(block.timestamp);
        _setActiveContext(asset0, t, t + 5000);
        _setQuoteHealthy();
        haltReg.resume(asset0, id, t - 5, t + 600, hex"01", hex"02");
        require(haltReg.phase(asset0) == HaltRegistry.Phase.RESUME_AUCTION, "no resume window");
        PolicyView memory p = hook.refreshState();
        require(p.mode == uint8(Mode.CLOSED) && p.lpFeeUnits == PolicyConstants.FEE_CLOSED, "resume window not priced as closed");
        require(p.validUntil == t + 5 minutes, "window end");
    }

    /// @dev V5: an earnings window is a CLOSED leaf carved out of a trading interval (scripts/calendar/event-windows.mjs). The hook treats it as
    ///      any planned closure: latched at its start with the closure budget, then the ordinary recovery on the reopen.
    function testV5_AnEarningsWindowInsideTheDayIsAPlannedClosureThenRecoversToActive() external {
        _live();
        uint64 t0 = uint64(block.timestamp);
        PolicyView memory before_ = hook.refreshState();
        require(before_.mode == uint8(Mode.ACTIVE) && before_.canSwap, "not active before the window");

        // The calendar interval is REGULAR until the window starts, then a two hour CLOSED leaf, then REGULAR again.
        bytes32 boundary = _setClosedContext(asset0, t0, t0 + 2 hours, t0 - 10);
        require(boundary != bytes32(0), "no boundary");
        PolicyView memory inWindow = hook.refreshState();
        require(inWindow.mode == uint8(Mode.CLOSED), "window is not a closure");
        require(inWindow.phase == PolicyConstants.PHASE_CLOSED, "phase is not CLOSED");
        require(inWindow.canSwap && inWindow.reasonBits == 0, "closure is blocking, not priced");
        require(inWindow.closureNonce == 1 && hook.state().closedLatched, "closure not latched");

        // The window ends and the calendar returns to REGULAR: recovery first needs a fresh observation and sixty seconds.
        uint64 t = t0 + 2 hours + 1;
        vm.warp(t);
        _setActiveContext(asset0, t, t + 5000);
        _setQuoteHealthy();
        PolicyView memory candidate = hook.refreshState();
        require(candidate.mode == uint8(Mode.RECOVERING) && !candidate.canSwap, "no recovery after the window");

        vm.warp(t + 61);
        _setActiveContext(asset0, t + 61, t + 5061);
        _setQuoteHealthy();
        PolicyView memory reopened = hook.refreshState();
        require(reopened.mode == uint8(Mode.ACTIVE) && reopened.canSwap, "pool did not reopen after the window");
        require(!hook.state().closedLatched && hook.state().closureNonce == 1, "closure not released");
    }

    function testV5_AnEarningsWindowWithoutACapturedAnchorBlocksInsteadOfPricing() external {
        _live();
        uint64 t0 = uint64(block.timestamp);
        // A CLOSED leaf with no captured anchor is not a proven closure: it blocks instead of pricing.
        calendar.setCurrent(_closedLeaf(asset0, t0, t0 + 2 hours));
        calendar.setNext(_activeLeaf(asset0, PolicyConstants.PHASE_REGULAR, t0 + 2 hours, t0 + 3 hours));
        PolicyView memory p = hook.refreshState();
        require(!p.canSwap, "unanchored window priced as a closure");
        require(p.mode != uint8(Mode.CLOSED), "unanchored window became CLOSED");
    }
}
