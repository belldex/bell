// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellPoolFactory} from "../src/BellPoolFactory.sol";
import {IBellHookDeployer} from "../src/interfaces/IBellHookDeployer.sol";
import {CreateRequest, CreateResult, PoolConfig} from "../src/types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LiquidityAmounts} from "../lib/v4-periphery/src/libraries/LiquidityAmounts.sol";

interface VmPools {
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function envBytes32(string calldata name) external view returns (bytes32);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function addr(uint256 privateKey) external view returns (address);
}

interface IToken {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IWrapped {
    function deposit() external payable;
}

/// @notice Creates the two Elysium testnet rehearsal pools through the real BellPoolFactory.
///
///   Pool A: tAAPL / WETH, SESSION_ONLY, no auction (WETH is not the factory's quote token)
///   Pool B: tAAPL / tUSDG, SESSION_ONLY, with the Opening Bell Auction (tUSDG is the factory's quote token)
///
/// Everything is env-driven so the same file works against any manifest. The seed sizes are small on purpose: they only
/// have to prove the pools open, trade under their caps, and let an LP leave. Flow caps are 5 percent of the seed per
/// swap, 50 percent per window, and 2 percent for the closed-market budget.
///
///   FOUNDRY_PROFILE=elysium_testnet forge script script/ElysiumPools.s.sol            (dry run, sends nothing)
///   FOUNDRY_PROFILE=elysium_testnet forge script script/ElysiumPools.s.sol --broadcast --skip-simulation
contract ElysiumPools {
    VmPools private constant vm = VmPools(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant ELYSIUM_TESTNET_CHAIN_ID = 99801;
    uint24 internal constant DYNAMIC_FEE_FLAG = 0x800000;
    int24 internal constant SPACING = 60;
    int24 internal constant HALF_RANGE = 6000;

    struct Env {
        BellPoolFactory factory;
        IBellHookDeployer deployer;
        address poolManager;
        address positionManager;
        address assetRegistry;
        address calendarRegistry;
        address safety;
        address weth;
        address stock;
        address usdg;
        bytes32 stockAsset;
        bytes32 usdgAsset;
        bytes32 wethAsset;
        bytes32 policyId;
        uint256 pk;
        address creator;
    }

    struct Hook { address hook; bytes32 poolId; uint256 tokenId; }

    function run() external returns (Hook memory a, Hook memory b) {
        require(block.chainid == ELYSIUM_TESTNET_CHAIN_ID, "Elysium testnet only");
        Env memory e = _env();

        uint256 serviceFee = e.factory.serviceFee();
        // Mode 1 creates the single compressed-session rehearsal pool: a second test stock against tUSDG, with the auction.
        if (vm.envOr("ELYSIUM_POOLS_MODE", uint256(0)) == 1) {
            address stock2 = vm.envAddress("ELYSIUM_STOCK2");
            bytes32 stock2Asset = vm.envBytes32("ELYSIUM_STOCK2_ASSET");
            vm.startBroadcast(e.pk);
            _approve(e, stock2, 200e18);
            _approve(e, e.usdg, 15_000e6 + serviceFee);
            b = _create(e, stock2, e.usdg, stock2Asset, e.usdgAsset, 100e18, 10_000e6);
            vm.stopBroadcast();
            return (a, b);
        }
        // Pool A: 40 tAAPL against 0.004 WETH. Pool B: 100 tAAPL against 10,000 tUSDG.
        vm.startBroadcast(e.pk);
        IWrapped(e.weth).deposit{value: 0.0045 ether}();
        _approve(e, e.stock, 200e18);
        _approve(e, e.weth, 0.01 ether);
        _approve(e, e.usdg, 30_000e6 + 2 * serviceFee);

        a = _create(e, e.weth, e.stock, e.wethAsset, e.stockAsset, 0.004 ether, 40e18);
        b = _create(e, e.stock, e.usdg, e.stockAsset, e.usdgAsset, 100e18, 10_000e6);
        vm.stopBroadcast();
    }

    function _env() private view returns (Env memory e) {
        e.factory = BellPoolFactory(vm.envAddress("ELYSIUM_POOL_FACTORY"));
        e.deployer = IBellHookDeployer(vm.envAddress("ELYSIUM_HOOK_DEPLOYER"));
        e.poolManager = vm.envAddress("ELYSIUM_POOL_MANAGER");
        e.positionManager = vm.envAddress("ELYSIUM_POSITION_MANAGER");
        e.assetRegistry = vm.envAddress("ELYSIUM_ASSET_REGISTRY");
        e.calendarRegistry = vm.envAddress("ELYSIUM_CALENDAR_REGISTRY");
        e.safety = vm.envAddress("ELYSIUM_SAFETY_CONTROLLER");
        e.weth = vm.envAddress("ELYSIUM_WETH");
        e.stock = vm.envAddress("ELYSIUM_STOCK");
        e.usdg = vm.envAddress("ELYSIUM_USDG");
        e.stockAsset = vm.envBytes32("ELYSIUM_STOCK_ASSET");
        e.usdgAsset = vm.envBytes32("ELYSIUM_USDG_ASSET");
        e.wethAsset = vm.envBytes32("ELYSIUM_WETH_ASSET");
        e.policyId = keccak256(bytes("bell-testnet-v1"));
        e.pk = vm.envUint("ELYSIUM_DEPLOYER_PRIVATE_KEY");
        e.creator = vm.addr(e.pk);
    }

    function _approve(Env memory e, address token, uint256 amount) private {
        require(IToken(token).approve(address(e.factory), amount), "approve");
    }

    function _config(Env memory e, address tokenA, address tokenB, bytes32 assetA, bytes32 assetB, uint256 amountA, uint256 amountB)
        private view returns (PoolConfig memory c)
    {
        (address token0, address token1, bytes32 asset0, bytes32 asset1, uint256 amount0, uint256 amount1) = tokenA < tokenB
            ? (tokenA, tokenB, assetA, assetB, amountA, amountB)
            : (tokenB, tokenA, assetB, assetA, amountB, amountA);
        c.token0 = token0; c.token1 = token1; c.asset0 = asset0; c.asset1 = asset1;
        c.poolManager = e.poolManager; c.positionManager = e.positionManager; c.factory = address(e.factory);
        c.assetRegistry = e.assetRegistry; c.calendarRegistry = e.calendarRegistry; c.safetyController = e.safety;
        c.treasuryAdapter = address(0);
        c.poolClass = 1; c.liquidityMode = 0; c.referenceMode = 0; c.tickSpacing = SPACING;
        c.tradeCap = [uint128(amount0 / 20), uint128(amount1 / 20)];
        c.windowCap = [uint128(amount0 / 2), uint128(amount1 / 2)];
        c.closureCap = [uint128(amount0 / 50), uint128(amount1 / 50)];
        c.policyId = e.policyId;
        c.referenceAdapter0 = address(0); c.referenceAdapter1 = address(0);
    }

    function _create(Env memory e, address tokenA, address tokenB, bytes32 assetA, bytes32 assetB, uint256 amountA, uint256 amountB)
        private returns (Hook memory h)
    {
        CreateRequest memory r;
        r.config = _config(e, tokenA, tokenB, assetA, assetB, amountA, amountB);
        (uint256 amount0, uint256 amount1) = tokenA < tokenB ? (amountA, amountB) : (amountB, amountA);

        // raw price token1/token0 as a Q64.96 square root: sqrt(a1/a0) * 2^96
        r.sqrtPriceX96 = _sqrtPriceX96(amount1, amount0);
        int24 tick = TickMath.getTickAtSqrtPrice(r.sqrtPriceX96);
        int24 base = (tick / SPACING) * SPACING;
        r.tickLower = base - HALF_RANGE;
        r.tickUpper = base + HALF_RANGE;
        require(r.sqrtPriceX96 > TickMath.getSqrtPriceAtTick(r.tickLower) && r.sqrtPriceX96 < TickMath.getSqrtPriceAtTick(r.tickUpper), "price in range");
        r.liquidity = LiquidityAmounts.getLiquidityForAmounts(
            r.sqrtPriceX96, TickMath.getSqrtPriceAtTick(r.tickLower), TickMath.getSqrtPriceAtTick(r.tickUpper), amount0, amount1
        );
        r.amountMax = [uint128(amount0 + amount0 / 10), uint128(amount1 + amount1 / 10)];
        r.recipient = e.creator;
        r.nonce = e.factory.nonces(e.creator);
        r.deadline = uint64(block.timestamp + 1800);
        r.maxServiceFee = uint128(e.factory.serviceFee());
        r.salt = _mine(e, r);

        CreateResult memory out = e.factory.createAndSeed(r);
        h = Hook(out.hook, out.poolId, out.tokenId);
    }

    /// @dev sqrt(num / den) * 2^96 with enough precision for a 1e-8 .. 1e8 ratio.
    function _sqrtPriceX96(uint256 num, uint256 den) private pure returns (uint160) {
        // mulDiv keeps the 512-bit intermediate: num * 2^192 overflows 256 bits for ordinary token amounts.
        uint256 ratioX192 = FullMath.mulDiv(num, 1 << 192, den);
        return uint160(_sqrt(ratioX192));
    }

    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    /// @dev Finds a salt whose hook address ends in the BELL permission mask 0x2CC0 (see BellPoolFactory.t.sol `_mine`).
    function _mine(Env memory e, CreateRequest memory r) private view returns (bytes32) {
        PoolKey memory key = PoolKey(Currency.wrap(r.config.token0), Currency.wrap(r.config.token1), DYNAMIC_FEE_FLAG, SPACING, IHooks(address(0)));
        bytes32 initHash = e.deployer.initCodeHash(r.config, key);
        bytes memory namespace = abi.encode(block.chainid, address(e.factory), e.creator, r.nonce, bytes32(0));
        bytes memory createPreimage = abi.encodePacked(bytes1(0xff), address(e.deployer), bytes32(0), initHash);
        for (uint256 i; i < 400000; ++i) {
            bytes32 digest;
            assembly ("memory-safe") {
                mstore(add(namespace, 160), i)
                let salt := keccak256(add(namespace, 32), 160)
                mstore(add(createPreimage, 53), salt)
                digest := keccak256(add(createPreimage, 32), 85)
            }
            if (uint160(uint256(digest)) & 0x3fff == 0x2cc0) return bytes32(i);
        }
        revert("salt search");
    }
}
