// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Optional extra immutable deployment wiring exposed only by BellHookDeployerV2.
interface IBellAuctionWiringDeployer {
    function auctionRegistry() external view returns (address);
    function auctionFactoryModule() external view returns (address);
}
