// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellOpeningAuctionV2} from "../src/auction/BellOpeningAuctionV2.sol";
import {HaltRegistry, IHaltHybridAuth} from "../src/registries/HaltRegistry.sol";
import {MockToken, MockAuctionCalendar, MockAuctionPolicyHook} from "./BellOpeningAuction.t.sol";
import {MockHaltAuth} from "./HaltRegistry.t.sol";

interface VmResume {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
}

/// @dev The reopening auction after a halt (Einstein Hooks v3, proof V2): it opens at the resume, blocks swaps while it runs and clears
///      through the unchanged opening-auction code.
contract BellOpeningAuctionV2Test {
    VmResume private constant vm = VmResume(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant T0 = 1_800_000_000;
    bytes32 private constant ASSET = keccak256("ANT");
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    MockToken private quote;
    MockToken private base;
    MockAuctionCalendar private calendar;
    MockAuctionPolicyHook private hook;
    HaltRegistry private reg;
    BellOpeningAuctionV2 private auction;

    function setUp() public {
        vm.warp(T0);
        quote = new MockToken("Quote", "USDG");
        base = new MockToken("Base", "ANT");
        calendar = new MockAuctionCalendar(ASSET);
        hook = new MockAuctionPolicyHook();
        reg = new HaltRegistry(IHaltHybridAuth(address(new MockHaltAuth())), keccak256("REPORTER"));
        auction = new BellOpeningAuctionV2(address(0xFAC), address(hook), address(calendar), ASSET, address(quote), address(base), 600, 900, 8, 1e18, 1e18, 25, reg);
        quote.mint(ALICE, 10_000e18);
        base.mint(BOB, 10_000e18);
    }

    function _halt(uint64 id) internal {
        reg.halt(ASSET, id, uint64(block.timestamp) - 30, keccak256("LULD"), block.timestamp + 600, hex"01", hex"02");
    }

    function _resume(uint64 id) internal {
        reg.resume(ASSET, id, uint64(block.timestamp) - 5, block.timestamp + 600, hex"01", hex"02");
    }

    function _order(bool buyer, uint128 amount, uint160 limit) internal {
        address who = buyer ? ALICE : BOB;
        MockToken t = buyer ? quote : base;
        vm.prank(who); t.approve(address(auction), type(uint256).max);
        vm.prank(who); auction.submitOrder(buyer, amount, limit);
    }

    function testNothingToArmWhileTheStockIsHaltedOrNormal() external {
        require(!auction.armResume(), "armed with no halt");
        _halt(1);
        require(!auction.armResume(), "armed while still halted");
        require(auction.cycleId() == 0 && !auction.blocksSwaps(), "state changed");
    }

    function testResumeOpensTheAuctionAtOnceAndBlocksSwapsForFiveMinutes() external {
        _halt(1);
        vm.warp(T0 + 20 minutes);
        _resume(1);
        require(auction.armResume(), "resume not armed");
        require(auction.cycleId() == 1 && auction.openTime() == T0 + 20 minutes + 5 minutes, "wrong open time");
        require(auction.currentStage() == 2, "order entry is not open at the resume");
        require(auction.blocksSwaps(), "swaps are not blocked while the auction is open");
        vm.warp(T0 + 20 minutes + 5 minutes);
        require(auction.currentStage() == 3 && auction.blocksSwaps(), "no lock after the window");
    }

    function testOrdersClearAtTheUniformPriceAfterTheWindow() external {
        _halt(1);
        vm.warp(T0 + 10 minutes);
        _resume(1);
        require(auction.armResume(), "resume not armed");
        _order(true, 100e18, uint160(1 << 96));
        _order(false, 100e18, uint160(1 << 96));
        vm.warp(T0 + 10 minutes + 5 minutes);
        auction.settle();
        (uint128 buyerBase,,) = auction.allocation(1, 0);
        (, uint128 sellerQuote,) = auction.allocation(1, 1);
        require(buyerBase == 100e18 && sellerQuote == 100e18, "reopening did not clear");
        vm.prank(ALICE); auction.claimUnfilled(1, 0);
        vm.prank(BOB); auction.claimUnfilled(1, 1);
        require(base.balanceOf(ALICE) == 100e18 && quote.balanceOf(BOB) == 100e18, "fills not delivered");
        require(!auction.blocksSwaps(), "swaps still blocked after settlement");
    }

    function testOrdersAreRefusedBeforeTheResumeAndAfterTheWindowCloses() external {
        _halt(1);
        (bool ok,) = address(auction).call(abi.encodeCall(auction.submitOrder, (true, 10e18, uint160(1 << 96))));
        require(!ok, "order accepted while halted");
        vm.warp(T0 + 10 minutes);
        _resume(1);
        auction.armResume();
        vm.warp(T0 + 10 minutes + 5 minutes);
        vm.prank(ALICE); quote.approve(address(auction), type(uint256).max);
        vm.prank(ALICE);
        (ok,) = address(auction).call(abi.encodeCall(auction.submitOrder, (true, 10e18, uint160(1 << 96))));
        require(!ok, "order accepted after the window closed");
    }

    function testAnUnsettledReopeningRefundsAtTheDeadlineAndSwapsReopen() external {
        _halt(1);
        vm.warp(T0 + 10 minutes);
        _resume(1);
        auction.armResume();
        _order(true, 50e18, uint160(1 << 96));
        vm.warp(T0 + 10 minutes + 5 minutes + 900);
        require(!auction.blocksSwaps(), "swaps blocked past the deadline");
        vm.prank(ALICE); auction.claimUnfilled(1, 0);
        require(quote.balanceOf(ALICE) == 10_000e18, "unsettled order not refunded");
    }

    function testTheSameResumeArmsOnceAndALaterHaltArmsANewCycle() external {
        _halt(1);
        vm.warp(T0 + 10 minutes);
        _resume(1);
        require(auction.armResume(), "first resume not armed");
        require(!auction.armResume(), "same resume armed twice");
        vm.warp(T0 + 10 minutes + 5 minutes + 900);
        _halt(2);
        vm.warp(T0 + 40 minutes);
        _resume(2);
        require(auction.armResume(), "second resume not armed");
        require(auction.cycleId() == 2, "second cycle id");
    }

    function testALeadShorterThanTheResumeWindowIsRefused() external {
        (bool ok,) = address(this).call(abi.encodeCall(this.deployWithLead, (299)));
        require(!ok, "short lead accepted");
        require(this.deployWithLead(300) != address(0), "lead of exactly the window refused");
    }

    function deployWithLead(uint32 lead) external returns (address) {
        return address(new BellOpeningAuctionV2(address(0xFAC), address(hook), address(calendar), ASSET, address(quote), address(base), lead, 900, 8, 1e18, 1e18, 25, reg));
    }
}
