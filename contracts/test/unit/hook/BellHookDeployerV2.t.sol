// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHookDeployerV2} from "../../../src/BellHookDeployerV2.sol";
import {BellHookV2} from "../../../src/BellHookV2.sol";
import {BellAuctionRegistry} from "../../../src/auction/BellAuctionRegistry.sol";
import {BellPolicyOracle} from "../../../src/BellPolicyOracle.sol";
import {BellModeEvaluator} from "../../../src/BellModeEvaluator.sol";
import {PoolConfig, LiquidityMode, PoolClass} from "../../../src/types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

contract V2MockDependency {
    function protocolFeeController() external pure returns (address) { return address(0); }
}

contract BellHookDeployerV2Test {
    uint160 private constant HOOK_MASK = 0x3fff;
    uint160 private constant REQUIRED_FLAGS = 0x2cc0;

    V2MockDependency private dependency;
    BellAuctionRegistry private registry;
    BellHookDeployerV2 private deployer;
    PoolConfig private config;
    PoolKey private key;

    function setUp() external {
        dependency = new V2MockDependency();
        V2MockDependency a = new V2MockDependency();
        V2MockDependency b = new V2MockDependency();
        (address token0, address token1) = address(a) < address(b) ? (address(a), address(b)) : (address(b), address(a));
        registry = new BellAuctionRegistry(address(this));
        V2MockDependency module = new V2MockDependency();
        BellPolicyOracle oracle = new BellPolicyOracle();
        BellModeEvaluator evaluator = new BellModeEvaluator();
        deployer = new BellHookDeployerV2(
            address(this), address(dependency), keccak256(type(BellHookV2).creationCode),
            address(oracle), address(evaluator), address(registry), address(module)
        );
        config = PoolConfig({
            token0: token0, token1: token1, asset0: keccak256("asset0"), asset1: keccak256("asset1"),
            poolManager: address(dependency), positionManager: address(dependency), factory: address(this),
            assetRegistry: address(dependency), calendarRegistry: address(dependency), safetyController: address(dependency),
            treasuryAdapter: address(0), poolClass: uint8(PoolClass.SESSION_ONLY), liquidityMode: uint8(LiquidityMode.PUBLIC),
            referenceMode: 0, tickSpacing: 60, tradeCap: [uint128(10), uint128(10)],
            windowCap: [uint128(100), uint128(100)], closureCap: [uint128(1), uint128(1)],
            policyId: keccak256("policy"), referenceAdapter0: address(0), referenceAdapter1: address(0)
        });
        key = PoolKey({
            currency0: Currency.wrap(token0), currency1: Currency.wrap(token1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(0))
        });
    }

    function testV2Create2TemplatePreservesRequiredHookFlagsAndRegistry() external {
        bytes32 salt;
        address predicted;
        for (uint256 i = 1; i < 200_000; ++i) {
            salt = bytes32(i);
            predicted = deployer.predict(config, key, salt);
            if (uint160(predicted) & HOOK_MASK == REQUIRED_FLAGS) break;
        }
        require(uint160(predicted) & HOOK_MASK == REQUIRED_FLAGS, "could not mine v2 hook flags");
        address hook = deployer.deploy(config, key, salt);
        require(hook == predicted && hook.code.length != 0, "v2 CREATE2 prediction mismatch");
        require(BellHookV2(hook).auctionRegistry() == address(registry), "hook registry mismatch");
        require(BellHookV2(hook).getHookPermissions().beforeRemoveLiquidity == false, "LP exit permission added");
    }
}
