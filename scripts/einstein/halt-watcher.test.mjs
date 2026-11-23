import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, readQuote, CONFIRMATIONS, RENEW_BEFORE_SECONDS } from './halt-watcher.mjs';

const fresh = (halted) => ({ halted, ageSeconds: 5 });
const NOW = 1_800_000_000;
const normal = { phase: 'NORMAL', haltedUntil: 0 };
const halted = (until) => ({ phase: 'HALTED', haltedUntil: until });

test('a halt is recorded only after the confirmations in a row', () => {
  assert.equal(decide({ obs: fresh(true), registry: normal, streak: 1, now: NOW }).action, 'none');
  assert.equal(decide({ obs: fresh(true), registry: normal, streak: CONFIRMATIONS, now: NOW }).action, 'halt');
});

test('a halt flag is also acted on while the registry is in the resume window', () => {
  assert.equal(decide({ obs: fresh(true), registry: { phase: 'RESUME_AUCTION', haltedUntil: NOW + 100 }, streak: CONFIRMATIONS, now: NOW }).action, 'halt');
});

test('resume needs the confirmations too, and only when the registry is HALTED', () => {
  assert.equal(decide({ obs: fresh(false), registry: halted(NOW + 6000), streak: 1, now: NOW }).action, 'none');
  assert.equal(decide({ obs: fresh(false), registry: halted(NOW + 6000), streak: CONFIRMATIONS, now: NOW }).action, 'resume');
  assert.equal(decide({ obs: fresh(false), registry: normal, streak: 9, now: NOW }).action, 'none');
});

test('a halt that is still on is renewed shortly before the registry would lapse, not before', () => {
  assert.equal(decide({ obs: fresh(true), registry: halted(NOW + RENEW_BEFORE_SECONDS + 60), streak: 5, now: NOW }).action, 'none');
  assert.equal(decide({ obs: fresh(true), registry: halted(NOW + RENEW_BEFORE_SECONDS - 1), streak: 5, now: NOW }).action, 'renew');
});

test('a missing, failed or stale quote never causes an action', () => {
  for (const obs of [{ halted: null, ageSeconds: null }, { halted: true, ageSeconds: 61 }, { halted: false, ageSeconds: null }]) {
    for (const registry of [normal, halted(NOW + 10), { phase: 'RESUME_AUCTION', haltedUntil: NOW + 10 }]) {
      assert.equal(decide({ obs, registry, streak: 99, now: NOW }).action, 'none');
    }
  }
});

test('readQuote reads the halt flag and the age, and treats every failure as unavailable', async () => {
  const ok = await readQuote('ANT', async () => ({ ok: true, json: async () => ({ quotes: [{ isTradingHalt: true, generatedAt: new Date(NOW * 1000 - 12_000).toISOString() }] }) }), NOW * 1000);
  assert.deepEqual([ok.halted, ok.ageSeconds], [true, 12]);
  assert.equal((await readQuote('ANT', async () => ({ ok: false, status: 503 }))).halted, null);
  assert.equal((await readQuote('ANT', async () => { throw new Error('dns'); })).halted, null);
  assert.equal((await readQuote('ANT', async () => ({ ok: true, json: async () => ({ quotes: [{ tokenBid: '1' }] }) }))).halted, null);
});
