// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Buckets} from "./ProtocolTypes.sol";

/// @notice Internal computation transport; NOT a normative public protocol interface, oracle or authorization API.
/// @dev The calling hook must authenticate health/references/config, persist the returned snapshot itself,
/// and bind callbacks to that snapshot. User-supplied contexts are never authoritative.
interface IBellSwapEvaluator {
    struct Context {
        bytes32 configHash;
        bytes32 stateHash;
        uint8 poolClass;
        uint8 mode;
        uint8 phase;
        bool closedLatched;
        bool frozenStock;
        uint64 closureNonce;
        uint64 timestamp;
        uint64 validUntil;
        uint64 bellStart;
        uint64 corporateUntil;
        uint160 preSqrtPriceX96;
        uint128[2] referencePrice18;
        uint8[2] decimals;
        uint128[2] tradeCap;
        uint128[2] windowCap;
        uint128[2] closureCap;
    }

    struct Snapshot {
        Context context;
        bytes32 callbackHash;
        uint24 lpFeeUnits;
        uint16 bandBps;
        bool guarded;
        bool zeroForOne;
        int256 amountSpecified;
        uint128[2] effectiveTradeCap;
        uint128[2] effectiveWindowCap;
    }

    function prepare(Context calldata context, bytes32 callbackHash, bool zeroForOne, int256 amountSpecified)
        external pure returns (Snapshot memory);

    function settle(Snapshot calldata snapshot, bytes32 callbackHash, uint64 timestamp, uint160 postSqrtPriceX96,
        int128 delta0, int128 delta1, Buckets calldata buckets, uint128[2] calldata episodeGross)
        external pure returns (Buckets memory nextBuckets, uint128[2] memory nextEpisode, uint128[2] memory gross);
}
