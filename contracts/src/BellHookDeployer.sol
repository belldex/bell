// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BellHook} from "./BellHook.sol";
import {PoolConfig} from "./types/ProtocolTypes.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

/// @notice Narrow CREATE2 deployer for the immutable BellHook template.
/// @dev The deployer keeps Hook creation code out of BellPoolFactory. Only the bound factory may deploy.
contract BellHookDeployer {
    error Unauthorized();
    error InvalidHookAddress(address predicted);

    address public immutable factory;
    address public immutable sessionRegistry;
    bytes32 public immutable templateCodeHash;

    constructor(address factory_, address sessionRegistry_, bytes32 templateCodeHash_) {
        // The deployer may be deployed first against the factory's precomputed CREATE/CREATE2 address.
        if (factory_ == address(0) || sessionRegistry_ == address(0)
            || sessionRegistry_.code.length == 0 || templateCodeHash_ == bytes32(0)) revert Unauthorized();
        factory = factory_;
        sessionRegistry = sessionRegistry_;
        templateCodeHash = templateCodeHash_;
    }

    function initCodeHash(PoolConfig memory config, PoolKey memory key) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            type(BellHook).creationCode,
            abi.encode(config, key, templateCodeHash, sessionRegistry)
        ));
    }

    function predict(PoolConfig memory config, PoolKey memory key, bytes32 salt) public view returns (address predicted) {
        bytes32 codeHash = initCodeHash(config, key);
        predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash)))));
    }

    function deploy(PoolConfig memory config, PoolKey memory key, bytes32 salt) external returns (address hook) {
        if (msg.sender != factory) revert Unauthorized();
        address predicted = predict(config, key, salt);
        if (!Hooks.isValidHookAddress(IHooks(address(uint160(predicted))), key.fee)) {
            revert InvalidHookAddress(predicted);
        }
        hook = address(new BellHook{salt: salt}(config, key, templateCodeHash, sessionRegistry));
        assert(hook == predicted);
    }
}
