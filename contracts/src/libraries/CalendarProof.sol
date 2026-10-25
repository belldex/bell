// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CalendarLeaf} from "../types/ProtocolTypes.sol";

library CalendarProof {
    bytes32 internal constant LEAF_DOMAIN = keccak256("BELL_CALENDAR_LEAF_V1");
    error InvalidLeaf();
    error InvalidProof();
    error InvalidPartition();

    function hashLeaf(uint256 chainId, address calendarRegistry, CalendarLeaf memory leaf) internal pure returns (bytes32) {
        if (calendarRegistry == address(0) || leaf.assetId == bytes32(0) || leaf.provenanceHash == bytes32(0)
            || leaf.end <= leaf.start || leaf.phase < 1 || leaf.phase > 5) revert InvalidLeaf();
        bytes32 inner = keccak256(abi.encode(
            LEAF_DOMAIN,
            chainId,
            calendarRegistry,
            leaf.assetId,
            leaf.year,
            leaf.index,
            leaf.start,
            leaf.end,
            leaf.phase,
            leaf.provenanceHash
        ));
        return keccak256(abi.encodePacked(inner));
    }

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return uint256(a) <= uint256(b)
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    function verify(bytes32 root, uint256 chainId, address calendarRegistry, CalendarLeaf memory leaf, bytes32[] memory proof)
        internal pure returns (bool)
    {
        if (proof.length > 32 || root == bytes32(0)) return false;
        bytes32 computed = hashLeaf(chainId, calendarRegistry, leaf);
        for (uint256 i; i < proof.length; ++i) computed = hashPair(computed, proof[i]);
        return computed == root;
    }

    function validateNeighbors(
        CalendarLeaf memory current,
        CalendarLeaf memory previous,
        CalendarLeaf memory next,
        uint32 leafCount,
        uint64 coverageStart,
        uint64 coverageEnd,
        uint64 nowTime
    ) internal pure {
        if (leafCount == 0 || current.index >= leafCount || current.end <= current.start || current.phase < 1 || current.phase > 5
            || coverageEnd <= coverageStart || nowTime < current.start || nowTime >= current.end) revert InvalidPartition();
        if (current.index == 0) {
            if (current.start != coverageStart) revert InvalidPartition();
        } else if (previous.assetId != current.assetId || previous.year != current.year
            || previous.index + 1 != current.index || previous.end != current.start || previous.end <= previous.start
            || previous.phase < 1 || previous.phase > 5) revert InvalidPartition();

        if (current.index + 1 == leafCount) {
            if (current.end != coverageEnd) revert InvalidPartition();
        } else if (next.assetId != current.assetId || next.year != current.year
            || next.index != current.index + 1 || next.start != current.end || next.end <= next.start
            || next.phase < 1 || next.phase > 5) revert InvalidPartition();
    }
}
