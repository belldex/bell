// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SourceSample} from "../types/ProtocolTypes.sol";

interface IYahooSourceVerifier {
    function reporter() external view returns (address);
    function digest(bytes32 sourceConfigHash, SourceSample calldata sample) external view returns (bytes32);
    function verify(bytes32 sourceConfigHash, SourceSample calldata sample, bytes calldata signature)
        external view returns (bool);
    function recoverSigner(bytes32 sourceConfigHash, SourceSample calldata sample, bytes calldata signature)
        external view returns (address);
}

interface IYahooAttestedSourceAdapter {
    function sourceConfigHash() external view returns (bytes32);
    function fingerprint() external view returns (bytes32);
    function feedId() external view returns (bytes32);
    function phaseScope() external view returns (uint8);
    function directPrice() external view returns (bool);
    function readCurrent() external view returns (SourceSample memory sample);
    function previewDirect(SourceSample calldata sample, bytes calldata signature) external view returns (bool valid, uint64 validUntil);
    function publishDirect(SourceSample calldata sample, bytes calldata signature) external;
    function decodeVerified(bytes calldata report) external view returns (SourceSample memory sample);
}
