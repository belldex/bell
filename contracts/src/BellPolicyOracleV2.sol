// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellPolicyOracle} from "./BellPolicyOracle.sol";

/// @title BellPolicyOracleV2
/// @notice V3 hook oracle pinned as a distinct deployment artifact.
/// @dev The policy engine remains the audited BellPolicyOracle implementation. Its dependency
///      reader consumes the unchanged BELL read ABI; V3 pool profiles point those reads at the
///      hybrid session adapter and current calendar/safety registries. This preserves market,
///      fee, cap, auction and recovery behavior while changing how trusted inputs are admitted.
contract BellPolicyOracleV2 is BellPolicyOracle {
    bytes32 public constant POLICY_VERSION = keccak256("BELL_POLICY_ORACLE_V2_HYBRID_INPUTS");
}
