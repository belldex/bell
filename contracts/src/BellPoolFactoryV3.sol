// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellPoolFactory} from "./BellPoolFactory.sol";
import {PoolConfig} from "./types/ProtocolTypes.sol";
import {IBellHookDeployer} from "./interfaces/IBellHookDeployer.sol";

/// @title BellPoolFactoryV3
/// @notice Factory artifact for pools using the BellHookV3 CREATE2 deployer.
/// @dev Pool creation, seed accounting, auction binding and Lens-compatible registration retain
///      BellPoolFactory's existing atomic path. The constructor requires a matching V3 deployer.
contract BellPoolFactoryV3 is BellPoolFactory {
    constructor(PoolConfig memory profile, IBellHookDeployer deployer, address usdg, address recipient)
        BellPoolFactory(profile, deployer, usdg, recipient)
    {}
}
