// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SourceSample, HealthView, Anchor} from "../types/ProtocolTypes.sol";
import {ISessionRegistry} from "../interfaces/IBellProtocol.sol";
import {ReasonBits} from "../types/ProtocolTypes.sol";

interface IHybridSessionAuthorization {
    function authorize(
        bytes32 role,
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external returns (uint32 leafIndex);
}

/// @notice Compatibility adapter that exposes legacy session data but gates trusted close anchors.
/// @dev The underlying SessionRegistry still performs mature report validation, freshness, replay and
///      close-price calculations. This wrapper is the registry address bound into a new hook. Its
///      `closeAnchor` and `anchorStatus` views stay closed until a keeper hybrid-signs the exact
///      derived anchor, so calling the legacy permissionless capture path alone cannot activate it.
contract HybridSessionRegistryAdapter {
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER");
    bytes32 public constant APPROVE_CLOSE_ANCHOR_ACTION = keccak256("SESSION_APPROVE_DERIVED_CLOSE_ANCHOR");

    ISessionRegistry public immutable underlying;
    IHybridSessionAuthorization public immutable hybridAuth;
    bytes32 public immutable keeperRole;
    mapping(bytes32 anchorKey => bytes32 approvedAnchorHash) private _approvedAnchors;

    error BadConfig();
    error AnchorUnavailable();

    event CloseAnchorHybridApproved(bytes32 indexed assetId, bytes32 indexed boundaryHash, bytes32 anchorHash);

    constructor(ISessionRegistry underlying_, IHybridSessionAuthorization auth_, bytes32 keeperRole_) {
        if (address(underlying_).code.length == 0 || address(auth_).code.length == 0 || keeperRole_ == bytes32(0)) {
            revert BadConfig();
        }
        underlying = underlying_;
        hybridAuth = auth_;
        keeperRole = keeperRole_;
    }

    function approveCloseAnchor(
        bytes32 assetId,
        bytes32 boundaryHash,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external {
        Anchor memory anchor = underlying.closeAnchor(assetId, boundaryHash);
        (Anchor memory checkedAnchor, bool valid,,) = underlying.anchorStatus(assetId, boundaryHash);
        if (
            assetId == bytes32(0) || boundaryHash == bytes32(0) || anchor.assetId != assetId
                || anchor.boundaryHash != boundaryHash || anchor.price18 == 0 || anchor.multiplier18 == 0
                || anchor.capturedAt == 0 || anchor.observedAt == 0 || anchor.inputAt == 0 || anchor.closureStart == 0
                || anchor.sourceHash == bytes32(0) || !valid
                || keccak256(abi.encode(checkedAnchor)) != keccak256(abi.encode(anchor))
        ) {
            revert AnchorUnavailable();
        }
        bytes32 anchorHash = keccak256(abi.encode(anchor));
        bytes32 payloadHash = keccak256(abi.encode(assetId, boundaryHash, anchorHash));
        hybridAuth.authorize(
            keeperRole, APPROVE_CLOSE_ANCHOR_ACTION, payloadHash, deadline, ecdsaSignature, pqSignature
        );
        _approvedAnchors[_anchorKey(assetId, boundaryHash)] = anchorHash;
        emit CloseAnchorHybridApproved(assetId, boundaryHash, anchorHash);
    }

    function approvalPayloadHash(bytes32 assetId, bytes32 boundaryHash) external view returns (bytes32) {
        Anchor memory anchor = underlying.closeAnchor(assetId, boundaryHash);
        if (anchor.assetId != assetId || anchor.boundaryHash != boundaryHash || anchor.price18 == 0) {
            revert AnchorUnavailable();
        }
        return keccak256(abi.encode(assetId, boundaryHash, keccak256(abi.encode(anchor))));
    }

    function isAnchorApproved(bytes32 assetId, bytes32 boundaryHash) external view returns (bool) {
        return _approved(assetId, boundaryHash, underlying.closeAnchor(assetId, boundaryHash));
    }

    function applyPoolOracleUpdates(bytes32 asset0, bytes32 asset1, bytes calldata payload, bool swapEnvelope)
        external
    {
        underlying.applyPoolOracleUpdates(asset0, asset1, payload, swapEnvelope);
    }

    function submitReports(bytes32 assetId, bytes[] calldata reports) external {
        underlying.submitReports(assetId, reports);
    }

    function refreshStockWithReports(
        bytes32 assetId,
        SourceSample calldata directSample,
        bytes calldata directSignature,
        bytes[] calldata reports
    ) external returns (uint256 reasons) {
        return underlying.refreshStockWithReports(assetId, directSample, directSignature, reports);
    }

    function refreshHealth(bytes32 assetId) external returns (uint256 reasons) {
        return underlying.refreshHealth(assetId);
    }

    function health(bytes32 assetId) external view returns (HealthView memory) {
        return underlying.health(assetId);
    }

    /// @dev The raw capture is deterministic derived state; approval is separately hybrid-signed.
    function captureClose(bytes32 assetId, bytes32 boundaryHash) external returns (Anchor memory) {
        return underlying.captureClose(assetId, boundaryHash);
    }

    function latestSample(bytes32 assetId, uint8 phase) external view returns (SourceSample memory) {
        return underlying.latestSample(assetId, phase);
    }

    function closeAnchor(bytes32 assetId, bytes32 boundaryHash) external view returns (Anchor memory anchor) {
        anchor = underlying.closeAnchor(assetId, boundaryHash);
        if (!_approved(assetId, boundaryHash, anchor)) return Anchor(0, 0, 0, 0, 0, 0, 0, 0, 0);
    }

    function anchorStatus(bytes32 assetId, bytes32 boundaryHash)
        external
        view
        returns (Anchor memory anchor, bool valid, uint256 reasons, uint64 validUntil)
    {
        (anchor, valid, reasons, validUntil) = underlying.anchorStatus(assetId, boundaryHash);
        if (valid && !_approved(assetId, boundaryHash, anchor)) {
            return (anchor, false, reasons | ReasonBits.ANCHOR_MISSING_OR_EXPIRED, 0);
        }
    }

    function _approved(bytes32 assetId, bytes32 boundaryHash, Anchor memory anchor) private view returns (bool) {
        return anchor.assetId == assetId && anchor.boundaryHash == boundaryHash
            && _approvedAnchors[_anchorKey(assetId, boundaryHash)] == keccak256(abi.encode(anchor));
    }

    function _anchorKey(bytes32 assetId, bytes32 boundaryHash) private pure returns (bytes32) {
        return keccak256(abi.encode(assetId, boundaryHash));
    }
}
