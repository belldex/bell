import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSwap, positionAmounts, liquidityFor, sqrtAtTick, computePool, compare, SWAP_TOPIC } from '../../../scripts/einstein/v3-evolve/lib.mjs';

const dec = { usdg: 6, nvda: 18 };
const price0 = 160; // USDG per NVDA
const sqrtInit = Math.sqrt((1 / price0) * 1e18 / 1e6); // token1 per token0 in raw units, USDG is currency0
const range = { tickLower: 223000, tickUpper: 227000 };
const sqrtX96 = (s) => BigInt(Math.round(s * 2 ** 96));
const seedU = 1000; // USDG
const L = liquidityFor(seedU * 1e6, (seedU / price0) * 1e18 * 3, sqrtInit, range.tickLower, range.tickUpper); // USDG side limits
const held0 = positionAmounts(L, sqrtInit, range.tickLower, range.tickUpper);
const pool = { role: 'bell', poolId: '0xaa', liquidity: String(Math.round(L)), ...range, usdgIsCurrency0: true, initSqrtPriceX96: String(sqrtX96(sqrtInit)), seed: { usdg: String(Math.round(held0.amount0)), nvda: String(Math.round(held0.amount1)) } };
const swap = (over) => ({ amount0: -10_000_000n, amount1: 60_000_000_000_000_000n, sqrtPriceX96: sqrtX96(sqrtInit), liquidity: BigInt(pool.liquidity) * 2n, tick: 225000, fee: 3000, block: 1, tx: '0x01', ts: 1_794_000_000, ref: 160, from: '0xbot', ...over });
const opts = { decimals: dec, startRef: 160, endRef: 160, botAddresses: ['0xbot'], windowStart: 1_794_000_000, windowEnd: 1_794_100_000 };

test('a position gives back the amounts it was made from, and no swaps means no gain or loss', () => {
  const back = positionAmounts(L, sqrtInit, range.tickLower, range.tickUpper);
  assert.ok(Math.abs(back.amount0 - Number(pool.seed.usdg)) < 1e-6 * Number(pool.seed.usdg));
  const r = computePool(pool, [], opts);
  assert.ok(Math.abs(r.valueVsHold) < 1e-6);
  assert.equal(r.swaps, 0);
});

test('fees are the input times the fee rate, times the position share of the pool', () => {
  const r = computePool(pool, [swap({})], opts);
  assert.ok(Math.abs(r.feesEarned - 10 * 0.003 * 0.5) < 1e-6, `fees ${r.feesEarned}`); // share is one half
  assert.equal(r.rows[0].feePips, 3000);
  assert.equal(r.rows[0].kind, 'bot');
});

test('LVR is positive when the LP sold NVDA below the reference price and negative when it sold above it', () => {
  // 10 USDG in at fee 0.3% buys 0.0625 NVDA: execution price 159.52 after the fee, against a reference of 170.
  const cheap = computePool(pool, [swap({ amount1: 62_500_000_000_000_000n, ref: 170 })], { ...opts, endRef: 170 });
  assert.ok(cheap.lvr > 0);
  const dear = computePool(pool, [swap({ amount1: 60_000_000_000_000_000n, ref: 150 })], { ...opts, endRef: 150 });
  assert.ok(dear.lvr < 0);
});

test('a swap while the pool tick is outside the position range earns the LP nothing', () => {
  const r = computePool(pool, [swap({ tick: 230000 })], opts);
  assert.equal(r.feesEarned, 0);
  assert.equal(r.lvr, 0);
});

test('session buckets and organic versus bot flow are counted separately', () => {
  const r = computePool(pool, [swap({}), swap({ from: '0xalice', tx: '0x02', ts: 1_794_000_100 })], opts);
  assert.equal(r.botSwaps, 1);
  assert.equal(r.organicSwaps, 1);
  assert.equal(Object.values(r.sessions).reduce((n, s) => n + s.swaps, 0), 2);
});

test('the gap is BELL minus the control in bps of capital', () => {
  assert.deepEqual(compare({ netBps: 12.5 }, { netBps: -3 }), { gapBps: 15.5, winner: 'BELL' });
  assert.equal(compare({ netBps: -1 }, { netBps: 4 }).winner, 'CONTROL');
});

test('a real mainnet Swap log decodes with the swapper-side signs', () => {
  const log = { topics: [SWAP_TOPIC, '0x8a96c3e3ef5a1cca5c4db6254b3451b959877c2595fed7b04c124eb9d3bfffef', '0x000000000000000000000000178d78419e8b7cd1f5e1e4a65f71d86c7f6516d5'],
    data: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd8f0000000000000000000000000000000000000000000000000000036b66b30a5ea0000000000000000000000000000000000012ebe5715d77b686cfc2cbd858b9100000000000000000000000000000000000000000000000000000027e8dad9e70000000000000000000000000000000000000000000000000000000000036f940000000000000000000000000000000000000000000000000000000000000bb8',
    blockNumber: '0x6e70956', transactionHash: '0xc777a11989dc6d59933440ee81f25f854da2ae3aa9555e13628f95cb2f3b9891', logIndex: '0xd' };
  const s = decodeSwap(log);
  assert.equal(s.amount0, -10000n);
  assert.equal(s.amount1, 60157110298090n);
  assert.equal(s.fee, 3000);
  assert.equal(s.tick, 225172);
  assert.ok(sqrtAtTick(225172) > 0);
});

import { readFileSync } from 'node:fs';
const v3 = JSON.parse(readFileSync(new URL('../components/einstein/v3-evolve-proof.json', import.meta.url), 'utf8'));
const v3Source = JSON.parse(readFileSync(new URL('../../../evidence/einstein/v3-evolve/proof.json', import.meta.url), 'utf8'));

test('the v3 Evolve page reads the same proof file that the script builds', () => {
  assert.deepEqual(v3.claims, v3Source.claims);
  assert.deepEqual(v3.runs.map((r) => [r.id, r.status]), v3Source.runs.map((r) => [r.id, r.status]));
});

test('v3 Evolve proof covers E1 to E9 and a run that has not started carries no result', () => {
  assert.deepEqual(v3.claims.map((c) => c.id), ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9']);
  for (const run of v3.runs) {
    if (run.status === 'scheduled') { assert.equal(run.result, undefined); assert.equal(run.replay, undefined); }
    else { assert.ok(run.result && run.config, `run ${run.id} is ${run.status} but has no result or config`); }
  }
  assert.ok(v3.limits.some((l) => /BELL loses a run/.test(l)), 'the limits must say a loss is shown as a loss');
});
