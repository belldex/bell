// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DelegatedAttestedSourceAdapter, IDelegatedKeyRegistry, IDelegatedHybridAuth} from "../src/adapters/DelegatedAttestedSourceAdapter.sol";
import {SourceSample} from "../src/types/ProtocolTypes.sol";

interface VmDelegated {
    function warp(uint256 timestamp) external;
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function addr(uint256 privateKey) external pure returns (address);
}

contract MockDelegatedRegistry {
    function roleKey(bytes32) external pure returns (IDelegatedKeyRegistry.RoleKey memory key) {
        key = IDelegatedKeyRegistry.RoleKey({ecdsaSigner: address(0xA11CE), publicKeyCommitment: bytes32(uint256(7)), maxStatefulSignatures: 64, nextStatefulLeaf: 1, keyVersion: 1, installed: true});
    }
}

/// @dev Stands in for HybridAuth: it accepts a call only when a non-empty post-quantum signature is supplied, and counts leaves.
contract MockDelegatedAuth {
    address public immutable registry_;
    uint32 public leaves;
    bytes32 public lastAction;
    bytes32 public lastPayload;

    constructor() { registry_ = address(new MockDelegatedRegistry()); }

    function registry() external view returns (address) { return registry_; }

    function authorize(bytes32, bytes32 action, bytes32 payloadHash, uint256 deadline, bytes calldata ecdsaSignature, bytes calldata pqSignature)
        external returns (uint32)
    {
        require(block.timestamp <= deadline, "deadline");
        require(ecdsaSignature.length != 0 && pqSignature.length != 0, "hybrid signature missing");
        lastAction = action; lastPayload = payloadHash;
        return ++leaves;
    }
}

/// @dev The test is built with via_ir, which may reuse block.timestamp across vm.warp inside one test, so time is read through a call.
contract Clock { function now_() external view returns (uint256) { return block.timestamp; } }

contract MockStockToken { function decimals() external pure returns (uint8) { return 18; } }

contract DelegatedAttestedSourceAdapterTest {
    VmDelegated private constant vm = VmDelegated(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant DELEGATE_KEY = 0xD31E6A7E;
    uint256 private constant OTHER_KEY = 0xBADBAD;
    bytes32 private constant WIRE = bytes32(uint256(0x1234));
    bytes32 private constant FEED = bytes32(uint256(0xFEED));
    uint256 private constant T0 = 1_800_000_000;

    Clock private clock = new Clock();
    function _now() internal view returns (uint256) { return clock.now_(); }

    MockDelegatedAuth private auth;
    MockStockToken private token;
    DelegatedAttestedSourceAdapter private direct;
    DelegatedAttestedSourceAdapter private regular;

    function _setUp() internal {
        vm.warp(T0);
        auth = new MockDelegatedAuth();
        token = new MockStockToken();
        direct = new DelegatedAttestedSourceAdapter(IDelegatedHybridAuth(address(auth)), keccak256("REPORTER"), WIRE, bytes32(0), 0, true, address(token), 300, 2500);
        regular = new DelegatedAttestedSourceAdapter(IDelegatedHybridAuth(address(auth)), keccak256("REPORTER"), WIRE, FEED, 1, false, address(token), 300, 2500);
    }

    function _delegate(DelegatedAttestedSourceAdapter a, uint64 forSeconds) internal {
        a.authorizeDelegate(vm.addr(DELEGATE_KEY), uint64(_now()) + forSeconds, _now() + 600, hex"01", hex"02");
    }

    function _sample(bytes32 feed, uint8 phase, uint128 price, bytes32 hash) internal view returns (SourceSample memory s) {
        s = SourceSample({descriptorId: bytes32(0), feedId: feed, phase: phase, price18: price, observedAt: uint64(_now() - 5), inputAt: uint64(_now() - 5),
            validFrom: uint64(_now() - 5), expiresAt: uint64(_now() + 100), validUntil: uint64(_now() + 100), reportHash: hash});
    }

    function _envelope(DelegatedAttestedSourceAdapter a, SourceSample memory s, uint256 key, bool withPq) internal view returns (bytes memory) {
        uint256 deadline = _now() + 120;
        bytes32 digest = a.reportDigest(keccak256(abi.encode(address(a), s)), deadline);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(key, digest);
        return abi.encode(deadline, abi.encodePacked(r, ss, v), withPq ? bytes(hex"99") : bytes(""));
    }

    function _publish(DelegatedAttestedSourceAdapter a, SourceSample memory s, uint256 key) internal returns (bool ok) {
        (ok,) = address(a).call(abi.encodeCall(a.publishDirect, (s, _envelope(a, s, key, false))));
    }

    function testNothingPublishesBeforeAPostQuantumAuthorizedDelegateExists() external {
        _setUp();
        SourceSample memory s = _sample(bytes32(0), 0, 100e18, bytes32(uint256(1)));
        require(!_publish(direct, s, DELEGATE_KEY), "published with no delegate");
    }

    function testOneHybridLeafAuthorizesTheDelegateAndManyReportsSpendNoMore() external {
        _setUp();
        _delegate(direct, 1 days);
        require(auth.leaves() == 1, "one leaf for the delegation");
        require(auth.lastAction() == direct.DELEGATE_ACTION(), "wrong action");
        for (uint256 i = 1; i <= 20; ++i) {
            vm.warp(T0 + i * 60);
            SourceSample memory s = _sample(bytes32(0), 0, uint128(100e18 + i * 1e17), bytes32(i));
            require(_publish(direct, s, DELEGATE_KEY), "report refused");
        }
        require(auth.leaves() == 1, "reports spent leaves");
        require(direct.readCurrent().price18 == 102e18, "latest price not stored");
    }

    function testAReportFromAnyoneButTheDelegateIsRefused() external {
        _setUp();
        _delegate(direct, 1 days);
        SourceSample memory s = _sample(bytes32(0), 0, 100e18, bytes32(uint256(2)));
        require(!_publish(direct, s, OTHER_KEY), "foreign key accepted");
    }

    function testAPostQuantumSignatureOnAReportIsRefusedSoNoOneThinksItWasChecked() external {
        _setUp();
        _delegate(direct, 1 days);
        SourceSample memory s = _sample(bytes32(0), 0, 100e18, bytes32(uint256(3)));
        (bool ok,) = address(direct).call(abi.encodeCall(direct.publishDirect, (s, _envelope(direct, s, DELEGATE_KEY, true))));
        require(!ok, "report with a pq field accepted");
    }

    function testTheDelegationExpiresOnItsOwn() external {
        _setUp();
        _delegate(direct, 1 hours);
        vm.warp(T0 + 1 hours + 1);
        SourceSample memory s = _sample(bytes32(0), 0, 100e18, bytes32(uint256(4)));
        require(!_publish(direct, s, DELEGATE_KEY), "expired delegate accepted");
    }

    function testADelegationLongerThanAboutADayIsRefused() external {
        _setUp();
        (bool ok,) = address(direct).call(abi.encodeCall(direct.authorizeDelegate, (vm.addr(DELEGATE_KEY), uint64(_now() + 3 days), _now() + 600, hex"01", hex"02")));
        require(!ok, "three day delegation accepted");
    }

    function testRotatingTheDelegateInvalidatesTheOldKeyAndKeepsTheFingerprint() external {
        _setUp();
        _delegate(direct, 1 days);
        bytes32 before_ = direct.fingerprint();
        SourceSample memory s = _sample(bytes32(0), 0, 100e18, bytes32(uint256(5)));
        bytes memory oldEnvelope = _envelope(direct, s, DELEGATE_KEY, false);
        direct.authorizeDelegate(vm.addr(OTHER_KEY), uint64(_now() + 1 days), _now() + 600, hex"01", hex"02");
        (bool ok,) = address(direct).call(abi.encodeCall(direct.publishDirect, (s, oldEnvelope)));
        require(!ok, "old delegate still works after rotation");
        require(direct.fingerprint() == before_, "rotation changed the fingerprint");
        require(auth.leaves() == 2, "rotation should cost one more leaf");
    }

    function testRevokeEndsTheDelegationAtOnce() external {
        _setUp();
        _delegate(direct, 1 days);
        direct.revokeDelegate(_now() + 600, hex"01", hex"02");
        SourceSample memory s = _sample(bytes32(0), 0, 100e18, bytes32(uint256(6)));
        require(!_publish(direct, s, DELEGATE_KEY), "revoked delegate accepted");
    }

    function testAReportOlderThanTheReportAgeLimitIsRefused() external {
        _setUp();
        _delegate(direct, 1 days);
        SourceSample memory s = _sample(bytes32(0), 0, 100e18, bytes32(uint256(7)));
        s.observedAt = uint64(_now() - 125); s.inputAt = s.observedAt; s.validFrom = s.observedAt;
        require(!_publish(direct, s, DELEGATE_KEY), "stale report accepted");
    }

    function testTheStepBandStopsALargeJumpButAllowsANormalMove() external {
        _setUp();
        _delegate(direct, 1 days);
        require(_publish(direct, _sample(bytes32(0), 0, 100e18, bytes32(uint256(8))), DELEGATE_KEY), "first report");
        vm.warp(T0 + 60);
        require(!_publish(direct, _sample(bytes32(0), 0, 110e18, bytes32(uint256(9))), DELEGATE_KEY), "10 percent in a minute accepted");
        require(_publish(direct, _sample(bytes32(0), 0, 102e18, bytes32(uint256(10))), DELEGATE_KEY), "2 percent refused");
    }

    function testAfterAQuietGapTheWiderBandAppliesAndAHugeJumpNeedsARebase() external {
        _setUp();
        _delegate(direct, 1 days);
        require(_publish(direct, _sample(bytes32(0), 0, 100e18, bytes32(uint256(11))), DELEGATE_KEY), "first report");
        vm.warp(T0 + 2 hours);
        require(!_publish(direct, _sample(bytes32(0), 0, 140e18, bytes32(uint256(12))), DELEGATE_KEY), "40 percent after a gap accepted");
        require(_publish(direct, _sample(bytes32(0), 0, 115e18, bytes32(uint256(13))), DELEGATE_KEY), "15 percent after a gap refused");
        vm.warp(T0 + 4 hours);
        direct.rebase(200e18, _now() + 600, hex"01", hex"02");
        require(_publish(direct, _sample(bytes32(0), 0, 201e18, bytes32(uint256(14))), DELEGATE_KEY), "report after a rebase refused");
    }

    function testASessionStreamReportDecodesThroughTheSameDelegate() external {
        _setUp();
        _delegate(regular, 1 days);
        SourceSample memory s = _sample(FEED, 2, 100e18, bytes32(uint256(15)));
        bytes memory report = abi.encode(s, uint256(_now() + 120), _sig(regular, s), bytes(""));
        SourceSample memory out = regular.decodeVerified(report);
        require(out.price18 == 100e18 && out.feedId == FEED, "stream report not decoded");
        // A direct adapter and a stream adapter refuse each other's reports.
        (bool ok,) = address(direct).call(abi.encodeCall(direct.decodeVerified, (report)));
        require(!ok, "direct adapter decoded a stream report");
    }

    function testAReportForOneAdapterDoesNotVerifyOnAnother() external {
        _setUp();
        _delegate(direct, 1 days);
        _delegate(regular, 1 days);
        SourceSample memory s = _sample(FEED, 2, 100e18, bytes32(uint256(16)));
        bytes memory report = abi.encode(s, uint256(_now() + 120), _sig(direct, s), bytes(""));
        (bool ok,) = address(regular).call(abi.encodeCall(regular.decodeVerified, (report)));
        require(!ok, "signature for another adapter accepted");
    }

    function _sig(DelegatedAttestedSourceAdapter a, SourceSample memory s) internal view returns (bytes memory) {
        bytes32 digest = a.reportDigest(keccak256(abi.encode(address(a), s)), _now() + 120);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(DELEGATE_KEY, digest);
        return abi.encodePacked(r, ss, v);
    }

    function testConfigurationBoundsAreEnforced() external {
        _setUp();
        (bool ok,) = address(this).call(abi.encodeCall(this.badBand, ()));
        require(!ok, "gap band above 50 percent accepted");
    }

    function badBand() external {
        new DelegatedAttestedSourceAdapter(IDelegatedHybridAuth(address(auth)), keccak256("REPORTER"), WIRE, bytes32(0), 0, true, address(token), 300, 6000);
    }
}
