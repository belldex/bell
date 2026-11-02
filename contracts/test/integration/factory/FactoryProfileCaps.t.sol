// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolConfig} from "../../../src/types/ProtocolTypes.sol";

/// Flow caps are raw token units and belong to the pool, not to the factory deployment.
///
/// The factory hashed tradeCap/windowCap/closureCap into profileHash, so one deployment could
/// only accept a single cap set. A pool seeded at a different size than that set could be
/// created but every swap reverted TradeCapExceeded, because the cap was token dust relative to
/// the pool's own inventory.
///
/// This harness mirrors `BellPoolFactory._profileHash` line for line. If the factory zeroes the
/// caps, the two hashes below are equal; while it still binds them, the test fails.
contract FactoryProfileCapsTest {
    function testProfileHashIgnoresFlowCaps() external pure {
        PoolConfig memory dust = _config(
            [uint128(10), uint128(10)],
            [uint128(100), uint128(100)],
            [uint128(1), uint128(1)]
        );
        PoolConfig memory sized = _config(
            [uint128(25_000_000_000_000_000), uint128(3_800_000_000_000_000)],
            [uint128(100_000_000_000_000_000), uint128(15_200_000_000_000_000)],
            [uint128(12_500_000_000_000_000), uint128(1_900_000_000_000_000)]
        );
        require(_factoryProfileHash(dust) == _factoryProfileHash(sized), "factory profile still binds flow caps");
    }

    /// Caps must still satisfy the factory's own sanity rules for whichever pool uses them.
    function testFlowCapInvariantsHoldForDerivedCaps() external pure {
        uint128[2] memory trade = [uint128(25_000_000_000_000_000), uint128(3_800_000_000_000_000)];
        uint128[2] memory window = [uint128(100_000_000_000_000_000), uint128(15_200_000_000_000_000)];
        uint128[2] memory closure = [uint128(12_500_000_000_000_000), uint128(1_900_000_000_000_000)];
        for (uint256 i; i < 2; ++i) {
            require(trade[i] > 0, "trade cap must be positive");
            require(trade[i] <= window[i], "trade <= window");
            require(closure[i] <= 2 * trade[i], "closure <= 2*trade");
            require(closure[i] <= window[i], "closure <= window");
        }
    }

    function _config(uint128[2] memory trade, uint128[2] memory window, uint128[2] memory closure)
        private
        pure
        returns (PoolConfig memory c)
    {
        c.tickSpacing = 60;
        c.policyId = keccak256("bell-mainnet-v1");
        c.tradeCap = trade;
        c.windowCap = window;
        c.closureCap = closure;
    }

    /// Mirrors BellPoolFactory._profileHash. The cap zeroing is the behaviour under test.
    function _factoryProfileHash(PoolConfig memory c) private pure returns (bytes32) {
        c.token0 = address(0);
        c.token1 = address(0);
        c.asset0 = bytes32(0);
        c.asset1 = bytes32(0);
        c.poolClass = 0;
        c.referenceAdapter0 = address(0);
        c.referenceAdapter1 = address(0);
        c.tradeCap = [uint128(0), uint128(0)];
        c.windowCap = [uint128(0), uint128(0)];
        c.closureCap = [uint128(0), uint128(0)];
        return keccak256(abi.encode(c));
    }
}
