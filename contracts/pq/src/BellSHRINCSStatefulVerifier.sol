// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.28;

import {SHRINCSVerifier} from "quip-hashsigs/contracts/SHRINCSVerifier.sol";

/// @title BellSHRINCSStatefulVerifier
/// @notice Testnet Phase 1 profile verifier. The deployed contract supports
///         audited stateful SHRINCS signatures; stateless recovery is not wired.
/// @dev Inherits Quip's AGPL verifier. Phase 1 uses the bounded stateful path;
///      a separately deployed SPHINCS+C sibling is required before enabling
///      the stateless recovery endpoint in a later release.
contract BellSHRINCSStatefulVerifier is SHRINCSVerifier {
    bytes32 public constant PROFILE_TAG = keccak256("shrincs-256s-keccak");

    function _pinnedSphincsPlusC() internal pure override returns (address) {
        return address(0);
    }
}
