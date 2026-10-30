// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SwapRequest} from "./types/ProtocolTypes.sol";
import {BellHook} from "./BellHook.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @notice Official direct swap router for the BELL protocol.
/// Single-transaction, zero-custody swap settlement against pinned Uniswap v4 PoolManager.
/// Enforces caller=payer, per-payer nonces, deadline, slippage bounds, and canonical WETH wrapping.
contract BellRouter is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    address public immutable canonicalWeth;
    mapping(address => uint64) public nonces;
    bool private _entered;

    error Unauthorized();
    error ReentrantCall();
    error InvalidRecipient();
    error DeadlineExpired(uint64 deadline);
    error InvalidNonce(uint64 expected, uint64 actual);
    error ConfigMismatch(bytes32 expected, bytes32 actual);
    error SlippageExceeded(uint128 expected, uint128 actual);
    error ZeroFill();
    error SettlementMismatch();
    error NativeTransferFailed();
    error InvalidConfiguration();

    event SwapExecuted(
        address indexed payer,
        address indexed recipient,
        bytes32 indexed poolId,
        bool zeroForOne,
        bool exactInput,
        uint128 amountIn,
        uint128 amountOut,
        uint64 nonce
    );

    constructor(IPoolManager manager_, address weth_) {
        if (address(manager_) == address(0) || weth_ == address(0)) revert InvalidConfiguration();
        poolManager = manager_;
        canonicalWeth = weth_;
    }

    receive() external payable {
        if (msg.sender != canonicalWeth) revert Unauthorized();
    }

    /// @notice Execute a direct single-hop swap on a BELL pool.
    /// Caller is strictly the payer. Returns actual executed input and output token amounts.
    function swap(SwapRequest calldata request) external payable returns (uint128 amountIn, uint128 amountOut) {
        if (_entered) revert ReentrantCall();
        _entered = true;

        (PoolKey memory key, bytes32 requestHash) = _validateRequest(request);

        bytes memory result = poolManager.unlock(abi.encode(msg.sender, requestHash, request, key));
        (amountIn, amountOut) = abi.decode(result, (uint128, uint128));

        if (request.wrapInput) {
            if (msg.value > amountIn) {
                _sendNative(msg.sender, msg.value - amountIn);
            }
        } else {
            if (msg.value != 0) revert SettlementMismatch();
        }

        _verifyClean(key, request.zeroForOne);

        nonces[msg.sender] = request.nonce + 1;
        emit SwapExecuted(
            msg.sender,
            request.recipient,
            PoolId.unwrap(key.toId()),
            request.zeroForOne,
            request.exactInput,
            amountIn,
            amountOut,
            request.nonce
        );

        _entered = false;
    }

    /// @dev Core unlock callback invoked by Uniswap v4 PoolManager.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Unauthorized();

        (address payer, bytes32 requestHash, SwapRequest memory r, PoolKey memory key) =
            abi.decode(data, (address, bytes32, SwapRequest, PoolKey));

        int256 specified = r.exactInput
            ? -int256(uint256(r.amountSpecified))
            : int256(uint256(r.amountSpecified));

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: r.zeroForOne,
                amountSpecified: specified,
                sqrtPriceLimitX96: r.sqrtPriceLimitX96
            }),
            abi.encode(payer, requestHash, r.oracleUpdates)
        );

        (uint128 amountIn, uint128 amountOut) = _processDelta(delta, r.zeroForOne, r.exactInput, r.limitAmount);

        Currency inCurrency = r.zeroForOne ? key.currency0 : key.currency1;
        Currency outCurrency = r.zeroForOne ? key.currency1 : key.currency0;

        _settleInput(inCurrency, payer, amountIn, r.wrapInput);
        _deliverOutput(outCurrency, r.recipient, amountOut, r.unwrapOutput);

        return abi.encode(amountIn, amountOut);
    }

    function _validateRequest(SwapRequest calldata request)
        private
        view
        returns (PoolKey memory key, bytes32 requestHash)
    {
        if (request.recipient == address(0) || request.recipient == address(this)) revert InvalidRecipient();
        if (block.timestamp > request.deadline) revert DeadlineExpired(request.deadline);
        if (request.nonce != nonces[msg.sender]) revert InvalidNonce(nonces[msg.sender], request.nonce);
        if (request.amountSpecified == 0 || request.limitAmount == 0) revert SettlementMismatch();

        key = BellHook(request.hook).poolKey();
        bytes32 actualConfigHash = BellHook(request.hook).configHash();
        if (actualConfigHash != request.expectedConfigHash) {
            revert ConfigMismatch(request.expectedConfigHash, actualConfigHash);
        }

        requestHash = keccak256(abi.encode(
            block.chainid,
            address(this),
            msg.sender,
            request.nonce,
            request.deadline,
            request.expectedConfigHash,
            request
        ));
    }

    function _processDelta(BalanceDelta delta, bool zeroForOne, bool exactInput, uint128 limitAmount)
        private
        pure
        returns (uint128 amountIn, uint128 amountOut)
    {
        int128 dIn = zeroForOne ? delta.amount0() : delta.amount1();
        int128 dOut = zeroForOne ? delta.amount1() : delta.amount0();

        if (dIn >= 0 || dOut <= 0) revert ZeroFill();
        amountIn = uint128(uint256(-int256(dIn)));
        amountOut = uint128(uint256(int256(dOut)));

        if (exactInput) {
            if (amountOut < limitAmount) revert SlippageExceeded(limitAmount, amountOut);
        } else {
            if (amountIn > limitAmount) revert SlippageExceeded(limitAmount, amountIn);
        }
    }

    function _settleInput(Currency inCurrency, address payer, uint128 amountIn, bool wrapInput) private {
        address inToken = Currency.unwrap(inCurrency);
        if (wrapInput) {
            if (inToken != canonicalWeth) revert InvalidConfiguration();
            if (address(this).balance < amountIn) revert SettlementMismatch();
            IWETH(canonicalWeth).deposit{value: amountIn}();
        } else {
            uint256 beforeIn = IERC20(inToken).balanceOf(address(this));
            IERC20(inToken).safeTransferFrom(payer, address(this), amountIn);
            if (IERC20(inToken).balanceOf(address(this)) != beforeIn + amountIn) revert SettlementMismatch();
        }
        poolManager.sync(inCurrency);
        IERC20(inToken).safeTransfer(address(poolManager), amountIn);
        poolManager.settle();
    }

    function _deliverOutput(Currency outCurrency, address recipient, uint128 amountOut, bool unwrapOutput) private {
        address outToken = Currency.unwrap(outCurrency);
        uint256 beforeOut = IERC20(outToken).balanceOf(address(this));
        poolManager.take(outCurrency, address(this), amountOut);
        if (IERC20(outToken).balanceOf(address(this)) != beforeOut + amountOut) revert SettlementMismatch();

        if (unwrapOutput) {
            if (outToken != canonicalWeth) revert InvalidConfiguration();
            IWETH(canonicalWeth).withdraw(amountOut);
            _sendNative(recipient, amountOut);
        } else {
            IERC20(outToken).safeTransfer(recipient, amountOut);
        }
    }

    function _verifyClean(PoolKey memory key, bool zeroForOne) private view {
        Currency inCurrency = zeroForOne ? key.currency0 : key.currency1;
        Currency outCurrency = zeroForOne ? key.currency1 : key.currency0;
        if (address(this).balance != 0
            || IERC20(Currency.unwrap(inCurrency)).balanceOf(address(this)) != 0
            || IERC20(Currency.unwrap(outCurrency)).balanceOf(address(this)) != 0)
        {
            revert SettlementMismatch();
        }
    }

    function _sendNative(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }
}
