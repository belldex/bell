// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SourceSample} from "../types/ProtocolTypes.sol";
import {PolicyConstants} from "../libraries/PolicyConstants.sol";
import {ISourceAdapterIdentity} from "../interfaces/ISourceAdapterIdentity.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IDelegatedHybridAuth {
    function authorize(
        bytes32 role,
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external returns (uint32 leafIndex);
    function registry() external view returns (address);
}

interface IDelegatedKeyRegistry {
    struct RoleKey {
        address ecdsaSigner;
        bytes32 publicKeyCommitment;
        uint32 maxStatefulSignatures;
        uint32 nextStatefulLeaf;
        uint32 keyVersion;
        bool installed;
    }

    function roleKey(bytes32 role) external view returns (RoleKey memory key);
}

/// @notice BELL-attested price source for a stock token that has no Chainlink feed, built so the post-quantum key lasts.
/// @dev HybridYahooAttestedSourceAdapter spends one HybridAuth leaf on every report. Reports must be 60 to 300 seconds old, so a
///      4,096-leaf key lasts three to six days. This adapter spends ONE leaf to authorize a delegate key for at most one day and a
///      few minutes, and the delegate signs each report with ECDSA only. The post-quantum signature therefore still decides who may
///      publish, and rotating the delegate costs one leaf per day (4,096 leaves last about eleven years).
///
///      What this changes about trust, plainly: inside a delegation window a single ECDSA key can publish prices. Three limits
///      contain it. A report may move the price at most `maxStepBps` from the last accepted one when that one is at most
///      `STEP_WINDOW` old, and `maxGapBps` otherwise; a larger move needs `rebase`, which is hybrid-signed. The delegate cannot touch
///      the token's corporate-action status (the registry reads that from the token itself). And the delegation expires on its own.
///
///      The interface matches the Yahoo adapter the SessionRegistry already accepts: `publishDirect` and `readCurrent` for the
///      token-adjusted price, `decodeVerified` for the three session streams.
contract DelegatedAttestedSourceAdapter is ISourceAdapterIdentity {
    bytes32 public constant DELEGATE_ACTION = keccak256("BELL_SOURCE_DELEGATE_V1");
    bytes32 public constant REBASE_ACTION = keccak256("BELL_SOURCE_REBASE_V1");
    bytes32 public constant REVOKE_ACTION = keccak256("BELL_SOURCE_REVOKE_V1");
    bytes32 private constant REPORT_DOMAIN = keccak256("BELL_DELEGATED_REPORT_V1");
    bytes32 private constant ZERO32 = bytes32(0);
    uint64 public constant MAX_DELEGATION_SECONDS = 1 days + 1 hours;
    uint64 public constant STEP_WINDOW = 10 minutes;

    IDelegatedHybridAuth public immutable hybridAuth;
    bytes32 public immutable authorizationRole;
    bytes32 public immutable override sourceConfigHash;
    bytes32 public immutable feedId;
    uint8 public immutable phaseScope;
    bool public immutable directPrice;
    address public immutable stockToken;
    uint16 public immutable maxStepBps;
    uint16 public immutable maxGapBps;
    bytes32 private immutable _hybridAuthCodeHash;

    address public delegate;
    uint64 public delegateUntil;
    uint64 public delegateEpoch;
    uint128 public referencePrice18;
    uint64 public referenceAt;
    SourceSample private _currentDirect;

    error BadConfig();
    error BadSample();
    error WrongAdapterMode();
    error StaleObservation();
    error AuthorizationVerifierChanged();
    error NoDelegate();
    error DelegateExpired();
    error DeadlineExpired();
    error BadDelegateSignature();
    error PostQuantumSignatureNotAllowed();
    error DelegationTooLong();
    error PriceJump(uint128 previous, uint128 proposed);

    event DelegateAuthorized(address indexed delegate, uint64 validUntil, uint64 epoch, uint32 leafIndex);
    event DelegateRevoked(uint64 epoch, uint32 leafIndex);
    event Rebased(uint128 price18, uint32 leafIndex);
    event DelegatedQuotePublished(bytes32 indexed reportHash, uint128 price18, uint64 observedAt, uint64 validUntil);

    constructor(
        IDelegatedHybridAuth auth_,
        bytes32 role_,
        bytes32 wireHash_,
        bytes32 feedId_,
        uint8 phaseScope_,
        bool directPrice_,
        address stockToken_,
        uint16 maxStepBps_,
        uint16 maxGapBps_
    ) {
        if (address(auth_).code.length == 0 || role_ == ZERO32 || wireHash_ == ZERO32) revert BadConfig();
        if (maxStepBps_ == 0 || maxGapBps_ < maxStepBps_ || maxGapBps_ > 5000) revert BadConfig();
        if (directPrice_) {
            if (feedId_ != ZERO32 || phaseScope_ != 0) revert BadConfig();
        } else if (feedId_ == ZERO32 || phaseScope_ < 1 || phaseScope_ > 3) {
            revert BadConfig();
        }
        if (stockToken_ == address(0) || stockToken_.code.length == 0) revert BadConfig();
        hybridAuth = auth_;
        authorizationRole = role_;
        sourceConfigHash = wireHash_;
        feedId = feedId_;
        phaseScope = phaseScope_;
        directPrice = directPrice_;
        stockToken = stockToken_;
        maxStepBps = maxStepBps_;
        maxGapBps = maxGapBps_;
        _hybridAuthCodeHash = address(auth_).codehash;
    }

    // ---------------------------------------------------------------- identity

    /// @dev The delegate is deliberately NOT part of the fingerprint: rotating it every day must not look like a source change.
    function fingerprint() external view override returns (bytes32) {
        _checkAuthCode();
        IDelegatedKeyRegistry.RoleKey memory key = IDelegatedKeyRegistry(hybridAuth.registry()).roleKey(authorizationRole);
        if (!key.installed) revert BadConfig();
        return keccak256(
            abi.encode(
                address(hybridAuth), _hybridAuthCodeHash, authorizationRole, sourceConfigHash, key.ecdsaSigner,
                key.publicKeyCommitment, key.keyVersion, feedId, phaseScope, directPrice, stockToken, maxStepBps, maxGapBps
            )
        );
    }

    // -------------------------------------------------- hybrid-signed management

    /// @notice One hybrid-signed call (ECDSA and SHRINCS, one leaf) names the delegate and how long it may sign.
    function authorizeDelegate(address newDelegate, uint64 validUntil, uint256 deadline, bytes calldata ecdsaSignature, bytes calldata pqSignature)
        external
    {
        if (newDelegate == address(0)) revert BadConfig();
        if (validUntil <= block.timestamp || validUntil > block.timestamp + MAX_DELEGATION_SECONDS) revert DelegationTooLong();
        uint64 epoch = delegateEpoch + 1;
        bytes32 payloadHash = keccak256(abi.encode(address(this), newDelegate, validUntil, epoch));
        uint32 leaf = _hybrid(DELEGATE_ACTION, payloadHash, deadline, ecdsaSignature, pqSignature);
        delegate = newDelegate;
        delegateUntil = validUntil;
        delegateEpoch = epoch;
        emit DelegateAuthorized(newDelegate, validUntil, epoch, leaf);
    }

    /// @notice Ends the current delegation at once. Hybrid-signed, so a stolen delegate key cannot extend itself.
    function revokeDelegate(uint256 deadline, bytes calldata ecdsaSignature, bytes calldata pqSignature) external {
        uint64 epoch = delegateEpoch + 1;
        bytes32 payloadHash = keccak256(abi.encode(address(this), epoch, "REVOKE"));
        uint32 leaf = _hybrid(REVOKE_ACTION, payloadHash, deadline, ecdsaSignature, pqSignature);
        delegate = address(0);
        delegateUntil = 0;
        delegateEpoch = epoch;
        emit DelegateRevoked(epoch, leaf);
    }

    /// @notice Accepts a price move larger than the step bands, for example the open after an earnings gap. Hybrid-signed.
    function rebase(uint128 price18, uint256 deadline, bytes calldata ecdsaSignature, bytes calldata pqSignature) external {
        if (price18 == 0) revert BadConfig();
        bytes32 payloadHash = keccak256(abi.encode(address(this), price18, block.timestamp / 1 hours));
        uint32 leaf = _hybrid(REBASE_ACTION, payloadHash, deadline, ecdsaSignature, pqSignature);
        referencePrice18 = price18;
        referenceAt = uint64(block.timestamp);
        emit Rebased(price18, leaf);
    }

    // ---------------------------------------------------------------- reports

    function readCurrent() external view returns (SourceSample memory sample) {
        if (!directPrice) revert WrongAdapterMode();
        sample = _currentDirect;
        if (sample.reportHash == ZERO32) revert BadSample();
    }

    function publishDirect(SourceSample calldata sample, bytes calldata envelope) external {
        if (!directPrice) revert WrongAdapterMode();
        _validate(sample, ZERO32, 0);
        if (sample.observedAt <= _currentDirect.observedAt) revert StaleObservation();
        (uint256 deadline, bytes memory ecdsaSignature, bytes memory pqSignature) = _decodeEnvelope(envelope);
        _checkDelegateSignature(keccak256(abi.encode(address(this), sample)), deadline, ecdsaSignature, pqSignature);
        _checkStep(sample.price18);
        _currentDirect = sample;
        emit DelegatedQuotePublished(sample.reportHash, sample.price18, sample.observedAt, sample.validUntil);
    }

    /// @dev Stateful like the Yahoo adapter's: it moves the reference price. The SessionRegistry calls it inside try/catch, so a
    ///      report that fails later rolls this back with the rest of the batch.
    function decodeVerified(bytes calldata report) external returns (SourceSample memory sample) {
        if (directPrice || report.length == 0 || report.length > PolicyConstants.MAX_REPORT_BYTES) revert BadSample();
        uint256 deadline;
        bytes memory ecdsaSignature;
        bytes memory pqSignature;
        (sample, deadline, ecdsaSignature, pqSignature) = abi.decode(report, (SourceSample, uint256, bytes, bytes));
        if (keccak256(report) != keccak256(abi.encode(sample, deadline, ecdsaSignature, pqSignature))) revert BadSample();
        _validate(sample, feedId, phaseScope);
        _checkDelegateSignature(keccak256(abi.encode(address(this), sample)), deadline, ecdsaSignature, pqSignature);
        _checkStep(sample.price18);
    }

    /// @notice The digest a delegate signs for a report, so an off-chain publisher and the tests build the same bytes.
    function reportDigest(bytes32 payloadHash, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(REPORT_DOMAIN, block.chainid, address(this), sourceConfigHash, payloadHash, delegateEpoch, deadline));
    }

    // --------------------------------------------------------------- internals

    function _checkDelegateSignature(bytes32 payloadHash, uint256 deadline, bytes memory ecdsaSignature, bytes memory pqSignature)
        private view
    {
        if (pqSignature.length != 0) revert PostQuantumSignatureNotAllowed();
        if (delegate == address(0)) revert NoDelegate();
        if (block.timestamp > delegateUntil) revert DelegateExpired();
        if (block.timestamp > deadline) revert DeadlineExpired();
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(reportDigest(payloadHash, deadline), ecdsaSignature);
        if (err != ECDSA.RecoverError.NoError || recovered != delegate) revert BadDelegateSignature();
    }

    function _checkStep(uint128 price18) private {
        uint128 ref = referencePrice18;
        if (ref != 0) {
            uint256 band = block.timestamp - referenceAt <= STEP_WINDOW ? maxStepBps : maxGapBps;
            uint256 diff = price18 > ref ? uint256(price18) - ref : uint256(ref) - price18;
            if (diff * 10_000 > uint256(ref) * band) revert PriceJump(ref, price18);
        }
        referencePrice18 = price18;
        referenceAt = uint64(block.timestamp);
    }

    function _hybrid(bytes32 action, bytes32 payloadHash, uint256 deadline, bytes calldata ecdsaSignature, bytes calldata pqSignature)
        private returns (uint32)
    {
        _checkAuthCode();
        return hybridAuth.authorize(authorizationRole, action, payloadHash, deadline, ecdsaSignature, pqSignature);
    }

    function _decodeEnvelope(bytes calldata envelope)
        private pure returns (uint256 deadline, bytes memory ecdsaSignature, bytes memory pqSignature)
    {
        (deadline, ecdsaSignature, pqSignature) = abi.decode(envelope, (uint256, bytes, bytes));
        if (keccak256(envelope) != keccak256(abi.encode(deadline, ecdsaSignature, pqSignature))) revert BadSample();
    }

    function _validate(SourceSample memory sample, bytes32 expectedFeedId, uint8 expectedScope) private view {
        if (
            sample.descriptorId != ZERO32 || sample.feedId != expectedFeedId || sample.price18 == 0
                || sample.reportHash == ZERO32 || sample.observedAt == 0 || sample.inputAt == 0
                || sample.validFrom > sample.observedAt || sample.observedAt > block.timestamp
                || sample.inputAt > block.timestamp || sample.expiresAt <= block.timestamp
                || sample.validUntil <= block.timestamp || sample.validUntil > sample.expiresAt
                || uint256(sample.validUntil) > uint256(sample.observedAt) + PolicyConstants.MAX_REPORT_AGE_SECONDS
                || block.timestamp - sample.observedAt >= PolicyConstants.MAX_REPORT_AGE_SECONDS
        ) revert BadSample();
        if (expectedScope == 0) {
            if (sample.phase != 0) revert BadSample();
        } else if (expectedScope == 1) {
            if (sample.phase != PolicyConstants.PHASE_REGULAR) revert BadSample();
        } else if (expectedScope == 2) {
            if (sample.phase != PolicyConstants.PHASE_PRE && sample.phase != PolicyConstants.PHASE_POST) revert BadSample();
        } else if (expectedScope == 3) {
            if (sample.phase != PolicyConstants.PHASE_OVERNIGHT) revert BadSample();
        } else {
            revert BadSample();
        }
    }

    function _checkAuthCode() private view {
        if (address(hybridAuth).codehash != _hybridAuthCodeHash) revert AuthorizationVerifierChanged();
    }
}
