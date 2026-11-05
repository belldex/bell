// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellAuctionRegistry} from "../src/auction/BellAuctionRegistry.sol";

interface Vm { function prank(address sender) external; }
contract MockAuctionRegistryWriter {}

/// @dev Write-once writer and per-pool binding are fund-safety boundaries.
contract BellAuctionRegistryTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant FACTORY = address(0xFAC);
    address private constant STRANGER = address(0xBAD);
    bytes32 private constant POOL_A = bytes32(uint256(1));
    bytes32 private constant POOL_B = bytes32(uint256(2));

    function _newRegistry() private returns (BellAuctionRegistry registry, address writer) {
        registry = new BellAuctionRegistry(FACTORY);
        writer = address(new MockAuctionRegistryWriter());
        vm.prank(FACTORY);
        registry.setAuctionFactoryModule(writer);
    }

    function _revertSelector(address target, bytes memory data) private returns (bytes4) {
        (bool ok, bytes memory ret) = target.call(data);
        if (ok || ret.length < 4) return bytes4(0);
        bytes4 selector;
        assembly { selector := mload(add(ret, 32)) }
        return selector;
    }

    function testConstructorRejectsZeroFactory() external {
        bool reverted;
        try new BellAuctionRegistry(address(0)) returns (BellAuctionRegistry) { reverted = false; }
        catch { reverted = true; }
        require(reverted, "zero factory accepted");
    }

    function testUnboundPoolReadsZero() external {
        (BellAuctionRegistry registry,) = _newRegistry();
        require(registry.auctionFor(POOL_A) == address(0), "unbound pool must read zero");
    }

    function testFactorySetsWriterOnceAndWriterBinds() external {
        (BellAuctionRegistry registry, address writer) = _newRegistry();
        require(registry.auctionFactoryModule() == writer, "writer not bound");
        vm.prank(writer);
        registry.setAuction(POOL_A, address(0xA11CE));
        require(registry.auctionFor(POOL_A) == address(0xA11CE), "auction not bound");
    }

    function testFactoryCannotReplaceWriter() external {
        (BellAuctionRegistry registry,) = _newRegistry();
        vm.prank(FACTORY);
        bytes4 got = _revertSelector(address(registry), abi.encodeCall(BellAuctionRegistry.setAuctionFactoryModule, (address(0x1234))));
        require(got == BellAuctionRegistry.AlreadySet.selector, "writer changed");
    }

    function testOnlyWriterCanBindAndCannotRebind() external {
        (BellAuctionRegistry registry, address writer) = _newRegistry();
        vm.prank(STRANGER);
        bytes4 got = _revertSelector(address(registry), abi.encodeCall(BellAuctionRegistry.setAuction, (POOL_A, address(0xB0B))));
        require(got == BellAuctionRegistry.Unauthorized.selector, "stranger bound");

        vm.prank(writer);
        registry.setAuction(POOL_A, address(0xA11CE));
        vm.prank(writer);
        got = _revertSelector(address(registry), abi.encodeCall(BellAuctionRegistry.setAuction, (POOL_A, address(0xB0B))));
        require(got == BellAuctionRegistry.AlreadySet.selector, "rebind accepted");
        require(registry.auctionFor(POOL_A) == address(0xA11CE), "binding displaced");
    }

    function testZeroWriterAndZeroAuctionRejected() external {
        BellAuctionRegistry registry = new BellAuctionRegistry(FACTORY);
        vm.prank(FACTORY);
        bytes4 got = _revertSelector(address(registry), abi.encodeCall(BellAuctionRegistry.setAuctionFactoryModule, (address(0))));
        require(got == BellAuctionRegistry.BadConfig.selector, "zero writer accepted");

        (registry,) = _newRegistry();
        address writer = registry.auctionFactoryModule();
        vm.prank(writer);
        got = _revertSelector(address(registry), abi.encodeCall(BellAuctionRegistry.setAuction, (POOL_A, address(0))));
        require(got == BellAuctionRegistry.BadConfig.selector, "zero auction accepted");
    }

    function testPoolBindingsAreIndependent() external {
        (BellAuctionRegistry registry, address writer) = _newRegistry();
        vm.prank(writer); registry.setAuction(POOL_A, address(0xA11CE));
        vm.prank(writer); registry.setAuction(POOL_B, address(0xB0B));
        require(registry.auctionFor(POOL_A) == address(0xA11CE), "pool A wrong");
        require(registry.auctionFor(POOL_B) == address(0xB0B), "pool B wrong");
    }
}
