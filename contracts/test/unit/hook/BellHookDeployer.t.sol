// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHookDeployer} from "../../../src/BellHookDeployer.sol";
import {BellPolicyOracle} from "../../../src/BellPolicyOracle.sol";
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
        deployer = new BellHookDeployer(address(this), dependency, keccak256(type(BellHook).creationCode), address(new BellPolicyOracle()));
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

    function testRuntimeSizeGateDeployer() external view {
        require(address(deployer).code.length <= 24576, "deployer exceeds EIP-170");
        address first = deployer.creationCode0(); address second = deployer.creationCode1();
        require(first.code.length <= 24576 && second.code.length <= 24576,"code transport exceeds EIP-170");
        require(first.code[0] == 0 && second.code[0] == 0,"payload executable");
    }

    function testRuntimeSizeGateHook() external {
        address hook = deployer.deploy(config, key, _validSalt());
        require(hook.code.length <= 24576, "hook exceeds EIP-170");
        require(address(BellHook(hook).modeEvaluator()).code.length <= 24576,"evaluator exceeds EIP-170");
    }

    function testTransportPreservesExactPinnedCreationCodeHash() external view {
        bytes32 expected = keccak256(abi.encodePacked(type(BellHook).creationCode,
            abi.encode(config, key, keccak256(type(BellHook).creationCode), dependency, deployer.policyOracle())));
        require(deployer.initCodeHash(config,key) == expected,"creation transport changed bytes");
    }

    function testDeployerCanBindFutureFactoryAddressBeforeFactoryDeployment() external {
        address futureFactory = address(0xFACADE);
        BellHookDeployer futureDeployer = new BellHookDeployer(
            futureFactory, dependency, keccak256(type(BellHook).creationCode), address(new BellPolicyOracle())
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

    /// @dev v4's isValidHookAddress would accept these salts (one flag bit is set), but the hook
    /// would then never receive beforeSwap/afterSwap, so every swap guard would be skipped.
    function testDeployRejectsSaltOutsideNormativePermissionMask() external {
        bytes32 salt = _saltWithWrongMask();
        address predicted = deployer.predict(config, key, salt);
        require(uint160(predicted) & HOOK_FLAG_MASK != EXPECTED_HOOK_FLAGS, "fixture salt is conforming");
        (bool ok, bytes memory reason) =
            address(deployer).call(abi.encodeCall(deployer.deploy, (config, key, salt)));
        require(!ok, "wrong-mask salt deployed a hook");
        require(reason.length >= 4 && bytes4(reason) == BellHookDeployer.InvalidHookAddress.selector,
            "unexpected revert reason");
    }

    function testDeployAcceptsOnlyTheNormativeMask() external {
        address hook = deployer.deploy(config, key, _validSalt());
        require(uint160(hook) & HOOK_FLAG_MASK == EXPECTED_HOOK_FLAGS, "deployed hook mask");
    }

    function _saltWithWrongMask() private view returns (bytes32 salt) {
        bytes32 initHash = deployer.initCodeHash(config, key);
        for (uint256 i = 1; i < 100_000; ++i) {
            salt = bytes32(i);
            address predicted = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff), address(deployer), salt, initHash
            )))));
            uint160 bits = uint160(predicted) & HOOK_FLAG_MASK;
            // Keep a flag set so v4's isValidHookAddress still passes, but drop beforeSwap/afterSwap.
            if (bits != 0 && bits != EXPECTED_HOOK_FLAGS) return salt;
        }
        revert("wrong-mask hook salt not found");
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
