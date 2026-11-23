// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EinsteinPoolRehearsal, Vm} from "./EinsteinPoolRehearsal.t.sol";
import {BellPolicyOracleV3} from "../../src/BellPolicyOracleV3.sol";
import {BellPolicyOracleV2} from "../../src/BellPolicyOracleV2.sol";
import {BellModeEvaluator} from "../../src/BellModeEvaluator.sol";
import {BellHookV3} from "../../src/BellHookV3.sol";
import {BellHookV2} from "../../src/BellHookV2.sol";
import {BellHookDeployerV3} from "../../src/BellHookDeployerV3.sol";
import {BellPoolFactoryV3} from "../../src/BellPoolFactoryV3.sol";
import {BellAuctionRegistry} from "../../src/auction/BellAuctionRegistry.sol";
import {BellAuctionFactoryModuleV2} from "../../src/auction/BellAuctionFactoryModuleV2.sol";
import {BellOpeningAuctionV2} from "../../src/auction/BellOpeningAuctionV2.sol";
import {HaltRegistry, IHaltHybridAuth} from "../../src/registries/HaltRegistry.sol";
import {IBellHook} from "../../src/interfaces/IBellProtocol.sol";
import {IBellHookDeployer} from "../../src/interfaces/IBellHookDeployer.sol";
import {CreateRequest, CreateResult, PoolConfig, PolicyView, Mode} from "../../src/types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LiquidityAmounts} from "../../lib/v4-periphery/src/libraries/LiquidityAmounts.sol";

interface IVmNonce {
    function getNonce(address account) external view returns (uint64);
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
}

contract StackHaltAuth {
    function authorize(bytes32, bytes32, bytes32, uint256 deadline, bytes calldata e, bytes calldata p) external view returns (uint32) {
        require(block.timestamp <= deadline && e.length != 0 && p.length != 0, "hybrid");
        return 1;
    }
}

/// @notice The whole Einstein Hooks v3 stack deployed on a fork of Robinhood mainnet, with no code etched: HaltRegistry,
///         BellPolicyOracleV3, an auction registry and BellAuctionFactoryModuleV2, a BellHookDeployerV3 that uses them and a
///         BellPoolFactoryV3, over the real pool manager, session registry, calendar and asset registry. A pool created through it is
///         halted, swapped, resumed and refused with `AuctionActive`. Nothing broadcasts. Run with:
///         forge test --match-contract EinsteinHaltStackRehearsal --match-test test_ --fork-url $RH_MAINNET_RPC_SECONDARY -vv
contract EinsteinHaltStackRehearsal is EinsteinPoolRehearsal {
    bytes32 private constant REASON = keccak256("LULD");
    HaltRegistry internal reg;
    BellAuctionRegistry internal auctionRegistry;
    BellHookDeployerV3 internal deployerV3;
    BellPoolFactoryV3 internal factoryV3;

    function _deployStack() internal {
        IVmNonce n = IVmNonce(address(vm));
        address futureFactory = n.computeCreateAddress(address(this), n.getNonce(address(this)) + 6);
        reg = new HaltRegistry(IHaltHybridAuth(address(new StackHaltAuth())), keccak256("REPORTER"));
        BellPolicyOracleV3 oracle = new BellPolicyOracleV3(address(reg));
        auctionRegistry = new BellAuctionRegistry(futureFactory);
        BellAuctionFactoryModuleV2 module = new BellAuctionFactoryModuleV2(futureFactory, address(auctionRegistry), USDG, 600, 900, 512, 25, 100, reg);
        BellHookDeployerV3 old = BellHookDeployerV3(address(DEPLOYER));
        deployerV3 = new BellHookDeployerV3(
            futureFactory, old.sessionRegistry(), keccak256(type(BellHookV3).creationCode), BellPolicyOracleV2(address(oracle)),
            BellModeEvaluator(old.modeEvaluator()), address(auctionRegistry), address(module)
        );
        PoolConfig memory profile = _config();
        profile.token0 = address(0);
        profile.token1 = address(0);
        profile.asset0 = bytes32(0);
        profile.asset1 = bytes32(0);
        profile.factory = futureFactory;
        profile.tradeCap = [uint128(10), uint128(10)];
        profile.windowCap = [uint128(100), uint128(100)];
        profile.closureCap = [uint128(1), uint128(1)];
        factoryV3 = new BellPoolFactoryV3(profile, IBellHookDeployer(address(deployerV3)), USDG, address(0xFEE));
        require(address(factoryV3) == futureFactory, "factory nonce prediction mismatch");
    }

    function _createOnStack() internal {
        _deployStack();
        int24 tick = 223320;
        int24 lower = tick - 3000;
        int24 upper = tick + 3000;
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(tick);
        uint128 amount0 = 1e6;
        uint128 amount1 = 5e15;
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), amount0, amount1
        );
        PoolConfig memory c = _config();
        c.factory = address(factoryV3);
        c.tradeCap = [amount0 / 10, amount1 / 10];
        c.windowCap = [(amount0 * 4) / 10, (amount1 * 4) / 10];
        c.closureCap = [amount0 / 20, amount1 / 20];
        CreateRequest memory r = CreateRequest({
            config: c, salt: bytes32(0), nonce: factoryV3.nonces(creator), deadline: uint64(block.timestamp + 3600),
            recipient: creator, sqrtPriceX96: sqrtP, tickLower: lower, tickUpper: upper, liquidity: liquidity,
            amountMax: [amount0 * 11 / 10, amount1 * 11 / 10], maxServiceFee: 49e6
        });
        r.salt = _mineOn(r);
        vm.startPrank(creator);
        IERC20(USDG).approve(address(factoryV3), type(uint256).max);
        IERC20(NVDA).approve(address(factoryV3), type(uint256).max);
        pool = factoryV3.createAndSeed(r);
        vm.stopPrank();
        key = PoolKey(Currency.wrap(USDG), Currency.wrap(NVDA), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(pool.hook));
    }

    function _mineOn(CreateRequest memory r) internal returns (bytes32) {
        vm.pauseGasMetering();
        PoolKey memory k = PoolKey(Currency.wrap(r.config.token0), Currency.wrap(r.config.token1), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(0)));
        bytes32 initHash = deployerV3.initCodeHash(r.config, k);
        bytes memory ns = abi.encode(block.chainid, address(factoryV3), creator, r.nonce, bytes32(0));
        bytes memory cp = abi.encodePacked(bytes1(0xff), address(deployerV3), bytes32(0), initHash);
        for (uint256 i; i < 400000; ++i) {
            bytes32 digest;
            assembly ("memory-safe") {
                mstore(add(ns, 160), i)
                let s := keccak256(add(ns, 32), 160)
                mstore(add(cp, 53), s)
                digest := keccak256(add(cp, 32), 85)
            }
            if (uint160(uint256(digest)) & 0x3fff == 0x2cc0) {
                vm.resumeGasMetering();
                return bytes32(i);
            }
        }
        revert("no salt");
    }

    function _swapFee() internal returns (uint24 fee) {
        vm.startPrank(creator);
        IERC20(USDG).approve(address(swapper), type(uint256).max);
        vm.recordLogs();
        swapper.swap(key, true, -int256(uint256(0.015e6)));
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == SWAP_TOPIC) {
                (, , , , , fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                return fee;
            }
        }
        revert("no Swap event");
    }

    function test_V1_V2_haltThenResumeOnTheDeployedStack() external {
        _createOnStack();
        assertEq(uint160(pool.hook) & 0x3fff, 0x2cc0, "hook bits");
        address auction = auctionRegistry.auctionFor(IBellHook(pool.hook).poolId());
        require(auction != address(0), "no auction bound to the pool");
        require(address(BellOpeningAuctionV2(auction).haltRegistry()) == address(reg), "auction not bound to the registry");

        // V1: a recorded halt is priced as CLOSED.
        reg.halt(NVDA_ID, 1, uint64(block.timestamp) - 60, REASON, block.timestamp + 600, hex"01", hex"02");
        PolicyView memory p = IBellHook(pool.hook).refreshState();
        assertEq(p.mode, uint8(Mode.CLOSED), "not CLOSED during the halt");
        uint24 fee = _swapFee();
        emitUint("Swap event fee during halt (pips)", fee);
        assertEq(fee, 10000, "halt fee is not 10000 pips");

        // V2: the resume opens the auction and swaps revert with AuctionActive.
        reg.resume(NVDA_ID, 1, uint64(block.timestamp), block.timestamp + 600, hex"01", hex"02");
        require(BellOpeningAuctionV2(auction).armResume(), "resume auction not armed");
        require(BellOpeningAuctionV2(auction).blocksSwaps(), "auction does not block swaps");
        vm.startPrank(creator);
        try swapper.swap(key, true, -int256(uint256(0.015e6))) { revert("swap succeeded inside the resume auction"); } catch (bytes memory reason) {
            require(_contains(reason, BellHookV2.AuctionActive.selector), "swap did not revert with AuctionActive");
        }
        vm.stopPrank();
    }

    function _contains(bytes memory data, bytes4 selector) private pure returns (bool) {
        if (data.length < 4) return false;
        for (uint256 i; i + 4 <= data.length; ++i) {
            bytes4 w;
            assembly ("memory-safe") { w := mload(add(add(data, 32), i)) }
            if (w == selector) return true;
        }
        return false;
    }
}
