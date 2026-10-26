// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetDescriptor, PoolClass} from "../types/ProtocolTypes.sol";

library AssetPolicy {
    /// @dev Absence of a price source is an explicit admitted descriptor shape, never a failed read.
    /// Identity, code/decimals/evidence, token pause and stock health checks remain separate requirements.
    function oraclelessCounterasset(AssetDescriptor memory d, uint8 poolClass) internal pure returns (bool) {
        return poolClass == uint8(PoolClass.SESSION_ONLY) && !d.isStock && d.capabilityMask == 0
            && d.tokenPriceAdapter == address(0) && d.regularAdapter == address(0)
            && d.extendedAdapter == address(0) && d.overnightAdapter == address(0) && d.secondaryAdapter == address(0);
    }
}
