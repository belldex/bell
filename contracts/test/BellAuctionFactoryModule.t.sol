// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PoolConfig} from "../src/types/ProtocolTypes.sol";
import {BellAuctionFactoryModule} from "../src/auction/BellAuctionFactoryModule.sol";
import {BellAuctionRegistry} from "../src/auction/BellAuctionRegistry.sol";

interface Vm { function prank(address sender) external; }

contract AuctionModuleToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
}

contract AuctionModuleCalendar {}

contract AuctionModuleHook {
    PoolConfig private _config;
    bytes32 private _poolId;
    uint128[2] private _principal;

    constructor(PoolConfig memory config_, bytes32 poolId_) {
        _config = config_;
        _poolId = poolId_;
        _principal = [uint128(1_000_000), uint128(1e18)];
    }

    function config() external view returns (PoolConfig memory) { return _config; }
    function poolId() external view returns (bytes32) { return _poolId; }
    function seedPrincipal() external view returns (uint128[2] memory) { return _principal; }
}

contract BellAuctionFactoryModuleTest {
    address private constant FACTORY = address(0xFAC7);
    bytes32 private constant POOL_ID = keccak256("USDG/AAPL");

    AuctionModuleToken private quote;
    AuctionModuleToken private stock;
    AuctionModuleCalendar private calendar;
    BellAuctionRegistry private registry;
    BellAuctionFactoryModule private module;

    function setUp() external {
        quote = new AuctionModuleToken("Global Dollar", "USDG");
        stock = new AuctionModuleToken("AAPL", "AAPL");
        calendar = new AuctionModuleCalendar();
        registry = new BellAuctionRegistry(FACTORY);
        module = new BellAuctionFactoryModule(FACTORY, address(registry), address(quote), 600, 900, 512, 25, 100);
        vm.prank(FACTORY);
        registry.setAuctionFactoryModule(address(module));
    }

    function testPriceGuardedUsdGStockPoolDoesNotReceiveP2PAuction() external {
        PoolConfig memory config;
        config.token0 = address(quote);
        config.token1 = address(stock);
        config.asset0 = bytes32(uint256(1));
        config.asset1 = bytes32(uint256(2));
        config.factory = FACTORY;
        config.calendarRegistry = address(calendar);
        config.poolClass = 0; // PRICE_GUARDED
        AuctionModuleHook hook = new AuctionModuleHook(config, POOL_ID);

        vm.prank(FACTORY);
        address auction = module.createAuction(address(hook), POOL_ID);

        require(auction == address(0), "PRICE_GUARDED pool received P2P auction");
        require(registry.auctionFor(POOL_ID) == address(0), "guarded pool was bound");
    }

    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}
