// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Anchor, HealthView, SourceSample} from "../../../src/types/ProtocolTypes.sol";
import {
    HybridSessionRegistryAdapter,
    IHybridSessionAuthorization
} from "../../../src/registries/HybridSessionRegistryAdapter.sol";
import {ISessionRegistry} from "../../../src/interfaces/IBellProtocol.sol";

interface VmHybridAnchor {
    function warp(uint256 timestamp) external;
    function expectRevert() external;
}

contract HybridAnchorAuthMock is IHybridSessionAuthorization {
    bytes32 public lastAction;
    bytes32 public lastPayload;
    uint256 public nonce;

    function authorize(bytes32, bytes32 action, bytes32 payloadHash, uint256, bytes calldata ecdsa, bytes calldata pq)
        external
        returns (uint32)
    {
        require(abi.decode(ecdsa, (bytes32)) == payloadHash, "bad payload signature");
        require(abi.decode(pq, (bytes32)) == action, "bad PQ signature");
        lastAction = action;
        lastPayload = payloadHash;
        return uint32(++nonce);
    }
}

contract HybridAnchorSessionMock {
    Anchor private _anchor;

    function setAnchor(Anchor calldata anchor_) external {
        _anchor = anchor_;
    }

    function closeAnchor(bytes32, bytes32) external view returns (Anchor memory) {
        return _anchor;
    }

    function anchorStatus(bytes32, bytes32)
        external
        view
        returns (Anchor memory anchor, bool valid, uint256 reasons, uint64 validUntil)
    {
        anchor = _anchor;
        valid = anchor.price18 != 0;
        validUntil = valid ? anchor.closureStart : 0;
    }

    function health(bytes32) external pure returns (HealthView memory) {
        return HealthView(false, 0, 0, 0, 0, 0);
    }

    function latestSample(bytes32, uint8) external pure returns (SourceSample memory) {
        return SourceSample(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }

    function captureClose(bytes32, bytes32) external view returns (Anchor memory) {
        return _anchor;
    }
    function applyPoolOracleUpdates(bytes32, bytes32, bytes calldata, bool) external {}
    function submitReports(bytes32, bytes[] calldata) external {}

    function refreshStockWithReports(bytes32, SourceSample calldata, bytes calldata, bytes[] calldata)
        external
        pure
        returns (uint256)
    {
        return 0;
    }

    function refreshHealth(bytes32) external pure returns (uint256) {
        return 0;
    }
}

contract HybridSessionRegistryAdapterTest {
    VmHybridAnchor private constant vm = VmHybridAnchor(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant ROLE = keccak256("KEEPER");
    HybridAnchorSessionMock private session;
    HybridAnchorAuthMock private auth;
    HybridSessionRegistryAdapter private adapter;
    bytes32 private constant ASSET = keccak256("AAPL");
    bytes32 private constant BOUNDARY = keccak256("session close");

    function setUp() public {
        vm.warp(10_000);
        session = new HybridAnchorSessionMock();
        auth = new HybridAnchorAuthMock();
        adapter = new HybridSessionRegistryAdapter(ISessionRegistry(address(session)), auth, ROLE);
        session.setAnchor(_anchor(keccak256("source batch 1")));
    }

    function testRawCloseCaptureIsNotVisibleToHookWithoutHybridApproval() public {
        Anchor memory hidden = adapter.closeAnchor(ASSET, BOUNDARY);
        require(hidden.price18 == 0, "unapproved anchor exposed");
        (, bool valid,,) = adapter.anchorStatus(ASSET, BOUNDARY);
        require(!valid, "unapproved anchor considered valid");
    }

    function testHybridApprovalUnlocksOnlyTheExactDerivedAnchor() public {
        Anchor memory anchor = session.closeAnchor(ASSET, BOUNDARY);
        bytes32 anchorHash = keccak256(abi.encode(anchor));
        bytes32 payload = keccak256(abi.encode(ASSET, BOUNDARY, anchorHash));
        adapter.approveCloseAnchor(
            ASSET,
            BOUNDARY,
            block.timestamp + 1 hours,
            abi.encode(payload),
            abi.encode(adapter.APPROVE_CLOSE_ANCHOR_ACTION())
        );
        Anchor memory exposed = adapter.closeAnchor(ASSET, BOUNDARY);
        require(exposed.price18 == anchor.price18 && exposed.sourceHash == anchor.sourceHash, "approved anchor hidden");
        (, bool valid,,) = adapter.anchorStatus(ASSET, BOUNDARY);
        require(valid && adapter.isAnchorApproved(ASSET, BOUNDARY), "approved anchor not valid");
        require(auth.lastAction() == adapter.APPROVE_CLOSE_ANCHOR_ACTION(), "wrong action authorized");
    }

    function testChangedDerivedAnchorInvalidatesOldApproval() public {
        Anchor memory anchor = session.closeAnchor(ASSET, BOUNDARY);
        bytes32 payload = keccak256(abi.encode(ASSET, BOUNDARY, keccak256(abi.encode(anchor))));
        adapter.approveCloseAnchor(
            ASSET,
            BOUNDARY,
            block.timestamp + 1 hours,
            abi.encode(payload),
            abi.encode(adapter.APPROVE_CLOSE_ANCHOR_ACTION())
        );
        session.setAnchor(_anchor(keccak256("source batch 2")));
        Anchor memory hidden = adapter.closeAnchor(ASSET, BOUNDARY);
        require(hidden.price18 == 0, "changed anchor retained stale approval");
        (, bool valid,,) = adapter.anchorStatus(ASSET, BOUNDARY);
        require(!valid, "changed anchor stayed valid");
    }

    function testInvalidHybridAuthorizationDoesNotApproveAnchor() public {
        bytes32 action = adapter.APPROVE_CLOSE_ANCHOR_ACTION();
        vm.expectRevert();
        adapter.approveCloseAnchor(
            ASSET, BOUNDARY, block.timestamp + 1 hours, abi.encode(bytes32(uint256(1))), abi.encode(action)
        );
        require(!adapter.isAnchorApproved(ASSET, BOUNDARY), "invalid signature approved anchor");
    }

    function _anchor(bytes32 sourceHash) private view returns (Anchor memory) {
        return Anchor(
            ASSET,
            BOUNDARY,
            200e18,
            1e18,
            uint64(block.timestamp),
            uint64(block.timestamp - 1),
            uint64(block.timestamp - 1),
            uint64(block.timestamp + 1 hours),
            sourceHash
        );
    }
}
