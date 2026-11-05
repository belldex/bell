// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellAuctionRegistry} from "../src/auction/BellAuctionRegistry.sol";

interface Vm {
    function prank(address sender) external;
}

/// @dev The registry is the only thing binding a pool to its auction, so its write-once rule is a
///      loss-of-funds boundary: a rebindable pool could be pointed at an attacker's auction and have
///      every order routed through it.
contract BellAuctionRegistryTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant FACTORY = address(0xFAC);
    address private constant STRANGER = address(0xBAD);
    bytes32 private constant POOL_A = bytes32(uint256(1));
    bytes32 private constant POOL_B = bytes32(uint256(2));

    function _newRegistry() private returns (BellAuctionRegistry) {
        return new BellAuctionRegistry(FACTORY);
    }

    function _revertSelector(address target, bytes memory data) private returns (bytes4) {
        (bool ok, bytes memory ret) = target.call(data);
        if (ok || ret.length < 4) return bytes4(0);
        bytes4 selector;
        assembly {
            selector := mload(add(ret, 32))
        }
        return selector;
    }

    function testConstructorRejectsZeroFactory() external {
        bool reverted;
        try new BellAuctionRegistry(address(0)) returns (BellAuctionRegistry) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "zero factory accepted");
    }

    function testUnboundPoolReadsZero() external {
        BellAuctionRegistry registry = _newRegistry();
        require(registry.auctionFor(POOL_A) == address(0), "unbound pool must read zero");
    }

    function testFactoryBindsOnce() external {
        BellAuctionRegistry registry = _newRegistry();
        vm.prank(FACTORY);
        registry.setAuction(POOL_A, address(0xA11CE));
        require(registry.auctionFor(POOL_A) == address(0xA11CE), "binding not stored");
    }

    function testRebindIsRejected() external {
        BellAuctionRegistry registry = _newRegistry();
        vm.prank(FACTORY);
        registry.setAuction(POOL_A, address(0xA11CE));

        // Even the factory cannot displace an existing binding, so a later mistake cannot reroute a
        // pool that already has an auction.
        vm.prank(FACTORY);
        bytes4 got =
            _revertSelector(address(registry), abi.encodeCall(BellAuctionRegistry.setAuction, (POOL_A, address(0xB0B))));
        require(got == BellAuctionRegistry.AlreadySet.selector, "rebind accepted");
        require(registry.auctionFor(POOL_A) == address(0xA11CE), "binding was displaced");
    }

    function testStrangerCannotBind() external {
        BellAuctionRegistry registry = _newRegistry();
        vm.prank(STRANGER);
        bytes4 got =
            _revertSelector(address(registry), abi.encodeCall(BellAuctionRegistry.setAuction, (POOL_A, address(0xB0B))));
        require(got == BellAuctionRegistry.Unauthorized.selector, "stranger bound an auction");
        require(registry.auctionFor(POOL_A) == address(0), "stranger mutated state");
    }

    function testZeroAuctionIsRejected() external {
        BellAuctionRegistry registry = _newRegistry();
        vm.prank(FACTORY);
        bytes4 got =
            _revertSelector(address(registry), abi.encodeCall(BellAuctionRegistry.setAuction, (POOL_A, address(0))));
        require(got == BellAuctionRegistry.BadConfig.selector, "zero auction accepted");
    }

    function testPoolsAreIndependent() external {
        BellAuctionRegistry registry = _newRegistry();
        vm.prank(FACTORY);
        registry.setAuction(POOL_A, address(0xA11CE));
        vm.prank(FACTORY);
        registry.setAuction(POOL_B, address(0xB0B));
        require(registry.auctionFor(POOL_A) == address(0xA11CE), "pool A wrong");
        require(registry.auctionFor(POOL_B) == address(0xB0B), "pool B wrong");
    }
}
