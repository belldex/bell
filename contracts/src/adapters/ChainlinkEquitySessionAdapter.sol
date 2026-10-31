// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SourceSample, SourceWire} from "../types/ProtocolTypes.sol";
import {PolicyConstants} from "../libraries/PolicyConstants.sol";
import {SourceConfigHash} from "../libraries/SourceConfigHash.sol";

interface IEquityAggregatorV3 {
    function decimals() external view returns (uint8);
    function aggregator() external view returns (address);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IRobinhoodTokenMultiplier {
    function uiMultiplier() external view returns (uint256);
    function oraclePaused() external view returns (bool);
}

/// @notice Reads the already-published Robinhood Chain equity Data Feed for a calendar-selected session.
/// @dev No offchain reporter or Data Streams subscription is involved. Old rounds fail closed at 120s.
contract ChainlinkEquitySessionAdapter {
    error BadConfig();
    error SourceUnavailable();
    error StalePrice();

    IEquityAggregatorV3 public immutable feed;
    IRobinhoodTokenMultiplier public immutable token;
    address public immutable implementation;
    bytes32 public immutable expectedProxyCodeHash;
    bytes32 public immutable expectedImplementationCodeHash;
    bytes32 public immutable expectedTokenCodeHash;
    bytes32 public immutable feedId;
    bytes32 public immutable configHash;
    bytes32 public immutable canonicalTokenId;
    uint8 public immutable feedDecimals;
    uint8 public immutable phaseScope;

    constructor(address feed_, bytes32 proxyHash_, address implementation_, bytes32 implementationHash_, address token_, bytes32 tokenHash_, uint8 decimals_, uint8 scope_, bytes32 tokenId_) {
        if (feed_ == address(0) || implementation_ == address(0) || token_ == address(0) || feed_.code.length == 0 || implementation_.code.length == 0 || token_.code.length == 0
            || feed_.codehash != proxyHash_ || implementation_.codehash != implementationHash_ || token_.codehash != tokenHash_ || decimals_ > 18
            || scope_ < 1 || scope_ > 3 || tokenId_ == bytes32(0)) revert BadConfig();
        feed = IEquityAggregatorV3(feed_); token = IRobinhoodTokenMultiplier(token_); implementation = implementation_; expectedProxyCodeHash = proxyHash_;
        expectedImplementationCodeHash = implementationHash_; expectedTokenCodeHash = tokenHash_; feedDecimals = decimals_; phaseScope = scope_; canonicalTokenId = tokenId_;
        feedId = keccak256(abi.encode("BELL:CHAINLINK:SESSION", feed_, scope_));
        configHash = SourceConfigHash.hash(SourceWire({kind: 5, phaseScope: scope_, endpoint: feed_, feedId: feedId,
            schema: 1, decimals: decimals_, priceBasis: 1, heartbeatSec: 86400, expectedCodeHash: proxyHash_,
            expectedImplementation: implementation_, canonicalTokenId: tokenId_}));
        if (feed.decimals() != decimals_ || feed.aggregator() != implementation_) revert BadConfig();
    }

    function sourceConfigHash() external view returns (bytes32) { return configHash; }
    function fingerprint() external view returns (bytes32) {
        if (address(feed).codehash != expectedProxyCodeHash || implementation.codehash != expectedImplementationCodeHash || address(token).codehash != expectedTokenCodeHash
            || feed.aggregator() != implementation || feed.decimals() != feedDecimals) revert SourceUnavailable();
        return keccak256(abi.encode(address(feed), implementation, address(token), expectedTokenCodeHash, feedDecimals, phaseScope));
    }

    function readCurrent() external view returns (SourceSample memory s) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        if (roundId == 0 || answeredInRound < roundId || answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) revert SourceUnavailable();
        if (block.timestamp - updatedAt >= 120) revert StalePrice();
        if (token.oraclePaused()) revert SourceUnavailable();
        uint256 multiplier = token.uiMultiplier();
        if (multiplier == 0) revert SourceUnavailable();
        uint256 tokenPrice = uint256(answer) * 10 ** (18 - feedDecimals);
        if (tokenPrice == 0 || tokenPrice > type(uint128).max || updatedAt + 120 > type(uint64).max) revert SourceUnavailable();
        // Robinhood's onchain Data Feed publishes token total-return value (underlying × multiplier).
        // SessionRegistry applies the independently-read multiplier when it stores a close anchor,
        // so convert back to the underlying equity price here to avoid multiplying it twice.
        uint256 normalized = tokenPrice * 1e18 / multiplier;
        if (normalized == 0 || normalized > type(uint128).max) revert SourceUnavailable();
        uint64 at = uint64(updatedAt); uint64 until = at + 120;
        s = SourceSample({descriptorId: bytes32(0), feedId: feedId, phase: 0, price18: uint128(normalized), observedAt: at,
            inputAt: at, validFrom: at, expiresAt: until, validUntil: until, reportHash: keccak256(abi.encode(roundId, answer, at))});
    }
}
