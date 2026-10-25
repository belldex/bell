// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MarketPhase, SwapRequest, SourceWire, PoolConfig, CreateRequest} from "../src/types/ProtocolTypes.sol";

contract ProtocolTypesHarness {
    function marketPhaseValues() external pure returns (uint8, uint8, uint8, uint8, uint8, uint8) {
        return (
            uint8(MarketPhase.UNKNOWN),
            uint8(MarketPhase.PRE),
            uint8(MarketPhase.REGULAR),
            uint8(MarketPhase.POST),
            uint8(MarketPhase.OVERNIGHT),
            uint8(MarketPhase.CLOSED)
        );
    }

    function acceptSwap(SwapRequest calldata request) external pure returns (uint128) {
        return request.amountSpecified;
    }

    function acceptSourceWire(SourceWire calldata wire) external pure returns (uint8) {
        return wire.kind;
    }

    function acceptPoolConfig(PoolConfig calldata config) external pure returns (bytes32) {
        return config.policyId;
    }

    function acceptCreate(CreateRequest calldata request) external pure returns (bytes32) {
        return request.config.policyId;
    }
}
