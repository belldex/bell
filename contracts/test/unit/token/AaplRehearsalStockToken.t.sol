// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AaplRehearsalStockToken} from "../../../src/fixtures/AaplRehearsalStockToken.sol";
import {StockTokenStatusAdapter} from "../../../src/adapters/StockTokenStatusAdapter.sol";

contract AaplRehearsalStockTokenTest {
    AaplRehearsalStockToken private token;
    StockTokenStatusAdapter private adapter;

    address private constant ALICE = address(0xAA11);
    address private constant BOB = address(0xBB22);

    function setUp() external {
        token = new AaplRehearsalStockToken();
        adapter = new StockTokenStatusAdapter();
    }

    function testMetadataAndDecimals() external view {
        require(keccak256(bytes(token.name())) == keccak256(bytes("AAPL Rehearsal Stock Token")), "wrong name");
        require(keccak256(bytes(token.symbol())) == keccak256(bytes("AAPL-RH-REHEARSAL")), "wrong symbol");
        require(token.decimals() == 18, "wrong decimals");
        require(token.totalSupply() == 0, "initial supply non-zero");
    }

    function testRobinhoodCorporateGetters() external view {
        require(token.uiMultiplier() == 1e18, "uiMultiplier must be 1e18");
        require(token.newUIMultiplier() == 1e18, "newUIMultiplier must be 1e18");
        require(token.effectiveAt() == 0, "effectiveAt must be 0");
        require(!token.oraclePaused(), "oraclePaused must be false");
    }

    function testFaucetMintAndTransfer() external {
        token.mint(ALICE, 500e18);
        require(token.balanceOf(ALICE) == 500e18, "Alice balance incorrect after mint");
        require(token.totalSupply() == 500e18, "Total supply incorrect after mint");

        token.mint(BOB, 250e18);
        require(token.balanceOf(BOB) == 250e18, "Bob balance incorrect after mint");
        require(token.totalSupply() == 750e18, "Total supply incorrect after second mint");
    }

    function testStockTokenStatusAdapterCompatibility() external view {
        StockTokenStatusAdapter.Status memory status = adapter.readStatus(address(token), 1_793_000_000);
        require(status.multiplier18 == 1e18, "adapter multiplier mismatch");
        require(status.pendingMultiplier18 == 1e18, "adapter pendingMultiplier mismatch");
        require(status.effectiveAt == 0, "adapter effectiveAt mismatch");
        require(!status.pending, "adapter pending should be false");
        require(!status.oraclePaused, "adapter oraclePaused should be false");
        require(status.fingerprint != bytes32(0), "adapter fingerprint should be non-zero");
    }
}
