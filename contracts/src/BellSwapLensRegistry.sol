// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellSwapLens} from "./BellSwapLens.sol";
import {BellHook} from "./BellHook.sol";
import {PoolConfig} from "./types/ProtocolTypes.sol";
import {CreationCodeChunk} from "./libraries/CreationCodeChunk.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PositionInfo} from "../lib/v4-periphery/src/libraries/PositionInfoLibrary.sol";

interface IPositionReceiptOwner {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, PositionInfo);
}

/// @notice LP-owner-authorized per-pool quote Lens deployment and onchain discovery.
/// @dev Lens deployment is separate from pool creation; caller must own its seed NFT and the NFT
///      PositionManager pool key must point back to the claimed hook and pool ID.
contract BellSwapLensRegistry {
    error InvalidHook();
    error CallerNotPositionOwner();
    error LensDeploymentFailed();

    address public immutable factory;
    address public immutable creationCode0;
    address public immutable creationCode1;
    mapping(bytes32 poolId => address lens) public lensForPool;

    event LensRegistered(bytes32 indexed poolId, address indexed hook, address indexed lens, address caller);

    constructor(address factory_) {
        if (factory_.code.length == 0) revert InvalidHook();
        factory = factory_;
        bytes memory creationCode = type(BellSwapLens).creationCode;
        uint256 split = creationCode.length / 2;
        creationCode0 = address(new CreationCodeChunk(creationCode, 0, split));
        creationCode1 = address(new CreationCodeChunk(creationCode, split, creationCode.length - split));
    }

    function ensureLens(address hook) external returns (address lens) {
        if (hook.code.length == 0) revert InvalidHook();
        BellHook bellHook = BellHook(hook);
        PoolConfig memory config = bellHook.config();
        bytes32 poolId = bellHook.poolId();
        if (config.factory != factory || poolId == bytes32(0)) revert InvalidHook();
        uint256 tokenId = bellHook.seedPositionId();
        if (tokenId == 0 || IPositionReceiptOwner(config.positionManager).ownerOf(tokenId) != msg.sender) {
            revert CallerNotPositionOwner();
        }
        (PoolKey memory key,) = IPositionReceiptOwner(config.positionManager).getPoolAndPositionInfo(tokenId);
        if (address(key.hooks) != hook || PoolId.unwrap(PoolIdLibrary.toId(key)) != poolId) revert InvalidHook();
        lens = lensForPool[poolId];
        if (lens != address(0)) return lens;

        bytes memory code = _creationCode();
        bytes memory initCode = abi.encodePacked(code, abi.encode(hook));
        assembly ("memory-safe") { lens := create(0, add(initCode, 32), mload(initCode)) }
        if (lens == address(0)) revert LensDeploymentFailed();
        if (BellSwapLens(lens).boundHook() != bellHook || BellSwapLens(lens).boundPoolId() != poolId) {
            revert LensDeploymentFailed();
        }
        lensForPool[poolId] = lens;
        emit LensRegistered(poolId, hook, lens, msg.sender);
    }

    function _creationCode() private view returns (bytes memory code) {
        address first = creationCode0;
        address second = creationCode1;
        uint256 length0 = first.code.length - 1;
        uint256 length1 = second.code.length - 1;
        code = new bytes(length0 + length1);
        assembly ("memory-safe") {
            extcodecopy(first, add(code, 32), 1, length0)
            extcodecopy(second, add(add(code, 32), length0), 1, length1)
        }
    }
}
