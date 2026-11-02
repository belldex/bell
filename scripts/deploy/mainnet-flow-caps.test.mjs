import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveFlowCaps } from './mainnet-pool-config.mjs';

// Flow caps are enforced in raw token units (FlowBudget.settle reverts TradeCapExceeded when
// gross > cap). A hardcoded small integer therefore makes every swap revert, which is exactly
// what a literal `tradeCap: [10n, 10n]` did against 18-decimal stock tokens.

test('flow caps scale with the seed instead of using a fixed integer', () => {
  const seed = 250_000_000_000_000_000n; // 0.25 of an 18-decimal token
  const caps = deriveFlowCaps({ seed0: seed, seed1: seed });
  assert.ok(caps.tradeCap[0] > 10n, 'trade cap must exceed the token dust floor');
  assert.equal(caps.tradeCap[0], seed / 10n, 'per-trade cap is 10% of the seed');
  assert.equal(caps.windowCap[0], (seed * 4n) / 10n, 'rolling cap is 40% of the seed');
  assert.equal(caps.closureCap[0], seed / 20n, 'closure cap is 5% of the seed');
});

test('caps keep the factory invariants trade <= window and closure <= 2 * trade', () => {
  for (const seed of [1_000_000n, 250_000_000_000_000_000n, 86_230_000n]) {
    const caps = deriveFlowCaps({ seed0: seed, seed1: seed });
    for (let i = 0; i < 2; i += 1) {
      assert.ok(caps.tradeCap[i] > 0n, `trade cap ${i} must be positive`);
      assert.ok(caps.tradeCap[i] <= caps.windowCap[i], `trade <= window for leg ${i}`);
      assert.ok(caps.closureCap[i] <= 2n * caps.tradeCap[i], `closure <= 2*trade for leg ${i}`);
      assert.ok(caps.closureCap[i] <= caps.windowCap[i], `closure <= window for leg ${i}`);
    }
  }
});

test('a dust-sized seed still yields a usable positive cap', () => {
  const caps = deriveFlowCaps({ seed0: 12n, seed1: 7n });
  assert.equal(caps.tradeCap[0], 1n);
  assert.equal(caps.tradeCap[1], 1n);
  assert.ok(caps.windowCap[0] >= caps.tradeCap[0]);
});

test('rejects a zero seed instead of emitting a zero cap', () => {
  assert.throws(() => deriveFlowCaps({ seed0: 0n, seed1: 1n }), /seed/i);
});
