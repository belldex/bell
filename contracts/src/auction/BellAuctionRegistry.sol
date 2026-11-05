// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title BellAuctionRegistry
/// @notice Write-once map from pool to its Opening Bell Auction.
/// @dev Exists only to break the hook/auction circular dependency: the hook needs the auction address
///      at construction, and the auction needs the hook to have been deployed first. The hook holds
///      this registry (known before either pool contract exists) and resolves its auction per swap.
///      A pool's auction can be written at most once, by the factory, so the binding stays immutable
///      in practice while the deployment order stays acyclic.
contract BellAuctionRegistry {
    error Unauthorized();
    error AlreadySet();
    error BadConfig();

    address public immutable factory;
    address public auctionFactoryModule;
    mapping(bytes32 poolId => address auction) private _auction;

    constructor(address factory_) {
        if (factory_ == address(0)) revert BadConfig();
        factory = factory_;
    }

    /// @notice Bind a pool to its auction. Callable once per pool, by the factory only.
    function setAuction(bytes32 poolId, address auction) external {
        if (msg.sender != auctionFactoryModule || auctionFactoryModule == address(0)) revert Unauthorized();
        if (auction == address(0)) revert BadConfig();
        if (_auction[poolId] != address(0)) revert AlreadySet();
        _auction[poolId] = auction;
    }

    /// @notice Bind the deployment module that creates auctions, once, from the protocol factory.
    function setAuctionFactoryModule(address module) external {
        if (msg.sender != factory) revert Unauthorized();
        if (auctionFactoryModule != address(0)) revert AlreadySet();
        if (module == address(0) || module.code.length == 0) revert BadConfig();
        auctionFactoryModule = module;
    }

    /// @notice The auction bound to a pool, or the zero address when none is bound yet.
    function auctionFor(bytes32 poolId) external view returns (address) {
        return _auction[poolId];
    }

    /// @notice Whether the bound auction currently blocks ordinary pool actions.
    /// @dev HookV2 calls this once instead of resolving the auction and making a second staticcall.
    function blocksSwaps(bytes32 poolId) external view returns (bool) {
        address auction = _auction[poolId];
        if (auction == address(0)) return false;
        return IRegistryAuction(auction).blocksSwaps();
    }
}

interface IRegistryAuction {
    function blocksSwaps() external view returns (bool);
}
