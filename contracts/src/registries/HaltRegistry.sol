// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IHaltHybridAuth {
    function authorize(
        bytes32 role,
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external returns (uint32 leafIndex);
}

/// @title HaltRegistry
/// @notice Records unscheduled trading halts for a stock token, one state per asset, written only through HybridAuth
///         (ECDSA and SHRINCS together) by the REPORTER role.
/// @dev This is the first piece of Einstein Hooks v3. It does not touch the hook: the hook's permission mask stays 0x2CC0 and
///      exits never call it. A later hook or calendar overlay reads `phase(assetId)` and applies CLOSED rules while HALTED, then
///      runs the resume auction for `RESUME_AUCTION_SECONDS`.
///
///      Fail-safe: a halt expires `MAX_HALT_SECONDS` after it was recorded or last renewed. The pool can never be stuck in HALTED
///      because the reporter went offline; the cost is that a halt longer than two hours needs a renewal (one more leaf).
///
///      Known gap, kept on chain: the reporter reads public halt data, so `halt` lands minutes after the real halt. The registry
///      stores both the claimed start and the time it was recorded, and `reportDelay` returns the difference so each halt can be
///      measured. Leaf budget: every call spends one REPORTER leaf; `leavesUsed` is exposed and `rotationDue` turns true at 80%.
contract HaltRegistry {
    enum Phase { NORMAL, HALTED, RESUME_AUCTION }

    bytes32 public constant HALT_ACTION = keccak256("BELL_HALT_V1");
    bytes32 public constant RENEW_ACTION = keccak256("BELL_HALT_RENEW_V1");
    bytes32 public constant RESUME_ACTION = keccak256("BELL_HALT_RESUME_V1");
    uint64 public constant MAX_HALT_SECONDS = 2 hours;
    uint64 public constant RESUME_AUCTION_SECONDS = 5 minutes;
    uint64 public constant MAX_BACKDATE_SECONDS = 1 days;
    uint32 public constant LEAF_BUDGET = 4096;
    uint32 public constant ROTATION_THRESHOLD = 3277; // 80% of 4096, rounded up

    struct Halt {
        uint64 haltId;
        uint64 startTs; // when the exchange says the halt began
        uint64 recordedAt; // when this registry learned of it
        uint64 expiresAt;
        uint64 resumedAt; // 0 until resume
        uint64 resumeTs; // when the exchange says trading resumed
        bytes32 reason;
        bool active;
    }

    IHaltHybridAuth public immutable hybridAuth;
    bytes32 public immutable authorizationRole;
    uint32 public leavesUsed;

    mapping(bytes32 assetId => Halt) private _halts;
    mapping(bytes32 assetId => uint64) public lastHaltId;

    event Halted(bytes32 indexed assetId, uint64 indexed haltId, uint64 startTs, uint64 recordedAt, uint64 expiresAt, bytes32 reason, uint32 leaf);
    event Renewed(bytes32 indexed assetId, uint64 indexed haltId, uint64 expiresAt, uint32 leaf);
    event Resumed(bytes32 indexed assetId, uint64 indexed haltId, uint64 resumeTs, uint64 auctionEndsAt, uint32 leaf);

    error BadConfig();
    error BadHaltId();
    error BadTimestamp();
    error AlreadyHalted();
    error NotHalted();
    error WrongHalt();

    constructor(IHaltHybridAuth auth, bytes32 role) {
        if (address(auth) == address(0) || role == bytes32(0)) revert BadConfig();
        hybridAuth = auth;
        authorizationRole = role;
    }

    function halt(
        bytes32 assetId,
        uint64 haltId,
        uint64 startTs,
        bytes32 reason,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external {
        if (assetId == bytes32(0) || reason == bytes32(0)) revert BadConfig();
        if (haltId != lastHaltId[assetId] + 1) revert BadHaltId();
        if (startTs > block.timestamp || startTs + MAX_BACKDATE_SECONDS < block.timestamp) revert BadTimestamp();
        if (phase(assetId) == Phase.HALTED) revert AlreadyHalted();
        bytes32 payloadHash = keccak256(abi.encode(address(this), assetId, haltId, startTs, reason));
        uint32 leaf = _spend(HALT_ACTION, payloadHash, deadline, ecdsaSignature, pqSignature);
        uint64 expiresAt = uint64(block.timestamp) + MAX_HALT_SECONDS;
        lastHaltId[assetId] = haltId;
        _halts[assetId] = Halt(haltId, startTs, uint64(block.timestamp), expiresAt, 0, 0, reason, true);
        emit Halted(assetId, haltId, startTs, uint64(block.timestamp), expiresAt, reason, leaf);
    }

    /// @notice Extends a halt that is still running for another `MAX_HALT_SECONDS`. A lapsed halt cannot be renewed; record a new one.
    function renew(bytes32 assetId, uint64 haltId, uint256 deadline, bytes calldata ecdsaSignature, bytes calldata pqSignature) external {
        Halt storage h = _halts[assetId];
        if (phase(assetId) != Phase.HALTED) revert NotHalted();
        if (h.haltId != haltId) revert WrongHalt();
        bytes32 payloadHash = keccak256(abi.encode(address(this), assetId, haltId, h.expiresAt));
        uint32 leaf = _spend(RENEW_ACTION, payloadHash, deadline, ecdsaSignature, pqSignature);
        h.expiresAt = uint64(block.timestamp) + MAX_HALT_SECONDS;
        emit Renewed(assetId, haltId, h.expiresAt, leaf);
    }

    function resume(bytes32 assetId, uint64 haltId, uint64 resumeTs, uint256 deadline, bytes calldata ecdsaSignature, bytes calldata pqSignature)
        external
    {
        Halt storage h = _halts[assetId];
        if (phase(assetId) != Phase.HALTED) revert NotHalted();
        if (h.haltId != haltId) revert WrongHalt();
        if (resumeTs < h.startTs || resumeTs > block.timestamp) revert BadTimestamp();
        bytes32 payloadHash = keccak256(abi.encode(address(this), assetId, haltId, resumeTs));
        uint32 leaf = _spend(RESUME_ACTION, payloadHash, deadline, ecdsaSignature, pqSignature);
        h.resumedAt = uint64(block.timestamp);
        h.resumeTs = resumeTs;
        emit Resumed(assetId, haltId, resumeTs, uint64(block.timestamp) + RESUME_AUCTION_SECONDS, leaf);
    }

    // ---------------------------------------------------------------- views

    /// @notice The state a hook or calendar overlay should apply right now. Time decides expiry; no transaction is needed.
    function phase(bytes32 assetId) public view returns (Phase) {
        Halt storage h = _halts[assetId];
        if (!h.active) return Phase.NORMAL;
        if (h.resumedAt != 0) return block.timestamp < h.resumedAt + RESUME_AUCTION_SECONDS ? Phase.RESUME_AUCTION : Phase.NORMAL;
        return block.timestamp < h.expiresAt ? Phase.HALTED : Phase.NORMAL;
    }

    function current(bytes32 assetId) external view returns (Halt memory) {
        return _halts[assetId];
    }

    /// @notice Seconds between the exchange's halt time and the moment this registry recorded it, for the page to publish per halt.
    function reportDelay(bytes32 assetId) external view returns (uint64) {
        Halt storage h = _halts[assetId];
        return h.recordedAt - h.startTs;
    }

    function rotationDue() external view returns (bool) {
        return leavesUsed >= ROTATION_THRESHOLD;
    }

    function _spend(bytes32 action, bytes32 payloadHash, uint256 deadline, bytes calldata ecdsaSignature, bytes calldata pqSignature)
        private
        returns (uint32 leaf)
    {
        leaf = hybridAuth.authorize(authorizationRole, action, payloadHash, deadline, ecdsaSignature, pqSignature);
        ++leavesUsed;
    }
}
