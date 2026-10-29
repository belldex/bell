// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";
import {ISourceAdapterIdentity} from "../interfaces/ISourceAdapterIdentity.sol";
import {SourceWire} from "../types/ProtocolTypes.sol";

interface ITokenOraclePause {
    function oraclePaused() external view returns (bool);
}

/// @title ChainlinkTokenReferenceAdapter
/// @notice Onchain reference-price adapter for PRICE_GUARDED: reads one token's
///         Chainlink Data Feed and scales it to an 18-decimal reference price.
/// @dev Staleness is governed by the configured feed heartbeat only; this adapter
///      intentionally does not reference PolicyConstants.
///
///      Canonical source identity: `sourceConfigHash()` returns
///      `keccak256(abi.encode(wire, block.chainid, stockToken))` where `wire` is a
///      canonical `SourceWire` struct encoded in the exact field order of
///      `SourceConfigHash.hash` (contracts/src/libraries/SourceConfigHash.sol):
///      kind=4 (SECONDARY per the developer brief section 20 source-kind table and
///      packages/protocol/src/source-codec.mjs validation rules), phaseScope=4
///      (SECONDARY), endpoint=feed address, feedId=keccak256(abi.encode(
///      "BELL:CHAINLINK:REFERENCE:FEED", feed)) (nonzero constant derived from the
///      endpoint, as the codec rejects feedId==0 for kind 4), schema=11 (the pinned
///      verified-report schema; the codec rejects schema==0 for kind 4),
///      decimals=feed decimals, priceBasis=4 (SECONDARY_TOKEN, required for kind 4),
///      heartbeatSec=configured heartbeat, expectedCodeHash=feed codehash (the
///      registry-path rule pins endpoint.codehash), expectedImplementation=feed
///      address, and canonicalTokenId=keccak256(abi.encode(chainId, token)) bound at
///      admission. `block.chainid` and the pause binding (`stockToken`) are appended
///      AFTER the canonical wire fields — not inside the wire struct — so two
///      adapters differing only in their pause binding produce different hashes while
///      the leading wire-hash prefix remains comparable to `SourceConfigHash.hash`.
contract ChainlinkTokenReferenceAdapter is ISourceAdapterIdentity {
    error StaleReference();
    error ReferenceUnavailable();
    error BadConfig();

    uint8 private constant KIND_SECONDARY = 4;
    uint8 private constant PHASE_SCOPE_SECONDARY = 4;
    uint8 private constant PRICE_BASIS_SECONDARY_TOKEN = 4;
    uint16 private constant SCHEMA_VERIFIED_REPORT = 11;

    AggregatorV3Interface public immutable feed;
    uint32 public immutable heartbeat;
    uint8 public immutable feedDecimals;
    address public immutable stockToken;
    bytes32 private immutable _sourceConfigHash;
    string private _symbol;

    constructor(address feed_, uint32 heartbeat_, uint8 feedDecimals_, string memory symbol_, address stockToken_) {
        if (feed_ == address(0) || heartbeat_ == 0 || feedDecimals_ > 18) revert BadConfig();
        // Feed decimals are validated on-chain, matching the AggregatorAdapter house
        // standard: the constructor argument must agree with the live feed.
        (bool ok, bytes memory data) = feed_.staticcall(abi.encodeCall(AggregatorV3Interface.decimals, ()));
        if (!ok || data.length != 32 || abi.decode(data, (uint8)) != feedDecimals_) revert BadConfig();
        feed = AggregatorV3Interface(feed_);
        heartbeat = heartbeat_;
        feedDecimals = feedDecimals_;
        _symbol = symbol_;
        stockToken = stockToken_;
        _sourceConfigHash = keccak256(abi.encode(
            KIND_SECONDARY,
            PHASE_SCOPE_SECONDARY,
            feed_,
            keccak256(abi.encode("BELL:CHAINLINK:REFERENCE:FEED", feed_)),
            SCHEMA_VERIFIED_REPORT,
            feedDecimals_,
            PRICE_BASIS_SECONDARY_TOKEN,
            heartbeat_,
            feed_.codehash,
            feed_,
            keccak256(abi.encode(block.chainid, address(0))),
            block.chainid,
            stockToken_
        ));
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    /// @notice Latest feed price scaled to 1e18. Feed answers are already multiplier-adjusted.
    /// @dev Named `referencePrice` because `reference` is a reserved keyword in Solidity >=0.8.26.
    function referencePrice() public view returns (uint128) {
        if (stockToken != address(0) && ITokenOraclePause(stockToken).oraclePaused()) revert ReferenceUnavailable();
        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        // Round sanity per the AggregatorAdapter house standard: the feed must identify
        // the round it is answering.
        if (roundId == 0 || answeredInRound < roundId || answer <= 0) revert ReferenceUnavailable();
        // forge-lint: disable-next-line(block-timestamp)
        if (updatedAt == 0 || updatedAt > block.timestamp) revert StaleReference();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp - updatedAt > heartbeat) revert StaleReference();
        uint256 scaled = feedDecimals <= 18
            ? uint256(answer) * 10 ** (18 - feedDecimals)
            : uint256(answer) / 10 ** (feedDecimals - 18);
        require(scaled <= type(uint128).max, "overflow");
        return uint128(scaled);
    }

    /// @notice Deterministic wire identity for this adapter's configuration.
    /// @dev See the contract-level NatSpec for the canonical SourceWire encoding.
    function sourceConfigHash() external view returns (bytes32) {
        return _sourceConfigHash;
    }

    /// @notice Deployment fingerprint distinguishing instances with identical config.
    function fingerprint() external view returns (bytes32) {
        return keccak256(abi.encode(address(this), feed, heartbeat, feedDecimals, _symbol, stockToken));
    }
}
