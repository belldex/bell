// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CalendarRegistry} from "../src/registries/CalendarRegistry.sol";
import {CalendarLeaf, CalendarRoot} from "../src/types/ProtocolTypes.sol";
import {CalendarProof} from "../src/libraries/CalendarProof.sol";

interface VmCalendar {
    function warp(uint256 timestamp) external;
    function prank(address caller) external;
}

contract MockCalendarSafety {
    address public governance;
    address public guardian;
    constructor(address governance_, address guardian_) { governance = governance_; guardian = guardian_; }
}

contract CalendarRegistryTest {
    VmCalendar private constant vm = VmCalendar(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant ASSET = bytes32(uint256(1));
    bytes32 private constant PROVENANCE = bytes32(uint256(2));

    function _registry() internal returns (CalendarRegistry) {
        MockCalendarSafety safety = new MockCalendarSafety(address(this), address(0xBEEF));
        return new CalendarRegistry(address(safety));
    }

    function _leaf(uint64 start, uint64 end) internal pure returns (CalendarLeaf memory) {
        return CalendarLeaf({assetId: ASSET, year: 2026, index: 0, start: start, end: end, phase: 2, provenanceHash: PROVENANCE});
    }

    function _root(uint64 start, uint64 end, bytes32 rootHash) internal pure returns (CalendarRoot memory) {
        return CalendarRoot({root: rootHash, leafCount: 1, coverageStart: start, coverageEnd: end, queuedAt: 0, executableAt: 0, datasetHash: bytes32(uint256(3))});
    }

    // Independent fixture encoder: do not derive expected roots with CalendarProof.
    function _hash(CalendarRegistry registry, CalendarLeaf memory item) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(abi.encode(
            keccak256("BELL_CALENDAR_LEAF_V1"), block.chainid, address(registry), item.assetId,
            item.year, item.index, item.start, item.end, item.phase, item.provenanceHash
        ))));
    }

    function _proofs() internal pure returns (bytes32[][] memory proofs) {
        proofs = new bytes32[][](3);
        for (uint256 i; i < 3; ++i) proofs[i] = new bytes32[](0);
    }

    function _install(CalendarRegistry registry, CalendarLeaf memory item) internal {
        bytes32 id = registry.queueRoot(ASSET, _root(item.start, item.end, _hash(registry, item)));
        (,, uint64 eta,,) = registry.operation(id);
        vm.warp(eta);
        registry.activateRoot(id);
    }

    function _tryInterval(CalendarRegistry registry, CalendarLeaf memory current, CalendarLeaf memory previous, CalendarLeaf memory next, bytes32[][] memory proofs) internal returns (bool ok) {
        (ok,) = address(registry).call(abi.encodeCall(registry.activateInterval, (ASSET, current, previous, next, proofs)));
    }

    function testAdjacentYearPreloadRefreshAndRolloverRetainsPreviousRoot() external {
        CalendarRegistry registry = _registry();
        uint64 start = uint64(block.timestamp + 20 days);
        CalendarLeaf memory left = _leaf(start, start + 20 days);
        CalendarLeaf memory right = _leaf(left.end, left.end + 20 days);
        right.year = 2027;
        _install(registry, left);
        vm.warp(left.start);
        CalendarLeaf memory empty;
        registry.activateInterval(ASSET, left, empty, empty, _proofs());
        require(registry.nextInterval(ASSET).assetId == 0, "unexpected preload");
        _install(registry, right);
        registry.activateInterval(ASSET, left, empty, right, _proofs());
        require(registry.nextInterval(ASSET).year == 2027, "unchanged current did not refresh next");
        require(registry.currentInterval(ASSET).year == 2026, "future cache authorized current");
        require(!_tryInterval(registry, right, left, empty, _proofs()), "future activation accepted");
        require(registry.currentInterval(ASSET).year == 2026, "future call overwrote current");
        vm.warp(right.start);
        registry.activateInterval(ASSET, right, left, empty, _proofs());
        require(registry.currentInterval(ASSET).year == 2027, "rollover failed");
        registry.activateInterval(ASSET, right, left, empty, _proofs());
        require(registry.nextInterval(ASSET).assetId == 0, "stale future cache");
    }

    function testRejectsSecondChronologicalRootClaimingCommittedYear() external {
        CalendarRegistry registry = _registry();
        uint64 start = uint64(block.timestamp + 20 days);
        CalendarLeaf memory left = _leaf(start, start + 20 days);
        CalendarLeaf memory conflict = _leaf(left.end, left.end + 20 days);
        _install(registry, left);
        vm.warp(left.start);
        CalendarLeaf memory empty;
        registry.activateInterval(ASSET, left, empty, empty, _proofs());
        _install(registry, conflict);
        vm.warp(conflict.start);
        require(!_tryInterval(registry, conflict, empty, empty, _proofs()), "year reassigned to conflicting root");
    }

    function testCrossYearUsesTerminalAndFirstIndicesOfSeparateTwoLeafRoots() external {
        CalendarRegistry registry = _registry();
        uint64 start = uint64(block.timestamp + 20 days);
        CalendarLeaf memory a = _leaf(start, start + 10 days);
        CalendarLeaf memory b = _leaf(a.end, a.end + 10 days); b.index = 1;
        CalendarLeaf memory c = _leaf(b.end, b.end + 10 days); c.year = 2027;
        CalendarLeaf memory d = _leaf(c.end, c.end + 10 days); d.year = 2027; d.index = 1;
        _installPair(registry, a, b);
        vm.warp(a.start);
        _installPair(registry, c, d);
        bytes32[][] memory proofs = _proofs();
        proofs[0] = new bytes32[](1); proofs[0][0] = _hash(registry, a);
        proofs[1] = new bytes32[](1); proofs[1][0] = _hash(registry, b);
        proofs[2] = new bytes32[](1); proofs[2][0] = _hash(registry, d);
        vm.warp(b.start);
        registry.activateInterval(ASSET, b, a, c, proofs);
        require(registry.nextInterval(ASSET).index == 0, "next root first leaf not cached");
        vm.warp(c.start);
        proofs[0][0] = _hash(registry, d);
        proofs[1][0] = _hash(registry, a);
        proofs[2][0] = _hash(registry, c);
        registry.activateInterval(ASSET, c, b, d, proofs);
        require(registry.currentInterval(ASSET).year == 2027, "left crossing rejected");
        CalendarLeaf memory bad = abi.decode(abi.encode(b), (CalendarLeaf)); bad.index = 0;
        require(!_tryInterval(registry, c, bad, d, proofs), "nonterminal previous accepted");
        bad = abi.decode(abi.encode(b), (CalendarLeaf)); bad.year = 2025;
        require(!_tryInterval(registry, c, bad, d, proofs), "nonadjacent previous year accepted");
        proofs[1][0] = _hash(registry, d);
        require(!_tryInterval(registry, c, b, d, proofs), "previous verified with wrong root");
    }

    function _installPair(CalendarRegistry registry, CalendarLeaf memory first, CalendarLeaf memory last) internal {
        bytes32 a = _hash(registry, first);
        bytes32 b = _hash(registry, last);
        bytes32 hash = uint256(a) <= uint256(b) ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
        CalendarRoot memory metadata = _root(first.start, last.end, hash); metadata.leafCount = 2;
        bytes32 id = registry.queueRoot(ASSET, metadata);
        (,, uint64 eta,,) = registry.operation(id);
        vm.warp(eta); registry.activateRoot(id);
    }

    function testRootSpecificNeighborCoverageAndExactEmptyProofShape() external {
        CalendarRegistry registry = _registry();
        uint64 start = uint64(block.timestamp + 20 days);
        CalendarLeaf memory left = _leaf(start, start + 20 days);
        CalendarLeaf memory right = _leaf(left.end, left.end + 20 days); right.year = 2027;
        _install(registry, left);
        vm.warp(left.start);
        // Governance committed a root with a last leaf that misses coverageEnd.
        // Inclusion alone must not make this malformed partition usable as next.
        CalendarRoot memory metadata = _root(right.start, right.end + 1, _hash(registry, right));
        bytes32 id = registry.queueRoot(ASSET, metadata);
        (,, uint64 eta,,) = registry.operation(id); vm.warp(eta); registry.activateRoot(id);
        CalendarLeaf memory empty;
        require(!_tryInterval(registry, left, empty, right, _proofs()), "neighbor last coverage unchecked");
        bytes32[][] memory proofs = new bytes32[][](2);
        require(!_tryInterval(registry, left, empty, empty, proofs), "wrong proof array count accepted");
        proofs = _proofs(); proofs[1] = new bytes32[](1);
        require(!_tryInterval(registry, left, empty, empty, proofs), "nonempty absent-neighbor proof accepted");
        empty.year = 2025;
        require(!_tryInterval(registry, left, empty, CalendarLeaf(0,0,0,0,0,0,0), _proofs()), "noncanonical empty leaf accepted");
    }

    function testThirdChronologicalRootRetainsRolloverPredecessorDiscovery() external {
        CalendarRegistry registry = _registry();
        uint64 start = uint64(block.timestamp + 30 days);
        CalendarLeaf memory first = _leaf(start, start + 10 days);
        CalendarLeaf memory second = _leaf(first.end, first.end + 10 days); second.year = 2027;
        CalendarLeaf memory third = _leaf(second.end, second.end + 10 days); third.year = 2028;
        _install(registry, first); vm.warp(first.start);
        CalendarLeaf memory empty;
        registry.activateInterval(ASSET, first, empty, empty, _proofs());
        _install(registry, second);
        registry.activateInterval(ASSET, first, empty, second, _proofs());
        vm.warp(second.start);
        registry.activateInterval(ASSET, second, first, empty, _proofs());
        _install(registry, third);
        registry.activateInterval(ASSET, second, first, third, _proofs());
        vm.warp(third.start);
        registry.activateInterval(ASSET, third, second, empty, _proofs());
        require(registry.currentInterval(ASSET).year == 2028, "third root rollover missing");
    }

    function testQueueRejectsOverlapAgainstActivatedCommittedCoverage() external {
        CalendarRegistry registry = _registry();
        uint64 start = uint64(block.timestamp + 20 days);
        CalendarLeaf memory item = _leaf(start, start + 20 days);
        _install(registry, item);
        (bool ok,) = address(registry).call(abi.encodeCall(
            registry.queueRoot, (ASSET, _root(start + 10 days, item.end + 10 days, bytes32(uint256(8))))
        ));
        require(!ok, "overlap against activated root queued");
    }

    function testReverseLazyYearBindingAcrossQueuedChronology() external {
        CalendarRegistry registry = _registry();
        uint64 start = uint64(block.timestamp + 30 days);
        CalendarLeaf memory first = _leaf(start, start + 20 days);
        CalendarLeaf memory second = _leaf(first.end, first.end + 20 days); second.year = 2027;
        _install(registry, first); vm.warp(first.start);
        _install(registry, second);
        CalendarLeaf memory empty;
        registry.activateInterval(ASSET, first, empty, second, _proofs());
        vm.warp(second.start);
        registry.activateInterval(ASSET, second, first, empty, _proofs());
        require(registry.currentInterval(ASSET).year == 2027, "reverse binding rollover missing");
    }

    function testAdjacentYearRejectsMissingUnactivatedWrongYearAndMalformedNeighbors() external {
        CalendarRegistry registry = _registry();
        uint64 start = uint64(block.timestamp + 20 days);
        CalendarLeaf memory left = _leaf(start, start + 20 days);
        CalendarLeaf memory right = _leaf(left.end, left.end + 20 days);
        right.year = 2027;
        _install(registry, left);
        vm.warp(left.start);
        CalendarLeaf memory empty;
        require(!_tryInterval(registry, left, empty, right, _proofs()), "missing root accepted");
        bytes32 id = registry.queueRoot(ASSET, _root(right.start, right.end, _hash(registry, right)));
        require(!_tryInterval(registry, left, empty, right, _proofs()), "queued-only root accepted");
        (,, uint64 eta,,) = registry.operation(id);
        vm.warp(eta);
        registry.activateRoot(id);
        CalendarLeaf memory bad = abi.decode(abi.encode(right), (CalendarLeaf));
        bad.year = 2028;
        require(!_tryInterval(registry, left, empty, bad, _proofs()), "wrong year accepted");
        bad = abi.decode(abi.encode(right), (CalendarLeaf)); bad.index = 1;
        require(!_tryInterval(registry, left, empty, bad, _proofs()), "wrong first index accepted");
        bad = abi.decode(abi.encode(right), (CalendarLeaf)); bad.start++;
        require(!_tryInterval(registry, left, empty, bad, _proofs()), "gap accepted");
        bad = abi.decode(abi.encode(right), (CalendarLeaf)); bad.start--;
        require(!_tryInterval(registry, left, empty, bad, _proofs()), "overlap accepted");
        bad = abi.decode(abi.encode(right), (CalendarLeaf)); bad.assetId = bytes32(uint256(99));
        require(!_tryInterval(registry, left, empty, bad, _proofs()), "wrong asset accepted");
        bytes32[][] memory proofs = _proofs();
        proofs[2] = new bytes32[](1); proofs[2][0] = bytes32(uint256(99));
        require(!_tryInterval(registry, left, empty, right, proofs), "wrong root proof accepted");
        proofs[2] = new bytes32[](33);
        require(!_tryInterval(registry, left, empty, right, proofs), "oversized proof accepted");
        registry.activateInterval(ASSET, left, empty, right, _proofs());
    }

    function testFutureRootNeedsDelayAndCoverageNoticeThenIntervalProof() external {
        CalendarRegistry registry = _registry();
        uint64 start = uint64(block.timestamp + 7 days);
        uint64 end = start + 1000;
        CalendarLeaf memory item = _leaf(start, end);
        bytes32 rootHash = CalendarProof.hashLeaf(block.chainid, address(registry), item);
        bytes32 operationId = registry.queueRoot(ASSET, _root(start, end, rootHash));
        (,, uint64 eta,, uint8 status) = registry.operation(operationId);
        require(status == 1 && eta == block.timestamp + 48 hours, "root timelock");
        vm.warp(eta);
        registry.activateRoot(operationId);
        vm.warp(start + 10);
        bytes32[][] memory proofs = new bytes32[][](3);
        proofs[0] = new bytes32[](0);
        proofs[1] = new bytes32[](0);
        proofs[2] = new bytes32[](0);
        registry.activateInterval(ASSET, item, CalendarLeaf(0,0,0,0,0,0,0), CalendarLeaf(0,0,0,0,0,0,0), proofs);
        CalendarLeaf memory active = registry.currentInterval(ASSET);
        require(active.start == start && active.end == end && active.phase == 2, "current interval not cached");
    }

    function testRootQueueRejectsOverlapAndGuardianCanCancelPending() external {
        CalendarRegistry registry = _registry();
        uint64 start = uint64(block.timestamp + 7 days);
        uint64 end = start + 1000;
        bytes32 rootHash = bytes32(uint256(4));
        bytes32 operationId = registry.queueRoot(ASSET, _root(start, end, rootHash));
        (bool duplicate,) = address(registry).call(abi.encodeCall(registry.queueRoot, (ASSET, _root(start + 1, end + 1, bytes32(uint256(5))))));
        require(!duplicate, "overlapping pending root queued");
        vm.prank(address(0xBEEF));
        registry.cancel(operationId);
        (,,,, uint8 status) = registry.operation(operationId);
        require(status == 3, "calendar root cancellation missing");
    }

    function testRejectsMalformedProofAndIntervalBoundary() external {
        CalendarRegistry registry = _registry();
        uint64 start = uint64(block.timestamp + 7 days);
        uint64 end = start + 1000;
        CalendarLeaf memory item = _leaf(start, end);
        bytes32 rootHash = CalendarProof.hashLeaf(block.chainid, address(registry), item);
        bytes32 operationId = registry.queueRoot(ASSET, _root(start, end, rootHash));
        (,, uint64 eta,,) = registry.operation(operationId);
        vm.warp(eta);
        registry.activateRoot(operationId);
        vm.warp(start + 10);
        bytes32[][] memory proofs = new bytes32[][](3);
        proofs[0] = new bytes32[](1);
        proofs[0][0] = bytes32(uint256(99));
        proofs[1] = new bytes32[](0);
        proofs[2] = new bytes32[](0);
        (bool ok,) = address(registry).call(abi.encodeCall(registry.activateInterval, (ASSET, item, CalendarLeaf(0,0,0,0,0,0,0), CalendarLeaf(0,0,0,0,0,0,0), proofs)));
        require(!ok, "malformed proof accepted");
    }
}
