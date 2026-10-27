// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SourceSample} from "../types/ProtocolTypes.sol";
import {PolicyConstants} from "../libraries/PolicyConstants.sol";
import {ISourceAdapterIdentity} from "../interfaces/ISourceAdapterIdentity.sol";
import {YahooSourceVerifier} from "./YahooSourceVerifier.sol";

interface IYahooTokenSnapshot {
    function tokenSnapshot(address token) external view
        returns (YahooSourceVerifier.TokenSnapshot memory snapshot, bool fresh);
}

/// @notice Adapter that accepts actual offchain Yahoo quote data attested by a configured BELL reporter.
/// @dev This is centralized reporter trust, not Yahoo-origin authentication. Only use after source/rights
///      review and an explicit signer-risk decision. SessionRegistry remains responsible for full freshness.
contract YahooAttestedSourceAdapter is ISourceAdapterIdentity {
    YahooSourceVerifier public immutable verifier;
    bytes32 public immutable override sourceConfigHash;
    bytes32 public immutable feedId;
    uint8 public immutable phaseScope;
    bool public immutable directPrice;
    address public immutable stockToken;
    bytes32 private immutable _verifierCodeHash;
    SourceSample private _currentDirect;

    error BadConfig();
    error BadSignature();
    error BadSample();
    error WrongAdapterMode();
    error StaleObservation();
    error VerifierChanged();

    event DirectQuotePublished(bytes32 indexed reportHash, uint128 price18, uint64 observedAt, uint64 validUntil);

    constructor(
        YahooSourceVerifier verifier_,
        bytes32 wireHash_,
        bytes32 feedId_,
        uint8 phaseScope_,
        bool directPrice_,
        address stockToken_
    ) {
        if (address(verifier_).code.length == 0 || wireHash_ == bytes32(0)) revert BadConfig();
        if (directPrice_) {
            if (feedId_ != bytes32(0) || phaseScope_ != 0) revert BadConfig();
        } else if (feedId_ == bytes32(0) || phaseScope_ < 1 || phaseScope_ > 4) {
            revert BadConfig();
        }
        verifier = verifier_;
        sourceConfigHash = wireHash_;
        feedId = feedId_;
        phaseScope = phaseScope_;
        directPrice = directPrice_;
        if (!directPrice_ && (stockToken_ == address(0) || stockToken_.code.length == 0)) revert BadConfig();
        stockToken = stockToken_;
        _verifierCodeHash = address(verifier_).codehash;
    }

    function fingerprint() external view override returns (bytes32) {
        if (address(verifier).codehash != _verifierCodeHash) revert VerifierChanged();
        return keccak256(abi.encode(address(verifier), _verifierCodeHash, verifier.reporter(), sourceConfigHash, feedId, phaseScope, directPrice, stockToken));
    }

    function readCurrent() external view returns (SourceSample memory sample) {
        if (!directPrice) revert WrongAdapterMode();
        sample = _currentDirect;
        if (sample.reportHash == bytes32(0)) revert BadSample();
    }

    function previewDirect(SourceSample calldata sample, bytes calldata signature)
        external view returns (bool valid, uint64 validUntil)
    {
        if (!directPrice) revert WrongAdapterMode();
        _validate(sample, bytes32(0), 0);
        _verify(sample, signature);
        if (sample.observedAt <= _currentDirect.observedAt) revert StaleObservation();
        return (true, sample.validUntil);
    }

    /// @notice Anyone can relay a reporter-signed direct adjusted-token quote; replay/age checks apply.
    function publishDirect(SourceSample calldata sample, bytes calldata signature) external {
        if (!directPrice) revert WrongAdapterMode();
        _validate(sample, bytes32(0), 0);
        _verify(sample, signature);
        if (sample.observedAt <= _currentDirect.observedAt) revert StaleObservation();
        _currentDirect = sample;
        emit DirectQuotePublished(sample.reportHash, sample.price18, sample.observedAt, sample.validUntil);
    }

    /// @notice Decode a reporter-signed Yahoo quote report for SessionRegistry.submitReports.
    function decodeVerified(bytes calldata report) external view returns (SourceSample memory sample) {
        if (directPrice) revert WrongAdapterMode();
        if (report.length == 0 || report.length > PolicyConstants.MAX_REPORT_BYTES) revert BadSample();
        bytes memory signature;
        (sample, signature) = abi.decode(report, (SourceSample, bytes));
        if (keccak256(abi.encode(sample, signature)) != keccak256(report)) revert BadSample();
        _validate(sample, feedId, phaseScope);
        _verify(sample, signature);
    }

    /// @notice Reporter-gated live multiplier/pause state for SessionRegistry's pinned stock token.
    function readTokenStatus(address token, uint64 nowTimestamp)
        external view returns (uint128 multiplier18, uint128 pendingMultiplier18, uint64 effectiveAt, bool pending, bool oraclePaused, bytes32 fingerprint_)
    {
        if (directPrice || token != stockToken) revert WrongAdapterMode();
        (YahooSourceVerifier.TokenSnapshot memory snapshot, bool fresh) =
            IYahooTokenSnapshot(address(verifier)).tokenSnapshot(token);
        if (!fresh || snapshot.updatedAt > nowTimestamp || snapshot.multiplier18 == 0) revert StaleObservation();
        multiplier18 = snapshot.multiplier18;
        pendingMultiplier18 = snapshot.pendingMultiplier18;
        effectiveAt = snapshot.effectiveAt;
        pending = effectiveAt > nowTimestamp;
        oraclePaused = snapshot.oraclePaused;
        fingerprint_ = keccak256(abi.encode(snapshot.codeHash, snapshot.multiplier18, snapshot.pendingMultiplier18, snapshot.effectiveAt, snapshot.oraclePaused, snapshot.updatedAt));
    }

    function _verify(SourceSample memory sample, bytes memory signature) private view {
        if (address(verifier).codehash != _verifierCodeHash) revert VerifierChanged();
        try verifier.verify(sourceConfigHash, sample, signature) returns (bool valid) {
            if (!valid) revert BadSignature();
        } catch {
            revert BadSignature();
        }
    }

    function _validate(SourceSample memory sample, bytes32 expectedFeedId, uint8 expectedScope) private view {
        if (sample.descriptorId != bytes32(0) || sample.feedId != expectedFeedId || sample.price18 == 0
            || sample.reportHash == bytes32(0) || sample.observedAt == 0 || sample.inputAt == 0
            || sample.validFrom > sample.observedAt || sample.observedAt > block.timestamp
            || sample.inputAt > block.timestamp || sample.expiresAt <= block.timestamp
            || sample.validUntil <= block.timestamp || sample.validUntil > sample.expiresAt
            || uint256(sample.validUntil) > uint256(sample.observedAt) + PolicyConstants.MAX_REPORT_AGE_SECONDS
            || block.timestamp - sample.observedAt >= PolicyConstants.MAX_REPORT_AGE_SECONDS) revert BadSample();
        if (expectedScope == 0) {
            if (sample.phase != 0) revert BadSample();
        } else if (expectedScope == 1) {
            if (sample.phase != PolicyConstants.PHASE_REGULAR) revert BadSample();
        } else if (expectedScope == 2) {
            if (sample.phase != PolicyConstants.PHASE_PRE && sample.phase != PolicyConstants.PHASE_POST) revert BadSample();
        } else if (expectedScope == 3) {
            if (sample.phase != PolicyConstants.PHASE_OVERNIGHT) revert BadSample();
        } else if (expectedScope == 4) {
            if (sample.phase != 5) revert BadSample();
        } else {
            revert BadSample();
        }
    }
}
