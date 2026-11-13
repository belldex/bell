// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PQKeyRegistry} from "../src/PQKeyRegistry.sol";
import {HybridAuth, IHashSigVerifier} from "../src/HybridAuth.sol";
import {CalendarRegistryV2} from "../src/CalendarRegistryV2.sol";
import {SessionRegistryV2} from "../src/SessionRegistryV2.sol";
import {PriceAttestationAdapter} from "../src/PriceAttestationAdapter.sol";

interface VmTrustInputs {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function expectRevert(bytes4 selector) external;
}

contract TrustInputsMockVerifier is IHashSigVerifier {
    function verify(bytes32, bytes32, bytes calldata signature)
        external
        pure
        returns (bool valid, uint32 leaf)
    {
        return abi.decode(signature, (bool, uint32));
    }
}

contract TrustInputsV2Test {
    VmTrustInputs private constant vm =
        VmTrustInputs(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SIGNER_KEY = 0xB0B;
    bytes32 private constant ROLE = keccak256("TRUST_INPUTS");
    bytes32 private constant COMMITMENT = keccak256("trust-inputs-root");
    uint256 private constant DEADLINE_OFFSET = 1 hours;

    PQKeyRegistry private registry;
    HybridAuth private auth;
    CalendarRegistryV2 private calendar;
    SessionRegistryV2 private sessions;
    PriceAttestationAdapter private prices;

    function setUp() public {
        registry = new PQKeyRegistry(address(this));
        auth = new HybridAuth(registry, new TrustInputsMockVerifier());
        registry.bootstrapRole(ROLE, vm.addr(SIGNER_KEY), COMMITMENT, 20);
        registry.setHybridAuth(address(auth));
        registry.finalizeBootstrap();
        calendar = new CalendarRegistryV2(auth, ROLE);
        sessions = new SessionRegistryV2(auth, ROLE);
        prices = new PriceAttestationAdapter(auth, ROLE);
    }

    function testHybridCalendarRootUpdate() public {
        uint64 from = uint64(block.timestamp);
        uint64 until = from + 1 days;
        bytes32 root = keccak256("calendar-v2");
        uint256 deadline = block.timestamp + DEADLINE_OFFSET;
        calendar.updateRoot(root, from, until, deadline, _ecdsa(
            address(calendar), calendar.UPDATE_ROOT_ACTION(),
            keccak256(abi.encode(root, from, until)), deadline
        ), abi.encode(true, uint32(1)));
        require(calendar.currentRoot() == root, "calendar root not stored");
        require(calendar.epoch() == 1, "calendar epoch not advanced");
    }

    function testHybridCloseAnchorUpdate() public {
        bytes32 poolId = keccak256("pool");
        bytes32 anchor = keccak256("close-anchor");
        uint64 cycle = 9;
        uint256 deadline = block.timestamp + DEADLINE_OFFSET;
        sessions.setCloseAnchor(poolId, cycle, anchor, deadline, _ecdsa(
            address(sessions), sessions.SET_CLOSE_ANCHOR_ACTION(),
            keccak256(abi.encode(poolId, cycle, anchor)), deadline
        ), abi.encode(true, uint32(1)));
        (uint64 storedCycle, bytes32 storedAnchor) = sessions.closeAnchor(poolId);
        require(storedCycle == cycle && storedAnchor == anchor, "anchor not stored");
    }

    function testHybridPriceAttestationUpdate() public {
        bytes32 asset = keccak256("AAPL");
        uint128 price = 227_35000000;
        uint64 observedAt = uint64(block.timestamp);
        uint256 deadline = block.timestamp + DEADLINE_OFFSET;
        prices.attestPrice(asset, price, observedAt, deadline, _ecdsa(
            address(prices), prices.ATTEST_PRICE_ACTION(),
            keccak256(abi.encode(asset, price, observedAt)), deadline
        ), abi.encode(true, uint32(1)));
        (uint128 storedPrice, uint64 storedTime, uint64 sequence) = prices.latestPrice(asset);
        require(storedPrice == price && storedTime == observedAt, "price not stored");
        require(sequence == 1, "sequence not advanced");
    }

    function testInvalidPQDoesNotChangeTrustInputState() public {
        uint64 from = uint64(block.timestamp);
        uint64 until = from + 1 days;
        bytes32 root = keccak256("untrusted-root");
        uint256 deadline = block.timestamp + DEADLINE_OFFSET;
        bytes memory ecdsa = _ecdsa(
            address(calendar), calendar.UPDATE_ROOT_ACTION(),
            keccak256(abi.encode(root, from, until)), deadline
        );
        vm.expectRevert(HybridAuth.InvalidPQSignature.selector);
        calendar.updateRoot(root, from, until, deadline, ecdsa, abi.encode(false, uint32(1)));
        require(calendar.currentRoot() == bytes32(0), "invalid PQ mutated state");
    }

    function _ecdsa(
        address target,
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline
    ) private returns (bytes memory) {
        bytes32 digest = auth.actionDigest(
            ROLE, target, action, payloadHash, auth.nonce(ROLE), 1, deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
}
