// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Immutable inert code storage. STOP prefix makes every call terminate before the payload.
/// @dev Only constructed by the template deployer from its compiled, hash-checked creation code.
contract CreationCodeChunk {
    constructor(bytes memory code, uint256 offset, uint256 length) {
        require(length <= 24575 && offset + length <= code.length, "CODE_CHUNK_BOUNDS");
        bytes memory runtime = new bytes(length + 1);
        assembly ("memory-safe") {
            mcopy(add(runtime, 33), add(add(code, 32), offset), length)
            return(add(runtime, 32), mload(runtime))
        }
    }
}
