// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SourceSample} from "../types/ProtocolTypes.sol";
import {PolicyConstants} from "../libraries/PolicyConstants.sol";
import {ISourceAdapterIdentity} from "../interfaces/ISourceAdapterIdentity.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IHybridYahooAuth {
    function authorize(
        bytes32 role,
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external returns (uint32 leafIndex);
    function actionDigest(
        bytes32 role,
        address target,
        bytes32 action,
        bytes32 payloadHash,
        uint256 actionNonce,
        uint32 keyVersion,
        uint256 deadline
    ) external view returns (bytes32);
    function nonce(bytes32 role) external view returns (uint256);
    function registry() external view returns (address);
    function hashSigVerifier() external view returns (address);
}

interface IHybridYahooKeyRegistry {
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

interface IHybridYahooHashSigVerifier {
    function verify(bytes32 commitment, bytes32 digest, bytes calldata signature)
        external
        view
        returns (bool valid, uint32 leafIndex);
}

/// @notice BELL stock quote adapter that consumes HybridAuth leaves for every trusted update.
/// @dev Each report carries `(sample, deadline, ecdsaSignature, pqSignature)`. The ECDSA signature
///      authenticates the exact source sample through HybridAuth; no legacy ECDSA-only report path
///      is accepted by this adapter. The same authorization pattern protects direct quotes and
///      corporate-action snapshots.
contract HybridYahooAttestedSourceAdapter is ISourceAdapterIdentity {
    bytes32 public constant SOURCE_SAMPLE_ACTION = keccak256("BELL_SOURCE_SAMPLE_V2");
    bytes32 public constant TOKEN_STATUS_ACTION = keccak256("BELL_TOKEN_STATUS_V2");
    bytes32 private constant ZERO32 = bytes32(0);

    IHybridYahooAuth public immutable hybridAuth;
    bytes32 public immutable authorizationRole;
    bytes32 public immutable override sourceConfigHash;
    bytes32 public immutable feedId;
    uint8 public immutable phaseScope;
    bool public immutable directPrice;
    address public immutable stockToken;
    bytes32 private immutable _hybridAuthCodeHash;
    SourceSample private _currentDirect;

    struct TokenStatus {
        uint64 updatedAt;
        uint128 multiplier18;
        uint128 pendingMultiplier18;
        uint64 effectiveAt;
        bool oraclePaused;
        bytes32 codeHash;
    }

    mapping(address token => TokenStatus status) private _tokenStatus;

    error BadConfig();
    error BadSample();
    error WrongAdapterMode();
    error StaleObservation();
    error AuthorizationVerifierChanged();
    error InvalidHybridSignature();

    event HybridQuotePublished(bytes32 indexed reportHash, uint128 price18, uint64 observedAt, uint64 validUntil);
    event HybridTokenStatusPublished(address indexed token, uint64 observedAt, uint128 multiplier18);

    constructor(
        IHybridYahooAuth auth_,
        bytes32 role_,
        bytes32 wireHash_,
        bytes32 feedId_,
        uint8 phaseScope_,
        bool directPrice_,
        address stockToken_
    ) {
        if (address(auth_).code.length == 0 || role_ == ZERO32 || wireHash_ == ZERO32) {
            revert BadConfig();
        }
        if (directPrice_) {
            if (feedId_ != ZERO32 || phaseScope_ != 0) revert BadConfig();
        } else if (feedId_ == ZERO32 || phaseScope_ < 1 || phaseScope_ > 4) {
            revert BadConfig();
        }
        if (!directPrice_ && (stockToken_ == address(0) || stockToken_.code.length == 0)) revert BadConfig();
        hybridAuth = auth_;
        authorizationRole = role_;
        sourceConfigHash = wireHash_;
        feedId = feedId_;
        phaseScope = phaseScope_;
        directPrice = directPrice_;
        stockToken = stockToken_;
        _hybridAuthCodeHash = address(auth_).codehash;
    }

    function fingerprint() external view override returns (bytes32) {
        _checkAuthCode();
        IHybridYahooKeyRegistry.RoleKey memory key =
            IHybridYahooKeyRegistry(hybridAuth.registry()).roleKey(authorizationRole);
        if (!key.installed) revert BadConfig();
        return keccak256(
            abi.encode(
                address(hybridAuth),
                _hybridAuthCodeHash,
                authorizationRole,
                sourceConfigHash,
                key.ecdsaSigner,
                key.publicKeyCommitment,
                key.keyVersion,
                feedId,
                phaseScope,
                directPrice,
                stockToken
            )
        );
    }

    function readCurrent() external view returns (SourceSample memory sample) {
        if (!directPrice) revert WrongAdapterMode();
        sample = _currentDirect;
        if (sample.reportHash == ZERO32) revert BadSample();
    }

    function previewDirect(SourceSample calldata sample, bytes calldata envelope)
        external
        view
        returns (bool valid, uint64 validUntil)
    {
        if (!directPrice) revert WrongAdapterMode();
        _validate(sample, ZERO32, 0);
        if (sample.observedAt <= _currentDirect.observedAt) revert StaleObservation();
        (uint256 deadline, bytes memory ecdsaSignature, bytes memory pqSignature) =
            abi.decode(envelope, (uint256, bytes, bytes));
        if (keccak256(envelope) != keccak256(abi.encode(deadline, ecdsaSignature, pqSignature))) revert BadSample();
        valid = _previewHybrid(SOURCE_SAMPLE_ACTION, _samplePayload(sample), deadline, ecdsaSignature, pqSignature);
        return (valid, valid ? sample.validUntil : 0);
    }

    function publishDirect(SourceSample calldata sample, bytes calldata envelope) external {
        if (!directPrice) revert WrongAdapterMode();
        _validate(sample, ZERO32, 0);
        if (sample.observedAt <= _currentDirect.observedAt) revert StaleObservation();
        (uint256 deadline, bytes memory ecdsaSignature, bytes memory pqSignature) = _decodeEnvelope(envelope);
        _authorize(SOURCE_SAMPLE_ACTION, _samplePayload(sample), deadline, ecdsaSignature, pqSignature);
        _currentDirect = sample;
        emit HybridQuotePublished(sample.reportHash, sample.price18, sample.observedAt, sample.validUntil);
    }

    /// @notice Stateful by design: each stock report consumes a unique PQ leaf before it is returned.
    function decodeVerified(bytes calldata report) external returns (SourceSample memory sample) {
        if (directPrice || report.length == 0 || report.length > PolicyConstants.MAX_REPORT_BYTES) revert BadSample();
        uint256 deadline;
        bytes memory ecdsaSignature;
        bytes memory pqSignature;
        (sample, deadline, ecdsaSignature, pqSignature) = abi.decode(report, (SourceSample, uint256, bytes, bytes));
        if (keccak256(report) != keccak256(abi.encode(sample, deadline, ecdsaSignature, pqSignature))) {
            revert BadSample();
        }
        _validate(sample, feedId, phaseScope);
        _authorize(SOURCE_SAMPLE_ACTION, _samplePayload(sample), deadline, ecdsaSignature, pqSignature);
    }

    function publishTokenStatusHybrid(
        address token,
        uint128 multiplier18,
        uint128 pendingMultiplier18,
        uint64 effectiveAt,
        uint64 observedAt,
        bool oraclePaused,
        bytes32 codeHash,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external {
        if (
            directPrice || token != stockToken || token.code.length == 0 || multiplier18 == 0
                || pendingMultiplier18 == 0 || codeHash != token.codehash || observedAt == 0
                || observedAt > block.timestamp
                || block.timestamp - observedAt >= PolicyConstants.MAX_REPORT_AGE_SECONDS
                || (effectiveAt == 0 && pendingMultiplier18 != multiplier18)
                || (effectiveAt != 0 && effectiveAt <= observedAt && pendingMultiplier18 != multiplier18)
        ) {
            revert BadSample();
        }
        if (observedAt <= _tokenStatus[token].updatedAt) revert StaleObservation();
        bytes32 payloadHash = keccak256(
            abi.encode(token, multiplier18, pendingMultiplier18, effectiveAt, observedAt, oraclePaused, codeHash)
        );
        _authorize(TOKEN_STATUS_ACTION, payloadHash, deadline, ecdsaSignature, pqSignature);
        _tokenStatus[token] =
            TokenStatus(observedAt, multiplier18, pendingMultiplier18, effectiveAt, oraclePaused, codeHash);
        emit HybridTokenStatusPublished(token, observedAt, multiplier18);
    }

    function readTokenStatus(address token, uint64 nowTimestamp)
        external
        view
        returns (
            uint128 multiplier18,
            uint128 pendingMultiplier18,
            uint64 effectiveAt,
            bool pending,
            bool oraclePaused,
            bytes32 fingerprint_
        )
    {
        if (directPrice || token != stockToken) revert WrongAdapterMode();
        TokenStatus memory status = _tokenStatus[token];
        if (
            status.updatedAt == 0 || status.updatedAt > nowTimestamp || status.multiplier18 == 0
                || token.codehash != status.codeHash
                || nowTimestamp - status.updatedAt >= PolicyConstants.MAX_REPORT_AGE_SECONDS
        ) {
            revert StaleObservation();
        }
        multiplier18 = status.multiplier18;
        pendingMultiplier18 = status.pendingMultiplier18;
        effectiveAt = status.effectiveAt;
        pending = effectiveAt > nowTimestamp;
        oraclePaused = status.oraclePaused;
        fingerprint_ = keccak256(
            abi.encode(
                status.codeHash,
                status.multiplier18,
                status.pendingMultiplier18,
                status.effectiveAt,
                status.oraclePaused,
                status.updatedAt
            )
        );
    }

    function _samplePayload(SourceSample memory sample) private view returns (bytes32) {
        return keccak256(abi.encode(sourceConfigHash, sample));
    }

    function _authorize(
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline,
        bytes memory ecdsaSignature,
        bytes memory pqSignature
    ) private {
        _checkAuthCode();
        hybridAuth.authorize(authorizationRole, action, payloadHash, deadline, ecdsaSignature, pqSignature);
    }

    function _previewHybrid(
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline,
        bytes memory ecdsaSignature,
        bytes memory pqSignature
    ) private view returns (bool) {
        _checkAuthCode();
        if (block.timestamp > deadline) return false;
        IHybridYahooKeyRegistry.RoleKey memory key =
            IHybridYahooKeyRegistry(hybridAuth.registry()).roleKey(authorizationRole);
        if (!key.installed) return false;
        bytes32 digest = hybridAuth.actionDigest(
            authorizationRole,
            address(this),
            action,
            payloadHash,
            hybridAuth.nonce(authorizationRole),
            key.keyVersion,
            deadline
        );
        (address recovered, ECDSA.RecoverError recoverError,) = ECDSA.tryRecover(digest, ecdsaSignature);
        if (recoverError != ECDSA.RecoverError.NoError || recovered != key.ecdsaSigner) return false;
        try IHybridYahooHashSigVerifier(hybridAuth.hashSigVerifier())
            .verify(key.publicKeyCommitment, digest, pqSignature) returns (
            bool valid, uint32 leafIndex
        ) {
            return valid && leafIndex == key.nextStatefulLeaf;
        } catch {
            return false;
        }
    }

    function _decodeEnvelope(bytes calldata envelope)
        private
        pure
        returns (uint256 deadline, bytes memory ecdsaSignature, bytes memory pqSignature)
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
            if (sample.phase != PolicyConstants.PHASE_PRE && sample.phase != PolicyConstants.PHASE_POST) {
                revert BadSample();
            }
        } else if (expectedScope == 3) {
            if (sample.phase != PolicyConstants.PHASE_OVERNIGHT) revert BadSample();
        } else if (expectedScope == 4) {
            if (sample.phase != 5) revert BadSample();
        } else {
            revert BadSample();
        }
    }

    function _checkAuthCode() private view {
        if (address(hybridAuth).codehash != _hybridAuthCodeHash) revert AuthorizationVerifierChanged();
    }
}
