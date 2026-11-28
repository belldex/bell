// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PositionInfo, PositionInfoLibrary} from "../../lib/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {CalendarLeaf, MarketPhase} from "../types/ProtocolTypes.sol";

interface ISpecialistHybridAuth {
    function authorize(
        bytes32 role,
        bytes32 action,
        bytes32 payloadHash,
        uint256 deadline,
        bytes calldata ecdsaSignature,
        bytes calldata pqSignature
    ) external returns (uint32 leafIndex);
}

interface ISpecialistAuction {
    function assetId() external view returns (bytes32);
    function cycleId() external view returns (uint64);
    function cycleOpenTimeById(uint64 cycle) external view returns (uint64);
    function cycleClearingPriceById(uint64 cycle) external view returns (uint160);
    function cycleSummary(uint64 cycle)
        external
        view
        returns (uint64 cycleOpenTime, uint64 deadline, uint8 cycleStage, uint160 priceX96, uint128 matchedBase, bool finalized);
    function cycleOrderCount(uint64 cycle) external view returns (uint32);
    function cycleOrderId(uint64 cycle, uint32 index) external view returns (uint32);
    function order(uint32 id)
        external
        view
        returns (address owner, uint128 amountIn, uint160 limitPriceX96, uint64 cycleId, bool isBuyer, bool cancelled, bool claimed);
}

interface ISpecialistCalendar {
    function currentInterval(bytes32 assetId) external view returns (CalendarLeaf memory);
}

/// @dev Same shape as HaltRegistry.phase: 0 NORMAL, 1 HALTED, 2 RESUME_AUCTION.
interface ISpecialistHalt {
    function phase(bytes32 assetId) external view returns (uint8);
}

interface ISpecialistPositions {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, PositionInfo);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
}

/// @title SpecialistRegistry
/// @notice One bonded market maker per stock token. The Specialist must (D1) place a buy and a sell order in every Opening Bell auction cycle
///         for the stock and (D2) keep a v4 position of at least a minimum depth, covering the current price, in the stock's BELL pool.
///         Both duties are read from onchain state by anyone. A passing epoch pays a share of the stock's reward pool; a failing one slashes part
///         of the bond, with the BELL part burned.
/// @dev Immutable: no proxy, no owner, no setter. Every parameter and every stock is fixed in the constructor. The only privileged action is
///      `assign`, which needs a HybridAuth authorization (ECDSA and SHRINCS together) for the assigning role. Removal happens only through
///      the scoring rules. The Specialist's LP position is an ordinary v4 position: this contract never holds it and never calls a hook, so the
///      Specialist can withdraw it at any time; the only consequence is that D2 fails for the slots where it is gone.
///
///      Epochs are `EPOCH_SECONDS` long, counted from `GENESIS`. The Specialist is scored from the first full epoch after the assignment.
///      A duty with too little data in an epoch (no auction cycles at all, or fewer than `MIN_CHECKPOINTS` checkpoints) is not measured and
///      cannot fail, so a missing caller never costs the Specialist a slash; an epoch with nothing measured is void and pays nothing.
contract SpecialistRegistry {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    using PositionInfoLibrary for PositionInfo;

    struct StockConfig {
        bytes32 stockId; // an opaque id, e.g. keccak256("NVDA")
        address auction; // the pool's BellOpeningAuction
        bytes32 poolId; // the stock's BELL pool in the PoolManager
        uint128 minBuyQuote; // smallest buy order that counts, in quote units
        uint128 minSellBase; // smallest sell order that counts, in base units
        uint128 minLiquidity; // smallest position liquidity that counts for D2
    }

    struct Params {
        uint64 genesis; // epoch 0 starts here
        uint32 epochSeconds; // one week in production
        uint32 slotSeconds; // one checkpoint per slot, 15 minutes in production
        uint32 unbondDelay; // 14 days in production
        uint16 d1PassBps; // share of auction cycles that must pass, 8000 = 4 of 5
        uint16 d2PassBps; // share of checkpoints that must pass, 9000
        uint16 minCheckpoints; // checkpoints needed in an epoch for D2 to be measured
        uint16 auctionBandBps; // an order counts only inside this band of the clearing price
        int24 minTickWidth; // narrowest range that counts for D2
        uint16 smallSlashBps; // 500 = one twentieth of the bond
        uint16 largeSlashBps; // 2500 = one quarter of the bond
        uint16 rewardShareBps; // share of the stock's reward pool paid for a passing epoch
        uint128 maxRewardPerEpoch; // USDG cap per epoch
        uint128 checkpointTip; // USDG paid to a checkpoint caller from the reward pool
        uint128 minBondBell;
        uint128 minBondUsdg;
    }

    struct Bond {
        uint128 bell;
        uint128 usdg;
        bytes32 stock; // assigned stock, zero before assignment
        uint64 unbondAt; // zero while no unbond is requested
        bool removed; // removed by the scoring rules
    }

    struct Epoch {
        uint16 cycles;
        uint16 cyclesPassed;
        uint16 checkpoints;
        uint16 checkpointsPassed;
        bool closed;
    }

    bytes32 public constant ASSIGN_ACTION = keccak256("BELL_SPECIALIST_ASSIGN_V1");
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant BPS = 10_000;

    ISpecialistHybridAuth public immutable HYBRID_AUTH;
    bytes32 public immutable ASSIGN_ROLE;
    IERC20 public immutable BELL;
    IERC20 public immutable USDG;
    IPoolManager public immutable POOL_MANAGER;
    ISpecialistPositions public immutable POSITIONS;
    ISpecialistCalendar public immutable CALENDAR;
    ISpecialistHalt public immutable HALT; // zero: no halt check

    uint64 public immutable GENESIS;
    uint32 public immutable EPOCH_SECONDS;
    uint32 public immutable SLOT_SECONDS;
    uint32 public immutable UNBOND_DELAY;
    uint16 public immutable D1_PASS_BPS;
    uint16 public immutable D2_PASS_BPS;
    uint16 public immutable MIN_CHECKPOINTS;
    uint16 public immutable AUCTION_BAND_BPS;
    int24 public immutable MIN_TICK_WIDTH;
    uint16 public immutable SMALL_SLASH_BPS;
    uint16 public immutable LARGE_SLASH_BPS;
    uint16 public immutable REWARD_SHARE_BPS;
    uint128 public immutable MAX_REWARD_PER_EPOCH;
    uint128 public immutable CHECKPOINT_TIP;
    uint128 public immutable MIN_BOND_BELL;
    uint128 public immutable MIN_BOND_USDG;

    mapping(bytes32 stock => StockConfig) public stockConfig;
    mapping(bytes32 stock => bool) public stockExists;
    mapping(address specialist => Bond) public bonds;
    mapping(bytes32 stock => address) public specialistOf;
    mapping(bytes32 stock => uint256) public positionOf; // v4 position token id the Specialist registered
    mapping(bytes32 stock => uint64) public startEpoch; // first scored epoch
    mapping(bytes32 stock => uint64) public nextEpochToClose;
    mapping(bytes32 stock => uint64) public nextCycleToRecord;
    mapping(bytes32 stock => uint64) public lastCheckpointSlot; // slot index + 1
    mapping(bytes32 stock => bool) public previousEpochFailed;
    mapping(bytes32 stock => uint256) public rewardPool;
    mapping(bytes32 stock => mapping(uint64 epoch => Epoch)) public epochs;
    uint256 public totalBondBell;
    uint256 public totalBondUsdg;

    uint256 private _lock = 1;

    event SpecialistBonded(address indexed specialist, uint256 bell, uint256 usdg);
    event SpecialistAssigned(bytes32 indexed stock, address indexed specialist, uint64 startEpoch, uint32 leafIndex);
    event PositionRegistered(bytes32 indexed stock, address indexed specialist, uint256 tokenId);
    event Checkpoint(
        bytes32 indexed stock, uint64 indexed epoch, uint64 slot, bool pass, uint128 liquidity, int24 tick, int24 tickLower, int24 tickUpper, address caller
    );
    event AuctionDutyRecorded(bytes32 indexed stock, uint64 indexed epoch, uint64 indexed cycle, bool pass, bool hasBuy, bool hasSell, bool counted);
    event EpochScored(
        bytes32 indexed stock, uint64 indexed epoch, address indexed specialist, uint8 outcome, bool d1Measured, bool d1Pass, bool d2Measured, bool d2Pass
    );
    event Slashed(bytes32 indexed stock, address indexed specialist, uint64 epoch, uint256 bellBurned, uint256 usdgToPool, bool removed);
    event Rewarded(bytes32 indexed stock, address indexed specialist, uint64 epoch, uint256 usdg);
    event RewardPoolFunded(bytes32 indexed stock, address indexed from, uint256 usdg);
    event UnbondRequested(address indexed specialist, uint64 unbondAt);
    event Unbonded(address indexed specialist, uint256 bell, uint256 usdg);

    error BadConfig();
    error Reentrant();
    error UnknownStock();
    error BondTooSmall();
    error AlreadyBonded();
    error NotBonded();
    error NotSpecialist();
    error StockTaken();
    error AlreadyAssigned();
    error Removed();
    error NoSpecialist();
    error NotYourPosition();
    error WrongPool();
    error NotOpenSession();
    error SlotDone();
    error NotScoredYet();
    error CycleNotFinal();
    error NoSuchCycle();
    error EpochNotOver();
    error CyclesPending();
    error UnbondNotRequested();
    error UnbondPending();
    error UnbondAlready();
    error EpochsOpen();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrant();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(
        address hybridAuth,
        bytes32 assignRole,
        address bell,
        address usdg,
        address poolManager,
        address positionManager,
        address calendar,
        address halt,
        Params memory p,
        StockConfig[] memory stocks
    ) {
        if (
            hybridAuth == address(0) || bell == address(0) || usdg == address(0) || poolManager == address(0) || positionManager == address(0)
                || calendar == address(0) || p.epochSeconds == 0 || p.slotSeconds == 0 || p.slotSeconds > p.epochSeconds || p.d1PassBps > BPS
                || p.d2PassBps > BPS || p.minCheckpoints == 0 || p.auctionBandBps == 0 || p.auctionBandBps >= BPS || p.minTickWidth <= 0
                || p.smallSlashBps > p.largeSlashBps || p.largeSlashBps > BPS || p.rewardShareBps > BPS || stocks.length == 0
                || p.minBondBell == 0 || p.minBondUsdg == 0
        ) revert BadConfig();
        HYBRID_AUTH = ISpecialistHybridAuth(hybridAuth);
        ASSIGN_ROLE = assignRole;
        BELL = IERC20(bell);
        USDG = IERC20(usdg);
        POOL_MANAGER = IPoolManager(poolManager);
        POSITIONS = ISpecialistPositions(positionManager);
        CALENDAR = ISpecialistCalendar(calendar);
        HALT = ISpecialistHalt(halt);
        GENESIS = p.genesis;
        EPOCH_SECONDS = p.epochSeconds;
        SLOT_SECONDS = p.slotSeconds;
        UNBOND_DELAY = p.unbondDelay;
        D1_PASS_BPS = p.d1PassBps;
        D2_PASS_BPS = p.d2PassBps;
        MIN_CHECKPOINTS = p.minCheckpoints;
        AUCTION_BAND_BPS = p.auctionBandBps;
        MIN_TICK_WIDTH = p.minTickWidth;
        SMALL_SLASH_BPS = p.smallSlashBps;
        LARGE_SLASH_BPS = p.largeSlashBps;
        REWARD_SHARE_BPS = p.rewardShareBps;
        MAX_REWARD_PER_EPOCH = p.maxRewardPerEpoch;
        CHECKPOINT_TIP = p.checkpointTip;
        MIN_BOND_BELL = p.minBondBell;
        MIN_BOND_USDG = p.minBondUsdg;
        for (uint256 i; i < stocks.length; ++i) {
            StockConfig memory s = stocks[i];
            if (s.stockId == bytes32(0) || s.auction == address(0) || s.poolId == bytes32(0) || stockExists[s.stockId] || s.minLiquidity == 0) {
                revert BadConfig();
            }
            stockExists[s.stockId] = true;
            stockConfig[s.stockId] = s;
        }
    }

    // ------------------------------------------------------------------ views

    function epochOf(uint256 timestamp) public view returns (uint64) {
        if (timestamp < GENESIS) return 0;
        return uint64((timestamp - GENESIS) / EPOCH_SECONDS);
    }

    function epochEnd(uint64 epoch) public view returns (uint256) {
        return uint256(GENESIS) + (uint256(epoch) + 1) * EPOCH_SECONDS;
    }

    function currentEpoch() external view returns (uint64) {
        return epochOf(block.timestamp);
    }

    /// @notice The duties of one epoch, as the contract would score them right now.
    function previewEpoch(bytes32 stock, uint64 epoch)
        public
        view
        returns (bool d1Measured, bool d1Pass, bool d2Measured, bool d2Pass)
    {
        Epoch memory e = epochs[stock][epoch];
        d1Measured = e.cycles > 0;
        d1Pass = !d1Measured || uint256(e.cyclesPassed) * BPS >= uint256(e.cycles) * D1_PASS_BPS;
        d2Measured = e.checkpoints >= MIN_CHECKPOINTS;
        d2Pass = !d2Measured || uint256(e.checkpointsPassed) * BPS >= uint256(e.checkpoints) * D2_PASS_BPS;
    }

    // --------------------------------------------------------------- lifecycle

    /// @notice Lock a bond. One bond per address; it is assigned to a stock later by `assign`.
    function bond(uint128 bellAmount, uint128 usdgAmount) external nonReentrant {
        if (bellAmount < MIN_BOND_BELL || usdgAmount < MIN_BOND_USDG) revert BondTooSmall();
        Bond storage b = bonds[msg.sender];
        if (b.bell != 0 || b.usdg != 0 || b.removed) revert AlreadyBonded();
        b.bell = bellAmount;
        b.usdg = usdgAmount;
        totalBondBell += bellAmount;
        totalBondUsdg += usdgAmount;
        BELL.safeTransferFrom(msg.sender, address(this), bellAmount);
        USDG.safeTransferFrom(msg.sender, address(this), usdgAmount);
        emit SpecialistBonded(msg.sender, bellAmount, usdgAmount);
    }

    /// @notice Name the Specialist for a stock. Needs a HybridAuth authorization from the assigning role.
    function assign(bytes32 stock, address specialist, uint256 deadline, bytes calldata ecdsaSignature, bytes calldata pqSignature)
        external
        returns (uint32 leafIndex)
    {
        if (!stockExists[stock]) revert UnknownStock();
        if (specialistOf[stock] != address(0)) revert StockTaken();
        Bond storage b = bonds[specialist];
        if (b.bell == 0) revert NotBonded();
        if (b.stock != bytes32(0)) revert AlreadyAssigned();
        if (b.removed || b.unbondAt != 0) revert Removed();
        bytes32 payloadHash = keccak256(abi.encode(address(this), stock, specialist, b.bell, b.usdg));
        leafIndex = HYBRID_AUTH.authorize(ASSIGN_ROLE, ASSIGN_ACTION, payloadHash, deadline, ecdsaSignature, pqSignature);
        b.stock = stock;
        specialistOf[stock] = specialist;
        uint64 start = epochOf(block.timestamp) + 1;
        startEpoch[stock] = start;
        nextEpochToClose[stock] = start;
        ISpecialistAuction a = ISpecialistAuction(stockConfig[stock].auction);
        uint64 c = a.cycleId();
        // The cycle in flight belongs to the epoch before the first scored one, or to a later one; either way it is walked in order.
        nextCycleToRecord[stock] = c == 0 ? 1 : (a.cycleOpenTimeById(c) > block.timestamp ? c : c + 1);
        emit SpecialistAssigned(stock, specialist, start, leafIndex);
    }

    /// @notice The Specialist names the v4 position that D2 will read. It can be changed at any time.
    function registerPosition(uint256 tokenId) external {
        Bond storage b = bonds[msg.sender];
        bytes32 stock = b.stock;
        if (stock == bytes32(0) || specialistOf[stock] != msg.sender) revert NotSpecialist();
        if (POSITIONS.ownerOf(tokenId) != msg.sender) revert NotYourPosition();
        (PoolKey memory key,) = POSITIONS.getPoolAndPositionInfo(tokenId);
        if (PoolId.unwrap(key.toId()) != stockConfig[stock].poolId) revert WrongPool();
        positionOf[stock] = tokenId;
        emit PositionRegistered(stock, msg.sender, tokenId);
    }

    /// @notice Anyone adds USDG to a stock's reward pool.
    function fund(bytes32 stock, uint256 amount) external nonReentrant {
        if (!stockExists[stock]) revert UnknownStock();
        rewardPool[stock] += amount;
        USDG.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardPoolFunded(stock, msg.sender, amount);
    }

    // ---------------------------------------------------------------- D2

    /// @notice Record one floor-duty sample for the current slot. Anyone may call; the caller earns the tip while the reward pool has it.
    function checkpoint(bytes32 stock) external nonReentrant {
        address specialist = specialistOf[stock];
        if (specialist == address(0)) revert NoSpecialist();
        uint64 epoch = epochOf(block.timestamp);
        if (epoch < startEpoch[stock]) revert NotScoredYet();
        if (epochs[stock][epoch].closed) revert EpochNotOver();
        _requireOpenSession(stockConfig[stock]);
        uint64 slot = uint64((block.timestamp - GENESIS) / SLOT_SECONDS);
        if (lastCheckpointSlot[stock] == slot + 1) revert SlotDone();
        lastCheckpointSlot[stock] = slot + 1;

        (bool pass, uint128 liquidity, int24 tick, int24 lo, int24 hi) = _floorState(stock, specialist);
        Epoch storage e = epochs[stock][epoch];
        ++e.checkpoints;
        if (pass) ++e.checkpointsPassed;
        emit Checkpoint(stock, epoch, slot, pass, liquidity, tick, lo, hi, msg.sender);

        uint256 tip = CHECKPOINT_TIP;
        if (tip != 0 && rewardPool[stock] >= tip) {
            rewardPool[stock] -= tip;
            USDG.safeTransfer(msg.sender, tip);
        }
    }

    function _floorState(bytes32 stock, address specialist)
        private
        view
        returns (bool pass, uint128 liquidity, int24 tick, int24 lo, int24 hi)
    {
        uint256 tokenId = positionOf[stock];
        if (tokenId == 0) return (false, 0, 0, 0, 0);
        StockConfig storage cfg = stockConfig[stock];
        (, tick,,) = POOL_MANAGER.getSlot0(PoolId.wrap(cfg.poolId));
        try POSITIONS.ownerOf(tokenId) returns (address owner) {
            if (owner != specialist) return (false, 0, tick, 0, 0);
        } catch {
            return (false, 0, tick, 0, 0); // the position was burned
        }
        liquidity = POSITIONS.getPositionLiquidity(tokenId);
        (, PositionInfo info) = POSITIONS.getPoolAndPositionInfo(tokenId);
        lo = info.tickLower();
        hi = info.tickUpper();
        pass = liquidity >= cfg.minLiquidity && lo <= tick && tick < hi && hi - lo >= MIN_TICK_WIDTH;
    }

    function _requireOpenSession(StockConfig storage cfg) private view {
        bytes32 assetId = ISpecialistAuction(cfg.auction).assetId();
        CalendarLeaf memory leaf;
        try CALENDAR.currentInterval(assetId) returns (CalendarLeaf memory l) {
            leaf = l;
        } catch {
            revert NotOpenSession();
        }
        if (block.timestamp < leaf.start || block.timestamp >= leaf.end) revert NotOpenSession();
        if (leaf.phase < uint8(MarketPhase.PRE) || leaf.phase > uint8(MarketPhase.OVERNIGHT)) revert NotOpenSession();
        if (address(HALT) != address(0) && HALT.phase(assetId) != 0) revert NotOpenSession();
    }

    // ---------------------------------------------------------------- D1

    /// @notice Record the Opening Bell duty for the next unrecorded cycle. Cycles are recorded in order, so none can be skipped.
    function recordAuction(bytes32 stock) external {
        address specialist = specialistOf[stock];
        if (specialist == address(0)) revert NoSpecialist();
        StockConfig storage cfg = stockConfig[stock];
        ISpecialistAuction a = ISpecialistAuction(cfg.auction);
        uint64 cycle = nextCycleToRecord[stock];
        if (cycle > a.cycleId()) revert NoSuchCycle();
        (uint64 openTime, uint64 deadline,, uint160 price,, bool finalized) = a.cycleSummary(cycle);
        if (!finalized && block.timestamp < deadline) revert CycleNotFinal();
        nextCycleToRecord[stock] = cycle + 1;
        uint64 epoch = epochOf(openTime);
        if (epoch < startEpoch[stock] || epochs[stock][epoch].closed) {
            emit AuctionDutyRecorded(stock, epoch, cycle, false, false, false, false);
            return;
        }
        (bool hasBuy, bool hasSell) = _orders(a, cfg, cycle, specialist, finalized ? price : 0);
        bool pass = hasBuy && hasSell;
        Epoch storage e = epochs[stock][epoch];
        ++e.cycles;
        if (pass) ++e.cyclesPassed;
        emit AuctionDutyRecorded(stock, epoch, cycle, pass, hasBuy, hasSell, true);
    }

    function _orders(ISpecialistAuction a, StockConfig storage cfg, uint64 cycle, address specialist, uint160 clearing)
        private
        view
        returns (bool hasBuy, bool hasSell)
    {
        uint32 count = a.cycleOrderCount(cycle);
        uint128 minBuy = cfg.minBuyQuote;
        uint128 minSell = cfg.minSellBase;
        for (uint32 i; i < count && !(hasBuy && hasSell); ++i) {
            (address owner, uint128 amountIn, uint160 limit,, bool isBuyer, bool cancelled,) = a.order(a.cycleOrderId(cycle, i));
            if (owner != specialist || cancelled) continue;
            if (amountIn < (isBuyer ? minBuy : minSell)) continue;
            if (clearing != 0 && !_inBand(limit, clearing)) continue;
            if (isBuyer) hasBuy = true;
            else hasSell = true;
        }
    }

    function _inBand(uint160 limit, uint160 clearing) private view returns (bool) {
        uint256 lo = uint256(clearing) * (BPS - AUCTION_BAND_BPS) / BPS;
        uint256 hi = uint256(clearing) * (BPS + AUCTION_BAND_BPS) / BPS;
        return limit >= lo && limit <= hi;
    }

    // ----------------------------------------------------------- scoring

    /// @notice Score the next finished epoch. Anyone may call once the epoch has ended and every cycle that opened in it is recorded.
    /// @dev outcome: 0 void (nothing measured), 1 pass, 2 one duty failed, 3 both failed or a second failing epoch in a row.
    function closeEpoch(bytes32 stock) external nonReentrant {
        address specialist = specialistOf[stock];
        if (specialist == address(0)) revert NoSpecialist();
        uint64 epoch = nextEpochToClose[stock];
        if (block.timestamp < epochEnd(epoch)) revert EpochNotOver();
        _requireCyclesRecorded(stock, epoch);

        epochs[stock][epoch].closed = true;
        nextEpochToClose[stock] = epoch + 1;
        (bool m1, bool p1, bool m2, bool p2) = previewEpoch(stock, epoch);
        uint8 failures = (m1 && !p1 ? 1 : 0) + (m2 && !p2 ? 1 : 0);
        uint8 outcome;
        if (!m1 && !m2) {
            outcome = 0;
        } else if (failures == 0) {
            outcome = 1;
        } else if (failures == 1 && !previousEpochFailed[stock]) {
            outcome = 2;
        } else {
            outcome = 3;
        }
        emit EpochScored(stock, epoch, specialist, outcome, m1, p1, m2, p2);

        if (outcome == 1) {
            previousEpochFailed[stock] = false;
            _reward(stock, specialist, epoch);
        } else if (outcome >= 2) {
            previousEpochFailed[stock] = true;
            _slash(stock, specialist, epoch, outcome == 2 ? SMALL_SLASH_BPS : LARGE_SLASH_BPS, outcome == 3);
        }
    }

    function _requireCyclesRecorded(bytes32 stock, uint64 epoch) private view {
        ISpecialistAuction a = ISpecialistAuction(stockConfig[stock].auction);
        uint64 next = nextCycleToRecord[stock];
        if (next > a.cycleId()) return; // every existing cycle is recorded
        uint64 openTime = a.cycleOpenTimeById(next);
        if (openTime != 0 && epochOf(openTime) <= epoch) revert CyclesPending();
    }

    function _reward(bytes32 stock, address specialist, uint64 epoch) private {
        uint256 pool = rewardPool[stock];
        uint256 amount = pool * REWARD_SHARE_BPS / BPS;
        if (amount > MAX_REWARD_PER_EPOCH) amount = MAX_REWARD_PER_EPOCH;
        if (amount == 0) return;
        rewardPool[stock] = pool - amount;
        USDG.safeTransfer(specialist, amount);
        emit Rewarded(stock, specialist, epoch, amount);
    }

    function _slash(bytes32 stock, address specialist, uint64 epoch, uint16 bps, bool remove) private {
        Bond storage b = bonds[specialist];
        uint256 bellCut = uint256(b.bell) * bps / BPS;
        uint256 usdgCut = uint256(b.usdg) * bps / BPS;
        b.bell -= uint128(bellCut);
        b.usdg -= uint128(usdgCut);
        totalBondBell -= bellCut;
        totalBondUsdg -= usdgCut;
        rewardPool[stock] += usdgCut;
        if (remove) {
            specialistOf[stock] = address(0);
            positionOf[stock] = 0;
            b.stock = bytes32(0);
            b.removed = true;
        }
        if (bellCut != 0) BELL.safeTransfer(BURN, bellCut);
        emit Slashed(stock, specialist, epoch, bellCut, usdgCut, remove);
    }

    // ------------------------------------------------------------- unbond

    /// @notice Start the unbond delay. Duties and slashing keep applying until the bond is paid out.
    function requestUnbond() external {
        Bond storage b = bonds[msg.sender];
        if (b.bell == 0 && b.usdg == 0) revert NotBonded();
        if (b.unbondAt != 0) revert UnbondAlready();
        b.unbondAt = uint64(block.timestamp + UNBOND_DELAY);
        emit UnbondRequested(msg.sender, b.unbondAt);
    }

    /// @notice Pay out what is left of the bond, once the delay has passed and every epoch that ended before now has been scored.
    function unbond() external nonReentrant {
        Bond storage b = bonds[msg.sender];
        if (b.unbondAt == 0) revert UnbondNotRequested();
        if (block.timestamp < b.unbondAt) revert UnbondPending();
        bytes32 stock = b.stock;
        if (stock != bytes32(0)) {
            // Still assigned: every finished epoch must be scored first, so a bad week cannot be dodged by leaving.
            if (epochEnd(nextEpochToClose[stock]) <= block.timestamp) revert EpochsOpen();
            specialistOf[stock] = address(0);
            positionOf[stock] = 0;
            b.stock = bytes32(0);
        }
        uint256 bellOut = b.bell;
        uint256 usdgOut = b.usdg;
        b.bell = 0;
        b.usdg = 0;
        b.unbondAt = 0;
        b.removed = true; // an address bonds once; a new Specialist uses a new address
        totalBondBell -= bellOut;
        totalBondUsdg -= usdgOut;
        if (bellOut != 0) BELL.safeTransfer(msg.sender, bellOut);
        if (usdgOut != 0) USDG.safeTransfer(msg.sender, usdgOut);
        emit Unbonded(msg.sender, bellOut, usdgOut);
    }
}
