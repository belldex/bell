import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMainnetPQWirePlan } from './pq-mainnet-wire-plan.mjs';

const evidence = JSON.parse(await readFile(new URL('../../evidence/deploy/mainnet-4663-chainlink-session-adapters.json', import.meta.url), 'utf8'));

test('Mainnet plan reuses all deployed Chainlink wires for all three stocks and sessions', () => {
  const plan = buildMainnetPQWirePlan(evidence);
  assert.equal(plan.chainId, 4663);
  assert.deepEqual(plan.assets.map((asset) => asset.symbol), ['AAPL', 'NVDA', 'TSLA']);
  for (const asset of plan.assets) {
    assert.equal(asset.adapters.length, 4);
    assert.deepEqual(asset.wires.map(({ kind, phaseScope }) => [kind, phaseScope]), [[1, 0], [5, 1], [5, 2], [5, 3]]);
    assert.equal(asset.secondaryAdapter, null);
    assert(asset.adapters.every((address) => /^0x[\da-f]{40}$/i.test(address)));
  }
});

test('Mainnet plan rejects missing stocks and misbound overnight feeds', () => {
  const missing = structuredClone(evidence);
  delete missing.assets.TSLA;
  assert.throws(() => buildMainnetPQWirePlan(missing), /AAPL, NVDA, and TSLA/);

  const mismatched = structuredClone(evidence);
  mismatched.assets.AAPL.overnightWire.phaseScope = 2;
  assert.throws(() => buildMainnetPQWirePlan(mismatched), /AAPL overnight/i);
});
