// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ISourceAdapterIdentity {
    function sourceConfigHash() external view returns (bytes32);
    function fingerprint() external view returns (bytes32);
}
