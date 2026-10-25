// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CalendarProof} from "../src/libraries/CalendarProof.sol";
import {CalendarLeaf} from "../src/types/ProtocolTypes.sol";

contract CalendarProofTest {
    bytes32 private constant ASSET = bytes32(uint256(1));
    bytes32 private constant PROVENANCE = bytes32(uint256(2));
    address private constant REGISTRY = address(0x1234);

    function _leaf(uint32 index, uint64 start, uint64 end) internal pure returns (CalendarLeaf memory) {
        return CalendarLeaf({assetId: ASSET, year: 2026, index: index, start: start, end: end, phase: 2, provenanceHash: PROVENANCE});
    }

    function testDomainSeparatedDoubleHashMerkleProof() external pure {
        CalendarLeaf memory first = _leaf(0, 100, 200);
        CalendarLeaf memory second = _leaf(1, 200, 300);
        bytes32 firstHash = _fixtureHash(first);
        bytes32 secondHash = _fixtureHash(second);
        bytes32 root = uint256(firstHash) <= uint256(secondHash)
            ? keccak256(abi.encodePacked(firstHash, secondHash))
            : keccak256(abi.encodePacked(secondHash, firstHash));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = secondHash;
        require(CalendarProof.verify(root, 4663, REGISTRY, first, proof), "valid proof rejected");
        proof[0] = bytes32(uint256(99));
        require(!CalendarProof.verify(root, 4663, REGISTRY, first, proof), "tampered proof accepted");
    }

    function _fixtureHash(CalendarLeaf memory leaf) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(abi.encode(
            keccak256("BELL_CALENDAR_LEAF_V1"), uint256(4663), REGISTRY,
            leaf.assetId, leaf.year, leaf.index, leaf.start, leaf.end, leaf.phase, leaf.provenanceHash
        ))));
    }

    function testProofBoundsAndDomainIdentityFailClosed() external pure {
        CalendarLeaf memory item = _leaf(0, 100, 200);
        bytes32 root = _fixtureHash(item);
        bytes32[] memory proof = new bytes32[](0);
        require(!CalendarProof.verify(root, 4664, REGISTRY, item, proof), "wrong chain accepted");
        require(!CalendarProof.verify(root, 4663, address(0x4321), item, proof), "wrong registry accepted");
        item.year = 2027;
        require(!CalendarProof.verify(root, 4663, REGISTRY, item, proof), "wrong year accepted");
        proof = new bytes32[](33);
        require(!CalendarProof.verify(root, 4663, REGISTRY, item, proof), "unbounded proof accepted");
    }

    function testMatchesSharedCrossRuntimeCalendarLeafVector() external pure {
        CalendarLeaf memory item = CalendarLeaf({
            assetId: 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,
            year: 2026,
            index: 0,
            start: 100,
            end: 200,
            phase: 2,
            provenanceHash: 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
        });
        bytes32 hash = CalendarProof.hashLeaf(4663, address(0x1111111111111111111111111111111111111111), item);
        require(hash == 0xca52218a0f58fd1bc60bc14bc24ce2550ad9316f5a672a67ba2c68d69e78f67e, "shared vector mismatch");
    }

    function testCurrentPartitionAndJointNeighbors() external pure {
        CalendarLeaf memory current = _leaf(1, 200, 300);
        CalendarLeaf memory previous = _leaf(0, 100, 200);
        CalendarLeaf memory next = _leaf(2, 300, 400);
        CalendarProof.validateNeighbors(current, previous, next, 4, 100, 500, 250);
    }

    function testRejectsGapOverlapWrongIndexAndOutOfIntervalTime() external {
        CalendarLeaf memory current = _leaf(1, 200, 300);
        CalendarLeaf memory previous = _leaf(0, 100, 199);
        CalendarLeaf memory next = _leaf(2, 300, 400);
        (bool ok,) = address(this).call(abi.encodeCall(this.validate, (current, previous, next, 4, 100, 500, 250)));
        require(!ok, "gap accepted");
        previous = _leaf(0, 100, 200);
        next = _leaf(3, 300, 400);
        (ok,) = address(this).call(abi.encodeCall(this.validate, (current, previous, next, 4, 100, 500, 250)));
        require(!ok, "wrong next index accepted");
        next = _leaf(2, 300, 400);
        (ok,) = address(this).call(abi.encodeCall(this.validate, (current, previous, next, 4, 100, 500, 300)));
        require(!ok, "end-exclusive boundary accepted");
    }

    function validate(CalendarLeaf calldata current, CalendarLeaf calldata previous, CalendarLeaf calldata next, uint32 count, uint64 start, uint64 end, uint64 nowTime) external pure {
        CalendarProof.validateNeighbors(current, previous, next, count, start, end, nowTime);
    }
}
