// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "../lib/v4-core/src/PoolManager.sol";
import {IPoolManager} from "../lib/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "../lib/v4-core/src/interfaces/callback/IUnlockCallback.sol";

contract TransientUnlockProbe is IUnlockCallback {
    IPoolManager private immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function run() external returns (bytes memory) {
        return manager.unlock(abi.encode(uint256(7)));
    }

    function unlockCallback(bytes calldata data) external view returns (bytes memory) {
        require(msg.sender == address(manager), "wrong manager");
        return data;
    }
}

contract V4CoreCompatibilityTest {
    function testPinnedPoolManagerUnlockTransientStorageCycle() external {
        PoolManager manager = new PoolManager(address(this));
        TransientUnlockProbe probe = new TransientUnlockProbe(IPoolManager(address(manager)));
        bytes memory result = probe.run();
        require(abi.decode(result, (uint256)) == 7, "unlock callback result");
        result = probe.run();
        require(abi.decode(result, (uint256)) == 7, "pool manager did not relock");
    }
}
