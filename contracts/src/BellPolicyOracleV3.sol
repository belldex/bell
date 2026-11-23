// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellPolicyOracleV2} from "./BellPolicyOracleV2.sol";

interface IHaltedUntil {
    function haltedUntil(bytes32 assetId) external view returns (uint64);
}

/// @title BellPolicyOracleV3
/// @notice Einstein Hooks v3 policy oracle: the V2 policy plus a recorded trading halt, priced as a planned CLOSED.
/// @dev While the halt registry reports a stock of the pool as halted, `evaluate` treats the pool as inside a proven closure: swaps
///      are not blocked, they pay the CLOSED fee (10,000 pips) under the closure caps, and exits are untouched because the hook
///      mask (0x2CC0) never calls the hook on removal. The registry's own expiry bounds the state, so a reporter that goes offline
///      cannot leave the pool halted.
///
///      Interim, stated plainly: the five minute resume window is priced the same way (CLOSED fee and caps) until the resume
///      auction is wired to the registry. The auction itself is not part of this contract.
///
///      A failed or malformed registry read is treated as "not halted", not as a block: the registry is a plain view contract and a
///      broken read must not freeze every swap. The checkpoint that commits the closure (`refreshState`) is permissionless, and a swap
///      reverts with `PolicyBlocked(RECOVERY_PENDING)` until someone has called it after a halt begins or ends.
contract BellPolicyOracleV3 is BellPolicyOracleV2 {
    bytes32 public constant POLICY_VERSION_V3 = keccak256("BELL_POLICY_ORACLE_V3_HALT_AWARE");
    uint256 private constant HALT_READ_GAS = 50_000;

    address public immutable haltRegistry;

    error BadHaltRegistry();

    constructor(address haltRegistry_) {
        if (haltRegistry_.code.length == 0) revert BadHaltRegistry();
        haltRegistry = haltRegistry_;
    }

    function _haltedUntil(Input calldata input) internal view override returns (uint64 until) {
        uint64 a = _read(input.asset0);
        uint64 b = _read(input.asset1);
        until = a > b ? a : b;
    }

    function _read(bytes32 assetId) private view returns (uint64 until) {
        if (assetId == bytes32(0)) return 0;
        address registry = haltRegistry;
        bytes4 selector = IHaltedUntil.haltedUntil.selector;
        bool ok;
        uint256 word;
        assembly ("memory-safe") {
            mstore(0, selector)
            mstore(4, assetId)
            ok := staticcall(HALT_READ_GAS, registry, 0, 36, 0, 32)
            if iszero(eq(returndatasize(), 32)) { ok := 0 }
            word := mload(0)
        }
        if (!ok || word > type(uint64).max) return 0;
        return uint64(word);
    }
}
