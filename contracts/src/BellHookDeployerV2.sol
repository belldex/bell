// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHookV2} from "./BellHookV2.sol";
import {PoolConfig} from "./types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CreationCodeChunk} from "./libraries/CreationCodeChunk.sol";
import {IBellHookDeployer} from "./interfaces/IBellHookDeployer.sol";

/// @notice Narrow CREATE2 deployer for the immutable BellHookV2 template.
/// @dev Mirrors BellHookDeployer. Same permission mask, same pinned evaluator; the only difference is
///      that the hook initcode carries the auction registry and the router as extra constructor args.
///      Only the bound factory may deploy.
contract BellHookDeployerV2 is IBellHookDeployer {
    error Unauthorized();
    error InvalidHookAddress(address predicted);
    error DeploymentFailed();

    /// @notice Same normative mask as the v1 template, so a v2 hook can never land on an address that
    ///         skips the swap and add-liquidity callbacks.
    uint160 internal constant EXPECTED_HOOK_MASK = 0x2cc0;
    /// @dev Unchanged from v1: the evaluator is not modified by the auction feature.
    bytes32 public constant MODE_EVALUATOR_CODE_HASH = 0x743105f46008f9ab255cba5b578b94473e16849d0a113c623b0eeb4e1c793b69;

    address public immutable factory;
    address public immutable sessionRegistry;
    bytes32 public immutable templateCodeHash;
    address public immutable creationCode0;
    address public immutable creationCode1;
    address public immutable policyOracle;
    address public immutable modeEvaluator;
    address public immutable auctionRegistry;
    address public immutable auctionFactoryModule;

    constructor(
        address factory_,
        address sessionRegistry_,
        bytes32 templateCodeHash_,
        address policyOracle_,
        address modeEvaluator_,
        address auctionRegistry_,
        address auctionFactoryModule_
    ) {
        if (
            factory_ == address(0) || sessionRegistry_ == address(0) || sessionRegistry_.code.length == 0
                || templateCodeHash_ == bytes32(0)
        ) revert Unauthorized();
        if (policyOracle_ == address(0) || policyOracle_.code.length == 0) revert Unauthorized();
        if (modeEvaluator_ == address(0) || modeEvaluator_.codehash != MODE_EVALUATOR_CODE_HASH) revert Unauthorized();
        if (auctionRegistry_ == address(0) || auctionRegistry_.code.length == 0) revert Unauthorized();
        if (auctionFactoryModule_ == address(0) || auctionFactoryModule_.code.length == 0) revert Unauthorized();
        factory = factory_;
        sessionRegistry = sessionRegistry_;
        templateCodeHash = templateCodeHash_;
        policyOracle = policyOracle_;
        modeEvaluator = modeEvaluator_;
        auctionRegistry = auctionRegistry_;
        auctionFactoryModule = auctionFactoryModule_;
        bytes memory code = type(BellHookV2).creationCode;
        if (keccak256(code) != templateCodeHash_) revert Unauthorized();
        uint256 split = code.length / 2;
        creationCode0 = address(new CreationCodeChunk(code, 0, split));
        creationCode1 = address(new CreationCodeChunk(code, split, code.length - split));
    }

    function initCodeHash(PoolConfig memory config, PoolKey memory key) public view returns (bytes32) {
        return keccak256(_initCode(config, key));
    }

    function predict(PoolConfig memory config, PoolKey memory key, bytes32 salt) public view returns (address predicted) {
        bytes32 codeHash = initCodeHash(config, key);
        predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash)))));
    }

    function deploy(PoolConfig memory config, PoolKey memory key, bytes32 salt) external returns (address hook) {
        if (msg.sender != factory) revert Unauthorized();
        address predicted = predict(config, key, salt);
        if (
            !Hooks.isValidHookAddress(IHooks(address(uint160(predicted))), key.fee)
                || uint160(predicted) & Hooks.ALL_HOOK_MASK != EXPECTED_HOOK_MASK
        ) {
            revert InvalidHookAddress(predicted);
        }
        bytes memory code = _initCode(config, key);
        assembly ("memory-safe") {
            hook := create2(0, add(code, 32), mload(code), salt)
        }
        if (hook == address(0)) revert DeploymentFailed();
        assert(hook == predicted);
    }

    function _initCode(PoolConfig memory config, PoolKey memory key) private view returns (bytes memory) {
        address first = creationCode0;
        address second = creationCode1;
        uint256 length0 = first.code.length - 1;
        uint256 length1 = second.code.length - 1;
        bytes memory code = new bytes(length0 + length1);
        assembly ("memory-safe") {
            extcodecopy(first, add(code, 32), 1, length0)
            extcodecopy(second, add(add(code, 32), length0), 1, length1)
        }
        return abi.encodePacked(
            code, abi.encode(config, key, templateCodeHash, sessionRegistry, policyOracle, modeEvaluator, auctionRegistry)
        );
    }
}
