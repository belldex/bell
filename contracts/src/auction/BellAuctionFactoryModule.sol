// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolClass, PoolConfig} from "../types/ProtocolTypes.sol";
import {BellHook} from "../BellHook.sol";
import {BellOpeningAuction} from "./BellOpeningAuction.sol";

interface IFactoryAuctionRegistry {
    function setAuctionFactoryModule(address module) external;
    function setAuction(bytes32 poolId, address auction) external;
    function auctionFor(bytes32 poolId) external view returns (address);
}

/// @title BellAuctionFactoryModule
/// @notice Isolated deployment module so BellPoolFactory runtime remains under EIP-170.
/// @dev One immutable module per protocol deployment; only the bound factory can deploy auctions.
///      It contains BellOpeningAuction creation code which would otherwise push BellPoolFactory well
///      above the 24,576-byte runtime limit. The module rechecks pool identity/principal and writes the
///      auction to the write-once registry atomically with createAndSeed.
contract BellAuctionFactoryModule {
    error Unauthorized();
    error BadPool();
    error AlreadyEstablished();

    address public immutable factory;
    address public immutable auctionRegistry;
    address public immutable quoteToken;
    uint32 public immutable auctionLead;
    uint32 public immutable settleTimeout;
    uint32 public immutable maximumCycles;
    uint8 public immutable maxOrders;
    uint128 public immutable minOrderDivisor;

    constructor(
        address factory_,
        address auctionRegistry_,
        address quoteToken_,
        uint32 auctionLead_,
        uint32 settleTimeout_,
        uint32 maximumCycles_,
        uint8 maxOrders_,
        uint128 minOrderDivisor_
    ) {
        if (factory_ == address(0) || auctionRegistry_.code.length == 0 || quoteToken_.code.length == 0
            || auctionLead_ == 0 || settleTimeout_ == 0 || maximumCycles_ == 0 || maxOrders_ == 0
            || maxOrders_ > 25 || minOrderDivisor_ == 0) revert BadPool();
        factory = factory_;
        auctionRegistry = auctionRegistry_;
        quoteToken = quoteToken_;
        auctionLead = auctionLead_;
        settleTimeout = settleTimeout_;
        maximumCycles = maximumCycles_;
        maxOrders = maxOrders_;
        minOrderDivisor = minOrderDivisor_;
    }

    /// @notice Deploy and bind one reusable P2P auction to a newly seeded USDG/stock pool.
    function createAuction(address hook, bytes32 poolId) external returns (address auction) {
        if (msg.sender != factory) revert Unauthorized();
        if (IFactoryAuctionRegistry(auctionRegistry).auctionFor(poolId) != address(0)) revert AlreadyEstablished();
        PoolConfig memory config = BellHook(hook).config();
        if (config.factory != factory || BellHook(hook).poolId() != poolId) revert BadPool();
        // V1's P2P-only price discovery is deliberately unanchored. Never bind it to a
        // PRICE_GUARDED pool, whose policy and fallback semantics are a different product.
        if (config.poolClass != uint8(PoolClass.SESSION_ONLY)) return address(0);
        // V1 auction economics support USDG/stock only. Other valid SESSION_ONLY pairs can still
        // create under the v2 hook; with no auction registry binding, normal swap policy applies.
        if (config.token0 != quoteToken && config.token1 != quoteToken) return address(0);
        bool quoteIsToken0 = config.token0 == quoteToken;
        bytes32 baseAsset = quoteIsToken0 ? config.asset1 : config.asset0;
        uint128[2] memory principal = BellHook(hook).seedPrincipal();
        uint128 quotePrincipal = quoteIsToken0 ? principal[0] : principal[1];
        uint128 basePrincipal = quoteIsToken0 ? principal[1] : principal[0];
        uint128 minQuote = quotePrincipal / minOrderDivisor;
        uint128 minBase = basePrincipal / minOrderDivisor;
        if (minQuote == 0) minQuote = 1;
        if (minBase == 0) minBase = 1;

        auction = address(new BellOpeningAuction(
            factory,
            hook,
            config.calendarRegistry,
            baseAsset,
            quoteToken,
            quoteIsToken0 ? config.token1 : config.token0,
            auctionLead,
            settleTimeout,
            maximumCycles,
            minQuote,
            minBase,
            maxOrders
        ));
        IFactoryAuctionRegistry(auctionRegistry).setAuction(poolId, auction);
    }
}
