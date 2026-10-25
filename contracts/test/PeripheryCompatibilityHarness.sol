// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PositionManager} from "../lib/v4-periphery/src/PositionManager.sol";

contract PeripheryCompatibilityHarness {
    function positionManagerCreationCodeHash() external pure returns (bytes32) {
        return keccak256(type(PositionManager).creationCode);
    }
}
