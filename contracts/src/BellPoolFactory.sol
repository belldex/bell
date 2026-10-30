// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHook} from "./BellHook.sol";
import {BellHookDeployer} from "./BellHookDeployer.sol";
import {CreateRequest, CreateResult, PoolConfig, AssetDescriptor, HealthView, LiquidityMode} from "./types/ProtocolTypes.sol";
import {TreasuryAdapter} from "./TreasuryAdapter.sol";
import {IBellPoolFactory, IAssetRegistry, ISessionRegistry} from "./interfaces/IBellProtocol.sol";
import {IBellEvents} from "./interfaces/ProtocolEvents.sol";
import {PositionReceipt, IPositionReceiptManager} from "./libraries/PositionReceipt.sol";
import {AssetPolicy} from "./libraries/AssetPolicy.sol";
import {PolicyConstants} from "./libraries/PolicyConstants.sol";
import {WidePriceMath} from "./libraries/WidePriceMath.sol";
import {ChainlinkTokenReferenceAdapter} from "./adapters/ChainlinkTokenReferenceAdapter.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPositionManager} from "../lib/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "../lib/v4-periphery/src/libraries/Actions.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IPositionManagerPermit2 {
    function permit2() external view returns (IAllowanceTransfer);
}

/// @notice Atomic PUBLIC setup for an explicitly bound immutable dependency/risk profile.
/// @dev Candidate only: constructor inputs are deployment-manifest trust boundaries, not proof of
/// canonical USDG, official periphery, source admission or calibrated risk. A missing fee-token
/// binding disables creation (not a fee-free pilot). No admin, relayer, arbitrary actions or sweep.
/// Multiple asset pairs may use the same profile; other profiles require a separately reviewed factory.
contract BellPoolFactory is IBellPoolFactory, IBellEvents {
    using SafeERC20 for IERC20;

    error InvalidConfiguration();
    error InvalidRequest();
    error UnsupportedLiquidityMode();
    error FeeTokenNotBound();
    error BalanceMismatch();
    error ReentrantRequest();
    error PriceGuardUnavailable();
    error InitialPriceOutOfBand();

    BellHookDeployer public immutable hookDeployer;
    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    address public immutable serviceToken;
    address public immutable serviceRecipient;
    uint128 public immutable serviceFee;
    uint8 public immutable liquidityMode;
    bytes32 public immutable profileHash;
    mapping(address => uint64) public override nonces;
    bool private _entered;

    constructor(PoolConfig memory profile, BellHookDeployer deployer, address usdg, address recipient) {
        if (profile.factory != address(this) || address(deployer).code.length == 0
            || deployer.factory() != address(this) || profile.poolManager.code.length == 0
            || profile.assetRegistry.code.length == 0
            || profile.calendarRegistry.code.length == 0 || profile.safetyController.code.length == 0
            || profile.tickSpacing != 60 || profile.poolClass > 1 || profile.policyId == bytes32(0)
            || recipient == address(0) || recipient == address(this)) revert InvalidConfiguration();
        for (uint256 i; i < 2; ++i) {
            if (profile.tradeCap[i] == 0 || profile.tradeCap[i] > profile.windowCap[i] || profile.closureCap[i] == 0
                || uint256(profile.closureCap[i]) > 2 * uint256(profile.tradeCap[i])
                || profile.closureCap[i] > profile.windowCap[i]) revert InvalidConfiguration();
        }
        IPositionManager pm;
        IAllowanceTransfer p2;
        if (profile.liquidityMode == uint8(LiquidityMode.PUBLIC)) {
            if (profile.positionManager == address(0) || profile.positionManager.code.length == 0
                || profile.treasuryAdapter != address(0)) revert InvalidConfiguration();
            pm = IPositionManager(profile.positionManager);
            if (address(pm.poolManager()) != profile.poolManager) revert InvalidConfiguration();
            p2 = IPositionManagerPermit2(address(pm)).permit2();
            if (address(p2).code.length == 0) revert InvalidConfiguration();
        } else if (profile.liquidityMode == uint8(LiquidityMode.TREASURY_ONLY)) {
            if (profile.treasuryAdapter == address(0) || profile.treasuryAdapter.code.length == 0) {
                revert InvalidConfiguration();
            }
        } else {
            revert InvalidConfiguration();
        }
        uint256 fee;
        if (usdg != address(0)) {
            if (usdg.code.length == 0) revert InvalidConfiguration();
            uint8 decimals = IERC20Metadata(usdg).decimals();
            if (decimals > 18) revert InvalidConfiguration();
            fee = 49 * 10 ** uint256(decimals);
        }
        hookDeployer = deployer;
        positionManager = pm;
        permit2 = p2;
        serviceToken = usdg;
        serviceRecipient = recipient;
        serviceFee = uint128(fee); // decimals <= 18 proves the bound
        liquidityMode = profile.liquidityMode;
        profileHash = _profileHash(profile);
    }

    function predict(CreateRequest calldata request) public view override
        returns (address hook, bytes32 poolId, bytes32 requestHash)
    {
        PoolKey memory key = _key(request.config);
        hook = hookDeployer.predict(request.config, key, _salt(request));
        key.hooks = IHooks(hook);
        poolId = PoolId.unwrap(PoolIdLibrary.toId(key));
        bytes32 configHash = keccak256(abi.encode(block.chainid, hookDeployer.templateCodeHash(), request.config));
        requestHash = keccak256(abi.encode(block.chainid, address(this), msg.sender, request.nonce,
            request.deadline, configHash, request));
    }

    function createAndSeed(CreateRequest calldata request) external override returns (CreateResult memory result) {
        if (_entered) revert ReentrantRequest();
        _entered = true;
        _validate(request);
        nonces[msg.sender] = request.nonce + 1;
        (address predicted, bytes32 id, bytes32 requestHash) = predict(request);
        PoolKey memory key = _key(request.config);
        address hook = hookDeployer.deploy(request.config, key, _salt(request));
        if (hook != predicted) revert InvalidConfiguration();
        key.hooks = IHooks(hook);

        if (request.config.liquidityMode == uint8(LiquidityMode.PUBLIC)) {
            uint256 tokenId = positionManager.nextTokenId();
            if (tokenId == 0) revert InvalidRequest();
            BellHook(hook).beginSeed(requestHash, request.tickLower, request.tickUpper, bytes32(tokenId), request.liquidity);
            emit PoolCreated(hook, id, BellHook(hook).configHash(), msg.sender, request.recipient);
            IPoolManager(request.config.poolManager).initialize(key, request.sqrtPriceX96);

            uint256[2] memory starting = [IERC20(request.config.token0).balanceOf(address(this)),
                IERC20(request.config.token1).balanceOf(address(this))];
            _fund(request.config.token0, request.amountMax[0], request.deadline);
            _fund(request.config.token1, request.amountMax[1], request.deadline);
            _mint(request, key);
            _clear(request.config.token0);
            _clear(request.config.token1);
            PositionReceipt.verifyPublicPosition(IPositionReceiptManager(address(positionManager)), tokenId,
                request.recipient, key, request.tickLower, request.tickUpper, request.liquidity);
            if (positionManager.nextTokenId() != tokenId + 1 || !BellHook(hook).seedCaptured()) revert InvalidRequest();
            uint128[2] memory principal = BellHook(hook).seedPrincipal();
            _verifySpent(request.config.token0, starting[0], request.amountMax[0], principal[0]);
            _verifySpent(request.config.token1, starting[1], request.amountMax[1], principal[1]);
            bytes32 positionKey = keccak256(abi.encodePacked(address(positionManager), request.tickLower, request.tickUpper, bytes32(tokenId)));
            BellHook(hook).activatePool(requestHash, tokenId);
            emit PoolActivated(id, tokenId, positionKey);
            _transferExact(serviceToken, msg.sender, serviceRecipient, serviceFee);
            emit ServiceFeePaid(msg.sender, serviceToken, serviceFee, serviceRecipient);
            _refund(request.config.token0, starting[0], request.amountMax[0] - principal[0]);
            _refund(request.config.token1, starting[1], request.amountMax[1] - principal[1]);
            result = CreateResult(hook, id, tokenId, positionKey, request.liquidity, principal);
        } else {
            bytes32 salt = request.salt;
            BellHook(hook).beginSeed(requestHash, request.tickLower, request.tickUpper, salt, request.liquidity);
            emit PoolCreated(hook, id, BellHook(hook).configHash(), msg.sender, request.recipient);
            IPoolManager(request.config.poolManager).initialize(key, request.sqrtPriceX96);

            bytes32 positionKey = TreasuryAdapter(request.config.treasuryAdapter).seed(requestHash, request);
            if (!BellHook(hook).seedCaptured()) revert InvalidRequest();
            uint128[2] memory principal = BellHook(hook).seedPrincipal();
            BellHook(hook).activatePool(requestHash, 0);
            emit PoolActivated(id, 0, positionKey);
            _transferExact(serviceToken, msg.sender, serviceRecipient, serviceFee);
            emit ServiceFeePaid(msg.sender, serviceToken, serviceFee, serviceRecipient);
            result = CreateResult(hook, id, 0, positionKey, request.liquidity, principal);
        }
        _entered = false;
    }

    function _validate(CreateRequest calldata r) private view {
        if (serviceToken == address(0)) revert FeeTokenNotBound();
        if (r.config.liquidityMode != liquidityMode) revert UnsupportedLiquidityMode();
        if (r.config.poolClass > 1 || (r.config.poolClass == 1
            && (r.config.referenceAdapter0 != address(0) || r.config.referenceAdapter1 != address(0)))) {
            // SESSION_ONLY has no reference path; an adapter there would imply priced protection.
            revert PriceGuardUnavailable();
        }
        if (_profileHash(r.config) != profileHash || r.config.token0 == address(0) || r.config.token0 >= r.config.token1
            || r.config.token0.code.length == 0 || r.config.token1.code.length == 0) revert InvalidConfiguration();
        if (msg.sender == serviceRecipient || block.timestamp > r.deadline || r.nonce != nonces[msg.sender] || r.nonce == type(uint64).max
            || r.deadline > type(uint48).max || r.recipient <= address(2) || r.recipient == address(this)
            || (address(positionManager) != address(0) && r.recipient == address(positionManager))
            || r.liquidity == 0 || r.tickLower >= r.tickUpper
            || r.tickLower < TickMath.MIN_TICK || r.tickUpper > TickMath.MAX_TICK
            || r.tickLower % 60 != 0 || r.tickUpper % 60 != 0 || r.amountMax[0] == 0 || r.amountMax[1] == 0
            || r.maxServiceFee < serviceFee) revert InvalidRequest();
        if (r.sqrtPriceX96 <= TickMath.getSqrtPriceAtTick(r.tickLower)
            || r.sqrtPriceX96 >= TickMath.getSqrtPriceAtTick(r.tickUpper)) revert InvalidRequest();
        bool stock0 = _admitted(r.config.assetRegistry, r.config.asset0, r.config.token0, r.config.poolClass);
        bool stock1 = _admitted(r.config.assetRegistry, r.config.asset1, r.config.token1, r.config.poolClass);
        // SESSION_ONLY requires exactly one verified stock. Stock/stock belongs to PRICE_GUARDED.
        if (r.config.poolClass != 0 && stock0 == stock1) revert InvalidConfiguration();
        if (r.config.poolClass == 0) _validatePriceGuard(r, stock0, stock1);
    }

    /// @dev PRICE_GUARDED admission: both sides must carry a live Chainlink reference adapter, the
    /// adapter on the stock side must pin that exact stock token (the counterasset side may be
    /// zero-bound), and the initial pool price must sit inside ACTIVE_BAND_BPS of the feed-derived
    /// reference ratio.
    function _validatePriceGuard(CreateRequest calldata r, bool stock0, bool stock1) private view {
        address adapter0 = r.config.referenceAdapter0;
        address adapter1 = r.config.referenceAdapter1;
        if (adapter0 == address(0) || adapter1 == address(0) || adapter0.code.length == 0 || adapter1.code.length == 0) {
            revert InvalidConfiguration();
        }
        // Each stock side's adapter must pin that exact token, so a misdirected or repurposed feed
        // cannot anchor a different asset. The counterasset side may be zero-bound; its feed only
        // contributes the ratio below and identity there is a deployment-manifest trust boundary.
        // Stock/stock is a valid PRICE_GUARDED shape, so both sides are checked in that case.
        if ((stock0 && ChainlinkTokenReferenceAdapter(adapter0).stockToken() != r.config.token0)
            || (stock1 && ChainlinkTokenReferenceAdapter(adapter1).stockToken() != r.config.token1)) {
            revert InvalidConfiguration();
        }
        uint128 price0 = ChainlinkTokenReferenceAdapter(adapter0).referencePrice();
        uint128 price1 = ChainlinkTokenReferenceAdapter(adapter1).referencePrice();
        uint8 decimals0 = IERC20Metadata(r.config.token0).decimals();
        uint8 decimals1 = IERC20Metadata(r.config.token1).decimals();
        // Full-precision band math shared with the swap path: the reference ratio is
        // (P0 * 10^d1) / (P1 * 10^d0) on the raw price axis, exactly the convention
        // WidePriceMath.isWithinPriceBand compares sqrtPriceX96^2 against.
        if (!WidePriceMath.isWithinPriceBand(r.sqrtPriceX96, price0, price1, decimals0, decimals1, PolicyConstants.ACTIVE_BAND_BPS)) {
            revert InitialPriceOutOfBand();
        }
    }

    function _admitted(address registry, bytes32 id, address token, uint8 poolClass) private view returns(bool) {
        if (id == bytes32(0) || IAssetRegistry(registry).descriptorIdForToken(token) != id) revert InvalidConfiguration();
        AssetDescriptor memory d = IAssetRegistry(registry).descriptor(id);
        if (d.id != id || d.token != token || d.expectedCodeHash != token.codehash || d.evidenceHash == bytes32(0)
            || d.implementationFingerprint == bytes32(0) || d.decimals != IERC20Metadata(token).decimals()) revert InvalidConfiguration();
        if (AssetPolicy.oraclelessCounterasset(d,poolClass)) return false;
        HealthView memory h = ISessionRegistry(hookDeployer.sessionRegistry()).health(id);
        if (!h.ready || h.reasonBits != 0 || h.validUntil <= block.timestamp) revert InvalidConfiguration();
        return d.isStock;
        // The hook performs the full calendar, pause, stock capability and joint-health checks at activation.
    }

    function _mint(CreateRequest calldata r, PoolKey memory key) private {
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, r.tickLower, r.tickUpper, uint256(r.liquidity), r.amountMax[0], r.amountMax[1], r.recipient, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        positionManager.modifyLiquidities(abi.encode(abi.encodePacked(uint8(Actions.MINT_POSITION),uint8(Actions.SETTLE_PAIR)),params), r.deadline);
    }

    function _fund(address token, uint128 amount, uint64 deadline) private {
        _transferExact(token, msg.sender, address(this), amount);
        IERC20(token).forceApprove(address(permit2), amount);
        permit2.approve(token, address(positionManager), amount, uint48(deadline));
    }

    function _clear(address token) private {
        permit2.approve(token, address(positionManager), 0, 0);
        IERC20(token).forceApprove(address(permit2), 0);
    }

    function _verifySpent(address token, uint256 start, uint128 maximum, uint128 principal) private view {
        uint256 current = IERC20(token).balanceOf(address(this));
        if (principal > maximum || current < start || current - start != uint256(maximum) - principal) revert BalanceMismatch();
    }

    function _refund(address token, uint256 start, uint128 refund) private {
        uint256 current = IERC20(token).balanceOf(address(this));
        // A fee/token callback must not turn unrelated post-receipt donations into a larger refund.
        if (current < start || current - start != refund) revert BalanceMismatch();
        if (refund != 0) _transferExact(token, address(this), msg.sender, refund);
        if (IERC20(token).balanceOf(address(this)) != start) revert BalanceMismatch();
    }

    function _transferExact(address token, address from, address to, uint256 amount) private {
        uint256 debit = IERC20(token).balanceOf(from);
        uint256 credit = IERC20(token).balanceOf(to);
        if (from == address(this)) IERC20(token).safeTransfer(to, amount);
        else IERC20(token).safeTransferFrom(from, to, amount);
        if (IERC20(token).balanceOf(from) != debit - amount || IERC20(token).balanceOf(to) != credit + amount) revert BalanceMismatch();
    }

    function _salt(CreateRequest calldata r) private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), msg.sender, r.nonce, r.salt));
    }

    function _key(PoolConfig memory c) private pure returns (PoolKey memory) {
        return PoolKey(Currency.wrap(c.token0), Currency.wrap(c.token1), LPFeeLibrary.DYNAMIC_FEE_FLAG, c.tickSpacing, IHooks(address(0)));
    }

    function _profileHash(PoolConfig memory c) private pure returns (bytes32) {
        c.token0 = address(0); c.token1 = address(0); c.asset0 = bytes32(0); c.asset1 = bytes32(0);
        // Pool class and reference adapters are per-pool choices. The factory's deployment
        // profile must permit the complete product matrix; each hook's configHash and request hash
        // still bind these values to its own pool instance.
        c.poolClass = 0;
        c.referenceAdapter0 = address(0);
        c.referenceAdapter1 = address(0);
        return keccak256(abi.encode(c));
    }
}
