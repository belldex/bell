// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SourceSample} from "../types/ProtocolTypes.sol";
import {PolicyConstants} from "../libraries/PolicyConstants.sol";

/// @notice Minimal signer verifier for real Yahoo-derived quotes attested by a BELL reporter.
/// @dev Yahoo responses are NOT signed by Yahoo. This contract verifies the explicitly trusted
///      BELL reporter's attestation; it must never be described as a Yahoo/Chainlink signature.
contract YahooSourceVerifier {
    using ECDSA for bytes32;

    struct TokenSnapshot {
        uint64 updatedAt;
        uint128 multiplier18;
        uint128 pendingMultiplier18;
        uint64 effectiveAt;
        bool oraclePaused;
        bytes32 codeHash;
    }

    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant REPORT_TYPEHASH = keccak256(
        "YahooQuote(bytes32 sourceConfigHash,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash)"
    );
    bytes32 private constant TOKEN_STATUS_TYPEHASH = keccak256(
        "YahooTokenStatus(address token,uint128 multiplier18,uint128 pendingMultiplier18,uint64 effectiveAt,uint64 observedAt,bool oraclePaused,bytes32 codeHash)"
    );
    bytes32 private constant NAME_HASH = keccak256("BELL Yahoo Quote Reporter");
    bytes32 private constant VERSION_HASH = keccak256("1");

    address public immutable reporter;
    mapping(address token => TokenSnapshot snapshot) private _tokenSnapshots;

    error InvalidReporter();
    error InvalidSignature();
    error InvalidTokenSnapshot();
    error StaleTokenSnapshot();

    constructor(address reporter_) {
        if (reporter_ == address(0)) revert InvalidReporter();
        reporter = reporter_;
    }

    /// @notice Reporter-authorized bounded snapshot for a canonical stock token's corporate status.
    /// @dev Keeps Yahoo quote sourcing independent from any paid price API subscription; token corporate
    ///      state still comes from the token contract and is re-read/bound on every update.
    function publishTokenSnapshot(address token, uint128 multiplier18, uint128 pendingMultiplier18, uint64 effectiveAt, uint64 observedAt, bool oraclePaused, bytes32 codeHash_, bytes calldata signature)
        external
    {
        if (token == address(0) || token.code.length == 0 || multiplier18 == 0 || codeHash_ != token.codehash
            || pendingMultiplier18 == 0 || (effectiveAt == 0 && pendingMultiplier18 != multiplier18)
            || (effectiveAt != 0 && effectiveAt <= observedAt && pendingMultiplier18 != multiplier18)
            || observedAt == 0 || observedAt > block.timestamp
            || block.timestamp - observedAt >= PolicyConstants.MAX_REPORT_AGE_SECONDS) revert InvalidTokenSnapshot();
        bytes32 reportDigest = tokenSnapshotDigest(token, multiplier18, pendingMultiplier18, effectiveAt, observedAt, oraclePaused, codeHash_);
        if (reportDigest.recover(signature) != reporter) revert InvalidSignature();
        if (observedAt <= _tokenSnapshots[token].updatedAt) revert StaleTokenSnapshot();
        _tokenSnapshots[token] = TokenSnapshot(observedAt, multiplier18, pendingMultiplier18, effectiveAt, oraclePaused, codeHash_);
    }

    function tokenSnapshot(address token) external view returns (TokenSnapshot memory snapshot, bool fresh) {
        snapshot = _tokenSnapshots[token];
        fresh = snapshot.updatedAt != 0 && snapshot.updatedAt <= block.timestamp
            && block.timestamp - snapshot.updatedAt < PolicyConstants.MAX_REPORT_AGE_SECONDS
            && token.codehash == snapshot.codeHash;
    }

    function tokenSnapshotDigest(address token, uint128 multiplier18, uint128 pendingMultiplier18, uint64 effectiveAt, uint64 observedAt, bool oraclePaused, bytes32 codeHash_)
        public view returns (bytes32)
    {
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("BELL Yahoo Token Status"),
            VERSION_HASH,
            block.chainid,
            address(this)
        ));
        bytes32 body = keccak256(abi.encode(
            TOKEN_STATUS_TYPEHASH,
            token,
            multiplier18,
            pendingMultiplier18,
            effectiveAt,
            observedAt,
            oraclePaused,
            codeHash_
        ));
        return keccak256(abi.encodePacked("\x19\x01", domain, body));
    }

    function recoverTokenStatusSigner(address token, uint128 multiplier18, uint128 pendingMultiplier18, uint64 effectiveAt, uint64 observedAt, bool oraclePaused, bytes32 codeHash_, bytes calldata signature)
        external view returns (address)
    {
        return tokenSnapshotDigest(token, multiplier18, pendingMultiplier18, effectiveAt, observedAt, oraclePaused, codeHash_).recover(signature);
    }

    function digest(bytes32 sourceConfigHash, SourceSample memory sample) public view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            NAME_HASH,
            VERSION_HASH,
            block.chainid,
            address(this)
        ));
        bytes32 body = keccak256(abi.encode(
            REPORT_TYPEHASH,
            sourceConfigHash,
            sample.feedId,
            sample.phase,
            sample.price18,
            sample.observedAt,
            sample.inputAt,
            sample.validFrom,
            sample.expiresAt,
            sample.validUntil,
            sample.reportHash
        ));
        return keccak256(abi.encodePacked("\x19\x01", domain, body));
    }

    function verify(bytes32 sourceConfigHash, SourceSample memory sample, bytes memory signature)
        public view returns (bool)
    {
        if (digest(sourceConfigHash, sample).recover(signature) != reporter) revert InvalidSignature();
        return true;
    }

    function recoverSigner(bytes32 sourceConfigHash, SourceSample memory sample, bytes memory signature)
        external view returns (address)
    {
        return digest(sourceConfigHash, sample).recover(signature);
    }
}
