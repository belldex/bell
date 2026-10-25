// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SourceSample, SourceWire} from "../types/ProtocolTypes.sol";
import {PolicyConstants} from "../libraries/PolicyConstants.sol";
import {SourceConfigHash} from "../libraries/SourceConfigHash.sol";

interface IVerifierProxy {
    function verify(bytes calldata report, bytes calldata parameterPayload) external payable returns (bytes memory verifiedReport);
}

contract EquityV11Adapter {
    error BadConfig();
    error VerifierUnavailable();
    error VerifierChanged();
    error BadReport(bytes32 feedId, uint8 reason);
    error PriceOutOfRange();

    struct ReportV11 {
        bytes32 feedId;
        uint32 validFromTimestamp;
        uint32 observationsTimestamp;
        uint192 nativeFee;
        uint192 linkFee;
        uint32 expiresAt;
        int192 mid;
        uint64 lastSeenTimestampNs;
        int192 bid;
        int192 bidVolume;
        int192 ask;
        int192 askVolume;
        int192 lastTradedPrice;
        uint32 marketStatus;
    }

    address public immutable verifierProxy;
    bytes32 public immutable expectedVerifierCodeHash;
    bytes32 public immutable feedId;
    uint8 public immutable priceDecimals;
    uint8 public immutable phaseScope;
    bytes32 public immutable configHash;

    constructor(address verifier_, bytes32 expectedCodeHash_, bytes32 feedId_, uint8 decimals_, uint8 phaseScope_, bytes32 canonicalTokenId_) {
        if (verifier_ == address(0) || verifier_.code.length == 0 || expectedCodeHash_ == bytes32(0)
            || verifier_.codehash != expectedCodeHash_ || feedId_ == bytes32(0) || decimals_ > 18
            || phaseScope_ < 1 || phaseScope_ > 3 || canonicalTokenId_ == bytes32(0)) revert BadConfig();
        verifierProxy = verifier_;
        expectedVerifierCodeHash = expectedCodeHash_;
        feedId = feedId_;
        priceDecimals = decimals_;
        phaseScope = phaseScope_;
        configHash = SourceConfigHash.hash(SourceWire({
            kind: 3,
            phaseScope: phaseScope_,
            endpoint: verifier_,
            feedId: feedId_,
            schema: 11,
            decimals: decimals_,
            priceBasis: 1,
            heartbeatSec: 0,
            expectedCodeHash: expectedCodeHash_,
            expectedImplementation: verifier_,
            canonicalTokenId: canonicalTokenId_
        }));
    }

    function sourceConfigHash() external view returns (bytes32) {
        return configHash;
    }

    function fingerprint() external view returns (bytes32) {
        bytes32 currentCodeHash = verifierProxy.codehash;
        if (currentCodeHash != expectedVerifierCodeHash) revert VerifierChanged();
        return keccak256(abi.encode(verifierProxy, currentCodeHash));
    }

    function decodeVerified(bytes calldata fullReport) external returns (SourceSample memory sample) {
        if (fullReport.length == 0 || fullReport.length > PolicyConstants.MAX_REPORT_BYTES) revert BadReport(feedId, 1);
        if (verifierProxy.codehash != expectedVerifierCodeHash) revert VerifierChanged();
        bytes memory verifiedBody = IVerifierProxy(verifierProxy).verify(fullReport, bytes(""));
        if (verifiedBody.length == 0 || verifiedBody.length > PolicyConstants.MAX_REPORT_BYTES) revert BadReport(feedId, 2);

        ReportV11 memory report = abi.decode(verifiedBody, (ReportV11));
        if (keccak256(abi.encode(report)) != keccak256(verifiedBody)) revert BadReport(feedId, 3);
        return _toSourceSample(report, keccak256(fullReport));
    }

    function _toSourceSample(ReportV11 memory report, bytes32 reportHash) private view returns (SourceSample memory sample) {
        if (report.feedId != feedId || report.marketStatus > 5) revert BadReport(feedId, 4);
        bool phaseMatches = phaseScope == 1
            ? report.marketStatus == 2
            : phaseScope == 2
                ? report.marketStatus == 1 || report.marketStatus == 3
                : report.marketStatus == 4;
        if (!phaseMatches) revert BadReport(feedId, 8);
        uint256 nowTimestamp = block.timestamp;
        if (report.validFromTimestamp > report.observationsTimestamp || report.observationsTimestamp > nowTimestamp
            || report.expiresAt <= nowTimestamp || report.lastSeenTimestampNs == 0) revert BadReport(feedId, 5);

        uint256 inputAt = uint256(report.lastSeenTimestampNs) / 1e9;
        if (inputAt == 0 || inputAt > nowTimestamp || report.mid <= 0) revert BadReport(feedId, 6);
        uint256 rawPrice = uint192(report.mid);
        uint256 scale = 10 ** (18 - priceDecimals);
        if (rawPrice > type(uint128).max / scale) revert PriceOutOfRange();
        uint256 price18 = rawPrice * scale;
        uint256 reportValidUntil = uint256(report.observationsTimestamp) + PolicyConstants.MAX_REPORT_AGE_SECONDS;
        uint256 validUntil = report.expiresAt < reportValidUntil ? report.expiresAt : reportValidUntil;
        if (nowTimestamp >= validUntil || validUntil > type(uint64).max || inputAt > type(uint64).max) revert BadReport(feedId, 7);

        // rawPrice was bounded by uint128.max / scale immediately above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 normalizedPrice = uint128(price18);
        // inputAt and validUntil are explicitly bounded by uint64 above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 normalizedInputAt = uint64(inputAt);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 normalizedValidUntil = uint64(validUntil);
        sample = SourceSample({
            descriptorId: bytes32(0),
            feedId: report.feedId,
            phase: uint8(report.marketStatus),
            price18: normalizedPrice,
            observedAt: uint64(report.observationsTimestamp),
            inputAt: normalizedInputAt,
            validFrom: uint64(report.validFromTimestamp),
            expiresAt: uint64(report.expiresAt),
            validUntil: normalizedValidUntil,
            reportHash: reportHash
        });
    }
}
