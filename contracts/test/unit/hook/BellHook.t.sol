// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHook} from "../../../src/BellHook.sol";
import {BellPolicyOracle} from "../../../src/BellPolicyOracle.sol";
import {
    PoolConfig,
    PoolState,
    Buckets,
    PolicyView,
    Lifecycle,
    Mode,
    PoolClass,
    LiquidityMode,
    ReasonBits
} from "../../../src/types/ProtocolTypes.sol";
import {IBellHook} from "../../../src/interfaces/IBellProtocol.sol";
import {IBellErrors} from "../../../src/interfaces/ProtocolEvents.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface VmBellHook {
    function getNonce(address account) external view returns (uint64);
    function setNonce(address account, uint64 nonce) external;
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
    function expectRevert(bytes calldata data) external;
    function prank(address sender) external;
    function chainId(uint256 newChainId) external;
}

/// @dev Non-canonical dependency: has code but does not implement a canonical interface.
contract BellHookDependencyMock {}

/// @dev Token-shaped dependency mock: the hook now reads `decimals()` when preparing a swap, so a bare
/// empty contract is no longer a faithful token stand-in for swap-path tests.
contract BellHookTokenMock {
    uint8 private immutable _decimals;

    constructor(uint8 decimals_) {
        _decimals = decimals_;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}

/// @dev Returns more than the single 32-byte word the constructor probe accepts.
contract BellHookOversizedReturnManager {
    fallback() external {
        assembly ("memory-safe") {
            return(0, 0x40)
        }
    }
}

/// @dev Attempts a 1 MiB return. The constructor must cap the probe gas and never copy this payload.
contract BellHookReturnBombManager {
    fallback() external {
        assembly ("memory-safe") {
            return(0, 0x100000)
        }
    }
}

/// @dev Returns one 32-byte word, but with dirty upper bits instead of a canonical ABI address.
contract BellHookDirtyAddressManager {
    fallback() external {
        assembly ("memory-safe") {
            mstore(0, or(shl(160, 1), 1))
            return(0, 0x20)
        }
    }
}

contract BellHookTest {
    VmBellHook private constant vm = VmBellHook(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint160 private constant HOOK_FLAG_MASK = 0x3fff;
    uint160 private constant EXPECTED_HOOK_FLAGS = 0x2cc0;

    bytes32 private constant ERR_POOL_MANAGER = keccak256("POOL_MANAGER");
    bytes32 private constant ERR_POSITION_MANAGER = keccak256("POSITION_MANAGER");
    bytes32 private constant ERR_FACTORY = keccak256("FACTORY");
    bytes32 private constant ERR_ASSET_REGISTRY = keccak256("ASSET_REGISTRY");
    bytes32 private constant ERR_CALENDAR_REGISTRY = keccak256("CALENDAR_REGISTRY");
    bytes32 private constant ERR_SAFETY_CONTROLLER = keccak256("SAFETY_CONTROLLER");
    bytes32 private constant ERR_TREASURY_ADAPTER = keccak256("TREASURY_ADAPTER");
    bytes32 private constant ERR_TOKENS = keccak256("TOKENS");
    bytes32 private constant ERR_ASSETS = keccak256("ASSETS");
    bytes32 private constant ERR_CAPS = keccak256("CAPS");
    bytes32 private constant ERR_POOL_KEY = keccak256("POOL_KEY");
    bytes32 private constant ERR_POOL_FEE = keccak256("POOL_FEE");
    bytes32 private constant ERR_TICK_SPACING = keccak256("TICK_SPACING");
    bytes32 private constant ERR_POOL_CLASS = keccak256("POOL_CLASS");
    bytes32 private constant ERR_LIQUIDITY_MODE = keccak256("LIQUIDITY_MODE");
    bytes32 private constant ERR_POLICY_ID = keccak256("POLICY_ID");
    bytes32 private constant ERR_TEMPLATE_CODE_HASH = keccak256("TEMPLATE_CODE_HASH");

    bytes4 private constant NOT_POOL_MANAGER = bytes4(keccak256("NotPoolManager()"));
    bytes4 private constant HOOK_NOT_IMPLEMENTED = bytes4(keccak256("HookNotImplemented()"));

    PoolManager private manager;
    BellPolicyOracle private oracle;
    PoolManager private otherManager;
    address private token0;
    address private token1;
    address private positionManager;
    address private factory;
    address private assetRegistry;
    address private calendarRegistry;
    address private safetyController;
    address private sessionRegistry;
    address private treasuryAdapter;
    address private oversizedReturnManager;
    address private returnBombManager;
    address private dirtyAddressManager;

    bytes32 private templateCodeHash;
    uint64 private validNonce;
    address private validHookAddress;

    function setUp() external {
        manager = new PoolManager(address(this));
        oracle = new BellPolicyOracle();
        otherManager = new PoolManager(address(this));
        address tokenA = address(new BellHookTokenMock(18));
        address tokenB = address(new BellHookTokenMock(6));
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        positionManager = address(new BellHookDependencyMock());
        factory = address(new BellHookDependencyMock());
        assetRegistry = address(new BellHookDependencyMock());
        calendarRegistry = address(new BellHookDependencyMock());
        safetyController = address(new BellHookDependencyMock());
        sessionRegistry = address(new BellHookDependencyMock());
        treasuryAdapter = address(new BellHookDependencyMock());
        oversizedReturnManager = address(new BellHookOversizedReturnManager());
        returnBombManager = address(new BellHookReturnBombManager());
        dirtyAddressManager = address(new BellHookDirtyAddressManager());
        templateCodeHash = keccak256(type(BellHook).creationCode);

        (validNonce, validHookAddress) = _nextValidAddress();
        vm.setNonce(address(this), validNonce);
    }

    // -------------------------------------------------------------------------
    // Permission surface
    // -------------------------------------------------------------------------

    function testHookPermissionsAreExactAndReturnDeltaFlagsAreFalse() external {
        BellHook hook = _deployHook(_config(), _key(), templateCodeHash);
        Hooks.Permissions memory permissions = hook.getHookPermissions();

        uint160 mask;
        if (permissions.beforeInitialize) mask |= uint160(1) << 13;
        if (permissions.afterInitialize) mask |= uint160(1) << 12;
        if (permissions.beforeAddLiquidity) mask |= uint160(1) << 11;
        if (permissions.afterAddLiquidity) mask |= uint160(1) << 10;
        if (permissions.beforeRemoveLiquidity) mask |= uint160(1) << 9;
        if (permissions.afterRemoveLiquidity) mask |= uint160(1) << 8;
        if (permissions.beforeSwap) mask |= uint160(1) << 7;
        if (permissions.afterSwap) mask |= uint160(1) << 6;
        if (permissions.beforeDonate) mask |= uint160(1) << 5;
        if (permissions.afterDonate) mask |= uint160(1) << 4;
        if (permissions.beforeSwapReturnDelta) mask |= uint160(1) << 3;
        if (permissions.afterSwapReturnDelta) mask |= uint160(1) << 2;
        if (permissions.afterAddLiquidityReturnDelta) mask |= uint160(1) << 1;
        if (permissions.afterRemoveLiquidityReturnDelta) mask |= uint160(1);

        require(mask == 0x2cc0, "permission mask");
        require(!permissions.afterInitialize, "afterInitialize");
        require(!permissions.beforeRemoveLiquidity, "beforeRemoveLiquidity");
        require(!permissions.afterRemoveLiquidity, "afterRemoveLiquidity");
        require(!permissions.beforeDonate, "beforeDonate");
        require(!permissions.afterDonate, "afterDonate");
        require(!permissions.beforeSwapReturnDelta, "beforeSwapReturnDelta");
        require(!permissions.afterSwapReturnDelta, "afterSwapReturnDelta");
        require(!permissions.afterAddLiquidityReturnDelta, "afterAddLiquidityReturnDelta");
        require(!permissions.afterRemoveLiquidityReturnDelta, "afterRemoveLiquidityReturnDelta");
        require(uint160(address(hook)) & HOOK_FLAG_MASK == EXPECTED_HOOK_FLAGS, "hook address flags");
        require(Hooks.isValidHookAddress(IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG), "not a valid hook");
    }

    function testDeploymentRequiresHookAddressPermissions() external {
        (uint64 invalidNonce, address invalidAddress) = _nextInvalidAddress();
        vm.setNonce(address(this), invalidNonce);

        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, invalidAddress));
        this.deployHook(_config(), _key(), templateCodeHash);
    }

    // -------------------------------------------------------------------------
    // Constructor binding
    // -------------------------------------------------------------------------

    function testConstructorBindsConfigKeyAndHashes() external {
        PoolConfig memory config = _config();
        PoolKey memory skeleton = _key();
        BellHook hook = _deployHook(config, skeleton, templateCodeHash);

        require(keccak256(abi.encode(hook.config())) == keccak256(abi.encode(config)), "config binding");
        require(hook.apiVersion() == 1, "api version");
        require(hook.templateCodeHash() == templateCodeHash, "template hash");
        require(
            hook.configHash() == keccak256(abi.encode(block.chainid, templateCodeHash, config)), "config hash formula"
        );
        require(
            hook.configHash() == keccak256(abi.encode(block.chainid, hook.templateCodeHash(), hook.config())),
            "config hash from views"
        );

        PoolKey memory boundKey = hook.poolKey();
        require(address(boundKey.hooks) == address(hook), "hook key binding");
        require(Currency.unwrap(boundKey.currency0) == config.token0, "currency0");
        require(Currency.unwrap(boundKey.currency1) == config.token1, "currency1");
        require(boundKey.fee == LPFeeLibrary.DYNAMIC_FEE_FLAG, "dynamic fee");
        require(boundKey.tickSpacing == config.tickSpacing, "tick spacing");
        require(hook.poolId() == PoolId.unwrap(PoolIdLibrary.toId(boundKey)), "pool id");
    }

    function testConfigHashBindsChainTemplateAndConfig() external {
        PoolConfig memory config = _config();
        BellHook first = _deployHook(config, _key(), templateCodeHash);
        BellHook same = _deployHook(config, _key(), templateCodeHash);
        require(first.configHash() == same.configHash(), "same inputs");
        require(first.poolId() != same.poolId(), "distinct pools");

        BellHook otherTemplate = _deployHook(config, _key(), keccak256("OTHER_TEMPLATE"));
        require(otherTemplate.configHash() != first.configHash(), "template binding");

        PoolConfig memory otherPolicy = _config();
        otherPolicy.policyId = keccak256("OTHER_POLICY");
        BellHook otherConfig = _deployHook(otherPolicy, _key(), templateCodeHash);
        require(otherConfig.configHash() != first.configHash(), "config binding");

        bytes32 beforeChain = first.configHash();
        vm.chainId(1);
        BellHook otherChain = _deployHook(config, _key(), templateCodeHash);
        require(otherChain.configHash() != beforeChain, "chain binding");
        require(first.configHash() == beforeChain, "config hash is immutable");
    }

    function testConstructorRejectsMissingOrWrongManager() external {
        PoolConfig memory config = _config();
        config.poolManager = address(0);
        _expectBadConfig(ERR_POOL_MANAGER, config, _key(), templateCodeHash);

        config = _config();
        config.poolManager = factory;
        _expectBadConfig(ERR_POOL_MANAGER, config, _key(), templateCodeHash);

        config = _config();
        config.poolManager = address(0xDEAD);
        _expectBadConfig(ERR_POOL_MANAGER, config, _key(), templateCodeHash);
    }

    function testConstructorRejectsMissingDependencies() external {
        // Treasury adapter is mode-specific: PUBLIC may use address(0), TREASURY_ONLY must be a code contract.
        // It is covered separately by testTreasuryOnlyTreasuryAdapterRules.
        for (uint8 index; index < 5; ++index) {
            PoolConfig memory config = _config();
            _setDependency(config, index, address(0));
            _expectBadConfig(_dependencyReason(index), config, _key(), templateCodeHash);

            config = _config();
            _setDependency(config, index, address(0xDEAD));
            _expectBadConfig(_dependencyReason(index), config, _key(), templateCodeHash);
        }
    }

    function testConstructorRequiresExactTickSpacing() external {
        PoolConfig memory config = _config();
        config.tickSpacing = 0;
        _expectBadConfig(ERR_TICK_SPACING, config, _key(), templateCodeHash);

        config = _config();
        config.tickSpacing = 10;
        _expectBadConfig(ERR_TICK_SPACING, config, _key(), templateCodeHash);

        config = _config();
        config.tickSpacing = 61;
        _expectBadConfig(ERR_TICK_SPACING, config, _key(), templateCodeHash);

        config = _config();
        config.tickSpacing = -60;
        _expectBadConfig(ERR_TICK_SPACING, config, _key(), templateCodeHash);
    }

    function testConstructorRejectsZeroAssetIds() external {
        PoolConfig memory config = _config();
        config.asset0 = bytes32(0);
        _expectBadConfig(ERR_ASSETS, config, _key(), templateCodeHash);

        config = _config();
        config.asset1 = bytes32(0);
        _expectBadConfig(ERR_ASSETS, config, _key(), templateCodeHash);
    }

    function testConstructorRejectsInvalidCaps() external {
        for (uint8 currency; currency < 2; ++currency) {
            PoolConfig memory config = _config();
            config.tradeCap[currency] = 0;
            _expectBadConfig(ERR_CAPS, config, _key(), templateCodeHash);

            config = _config();
            config.windowCap[currency] = 0;
            _expectBadConfig(ERR_CAPS, config, _key(), templateCodeHash);

            config = _config();
            config.closureCap[currency] = 0;
            _expectBadConfig(ERR_CAPS, config, _key(), templateCodeHash);

            // T <= W
            config = _config();
            config.tradeCap[currency] = config.windowCap[currency] + 1;
            _expectBadConfig(ERR_CAPS, config, _key(), templateCodeHash);

            // C <= 2T
            config = _config();
            config.closureCap[currency] = config.tradeCap[currency] * 2 + 1;
            _expectBadConfig(ERR_CAPS, config, _key(), templateCodeHash);

            // C <= W while C <= 2T (so the window bound is the violated one)
            config = _config();
            config.tradeCap[currency] = config.windowCap[currency];
            config.closureCap[currency] = config.windowCap[currency] + 1;
            _expectBadConfig(ERR_CAPS, config, _key(), templateCodeHash);
        }
    }

    function testPublicPoolAcceptsZeroTreasuryAdapter() external {
        PoolConfig memory config = _config();
        config.treasuryAdapter = address(0);
        BellHook hook = _deployHook(config, _key(), templateCodeHash);
        require(hook.config().treasuryAdapter == address(0), "zero treasury adapter");
        require(!hook.getPolicy().canSwap, "zero adapter must remain fail closed");
    }

    function testTreasuryOnlyTreasuryAdapterRules() external {
        PoolConfig memory config = _config();
        config.liquidityMode = uint8(LiquidityMode.TREASURY_ONLY);
        config.treasuryAdapter = address(0);
        _expectBadConfig(ERR_TREASURY_ADAPTER, config, _key(), templateCodeHash);

        config = _config();
        config.liquidityMode = uint8(LiquidityMode.TREASURY_ONLY);
        config.treasuryAdapter = address(0xDEAD);
        _expectBadConfig(ERR_TREASURY_ADAPTER, config, _key(), templateCodeHash);

        // PUBLIC only relaxes the zero case; a configured non-zero dependency must still be code.
        config = _config();
        config.treasuryAdapter = address(0xDEAD);
        _expectBadConfig(ERR_TREASURY_ADAPTER, config, _key(), templateCodeHash);

        config = _config();
        config.liquidityMode = uint8(LiquidityMode.TREASURY_ONLY);
        BellHook hook = _deployHook(config, _key(), templateCodeHash);
        require(hook.config().liquidityMode == uint8(LiquidityMode.TREASURY_ONLY), "treasury mode");
    }

    function testConstructorRejectsOversizedManagerReturn() external {
        PoolConfig memory config = _config();
        config.poolManager = oversizedReturnManager;
        _expectBadConfig(ERR_POOL_MANAGER, config, _key(), templateCodeHash);
    }

    function testConstructorRejectsNonCanonicalManagerAddressWord() external {
        PoolConfig memory config = _config();
        config.poolManager = dirtyAddressManager;
        _expectBadConfig(ERR_POOL_MANAGER, config, _key(), templateCodeHash);
    }

    function testConstructorRejectsReturnBombWithinBoundedGas() external {
        PoolConfig memory config = _config();
        config.poolManager = returnBombManager;

        (uint64 nonce,) = _nextValidAddress();
        vm.setNonce(address(this), nonce);
        // A 1 MiB return must not be copied. With the probe capped at MAX_STATIC_CALL_GAS the constructor
        // still reaches BadConfig instead of spending unbounded gas or succeeding.
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadConfig.selector, ERR_POOL_MANAGER));
        this.deployHook{gas: 3_000_000}(config, _key(), templateCodeHash);
    }

    function testConstructorRejectsMismatchedPoolKey() external {
        PoolConfig memory config = _config();

        PoolKey memory key = _key();
        key.currency0 = Currency.wrap(token1);
        _expectBadConfig(ERR_POOL_KEY, config, key, templateCodeHash);

        key = _key();
        key.currency1 = Currency.wrap(factory);
        _expectBadConfig(ERR_POOL_KEY, config, key, templateCodeHash);

        key = _key();
        key.tickSpacing = 10;
        _expectBadConfig(ERR_POOL_KEY, config, key, templateCodeHash);

        key = _key();
        key.hooks = IHooks(factory);
        _expectBadConfig(ERR_POOL_KEY, config, key, templateCodeHash);

        key = _key();
        key.fee = 500;
        _expectBadConfig(ERR_POOL_FEE, config, key, templateCodeHash);
    }

    function testConstructorRejectsInvalidConfig() external {
        PoolConfig memory config = _config();
        config.tickSpacing = 0;
        _expectBadConfig(ERR_TICK_SPACING, config, _key(), templateCodeHash);

        config = _config();
        config.policyId = bytes32(0);
        _expectBadConfig(ERR_POLICY_ID, config, _key(), templateCodeHash);

        config = _config();
        config.poolClass = 2;
        _expectBadConfig(ERR_POOL_CLASS, config, _key(), templateCodeHash);

        config = _config();
        config.liquidityMode = 2;
        _expectBadConfig(ERR_LIQUIDITY_MODE, config, _key(), templateCodeHash);

        config = _config();
        config.token0 = token1;
        config.token1 = token1;
        _expectBadConfig(ERR_TOKENS, config, _key(), templateCodeHash);

        config = _config();
        config.token0 = token1;
        config.token1 = token0;
        _expectBadConfig(ERR_TOKENS, config, _key(), templateCodeHash);

        config = _config();
        config.token0 = address(0xDEAD);
        _expectBadConfig(ERR_TOKENS, config, _key(), templateCodeHash);

        _expectBadConfig(ERR_TEMPLATE_CODE_HASH, _config(), _key(), bytes32(0));
    }

    // -------------------------------------------------------------------------
    // Callback gating and pool isolation
    // -------------------------------------------------------------------------

    function testCallbacksRejectNonPoolManager() external {
        BellHook hook = _deployHook(_config(), _key(), templateCodeHash);
        PoolKey memory key = hook.poolKey();

        vm.expectRevert(abi.encodeWithSelector(NOT_POOL_MANAGER));
        hook.beforeInitialize(factory, key, 1);

        vm.expectRevert(abi.encodeWithSelector(NOT_POOL_MANAGER));
        hook.beforeAddLiquidity(address(this), key, _liquidityParams(), "");

        vm.expectRevert(abi.encodeWithSelector(NOT_POOL_MANAGER));
        hook.afterAddLiquidity(address(this), key, _liquidityParams(), _zeroDelta(), _zeroDelta(), "");

        vm.expectRevert(abi.encodeWithSelector(NOT_POOL_MANAGER));
        hook.beforeSwap(address(this), key, _swapParams(), "");

        vm.expectRevert(abi.encodeWithSelector(NOT_POOL_MANAGER));
        hook.afterSwap(address(this), key, _swapParams(), _zeroDelta(), "");
    }

    function testCallbacksRejectAnotherPoolManager() external {
        BellHook hook = _deployHook(_config(), _key(), templateCodeHash);
        PoolKey memory key = hook.poolKey();

        vm.expectRevert(abi.encodeWithSelector(NOT_POOL_MANAGER));
        vm.prank(address(otherManager));
        hook.beforeSwap(factory, key, _swapParams(), "");

        vm.expectRevert(abi.encodeWithSelector(NOT_POOL_MANAGER));
        vm.prank(address(otherManager));
        hook.beforeInitialize(factory, key, 1);
    }

    function testCallbacksRejectWrongPoolKeyAndFactoryContext() external {
        BellHook hook = _deployHook(_config(), _key(), templateCodeHash);
        PoolKey memory key = hook.poolKey();

        PoolKey memory wrongKey = key;
        wrongKey.tickSpacing = 10;

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.ContextMismatch.selector));
        vm.prank(address(manager));
        hook.beforeInitialize(factory, wrongKey, 1);

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.ContextMismatch.selector));
        vm.prank(address(manager));
        hook.beforeAddLiquidity(factory, wrongKey, _liquidityParams(), "");

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.ContextMismatch.selector));
        vm.prank(address(manager));
        hook.afterAddLiquidity(factory, wrongKey, _liquidityParams(), _zeroDelta(), _zeroDelta(), "");

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.ContextMismatch.selector));
        vm.prank(address(manager));
        hook.beforeSwap(factory, wrongKey, _swapParams(), "");

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.ContextMismatch.selector));
        vm.prank(address(manager));
        hook.afterSwap(factory, wrongKey, _swapParams(), _zeroDelta(), "");

        key = hook.poolKey();
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.Unauthorized.selector));
        vm.prank(address(manager));
        hook.beforeInitialize(address(0xBEEF), key, 1);
    }

    function testSwapHookDataCannotSupplyPolicyOrReference() external {
        BellHook hook = _deployHook(_config(), _key(), templateCodeHash);
        PoolKey memory key = hook.poolKey();
        bytes memory forged = abi.encode(hook.configHash(), uint128(1e18), uint128(1e18), true);
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.ContextMismatch.selector));
        vm.prank(address(manager));
        hook.beforeSwap(factory, key, _swapParams(), forged);
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.ContextMismatch.selector));
        vm.prank(address(manager));
        hook.afterSwap(factory, key, _swapParams(), _zeroDelta(), forged);
    }

    function testCallbacksFailClosedUntilImplemented() external {
        BellHook hook = _deployHook(_config(), _key(), templateCodeHash);
        PoolKey memory key = hook.poolKey();

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadSeed.selector));
        vm.prank(address(manager));
        hook.beforeInitialize(factory, key, 1);

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadSeed.selector));
        vm.prank(address(manager));
        hook.beforeAddLiquidity(factory, key, _liquidityParams(), "");

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadSeed.selector));
        vm.prank(address(manager));
        hook.afterAddLiquidity(factory, key, _liquidityParams(), _zeroDelta(), _zeroDelta(), "");

        // M05-02 replaced the unconditional beforeSwap revert with the canonical evaluator. Pre-LIVE is a
        // policy block carrying every recorded reason, not a generic "not implemented" response.
        PolicyView memory policy = hook.getPolicy();
        require(!policy.canSwap, "setup must not swap");
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.PolicyBlocked.selector, policy.reasonBits));
        vm.prank(address(manager));
        hook.beforeSwap(factory, key, _swapParams(), "");

        // M05-05 wired the real settlement path. A pre-LIVE pool therefore cannot reach afterSwap either:
        // without a bound snapshot from a successful beforeSwap the callback is a context mismatch, and the
        // generic "not implemented" response no longer exists.
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.ContextMismatch.selector));
        vm.prank(address(manager));
        hook.afterSwap(factory, key, _swapParams(), _zeroDelta(), "");
    }

    function testPoolIsolationByKeyAndConfig() external {
        PoolConfig memory firstConfig = _config();
        BellHook first = _deployHook(firstConfig, _key(), templateCodeHash);

        PoolConfig memory secondConfig = _config();
        secondConfig.asset0 = keccak256("SECOND_ASSET_0");
        secondConfig.policyId = keccak256("SECOND_POLICY");
        // Keep the normative spacing; isolation comes from the bound hook address in each PoolKey, not a
        // different tick spacing (which the constructor now rejects).
        PoolKey memory secondSkeleton = _key();
        BellHook second = _deployHook(secondConfig, secondSkeleton, templateCodeHash);

        require(first.poolId() != second.poolId(), "pool ids");
        require(first.configHash() != second.configHash(), "config hashes");
        require(keccak256(abi.encode(first.config())) != keccak256(abi.encode(second.config())), "config isolation");

        PoolKey memory firstKey = first.poolKey();
        PoolKey memory secondKey = second.poolKey();

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.ContextMismatch.selector));
        vm.prank(address(manager));
        first.beforeSwap(factory, secondKey, _swapParams(), "");

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.ContextMismatch.selector));
        vm.prank(address(manager));
        second.beforeSwap(factory, firstKey, _swapParams(), "");

        vm.prank(address(0xBEEF));
        first.refreshState();
        vm.prank(address(0xBEEF));
        second.refreshState();

        Buckets memory firstBuckets = first.buckets();
        Buckets memory secondBuckets = second.buckets();
        require(_bucketsAreEmpty(firstBuckets) && _bucketsAreEmpty(secondBuckets), "budget bleed");
        require(first.episodeGross(0)[0] == 0 && second.episodeGross(0)[1] == 0, "episode bleed");
    }

    // -------------------------------------------------------------------------
    // Read views, setup state and immutability
    // -------------------------------------------------------------------------

    function testInitialStateIsSetupAndFailClosed() external {
        PoolConfig memory config = _config();
        BellHook hook = _deployHook(config, _key(), templateCodeHash);

        PolicyView memory policy = hook.getPolicy();
        require(!policy.canSwap, "canSwap must be false");
        require(policy.mode == uint8(Mode.SETUP), "mode");
        require(policy.phase == 0, "phase");
        require(policy.flags == 0, "flags");
        // The M05-01 dependency mocks are deliberately non-functional, so the M05-02 evaluator records every
        // failed dependency read instead of returning healthy. SETUP is still the dominant lowest bit.
        require(policy.reasonBits & ReasonBits.SETUP != 0, "setup reason");
        require(policy.reasonBits & ReasonBits.CALENDAR_MISSING != 0, "calendar reason");
        require(policy.reasonBits & ReasonBits.REPORT_INVALID_OR_STALE != 0, "health reason");
        require(policy.lpFeeUnits == 0, "fee");
        require(policy.closureNonce == 0, "closure nonce");
        require(policy.validUntil == 0, "valid until");
        require(policy.referencePrice18[0] == 0 && policy.referencePrice18[1] == 0, "reference");
        require(policy.closureRemaining[0] == 0 && policy.closureRemaining[1] == 0, "closure remaining");
        require(policy.effectiveTradeCap[0] == config.tradeCap[0], "trade cap 0");
        require(policy.effectiveTradeCap[1] == config.tradeCap[1], "trade cap 1");
        require(policy.effectiveWindowCap[0] == config.windowCap[0], "window cap 0");
        require(policy.effectiveWindowCap[1] == config.windowCap[1], "window cap 1");
        require(policy.rollingRemaining[0] == config.windowCap[0], "rolling 0");
        require(policy.rollingRemaining[1] == config.windowCap[1], "rolling 1");
        require(policy.configHash == hook.configHash(), "policy config hash");
        require(policy.stateHash != bytes32(0), "state hash");

        PoolState memory state = hook.state();
        require(state.lifecycle == uint8(Lifecycle.DEPLOYED), "lifecycle");
        require(state.mode == uint8(Mode.SETUP), "stored mode");
        require(!state.closedLatched, "latch");
        require(state.closureNonce == 0 && state.pauseNonce == 0 && state.bellStart == 0, "state counters");

        require(_bucketsAreEmpty(hook.buckets()), "buckets");
        uint128[2] memory gross = hook.episodeGross(0);
        require(gross[0] == 0 && gross[1] == 0, "episode gross");
        require(hook.apiVersion() == 1, "api version");
    }

    function testRefreshStateMatchesGetPolicyAndIsPermissionless() external {
        BellHook hook = _deployHook(_config(), _key(), templateCodeHash);
        PolicyView memory before = hook.getPolicy();
        PoolState memory stateBefore = hook.state();

        vm.prank(address(0xBEEF));
        PolicyView memory refreshed = hook.refreshState();

        require(keccak256(abi.encode(before)) == keccak256(abi.encode(refreshed)), "checkpoint parity");
        require(
            keccak256(abi.encode(hook.getPolicy())) == keccak256(abi.encode(refreshed)), "post-checkpoint view parity"
        );
        require(keccak256(abi.encode(hook.state())) == keccak256(abi.encode(stateBefore)), "checkpoint mutated state");

        vm.prank(address(0xCAFE));
        PolicyView memory refreshedAgain = hook.refreshState();
        require(keccak256(abi.encode(refreshedAgain)) == keccak256(abi.encode(refreshed)), "repeat checkpoint");
    }

    function testNoMutableConfigSurface() external {
        BellHook hook = _deployHook(_config(), _key(), templateCodeHash);
        bytes32 configBefore = keccak256(abi.encode(hook.config()));
        bytes32 hashBefore = hook.configHash();
        bytes32 templateBefore = hook.templateCodeHash();
        bytes32 poolBefore = hook.poolId();

        vm.prank(address(0xBEEF));
        hook.refreshState();

        (bool success,) = address(hook).call(abi.encodeWithSignature("setConfig()"));
        require(!success, "setConfig");
        (success,) = address(hook).call(abi.encodeWithSignature("updateConfig()"));
        require(!success, "updateConfig");
        (success,) = address(hook).call(abi.encodeWithSignature("setPolicyId(bytes32)", bytes32(uint256(1))));
        require(!success, "setPolicyId");
        (success,) = address(hook)
            .call(
                abi.encodeWithSignature(
                    "setPoolKey((address,address,uint24,int24,address))",
                    token0,
                    token1,
                    LPFeeLibrary.DYNAMIC_FEE_FLAG,
                    int24(60),
                    address(hook)
                )
            );
        require(!success, "setPoolKey");
        (success,) = address(hook).call(abi.encodeWithSignature("upgradeTo(address)", address(0xDEAD)));
        require(!success, "upgradeTo");
        (success,) = address(hook).call(abi.encodeWithSignature("transferOwnership(address)", address(0xDEAD)));
        require(!success, "transferOwnership");

        require(keccak256(abi.encode(hook.config())) == configBefore, "config mutated");
        require(hook.configHash() == hashBefore, "config hash mutated");
        require(hook.templateCodeHash() == templateBefore, "template hash mutated");
        require(hook.poolId() == poolBefore, "pool id mutated");
    }

    function testIBellHookConformanceAndActivatePoolIsFailClosed() external {
        BellHook hook = _deployHook(_config(), _key(), templateCodeHash);
        IBellHook api = IBellHook(address(hook));

        require(api.apiVersion() == 1, "interface api version");
        require(api.poolId() == hook.poolId(), "interface pool id");
        require(keccak256(abi.encode(api.config())) == keccak256(abi.encode(hook.config())), "interface config");
        require(keccak256(abi.encode(api.state())) == keccak256(abi.encode(hook.state())), "interface state");
        require(keccak256(abi.encode(api.buckets())) == keccak256(abi.encode(hook.buckets())), "interface buckets");
        uint128[2] memory gross = api.episodeGross(0);
        require(gross[0] == 0 && gross[1] == 0, "interface episode gross");

        PolicyView memory policy = api.getPolicy();
        require(!policy.canSwap && policy.mode == uint8(Mode.SETUP), "interface getPolicy");

        vm.prank(address(0xBEEF));
        PolicyView memory refreshed = api.refreshState();
        require(keccak256(abi.encode(refreshed)) == keccak256(abi.encode(policy)), "interface refreshState");

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.Unauthorized.selector));
        api.activatePool(bytes32(0), 0);

        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadSeed.selector));
        vm.prank(factory);
        api.activatePool(bytes32(0), 0);
    }

    function testCreateAddressHelperMatchesFoundry() external view {
        require(_createAddress(address(this), 0) == vm.computeCreateAddress(address(this), 0), "nonce 0");
        require(_createAddress(address(this), 1) == vm.computeCreateAddress(address(this), 1), "nonce 1");
        require(_createAddress(address(this), 127) == vm.computeCreateAddress(address(this), 127), "nonce 127");
        require(_createAddress(address(this), 128) == vm.computeCreateAddress(address(this), 128), "nonce 128");
        require(_createAddress(address(this), 300) == vm.computeCreateAddress(address(this), 300), "nonce 300");
        require(_createAddress(address(this), 70_000) == vm.computeCreateAddress(address(this), 70_000), "nonce 70000");
    }

    // -------------------------------------------------------------------------
    // Deployment helper
    // -------------------------------------------------------------------------

    function deployHook(PoolConfig calldata config, PoolKey calldata key, bytes32 templateHash)
        external
        returns (address)
    {
        return address(new BellHook(config, key, templateHash, sessionRegistry, oracle));
    }

    function _deployHook(PoolConfig memory config, PoolKey memory key, bytes32 templateHash)
        internal
        returns (BellHook hook)
    {
        (uint64 nonce, address predicted) = _nextValidAddress();
        vm.setNonce(address(this), nonce);
        hook = BellHook(this.deployHook(config, key, templateHash));
        require(address(hook) == predicted, "hook address prediction");
    }

    function _expectBadConfig(bytes32 reason, PoolConfig memory config, PoolKey memory key, bytes32 templateHash)
        internal
    {
        (uint64 nonce,) = _nextValidAddress();
        vm.setNonce(address(this), nonce);
        vm.expectRevert(abi.encodeWithSelector(IBellErrors.BadConfig.selector, reason));
        this.deployHook(config, key, templateHash);
    }

    function _nextValidAddress() internal view returns (uint64 nonce, address predicted) {
        nonce = vm.getNonce(address(this));
        while (true) {
            predicted = _createAddress(address(this), nonce);
            if (uint160(predicted) & HOOK_FLAG_MASK == EXPECTED_HOOK_FLAGS) return (nonce, predicted);
            ++nonce;
        }
    }

    function _nextInvalidAddress() internal view returns (uint64 nonce, address predicted) {
        nonce = vm.getNonce(address(this));
        while (true) {
            predicted = _createAddress(address(this), nonce);
            if (uint160(predicted) & HOOK_FLAG_MASK != EXPECTED_HOOK_FLAGS) return (nonce, predicted);
            ++nonce;
        }
    }

    function _createAddress(address deployer, uint64 nonce) internal pure returns (address) {
        bytes memory encoded;
        if (nonce == 0) {
            encoded = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, bytes1(0x80));
        } else {
            bytes memory nonceBytes = _rlpEncodeUint(nonce);
            encoded = abi.encodePacked(uint8(0xc0 + 21 + nonceBytes.length), bytes1(0x94), deployer, nonceBytes);
        }
        return address(uint160(uint256(keccak256(encoded))));
    }

    function _rlpEncodeUint(uint64 value) internal pure returns (bytes memory) {
        if (value == 0) return hex"80";
        if (value < 0x80) {
            // The branch proves the value fits one byte.
            // forge-lint: disable-next-line(unsafe-typecast)
            return abi.encodePacked(uint8(value));
        }

        uint8 length;
        uint64 remaining = value;
        while (remaining != 0) {
            ++length;
            remaining >>= 8;
        }

        bytes memory encoded = new bytes(1 + length);
        encoded[0] = bytes1(0x80 + length);
        for (uint8 index; index < length; ++index) {
            // The shifted byte is always below 256 by construction.
            // forge-lint: disable-next-line(unsafe-typecast)
            encoded[1 + index] = bytes1(uint8(value >> (8 * (length - 1 - index))));
        }
        return encoded;
    }

    // -------------------------------------------------------------------------
    // Fixtures
    // -------------------------------------------------------------------------

    function _config() internal view returns (PoolConfig memory config) {
        config.token0 = token0;
        config.token1 = token1;
        config.asset0 = keccak256("ASSET_0");
        config.asset1 = keccak256("ASSET_1");
        config.poolManager = address(manager);
        config.positionManager = positionManager;
        config.factory = factory;
        config.assetRegistry = assetRegistry;
        config.calendarRegistry = calendarRegistry;
        config.safetyController = safetyController;
        config.treasuryAdapter = treasuryAdapter;
        config.poolClass = uint8(PoolClass.PRICE_GUARDED);
        config.liquidityMode = uint8(LiquidityMode.PUBLIC);
        config.referenceMode = 0;
        config.tickSpacing = 60;
        config.tradeCap = [uint128(1_000_000), uint128(2_000_000)];
        config.windowCap = [uint128(10_000_000), uint128(20_000_000)];
        config.closureCap = [uint128(500_000), uint128(1_000_000)];
        config.policyId = keccak256("POLICY_V1");
    }

    function _key() internal view returns (PoolKey memory key) {
        key.currency0 = Currency.wrap(token0);
        key.currency1 = Currency.wrap(token1);
        key.fee = LPFeeLibrary.DYNAMIC_FEE_FLAG;
        key.tickSpacing = 60;
        key.hooks = IHooks(address(0));
    }

    function _liquidityParams() internal pure returns (ModifyLiquidityParams memory params) {
        params.tickLower = -60;
        params.tickUpper = 60;
        params.liquidityDelta = 1e18;
        params.salt = bytes32(0);
    }

    function _swapParams() internal pure returns (SwapParams memory params) {
        params.zeroForOne = true;
        params.amountSpecified = -1e18;
        params.sqrtPriceLimitX96 = 0;
    }

    function _zeroDelta() internal pure returns (BalanceDelta) {
        return BalanceDelta.wrap(0);
    }

    function _bucketsAreEmpty(Buckets memory buckets) internal pure returns (bool) {
        return buckets.epoch == 0 && buckets.currentGross[0] == 0 && buckets.currentGross[1] == 0
            && buckets.previousGross[0] == 0 && buckets.previousGross[1] == 0;
    }

    function _setDependency(PoolConfig memory config, uint8 index, address value) internal pure {
        if (index == 0) config.positionManager = value;
        else if (index == 1) config.factory = value;
        else if (index == 2) config.assetRegistry = value;
        else if (index == 3) config.calendarRegistry = value;
        else if (index == 4) config.safetyController = value;
        else config.treasuryAdapter = value;
    }

    function _dependencyReason(uint8 index) internal pure returns (bytes32) {
        if (index == 0) return ERR_POSITION_MANAGER;
        if (index == 1) return ERR_FACTORY;
        if (index == 2) return ERR_ASSET_REGISTRY;
        if (index == 3) return ERR_CALENDAR_REGISTRY;
        if (index == 4) return ERR_SAFETY_CONTROLLER;
        return ERR_TREASURY_ADAPTER;
    }
}
