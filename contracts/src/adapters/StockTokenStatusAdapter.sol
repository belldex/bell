// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PolicyConstants} from "../libraries/PolicyConstants.sol";

interface IRobinhoodStockTokenStatus {
    function uiMultiplier() external view returns (uint256);
    function newUIMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
    function oraclePaused() external view returns (bool);
}

contract StockTokenStatusAdapter {
    error InvalidTokenStatus();
    error CorporateInconsistent();

    struct Status {
        uint128 multiplier18;
        uint128 pendingMultiplier18;
        uint64 effectiveAt;
        bool pending;
        bool oraclePaused;
        bytes32 fingerprint;
    }

    function readStatus(address token, uint64 nowTimestamp) external view returns (Status memory status) {
        if (token == address(0) || token.code.length == 0) revert InvalidTokenStatus();
        uint256 multiplier = _readUint(token, IRobinhoodStockTokenStatus.uiMultiplier.selector);
        uint256 nextMultiplier = _readUint(token, IRobinhoodStockTokenStatus.newUIMultiplier.selector);
        uint256 effectiveAt = _readUint(token, IRobinhoodStockTokenStatus.effectiveAt.selector);
        bool paused = _readBool(token, IRobinhoodStockTokenStatus.oraclePaused.selector);
        if (multiplier == 0 || multiplier > type(uint128).max || nextMultiplier == 0 || nextMultiplier > type(uint128).max
            || effectiveAt > type(uint64).max) revert InvalidTokenStatus();

        bool pending = effectiveAt > nowTimestamp;
        if (effectiveAt == 0 && nextMultiplier != multiplier) revert CorporateInconsistent();
        if (effectiveAt != 0 && !pending && nextMultiplier != multiplier) revert CorporateInconsistent();
        // All three values are explicitly bounded to their destination widths above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 normalizedMultiplier = uint128(multiplier);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 normalizedPendingMultiplier = uint128(nextMultiplier);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 normalizedEffectiveAt = uint64(effectiveAt);
        status = Status({
            multiplier18: normalizedMultiplier,
            pendingMultiplier18: normalizedPendingMultiplier,
            effectiveAt: normalizedEffectiveAt,
            pending: pending,
            oraclePaused: paused,
            fingerprint: keccak256(abi.encode(token.codehash, multiplier, nextMultiplier, effectiveAt, paused))
        });
    }

    function _readUint(address token, bytes4 selector) private view returns (uint256 value) {
        (bool ok, uint256 decoded) = _readWord(token, selector);
        if (!ok) revert InvalidTokenStatus();
        return decoded;
    }

    function _readBool(address token, bytes4 selector) private view returns (bool value) {
        (bool ok, uint256 decoded) = _readWord(token, selector);
        if (!ok) revert InvalidTokenStatus();
        if (decoded > 1) revert InvalidTokenStatus();
        value = decoded == 1;
    }

    function _readWord(address token, bytes4 selector) private view returns (bool success, uint256 value) {
        bytes memory callData = abi.encodeWithSelector(selector);
        assembly ("memory-safe") {
            let output := mload(0x40)
            mstore(0x40, add(output, 32))
            success := staticcall(100000, token, add(callData, 32), mload(callData), output, 32)
            if iszero(eq(returndatasize(), 32)) { success := 0 }
            if success { value := mload(output) }
        }
    }
}
