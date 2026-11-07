// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellPoolFactoryTest} from "../../integration/factory/BellPoolFactory.t.sol";
import {BellHook} from "../../../src/BellHook.sol";
import {CreateResult, CalendarLeaf, Anchor, Mode} from "../../../src/types/ProtocolTypes.sol";
import {MockCalendarRegistry, MockSafetyController} from "../../unit/hook/BellHookLifecycle.t.sol";
import {ModePolicy} from "../../../src/libraries/ModePolicy.sol";
import {CalendarProof} from "../../../src/libraries/CalendarProof.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Actions} from "../../../lib/v4-periphery/src/libraries/Actions.sol";

interface VmExitFuzz {
    function prank(address) external;
    function warp(uint256) external;
    function mockCall(address, bytes calldata, bytes calldata) external;
    function store(address, bytes32, bytes32) external;
    function snapshotState() external returns (uint256);
    function revertToState(uint256) external returns (bool);
}

/// @notice The exit liveness property, stated as a randomised sequence test.
///
/// Property: for ANY sequence of BELL-side events (pauses of the pool or either asset, any combination of dependency
/// read failures, time moving forward until every feed is stale, the market closing and latching, every flow budget
/// spent), the owner of a position can still remove ALL of its liquidity in kind, receive both tokens, and leave
/// BELL's own state (mode, buckets, seed principal, config) exactly as it was.
///
/// The property is checked after EVERY step of the sequence, not only at the end, on a snapshot that is rolled back
/// so the sequence itself keeps evolving. It is the stateful counterpart of the four fixed-scenario tests in
/// PublicPositionManager.t.sol: those pin four named situations, this one lets the fuzzer combine them in any order.
contract ExitLivenessFuzzTest is BellPoolFactoryTest {
    VmExitFuzz private constant vmx = VmExitFuzz(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant KINDS = 10;

    /// @dev Exit bits of a Uniswap v4 hook address: beforeRemoveLiquidity (9), afterRemoveLiquidity (8),
    ///      afterRemoveLiquidityReturnDelta (0).
    uint160 private constant EXIT_BITS = Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG
        | Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG;

    bool private marketClosed;
    bool private budgetsSpent;

    /// forge-config: default.fuzz.runs = 1500
    function testFuzzOwnerCanAlwaysExitAfterAnySequenceOfBellEvents(uint256[] calldata ops) external {
        CreateResult memory r = factory.createAndSeed(request);
        BellHook hook = BellHook(r.hook);
        require(uint160(r.hook) & EXIT_BITS == 0, "hook address carries an exit bit");

        _assertOwnerExits(hook, r.tokenId); // the untouched pool
        uint256 n = ops.length > 24 ? 24 : ops.length;
        for (uint256 i; i < n; ++i) {
            _apply(hook, ops[i] & 0xff, ops[i] >> 8, i + 1);
            _assertOwnerExits(hook, r.tokenId);
        }
    }

    /// @dev Every kind of event at once, in the order that is hardest on the exit path: pauses, dead dependencies,
    ///      stale time, a latched closure and spent budgets. Fixed, so a regression names itself without a seed.
    function testOwnerExitsAfterEveryEventAtOnce() external {
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
        else if (kind == 8) _closeMarket(hook);
        else _spendBudgets(hook);
        // Let BELL react to what just happened, as a keeper or the next swap would. A refresh that itself reverts is
        // a BELL-side failure, and exiting must not depend on it, so it is tolerated here.
        try hook.refreshState() {} catch {}
    }

    /// @dev Same fixture as testPublicInKindExitClosedLatchedAndExhaustedBudgets.
    function _closeMarket(BellHook hook) private {
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
        hook;
    }

    /// @dev Test-only accounting injection, as in the fixed test: swaps are disabled in production, so the bucket and
    ///      episode counters are written directly. Layout from `forge inspect`: _buckets.currentGross is slot 5 and
    ///      _episodeGross is the mapping at slot 7.
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

    /// @dev The invariant. Runs the full in-kind exit on a snapshot and rolls it back.
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
                hook.state(),
                hook.buckets(),
                hook.episodeGross(hook.state().closureNonce),
                hook.seedPrincipal(),
                hook.config()
            )
        );
    }
}
