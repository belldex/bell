// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellPoolFactoryV3} from "../../../src/BellPoolFactoryV3.sol";
import {BellHookDeployerV3} from "../../../src/BellHookDeployerV3.sol";
import {BellHookV3} from "../../../src/BellHookV3.sol";
import {BellPolicyOracleV2} from "../../../src/BellPolicyOracleV2.sol";
import {BellHook} from "../../../src/BellHook.sol";
import {BellModeEvaluator} from "../../../src/BellModeEvaluator.sol";
import {BellAuctionRegistry} from "../../../src/auction/BellAuctionRegistry.sol";
import {BellAuctionFactoryModule} from "../../../src/auction/BellAuctionFactoryModule.sol";
import {IBellHookDeployer} from "../../../src/interfaces/IBellHookDeployer.sol";
import {ModePolicy} from "../../../src/libraries/ModePolicy.sol";
import {CalendarProof} from "../../../src/libraries/CalendarProof.sol";
import {
    CreateRequest, CreateResult, PoolConfig, AssetDescriptor, HealthView, CalendarLeaf, Anchor
} from "../../../src/types/ProtocolTypes.sol";
import {FactoryToken, FactoryPermit2, FactoryAdmission} from "../../integration/factory/BellPoolFactory.t.sol";
import {MockCalendarRegistry, MockSessionRegistry, MockSafetyController} from "../../unit/hook/BellHookLifecycle.t.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Actions} from "../../../lib/v4-periphery/src/libraries/Actions.sol";
import {PositionManager} from "../../../lib/v4-periphery/src/PositionManager.sol";
import {IPositionDescriptor} from "../../../lib/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "../../../lib/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

interface VmExitV3 {
    function prank(address) external;
    function warp(uint256) external;
    function mockCall(address, bytes calldata, bytes calldata) external;
    function store(address, bytes32, bytes32) external;
    function snapshotState() external returns (uint256);
    function revertToState(uint256) external returns (bool);
    function getNonce(address) external view returns (uint64);
    function computeCreateAddress(address, uint256) external pure returns (address);
}

/// @notice The exit liveness property for PQ Hooks v2 pools (BellHookV3 from BellPoolFactoryV3).
///
/// It is the V3 counterpart of ExitLivenessFuzz: the same randomised sequence of BELL-side events (pauses of the pool
/// or either asset, dependency read failures, time moving until every feed is stale, a latched closure, every flow
/// budget spent), with the same check after every step. The pool is built through the V3 stack: BellPolicyOracleV2,
/// BellHookDeployerV3 and BellPoolFactoryV3.
///
/// The post-quantum trust inputs reach the hook only through the registries and the safety controller it already
/// reads, so everything the PQ module can do to a pool is a pause, a stale or failing read, or a new calendar or anchor.
/// Those are the events below. SafetyControllerV2 itself is built with Solidity 0.8.30 in an isolated profile and cannot
/// be imported here, so MockSafetyController stands in for any controller exposing the same view ABI.
contract ExitLivenessV3FuzzTest {
    VmExitV3 private constant vmx = VmExitV3(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant KINDS = 10;
    uint160 private constant EXIT_BITS = Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG
        | Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG;
    address private constant RECIPIENT = address(0xBEEF);
    address private constant SERVICE = address(0xFEE);

    BellPoolFactoryV3 private factory;
    IBellHookDeployer private deployer;
    PoolManager private manager;
    PositionManager private positions;
    FactoryToken private token0;
    FactoryToken private token1;
    FactoryToken private usdg;
    FactoryAdmission private assets;
    MockSessionRegistry private sessions;
    CreateRequest private request;

    bool private marketClosed;
    bool private budgetsSpent;

    function setUp() public {
        vmx.warp(10000);
        manager = new PoolManager(address(this));
        FactoryPermit2 permit2 = new FactoryPermit2();
        positions = new PositionManager(
            manager, IAllowanceTransfer(address(permit2)), 100000, IPositionDescriptor(address(0)), IWETH9(address(0))
        );
        FactoryToken a = new FactoryToken();
        FactoryToken b = new FactoryToken();
        (token0, token1) = address(a) < address(b) ? (a, b) : (b, a);
        usdg = new FactoryToken();
        assets = new FactoryAdmission();
        sessions = new MockSessionRegistry();
        MockCalendarRegistry calendar = new MockCalendarRegistry();
        MockSafetyController safety = new MockSafetyController();
        BellPolicyOracleV2 oracle = new BellPolicyOracleV2();
        BellModeEvaluator modeEvaluator = new BellModeEvaluator();
        address future = vmx.computeCreateAddress(address(this), vmx.getNonce(address(this)) + 3);
        BellAuctionRegistry auctionRegistry = new BellAuctionRegistry(future);
        BellAuctionFactoryModule auctionModule = new BellAuctionFactoryModule(
            future, address(auctionRegistry), address(usdg), 600, 900, 512, 25, 100
        );
        deployer = IBellHookDeployer(
            address(
                new BellHookDeployerV3(
                    future,
                    address(sessions),
                    keccak256(type(BellHookV3).creationCode),
                    oracle,
                    modeEvaluator,
                    address(auctionRegistry),
                    address(auctionModule)
                )
            )
        );
        PoolConfig memory c = PoolConfig({
            token0: address(token0),
            token1: address(token1),
            asset0: bytes32(uint256(1)),
            asset1: bytes32(uint256(2)),
            poolManager: address(manager),
            positionManager: address(positions),
            factory: future,
            assetRegistry: address(assets),
            calendarRegistry: address(calendar),
            safetyController: address(safety),
            treasuryAdapter: address(0),
            poolClass: 1,
            liquidityMode: 0,
            referenceMode: 0,
            tickSpacing: 60,
            tradeCap: [uint128(10), uint128(10)],
            windowCap: [uint128(100), uint128(100)],
            closureCap: [uint128(1), uint128(1)],
            policyId: keccak256("candidate"),
            referenceAdapter0: address(0),
            referenceAdapter1: address(0)
        });
        factory = new BellPoolFactoryV3(c, deployer, address(usdg), SERVICE);
        require(address(factory) == future, "factory prediction");
        _admit(c.asset0, address(token0), true);
        _admit(c.asset1, address(token1), false);
        calendar.setLeaf(CalendarLeaf(c.asset0, 2026, 0, 9000, 20000, 2, keccak256("fixture")));
        calendar.setLeaf(CalendarLeaf(c.asset1, 2026, 0, 9000, 20000, 2, keccak256("fixture")));
        request = CreateRequest(
            c, bytes32(0), 0, 10100, RECIPIENT, uint160(1 << 96), -120, 120, 1000000,
            [uint128(10000), uint128(10000)], 49e6
        );
        request.salt = _mine(request);
        token0.mint(address(this), 1e9);
        token1.mint(address(this), 1e9);
        usdg.mint(address(this), 1e9);
        token0.approve(address(factory), type(uint256).max);
        token1.approve(address(factory), type(uint256).max);
        usdg.approve(address(factory), type(uint256).max);
    }

    /// @dev The V3 template carries the V2 permission mask: no remove-liquidity callback of any kind.
    function testV3PoolHookHasNoExitPermissionBits() public {
        CreateResult memory r = factory.createAndSeed(request);
        require(uint160(r.hook) & 0x3fff == 0x2cc0, "V3 hook mask is not exactly 0x2cc0");
        require(uint160(r.hook) & EXIT_BITS == 0, "V3 hook address carries an exit bit");
        BellHookV3 hook = BellHookV3(r.hook);
        require(!hook.getHookPermissions().beforeRemoveLiquidity, "beforeRemoveLiquidity set");
        require(!hook.getHookPermissions().afterRemoveLiquidity, "afterRemoveLiquidity set");
        require(!hook.getHookPermissions().afterRemoveLiquidityReturnDelta, "exit return-delta set");
    }

    /// forge-config: default.fuzz.runs = 1500
    function testFuzzOwnerCanAlwaysExitAV3PoolAfterAnySequenceOfEvents(uint256[] calldata ops) external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        require(uint160(r.hook) & EXIT_BITS == 0, "hook address carries an exit bit");

        _assertOwnerExits(hook, r.tokenId);
        uint256 n = ops.length > 24 ? 24 : ops.length;
        for (uint256 i; i < n; ++i) {
            _apply(hook, ops[i] & 0xff, ops[i] >> 8, i + 1);
            _assertOwnerExits(hook, r.tokenId);
        }
    }

    /// @dev Every kind of event at once, in the order that is hardest on the exit path. Fixed, so a regression names itself.
    function testV3OwnerExitsAfterEveryEventAtOnce() external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        for (uint256 k; k < KINDS; ++k) {
            _apply(hook, k, 1, k + 1);
            _assertOwnerExits(hook, r.tokenId);
        }
    }

    function _apply(BellHook hook, uint256 kind, uint256 arg, uint256 nonce) private {
        bool flag = arg & 1 == 1;
        MockSafetyController safety = MockSafetyController(request.config.safetyController);
        MockCalendarRegistry calendar = MockCalendarRegistry(request.config.calendarRegistry);
        kind = kind % KINDS;
        if (kind == 0) safety.setPause(ModePolicy.targetId(1, address(hook)), flag, uint64(nonce));
        else if (kind == 1) safety.setPause(ModePolicy.targetId(2, address(token0)), flag, uint64(nonce));
        else if (kind == 2) safety.setPause(ModePolicy.targetId(2, address(token1)), flag, uint64(nonce));
        else if (kind == 3) assets.setRevertReads(flag);
        else if (kind == 4) sessions.setRevertReads(flag);
        else if (kind == 5) calendar.setRevertReads(flag);
        else if (kind == 6) safety.setRevertReads(flag);
        else if (kind == 7) vmx.warp(block.timestamp + 1 + (arg % 60000));
        else if (kind == 8) _closeMarket();
        else _spendBudgets(hook);
        // A refresh that itself reverts is a BELL-side failure; exiting must not depend on it, so it is tolerated.
        try hook.refreshState() {} catch {}
    }

    function _closeMarket() private {
        if (marketClosed) return;
        marketClosed = true;
        CalendarLeaf memory leaf = CalendarLeaf(request.config.asset0, 2026, 1, 9999, 20000, 5, bytes32(uint256(1)));
        MockCalendarRegistry(request.config.calendarRegistry).setLeaf(leaf);
        bytes32 boundary = CalendarProof.hashLeaf(block.chainid, request.config.calendarRegistry, leaf);
        Anchor memory anchor =
            Anchor(request.config.asset0, boundary, 100e18, 1e18, 9998, 9997, 9997, 9999, bytes32(uint256(1)));
        vmx.mockCall(
            address(sessions),
            abi.encodeWithSignature("anchorStatus(bytes32,bytes32)", request.config.asset0, boundary),
            abi.encode(anchor, true, uint256(0), uint64(20000))
        );
        vmx.mockCall(
            request.config.calendarRegistry,
            abi.encodeWithSignature("nextInterval(bytes32)", request.config.asset0),
            abi.encode(CalendarLeaf(request.config.asset0, 2026, 2, 20000, 21000, 5, bytes32(uint256(1))))
        );
    }

    /// @dev Test-only accounting injection, as in the V2 fuzz: _buckets.currentGross is slot 5 and _episodeGross is the
    ///      mapping at slot 7 (layout from `forge inspect`; BellHookV3 adds no storage over BellHookV2).
    function _spendBudgets(BellHook hook) private {
        if (budgetsSpent) return;
        budgetsSpent = true;
        vmx.store(address(hook), bytes32(uint256(5)), bytes32(uint256(100) | (uint256(100) << 128)));
        vmx.store(
            address(hook),
            keccak256(abi.encode(uint64(1), uint256(7))),
            bytes32(uint256(1) | (uint256(1) << 128))
        );
    }

    function _assertOwnerExits(BellHook hook, uint256 id) private {
        uint256 snap = vmx.snapshotState();
        bytes32 stateBefore = _bellState(hook);
        uint256 b0 = token0.balanceOf(RECIPIENT);
        uint256 b1 = token1.balanceOf(RECIPIENT);

        bytes[] memory p = new bytes[](2);
        p[0] = abi.encode(id, uint256(request.liquidity), uint128(1), uint128(1), bytes(""));
        p[1] = abi.encode(hook.poolKey().currency0, hook.poolKey().currency1, RECIPIENT);
        bytes memory data = abi.encode(
            abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR)), p
        );
        vmx.prank(RECIPIENT);
        positions.modifyLiquidities(data, block.timestamp + 100); // reverts, and so fails the test, if exit is held back

        require(positions.getPositionLiquidity(id) == 0, "liquidity not fully removed");
        require(positions.ownerOf(id) == RECIPIENT, "custody changed");
        require(token0.balanceOf(RECIPIENT) > b0 && token1.balanceOf(RECIPIENT) > b1, "not two-token in-kind");
        require(token0.balanceOf(address(positions)) == 0 && token1.balanceOf(address(positions)) == 0, "PM residue");
        require(_bellState(hook) == stateBefore, "exit changed BELL state, budget or seed");
        require(vmx.revertToState(snap), "snapshot");
    }

    function _bellState(BellHook hook) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                hook.state(), hook.buckets(), hook.episodeGross(hook.state().closureNonce), hook.seedPrincipal(), hook.config()
            )
        );
    }

    function _mine(CreateRequest memory r) private view returns (bytes32) {
        PoolKey memory key = PoolKey(
            Currency.wrap(r.config.token0), Currency.wrap(r.config.token1), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(0))
        );
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
        assets.setDescriptor(
            AssetDescriptor(
                id, token, stock, 6, 4, address(0), address(0), address(0), address(0), address(0),
                token.codehash, bytes32(uint256(1)), bytes32(uint256(1))
            )
        );
        sessions.setHealth(id, HealthView(true, 0, 9000, 11000, 9900, 9950));
    }
}
