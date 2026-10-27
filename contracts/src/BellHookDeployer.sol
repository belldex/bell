// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHook} from "./BellHook.sol";
import {PoolConfig} from "./types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CreationCodeChunk} from "./libraries/CreationCodeChunk.sol";

/// @notice Narrow CREATE2 deployer for the immutable BellHook template.
/// @dev The deployer keeps Hook creation code out of BellPoolFactory. Only the bound factory may deploy.
contract BellHookDeployer {
    error Unauthorized();
    error InvalidHookAddress(address predicted);
    error DeploymentFailed();

    /// @notice Normative BellHook permission mask (beforeInitialize, before/afterAddLiquidity,
    /// before/afterSwap). v4's Hooks.isValidHookAddress only rejects inconsistent delta flags and
    /// requires one bit to be set, so a salt could otherwise land the hook on an address that never
    /// receives swap callbacks: guards would be skipped silently while the pool still activates.
    uint160 internal constant EXPECTED_HOOK_MASK = 0x2cc0;

    address public immutable factory;
    address public immutable sessionRegistry;
    bytes32 public immutable templateCodeHash;
    address public immutable creationCode0;
    address public immutable creationCode1;
    /// @notice Shared per-deployment policy oracle. Passing one instance to every hook keeps each hook's
    /// initcode inside the EIP-3860 limit instead of embedding a second contract creation.
    address public immutable policyOracle;

    constructor(address factory_, address sessionRegistry_, bytes32 templateCodeHash_, address policyOracle_) {
        // The deployer may be deployed first against the factory's precomputed CREATE/CREATE2 address.
        if (factory_ == address(0) || sessionRegistry_ == address(0)
            || sessionRegistry_.code.length == 0 || templateCodeHash_ == bytes32(0)) revert Unauthorized();
        if (policyOracle_ == address(0) || policyOracle_.code.length == 0) revert Unauthorized();
        factory = factory_;
        sessionRegistry = sessionRegistry_;
        templateCodeHash = templateCodeHash_;
        policyOracle = policyOracle_;
        // Creation code exists only in this constructor, never in deployer's runtime bytecode.
        bytes memory code = type(BellHook).creationCode;
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
        if (!Hooks.isValidHookAddress(IHooks(address(uint160(predicted))), key.fee)
            || uint160(predicted) & Hooks.ALL_HOOK_MASK != EXPECTED_HOOK_MASK) {
            revert InvalidHookAddress(predicted);
        }
        bytes memory code = _initCode(config, key);
        assembly ("memory-safe") { hook := create2(0, add(code, 32), mload(code), salt) }
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
        return abi.encodePacked(code, abi.encode(config, key, templateCodeHash, sessionRegistry, policyOracle));
    }
}
