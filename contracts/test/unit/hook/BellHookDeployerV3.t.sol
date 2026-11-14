// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHookDeployerV3} from "../../../src/BellHookDeployerV3.sol";
import {BellHookV3} from "../../../src/BellHookV3.sol";
import {BellAuctionRegistry} from "../../../src/auction/BellAuctionRegistry.sol";
import {BellPolicyOracleV2} from "../../../src/BellPolicyOracleV2.sol";
import {BellModeEvaluator} from "../../../src/BellModeEvaluator.sol";
import {PoolConfig, LiquidityMode, PoolClass} from "../../../src/types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

contract V3MockDependency {
    function protocolFeeController() external pure returns (address) {
        return address(0);
    }
}

contract BellHookDeployerV3Test {
    uint160 private constant HOOK_MASK = 0x3fff;
    uint160 private constant REQUIRED_FLAGS = 0x2cc0;

    function testV3Create2TemplatePreservesAuctionFlagsAndAllowsLPExit() external {
        V3MockDependency session = new V3MockDependency();
        V3MockDependency a = new V3MockDependency();
        V3MockDependency b = new V3MockDependency();
        (address token0, address token1) = address(a) < address(b) ? (address(a), address(b)) : (address(b), address(a));
        BellAuctionRegistry registry = new BellAuctionRegistry(address(this));
        V3MockDependency module = new V3MockDependency();
        BellPolicyOracleV2 oracle = new BellPolicyOracleV2();
        BellModeEvaluator evaluator = new BellModeEvaluator();
        BellHookDeployerV3 deployer = new BellHookDeployerV3(
            address(this),
            address(session),
            keccak256(type(BellHookV3).creationCode),
            oracle,
            evaluator,
            address(registry),
            address(module)
        );
        PoolConfig memory config = PoolConfig({
            token0: token0,
            token1: token1,
            asset0: keccak256("asset0"),
            asset1: keccak256("asset1"),
            poolManager: address(session),
            positionManager: address(session),
            factory: address(this),
            assetRegistry: address(session),
            calendarRegistry: address(session),
            safetyController: address(session),
            treasuryAdapter: address(0),
            poolClass: uint8(PoolClass.SESSION_ONLY),
            liquidityMode: uint8(LiquidityMode.PUBLIC),
            referenceMode: 0,
            tickSpacing: 60,
            tradeCap: [uint128(10), uint128(10)],
            windowCap: [uint128(100), uint128(100)],
            closureCap: [uint128(1), uint128(1)],
            policyId: keccak256("policy"),
            referenceAdapter0: address(0),
            referenceAdapter1: address(0)
        });
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        bytes32 salt;
        address predicted;
        for (uint256 i = 1; i < 200_000; ++i) {
            salt = bytes32(i);
            predicted = deployer.predict(config, key, salt);
            if (uint160(predicted) & HOOK_MASK == REQUIRED_FLAGS) break;
        }
        require(uint160(predicted) & HOOK_MASK == REQUIRED_FLAGS, "could not mine v3 hook flags");
        address hook = deployer.deploy(config, key, salt);
        require(hook == predicted && hook.code.length != 0, "v3 CREATE2 prediction mismatch");
        require(BellHookV3(hook).auctionRegistry() == address(registry), "hook registry mismatch");
        require(!BellHookV3(hook).getHookPermissions().beforeRemoveLiquidity, "LP exit permission added");
    }
}
