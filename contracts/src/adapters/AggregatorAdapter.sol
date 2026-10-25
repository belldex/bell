// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SourceSample, SourceWire} from "../types/ProtocolTypes.sol";
import {PolicyConstants} from "../libraries/PolicyConstants.sol";
import {SourceConfigHash} from "../libraries/SourceConfigHash.sol";

interface IAggregatorV3Proxy {
    function decimals() external view returns (uint8);
    function aggregator() external view returns (address);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

contract AggregatorAdapter {
    error BadConfig();
    error SourceUnavailable();
    error SourceChanged();
    error InvalidRound();
    error StalePrice();
    error PriceOutOfRange();

    address public immutable feed;
    address public immutable expectedImplementation;
    bytes32 public immutable expectedProxyCodeHash;
    bytes32 public immutable expectedImplementationCodeHash;
    bytes32 public immutable configHash;
    uint8 public immutable feedDecimals;
    uint8 public immutable priceBasis;
    uint32 public immutable heartbeatSec;

    constructor(
        address feed_,
        bytes32 expectedProxyCodeHash_,
        address expectedImplementation_,
        bytes32 expectedImplementationCodeHash_,
        uint8 feedDecimals_,
        uint32 heartbeatSec_,
        uint8 priceBasis_,
        uint8 kind_,
        uint8 phaseScope_,
        bytes32 canonicalTokenId_
    ) {
        if (feed_ == address(0) || expectedImplementation_ == address(0) || feed_.code.length == 0
            || expectedImplementation_.code.length == 0 || expectedProxyCodeHash_ == bytes32(0)
            || expectedImplementationCodeHash_ == bytes32(0) || feedDecimals_ > 18
            || (priceBasis_ != 2 && priceBasis_ != 3) || (kind_ != 1 && kind_ != 2) || phaseScope_ != 0
            || canonicalTokenId_ == bytes32(0) || (kind_ == 1 && priceBasis_ != 2) || (kind_ == 2 && priceBasis_ != 3)
            || feed_.codehash != expectedProxyCodeHash_
            || expectedImplementation_.codehash != expectedImplementationCodeHash_) revert BadConfig();
        feed = feed_;
        expectedImplementation = expectedImplementation_;
        expectedProxyCodeHash = expectedProxyCodeHash_;
        expectedImplementationCodeHash = expectedImplementationCodeHash_;
        feedDecimals = feedDecimals_;
        heartbeatSec = heartbeatSec_;
        priceBasis = priceBasis_;
        configHash = SourceConfigHash.hash(SourceWire({
            kind: kind_,
            phaseScope: phaseScope_,
            endpoint: feed_,
            feedId: bytes32(0),
            schema: 0,
            decimals: feedDecimals_,
            priceBasis: priceBasis_,
            heartbeatSec: heartbeatSec_,
            expectedCodeHash: expectedProxyCodeHash_,
            expectedImplementation: expectedImplementation_,
            canonicalTokenId: canonicalTokenId_
        }));
        if (_readDecimals() != feedDecimals_ || _readImplementation() != expectedImplementation_) revert BadConfig();
    }

    function sourceConfigHash() external view returns (bytes32) {
        return configHash;
    }

    function fingerprint() public view returns (bytes32) {
        if (feed.codehash != expectedProxyCodeHash || expectedImplementation.codehash != expectedImplementationCodeHash
            || _readImplementation() != expectedImplementation || _readDecimals() != feedDecimals) revert SourceChanged();
        return keccak256(abi.encode(feed.codehash, expectedImplementation, expectedImplementation.codehash, feedDecimals, heartbeatSec, priceBasis));
    }

    function readCurrent() external view returns (SourceSample memory sample) {
        bytes32 currentFingerprint = fingerprint();
        (uint80 roundId, int256 answer, uint64 updatedAt) = _readRound();
        (uint128 price18, uint64 validUntil) = _normalize(answer, updatedAt);
        sample = SourceSample({
            descriptorId: bytes32(0),
            feedId: bytes32(0),
            phase: 0,
            price18: price18,
            observedAt: updatedAt,
            inputAt: updatedAt,
            validFrom: updatedAt,
            expiresAt: validUntil,
            validUntil: validUntil,
            reportHash: keccak256(abi.encode(roundId, answer, updatedAt, currentFingerprint))
        });
    }

    function _readRound() private view returns (uint80 roundId, int256 answer, uint64 updatedAt) {
        (bool ok, bytes memory data) = feed.staticcall{gas: PolicyConstants.MAX_STATIC_CALL_GAS}(
            abi.encodeCall(IAggregatorV3Proxy.latestRoundData, ())
        );
        if (!ok || data.length != 160) revert SourceUnavailable();
        uint256 rawUpdatedAt;
        uint80 answeredInRound;
        (roundId, answer,, rawUpdatedAt, answeredInRound) =
            abi.decode(data, (uint80, int256, uint256, uint256, uint80));
        // Oracle timestamps are checked against the EVM timestamp; the strict policy maximum is far wider than proposer drift.
        // forge-lint: disable-next-line(block-timestamp)
        if (roundId == 0 || answeredInRound < roundId || answer <= 0 || rawUpdatedAt == 0 || rawUpdatedAt > block.timestamp
            || rawUpdatedAt > type(uint64).max) revert InvalidRound();
        // Explicitly bounded above by uint64.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        updatedAt = uint64(rawUpdatedAt);
    }

    function _normalize(int256 answer, uint64 updatedAt) private view returns (uint128 price18, uint64 validUntil) {
        uint256 maximumAge = heartbeatSec == 0
            ? PolicyConstants.MAX_DIRECT_PRICE_AGE_SECONDS
            : heartbeatSec < PolicyConstants.MAX_DIRECT_PRICE_AGE_SECONDS
                ? heartbeatSec
                : PolicyConstants.MAX_DIRECT_PRICE_AGE_SECONDS;
        // Freshness is intentionally checked against the execution timestamp using the strict policy age.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp - updatedAt >= maximumAge) revert StalePrice();
        uint256 scale = 10 ** (18 - feedDecimals);
        // answer is positive and bounded to int256 by the ABI decoder.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 unsignedAnswer = uint256(answer);
        if (unsignedAnswer > type(uint128).max / scale) revert PriceOutOfRange();
        // The quotient check above proves the product fits uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        price18 = uint128(unsignedAnswer * scale);
        uint256 deadline = uint256(updatedAt) + maximumAge;
        if (deadline > type(uint64).max) revert PriceOutOfRange();
        // The explicit bound check above proves this deadline fits uint64.
        // forge-lint: disable-next-line(unsafe-typecast)
        validUntil = uint64(deadline);
    }

    function _readDecimals() private view returns (uint8 value) {
        (bool ok, bytes memory data) = feed.staticcall{gas: PolicyConstants.MAX_STATIC_CALL_GAS}(
            abi.encodeCall(IAggregatorV3Proxy.decimals, ())
        );
        if (!ok || data.length != 32) revert SourceUnavailable();
        uint256 decoded = abi.decode(data, (uint256));
        if (decoded > 18) revert BadConfig();
        // Feed decimals are bounded to 0..18 above.
        // forge-lint: disable-next-line(unsafe-typecast)
        value = uint8(decoded);
    }

    function _readImplementation() private view returns (address implementation) {
        (bool ok, bytes memory data) = feed.staticcall{gas: PolicyConstants.MAX_STATIC_CALL_GAS}(
            abi.encodeCall(IAggregatorV3Proxy.aggregator, ())
        );
        if (!ok || data.length != 32) revert SourceUnavailable();
        implementation = abi.decode(data, (address));
    }
}
