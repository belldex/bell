// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHookDeployer} from "../../../src/BellHookDeployer.sol";
import {BellHook} from "../../../src/BellHook.sol";
import {PoolConfig, LiquidityMode, PoolClass} from "../../../src/types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

contract HookDeployerMockDependency {
    function protocolFeeController() external pure returns (address) { return address(0); }
}

contract BellHookDeployerAttacker {
    function attempt(BellHookDeployer deployer, PoolConfig calldata config, PoolKey calldata key, bytes32 salt)
        external returns (address)
    {
        return deployer.deploy(config, key, salt);
    }
}

contract BellHookDeployerTest {
    uint160 private constant HOOK_FLAG_MASK = 0x3fff;
    uint160 private constant EXPECTED_HOOK_FLAGS = 0x2cc0;
    BellHookDeployer private deployer;
    PoolConfig private config;
    PoolKey private key;
    address private token0;
    address private token1;
    address private dependency;

    function setUp() external {
        dependency = address(new HookDeployerMockDependency());
        address a = address(new HookDeployerMockDependency());
        address b = address(new HookDeployerMockDependency());
        (token0, token1) = a < b ? (a, b) : (b, a);
        deployer = new BellHookDeployer(address(this), dependency, keccak256(type(BellHook).creationCode));
        config = PoolConfig({
            token0: token0,
            token1: token1,
            asset0: keccak256("asset0"),
            asset1: keccak256("asset1"),
            poolManager: dependency,
            positionManager: dependency,
            factory: address(this),
            assetRegistry: dependency,
            calendarRegistry: dependency,
            safetyController: dependency,
            treasuryAdapter: address(0),
            poolClass: uint8(PoolClass.SESSION_ONLY),
            liquidityMode: uint8(LiquidityMode.PUBLIC),
            referenceMode: 0,
            tickSpacing: 60,
            tradeCap: [uint128(10), uint128(10)],
            windowCap: [uint128(100), uint128(100)],
            closureCap: [uint128(1), uint128(1)],
            policyId: keccak256("policy")
        });
        key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    function testPredictionMatchesCreate2HookDeploymentAndPermissionMask() external {
        bytes32 salt = _validSalt();
        address predicted = deployer.predict(config, key, salt);
        require(uint160(predicted) & HOOK_FLAG_MASK == EXPECTED_HOOK_FLAGS, "wrong hook flags");
        address actual = deployer.deploy(config, key, salt);
        require(actual == predicted, "CREATE2 address mismatch");
        require(actual.code.length != 0, "hook not deployed");
    }

    function testDeployerCanBindFutureFactoryAddressBeforeFactoryDeployment() external {
        address futureFactory = address(0xFACADE);
        BellHookDeployer futureDeployer = new BellHookDeployer(
            futureFactory, dependency, keccak256(type(BellHook).creationCode)
        );
        require(futureDeployer.factory() == futureFactory, "future factory binding");
    }

    function testOnlyFactoryCanDeployHook() external {
        BellHookDeployerAttacker attacker = new BellHookDeployerAttacker();
        (bool ok,) = address(attacker).call(abi.encodeCall(
            attacker.attempt, (deployer, config, key, _validSalt())
        ));
        require(!ok, "non-factory deployed hook");
    }

    function _validSalt() private view returns (bytes32 salt) {
        bytes32 initHash = deployer.initCodeHash(config, key);
        for (uint256 i = 1; i < 100_000; ++i) {
            salt = bytes32(i);
            address predicted = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff), address(deployer), salt, initHash
            )))));
            if (uint160(predicted) & HOOK_FLAG_MASK == EXPECTED_HOOK_FLAGS) return salt;
        }
        revert("valid hook salt not found");
    }
}
