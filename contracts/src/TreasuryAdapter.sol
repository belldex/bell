// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CreateRequest, PoolConfig, LiquidityMode} from "./types/ProtocolTypes.sol";
import {BellHook} from "./BellHook.sol";

/// @notice Restricted in-kind treasury position manager for one TREASURY_ONLY pool.
/// @dev The hook binds this adapter immutably at its own deployment; the adapter binds the
/// predicted hook one-shot at seed after verifying the hook points back at it. One seed position
/// for the adapter lifetime: the hook lifecycle allows exactly one seed and no post-LIVE add in
/// TREASURY_ONLY mode. No customer custody, no sweep, no arbitrary transfer target: outputs only
/// ever move in-kind to the immutable recipient, seed funds only ever come from the immutable
/// treasury, and every transfer is exact-balance verified against fee-on-transfer/tax tokens.
/// Remove/collect are treasury-only, deadline-bound and oracle-free; they never touch hook
/// budget accounting (no beforeRemoveLiquidity/beforeSwap gate exists on those paths).
contract TreasuryAdapter is IUnlockCallback {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidRequest();
    error BadSeed();
    error DeadlineExpired(uint64);
    error SlippageExceeded();
    error SettlementMismatch();
    error ReentrantCall();

    /// @dev Treasury receipt: pool (via key), ticks, salt and this adapter.
    struct Position {
        int24 tickLower;
        int24 tickUpper;
        bytes32 salt;
        uint128 liquidity;
        uint128 principal0;
        uint128 principal1;
        bool active;
    }

    IPoolManager public immutable poolManager;
    /// @dev Seed authority; deployment-manifest trust boundary like BellHook's factory binding.
    address public immutable factory;
    /// @dev Only remove/collect authority and the only seed funding source.
    address public immutable treasury;
    /// @dev Immutable in-kind output recipient for every exit and fee credit.
    address public immutable recipient;
    /// @dev Predicted BellHook address; code exists only after the factory deploys it.
    address public immutable hook;
    Currency public immutable currency0;
    Currency public immutable currency1;
    int24 public immutable tickSpacing;

    mapping(bytes32 => Position) public positions;
    bool private _entered;
    bool private _bound;
    bool private _seeded;

    constructor(
        IPoolManager poolManager_,
        address factory_,
        address treasury_,
        address recipient_,
        address hook_,
        Currency currency0_,
        Currency currency1_,
        int24 tickSpacing_
    ) {
        if (address(poolManager_).code.length == 0 || factory_ == address(0) || treasury_ == address(0)
            || recipient_ == address(0) || recipient_ == address(this) || treasury_ == address(this)
            || hook_ == address(0) || Currency.unwrap(currency0_) == address(0)
            || Currency.unwrap(currency0_) >= Currency.unwrap(currency1_) || tickSpacing_ <= 0) revert InvalidConfiguration();
        poolManager = poolManager_;
        factory = factory_;
        treasury = treasury_;
        recipient = recipient_;
        hook = hook_;
        currency0 = currency0_;
        currency1 = currency1_;
        tickSpacing = tickSpacing_;
    }

    /// @dev Only the seed factory may call, exactly once, inside the hook's SEEDING window that
    /// beginSeed opened. Pulls the maximum from the treasury, adds the exact seed liquidity, then
    /// verifies and refunds the unspent remainder to the same treasury.
    function seed(bytes32 requestHash, CreateRequest calldata r) external returns (bytes32 key_) {
        if (_entered) revert ReentrantCall();
        _entered = true;
        if (msg.sender != factory) revert Unauthorized();
        if (block.timestamp > r.deadline) revert DeadlineExpired(r.deadline);
        if (!_bound) _bind(r.config);
        if (_seeded || requestHash == bytes32(0) || r.recipient != recipient || r.liquidity == 0
            || r.tickLower >= r.tickUpper || r.tickLower % tickSpacing != 0 || r.tickUpper % tickSpacing != 0
            || r.amountMax[0] == 0 || r.amountMax[1] == 0) revert InvalidRequest();
        key_ = positionKey(r.tickLower, r.tickUpper, r.salt);
        if (positions[key_].active) revert BadSeed();

        _pullExact(currency0, treasury, r.amountMax[0]);
        _pullExact(currency1, treasury, r.amountMax[1]);
        (uint128 got0, uint128 got1) = abi.decode(
            poolManager.unlock(abi.encode(r.tickLower, r.tickUpper, r.salt, int256(uint256(r.liquidity)))),
            (uint128, uint128));
        uint128[2] memory principal = BellHook(hook).seedPrincipal();
        if (!BellHook(hook).seedCaptured() || got0 != principal[0] || got1 != principal[1]
            || got0 == 0 || got1 == 0
            || IERC20(Currency.unwrap(currency0)).balanceOf(address(this)) != uint256(r.amountMax[0]) - got0
            || IERC20(Currency.unwrap(currency1)).balanceOf(address(this)) != uint256(r.amountMax[1]) - got1) {
            revert SettlementMismatch();
        }
        positions[key_] = Position({
            tickLower: r.tickLower, tickUpper: r.tickUpper, salt: r.salt,
            liquidity: r.liquidity, principal0: principal[0], principal1: principal[1], active: true
        });
        _seeded = true;
        _refundExact(currency0, r.amountMax[0] - principal[0]);
        _refundExact(currency1, r.amountMax[1] - principal[1]);
        _entered = false;
    }

    /// @notice Treasury-only partial or full exit. In-kind to the immutable recipient, no oracle
    /// gate and no hook budget interaction.
    function remove(bytes32 key_, uint128 liquidity, uint128 amount0Min, uint128 amount1Min, uint64 deadline)
        external returns (uint128 amount0, uint128 amount1)
    {
        if (_entered) revert ReentrantCall();
        _entered = true;
        if (msg.sender != treasury) revert Unauthorized();
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        Position storage p = positions[key_];
        if (!p.active || liquidity == 0 || liquidity > p.liquidity) revert BadSeed();
        (amount0, amount1) = _unlockModify(p.tickLower, p.tickUpper, p.salt, -int256(uint256(liquidity)));
        if (amount0 < amount0Min || amount1 < amount1Min) revert SlippageExceeded();
        p.liquidity -= liquidity;
        if (p.liquidity == 0) {
            p.active = false;
            p.principal0 = 0;
            p.principal1 = 0;
        }
        _entered = false;
    }

    /// @notice Treasury-only in-kind fee collection. Actual credits must meet the minima.
    function collect(bytes32 key_, uint128 fee0Min, uint128 fee1Min, uint64 deadline)
        external returns (uint128 amount0, uint128 amount1)
    {
        if (_entered) revert ReentrantCall();
        _entered = true;
        if (msg.sender != treasury) revert Unauthorized();
        if (block.timestamp > deadline) revert DeadlineExpired(deadline);
        Position storage p = positions[key_];
        if (!p.active) revert BadSeed();
        (amount0, amount1) = _unlockModify(p.tickLower, p.tickUpper, p.salt, int256(0));
        if (amount0 < fee0Min || amount1 < fee1Min) revert SlippageExceeded();
        _entered = false;
    }

    function position(bytes32 key_) external view returns (Position memory) {
        return positions[key_];
    }

    function positionKey(int24 tickLower, int24 tickUpper, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            PoolId.unwrap(PoolIdLibrary.toId(_key())), tickLower, tickUpper, salt, address(this)
        ));
    }

    /// @dev Settle positive deltas from the adapter balance; forward negative deltas in-kind to
    /// the immutable recipient. Only ever invoked by the pinned PoolManager inside our unlock.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Unauthorized();
        (int24 tickLower, int24 tickUpper, bytes32 salt, int256 liquidityDelta) =
            abi.decode(data, (int24, int24, bytes32, int256));
        PoolKey memory key = _key();
        (BalanceDelta callerDelta,) =
            poolManager.modifyLiquidity(key, ModifyLiquidityParams({
                tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: liquidityDelta, salt: salt
            }), "");
        int128 a0 = callerDelta.amount0();
        int128 a1 = callerDelta.amount1();
        uint128 got0;
        uint128 got1;
        // Adding liquidity owes the pool (negative delta): settle from the treasury-funded
        // balance. Removing/collecting is owed (positive delta): take and forward in-kind.
        if (a0 < 0) got0 = _settle(key.currency0, uint128(-a0));
        else if (a0 > 0) got0 = _takeForward(key.currency0, uint128(a0));
        if (a1 < 0) got1 = _settle(key.currency1, uint128(-a1));
        else if (a1 > 0) got1 = _takeForward(key.currency1, uint128(a1));
        return abi.encode(got0, got1);
    }

    function _unlockModify(int24 tickLower, int24 tickUpper, bytes32 salt, int256 liquidityDelta)
        private returns (uint128, uint128)
    {
        return abi.decode(
            poolManager.unlock(abi.encode(tickLower, tickUpper, salt, liquidityDelta)), (uint128, uint128));
    }

    function _key() private view returns (PoolKey memory) {
        return PoolKey(currency0, currency1, LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing, IHooks(hook));
    }

    function _settle(Currency currency, uint128 amount) private returns (uint128) {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
        return amount;
    }

    function _takeForward(Currency currency, uint128 amount) private returns (uint128) {
        poolManager.take(currency, address(this), amount);
        _forwardExact(currency, recipient, amount);
        return amount;
    }

    /// @dev Two-way binding: the config must match every immutable, and the hook must already
    /// point back at this adapter as its own immutable treasury routing.
    function _bind(PoolConfig calldata c) private {
        if (c.poolManager != address(poolManager) || c.factory != factory
            || c.treasuryAdapter != address(this) || c.liquidityMode != uint8(LiquidityMode.TREASURY_ONLY)
            || c.token0 != Currency.unwrap(currency0) || c.token1 != Currency.unwrap(currency1)
            || c.tickSpacing != tickSpacing) revert InvalidConfiguration();
        PoolConfig memory hc = BellHook(hook).config();
        if (hc.treasuryAdapter != address(this) || hc.poolManager != address(poolManager)
            || hc.factory != factory || hc.liquidityMode != uint8(LiquidityMode.TREASURY_ONLY)) {
            revert InvalidConfiguration();
        }
        _bound = true;
    }

    function _pullExact(Currency currency, address from, uint128 amount) private {
        IERC20 token = IERC20(Currency.unwrap(currency));
        uint256 fromBefore = token.balanceOf(from);
        uint256 hereBefore = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        if (token.balanceOf(from) != fromBefore - amount
            || token.balanceOf(address(this)) != hereBefore + amount) revert SettlementMismatch();
    }

    function _forwardExact(Currency currency, address to, uint128 amount) private {
        if (amount == 0) return;
        IERC20 token = IERC20(Currency.unwrap(currency));
        uint256 toBefore = token.balanceOf(to);
        token.safeTransfer(to, amount);
        if (token.balanceOf(to) != toBefore + amount) revert SettlementMismatch();
    }

    function _refundExact(Currency currency, uint128 amount) private {
        if (amount == 0) return;
        IERC20 token = IERC20(Currency.unwrap(currency));
        uint256 hereBefore = token.balanceOf(address(this));
        _forwardExact(currency, treasury, amount);
        if (token.balanceOf(address(this)) != hereBefore - amount) revert SettlementMismatch();
    }
}
