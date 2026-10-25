// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StockTokenStatusAdapter} from "../src/adapters/StockTokenStatusAdapter.sol";

contract MockStockTokenStatus {
    uint256 public multiplier = 1e18;
    uint256 public pendingMultiplier = 1e18;
    uint256 public pendingEffectiveAt;
    bool public paused;

    function uiMultiplier() external view returns (uint256) { return multiplier; }
    function newUIMultiplier() external view returns (uint256) { return pendingMultiplier; }
    function effectiveAt() external view returns (uint256) { return pendingEffectiveAt; }
    function oraclePaused() external view returns (bool) { return paused; }

    function set(uint256 current, uint256 next, uint256 effectiveAt_, bool paused_) external {
        multiplier = current;
        pendingMultiplier = next;
        pendingEffectiveAt = effectiveAt_;
        paused = paused_;
    }
}

contract StockTokenStatusAdapterTest {
    function testReadsCurrentPendingAndPauseState() external {
        MockStockTokenStatus token = new MockStockTokenStatus();
        StockTokenStatusAdapter adapter = new StockTokenStatusAdapter();
        StockTokenStatusAdapter.Status memory status = adapter.readStatus(address(token), 1000);
        require(status.multiplier18 == 1e18 && !status.pending && !status.oraclePaused, "normal status");
        token.set(1e18, 2e18, 2000, false);
        status = adapter.readStatus(address(token), 1000);
        require(status.pending && status.pendingMultiplier18 == 2e18 && status.effectiveAt == 2000, "pending update");
        token.set(1e18, 2e18, 2000, true);
        status = adapter.readStatus(address(token), 1000);
        require(status.oraclePaused, "oracle pause");
    }

    function testRejectsMissingGettersAndExpiredUnappliedMultiplier() external {
        StockTokenStatusAdapter adapter = new StockTokenStatusAdapter();
        (bool noCode,) = address(adapter).staticcall(abi.encodeCall(adapter.readStatus, (address(0xBEEF), uint64(1))));
        require(!noCode, "missing token getters accepted");
        MockStockTokenStatus token = new MockStockTokenStatus();
        token.set(1e18, 2e18, 2000, false);
        (bool stalePending,) = address(adapter).staticcall(abi.encodeCall(adapter.readStatus, (address(token), uint64(2001))));
        require(!stalePending, "expired pending multiplier accepted");
    }
}
