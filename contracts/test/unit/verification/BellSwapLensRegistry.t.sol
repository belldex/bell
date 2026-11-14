// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellSwapLensRegistry} from "../../../src/BellSwapLensRegistry.sol";
import {BellSwapLens} from "../../../src/BellSwapLens.sol";
import {PoolConfig} from "../../../src/types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PositionInfo} from "../../../lib/v4-periphery/src/libraries/PositionInfoLibrary.sol";

contract LensRegistryFactoryMock {}

contract LensRegistryPositionManagerMock {
    address public owner;
    PoolKey private _key;

    function set(address owner_, PoolKey calldata key_) external {
        owner = owner_;
        _key = key_;
    }

    function ownerOf(uint256) external view returns (address) {
        return owner;
    }

    function getPoolAndPositionInfo(uint256) external view returns (PoolKey memory, PositionInfo) {
        return (_key, PositionInfo.wrap(0));
    }
}

contract LensRegistryHookMock {
    address private immutable _factory;
    address private immutable _positionManager;
    uint256 public immutable seedPositionId;
    bytes32 public poolId;

    constructor(address factory_, address positionManager_, uint256 tokenId_) {
        _factory = factory_;
        _positionManager = positionManager_;
        seedPositionId = tokenId_;
    }

    function config() external view returns (PoolConfig memory result) {
        result.factory = _factory;
        result.positionManager = _positionManager;
    }

    function setPoolId(bytes32 poolId_) external {
        poolId = poolId_;
    }
}

interface VmLensRegistry {
    function expectRevert(bytes4 selector) external;
}

contract BellSwapLensRegistryTest {
    VmLensRegistry private constant vm = VmLensRegistry(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testPermissionlessLensRegistrationAndIdempotence() external {
        address factory = address(new LensRegistryFactoryMock());
        BellSwapLensRegistry registry = new BellSwapLensRegistry(factory);
        LensRegistryPositionManagerMock positionManager = new LensRegistryPositionManagerMock();
        LensRegistryHookMock hook = new LensRegistryHookMock(factory, address(positionManager), 7);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0x100)),
            currency1: Currency.wrap(address(0x200)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        bytes32 poolId = PoolId.unwrap(PoolIdLibrary.toId(key));
        hook.setPoolId(poolId);
        positionManager.set(address(this), key);

        address lens = registry.ensureLens(address(hook));
        require(address(BellSwapLens(lens).boundHook()) == address(hook), "wrong hook binding");
        require(BellSwapLens(lens).boundPoolId() == poolId, "wrong pool binding");
        require(registry.lensForPool(poolId) == lens, "missing registry binding");
        require(registry.ensureLens(address(hook)) == lens, "not idempotent");
    }

    function testRejectsHookFromDifferentFactory() external {
        address factory = address(new LensRegistryFactoryMock());
        BellSwapLensRegistry registry = new BellSwapLensRegistry(factory);
        LensRegistryHookMock hook = new LensRegistryHookMock(address(new LensRegistryFactoryMock()), address(0), 1);
        hook.setPoolId(keccak256("other"));
        vm.expectRevert(BellSwapLensRegistry.InvalidHook.selector);
        registry.ensureLens(address(hook));
    }

    function testRejectsNonOwnerEvenForAuthenticSeedPosition() external {
        address factory = address(new LensRegistryFactoryMock());
        BellSwapLensRegistry registry = new BellSwapLensRegistry(factory);
        LensRegistryPositionManagerMock positionManager = new LensRegistryPositionManagerMock();
        LensRegistryHookMock hook = new LensRegistryHookMock(factory, address(positionManager), 8);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0x100)),
            currency1: Currency.wrap(address(0x200)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        hook.setPoolId(PoolId.unwrap(PoolIdLibrary.toId(key)));
        positionManager.set(address(0xBEEF), key);
        (bool success, bytes memory result) =
            address(registry).call(abi.encodeCall(BellSwapLensRegistry.ensureLens, (address(hook))));
        require(
            !success && bytes4(result) == BellSwapLensRegistry.CallerNotPositionOwner.selector,
            "non-owner registered lens"
        );
    }

    function testRejectsHookWithoutCode() external {
        BellSwapLensRegistry registry = new BellSwapLensRegistry(address(new LensRegistryFactoryMock()));
        vm.expectRevert(BellSwapLensRegistry.InvalidHook.selector);
        registry.ensureLens(address(0x1234));
    }
}
