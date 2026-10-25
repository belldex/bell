// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SourceWire} from "../types/ProtocolTypes.sol";

library SourceConfigHash {
    function hash(SourceWire memory wire) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            wire.kind,
            wire.phaseScope,
            wire.endpoint,
            wire.feedId,
            wire.schema,
            wire.decimals,
            wire.priceBasis,
            wire.heartbeatSec,
            wire.expectedCodeHash,
            wire.expectedImplementation,
            wire.canonicalTokenId
        ));
    }
}
