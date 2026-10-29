// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

enum MarketPhase {
    UNKNOWN,
    PRE,
    REGULAR,
    POST,
    OVERNIGHT,
    CLOSED
}

enum PoolClass {
    PRICE_GUARDED,
    SESSION_ONLY
}

enum LiquidityMode {
    PUBLIC,
    TREASURY_ONLY
}

enum Lifecycle {
    DEPLOYED,
    SEEDING,
    LIVE
}

enum Mode {
    HALTED,
    ACTIVE,
    CLOSED,
    RECOVERING,
    SETUP
}

struct AssetDescriptor {
    bytes32 id;
    address token;
    bool isStock;
    uint8 decimals;
    uint8 capabilityMask;
    address tokenPriceAdapter;
    address regularAdapter;
    address extendedAdapter;
    address overnightAdapter;
    address secondaryAdapter;
    bytes32 expectedCodeHash;
    bytes32 implementationFingerprint;
    bytes32 evidenceHash;
}

struct SourceWire {
    uint8 kind;
    uint8 phaseScope;
    address endpoint;
    bytes32 feedId;
    uint16 schema;
    uint8 decimals;
    uint8 priceBasis;
    uint32 heartbeatSec;
    bytes32 expectedCodeHash;
    address expectedImplementation;
    bytes32 canonicalTokenId;
}

struct SourceSample {
    bytes32 descriptorId;
    bytes32 feedId;
    uint8 phase;
    uint128 price18;
    uint64 observedAt;
    uint64 inputAt;
    uint64 validFrom;
    uint64 expiresAt;
    uint64 validUntil;
    bytes32 reportHash;
}

struct HealthView {
    bool ready;
    uint256 reasonBits;
    uint64 healthySince;
    uint64 validUntil;
    uint64 baselineObservation;
    uint64 latestObservation;
}

struct CalendarLeaf {
    bytes32 assetId;
    uint32 year;
    uint32 index;
    uint64 start;
    uint64 end;
    uint8 phase;
    bytes32 provenanceHash;
}

struct CalendarRoot {
    bytes32 root;
    uint32 leafCount;
    uint64 coverageStart;
    uint64 coverageEnd;
    uint64 queuedAt;
    uint64 executableAt;
    bytes32 datasetHash;
}

struct Anchor {
    bytes32 assetId;
    bytes32 boundaryHash;
    uint128 price18;
    uint128 multiplier18;
    uint64 capturedAt;
    uint64 observedAt;
    uint64 inputAt;
    uint64 closureStart;
    bytes32 sourceHash;
}

struct PoolConfig {
    address token0;
    address token1;
    bytes32 asset0;
    bytes32 asset1;
    address poolManager;
    address positionManager;
    address factory;
    address assetRegistry;
    address calendarRegistry;
    address safetyController;
    address treasuryAdapter;
    uint8 poolClass;
    uint8 liquidityMode;
    uint8 referenceMode;
    int24 tickSpacing;
    uint128[2] tradeCap;
    uint128[2] windowCap;
    uint128[2] closureCap;
    bytes32 policyId;
    // Appended AFTER the existing fields to avoid reordering the ABI layout that
    // _profileHash, BellHook.configHash and every off-chain codec already pin.
    // Zero means "no reference anchor on this side"; SESSION_ONLY must keep both zero.
    address referenceAdapter0;
    address referenceAdapter1;
}

struct PoolState {
    uint8 lifecycle;
    uint8 mode;
    bool closedLatched;
    uint64 closureNonce;
    uint64 reopenCandidateAt;
    uint64 oldValidUntil;
    uint64[2] reopenBaseObservations;
    uint64[2] lastOpenObservations;
    uint64 pauseNonce;
    uint64 bellStart;
    uint64 corporateUntil;
}

struct Buckets {
    uint64 epoch;
    uint128[2] currentGross;
    uint128[2] previousGross;
}

struct PolicyView {
    bool canSwap;
    uint8 mode;
    uint8 phase;
    uint16 flags;
    uint256 reasonBits;
    uint24 lpFeeUnits;
    uint16 bandBps;
    uint128[2] effectiveTradeCap;
    uint128[2] effectiveWindowCap;
    uint128[2] rollingRemaining;
    uint128[2] closureRemaining;
    uint128[2] referencePrice18;
    uint64 validUntil;
    uint64 closureNonce;
    bytes32 configHash;
    bytes32 stateHash;
}

struct CreateRequest {
    PoolConfig config;
    bytes32 salt;
    uint64 nonce;
    uint64 deadline;
    address recipient;
    uint160 sqrtPriceX96;
    int24 tickLower;
    int24 tickUpper;
    uint128 liquidity;
    uint128[2] amountMax;
    uint128 maxServiceFee;
}

struct CreateResult {
    address hook;
    bytes32 poolId;
    uint256 tokenId;
    bytes32 positionKey;
    uint128 liquidity;
    uint128[2] seedPrincipal;
}

struct SwapRequest {
    address hook;
    bool zeroForOne;
    bool exactInput;
    uint128 amountSpecified;
    uint128 limitAmount;
    uint160 sqrtPriceLimitX96;
    address recipient;
    uint64 nonce;
    uint64 deadline;
    bytes32 expectedConfigHash;
    bool wrapInput;
    bool unwrapOutput;
    bool unwrapRefund;
}

library ReasonBits {
    uint256 internal constant SETUP = 1 << 0;
    uint256 internal constant MANUAL_PAUSE = 1 << 1;
    uint256 internal constant ASSET_PAUSE = 1 << 2;
    uint256 internal constant ISSUER_PAUSE = 1 << 3;
    uint256 internal constant FINGERPRINT_CHANGED = 1 << 4;
    uint256 internal constant CALENDAR_MISSING = 1 << 5;
    uint256 internal constant CALENDAR_CONFLICT = 1 << 6;
    uint256 internal constant UNEXPECTED_CLOSED = 1 << 7;
    uint256 internal constant REPORT_INVALID_OR_STALE = 1 << 8;
    uint256 internal constant PRICE_INPUT_INVALID_OR_STALE = 1 << 9;
    uint256 internal constant CORPORATE_INCONSISTENT = 1 << 10;
    uint256 internal constant ANCHOR_MISSING_OR_EXPIRED = 1 << 11;
    uint256 internal constant RECOVERY_PENDING = 1 << 12;
    uint256 internal constant ROLLING_BUDGET = 1 << 13;
    uint256 internal constant EPISODE_BUDGET = 1 << 14;
    uint256 internal constant ZERO_FILL = 1 << 15;
    uint256 internal constant PRICE_PATH_REJECTED = 1 << 16;
}
