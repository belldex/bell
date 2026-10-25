import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateCronCall, runKeeperTick, isNoOpTick } from '../src/keeper-tick.mjs';
import { LeaseGuard } from '../src/jobs.mjs';

const store = () => ({
  async acquire({ ttlSeconds }) { return { fence: 1, expiresAt: Date.now() + ttlSeconds * 1000 }; },
  async renew() { return true; },
  async release() {},
});

test('cron auth uses length-then-content comparison and rejects missing tokens', () => {
  assert.equal(authenticateCronCall({ headerToken: 'abc', expectedToken: 'abc' }), true);
  assert.equal(authenticateCronCall({ headerToken: 'abd', expectedToken: 'abc' }), false);
  assert.equal(authenticateCronCall({ headerToken: undefined, expectedToken: 'abc' }), false);
  assert.equal(authenticateCronCall({ headerToken: 'abcd', expectedToken: 'abc' }), false);
});

test('duplicate invocation skips already-fresh work without sending transactions', async () => {
  const g = new LeaseGuard({ chainId: 1, jobKind: 'tick', ownerToken: '0x' + 'a'.repeat(64), store: store() });
  let submits = 0;
  const results = await runKeeperTick({
    lease: g,
    now: 1000,
    clockNow: () => 1001,
    dueWork: [{ id: 'w1', alreadyFresh: true }],
    submit: () => { submits += 1; return { txHash: '0x' + '1'.repeat(64) }; },
  });
  assert.equal(submits, 0);
  assert.deepEqual(results.skipped, [{ id: 'w1', reason: 'ALREADY_FRESH' }]);
  assert.equal(isNoOpTick(results), true);
});

test('application deadline stops new submissions mid-batch', async () => {
  const g = new LeaseGuard({ chainId: 1, jobKind: 'tick', ownerToken: '0x' + 'a'.repeat(64), store: store() });
  const submitted = [];
  const results = await runKeeperTick({
    lease: g,
    now: Date.now(),
    deadlineSeconds: 0, // expires immediately
    clockNow: () => Date.now() + 1,
    dueWork: [{ id: 'w1' }, { id: 'w2' }],
    submit: (work) => { submitted.push(work.id); return {}; },
  });
  assert.deepEqual(submitted, []);
  assert.equal(results.skipped.length, 2);
  assert.equal(results.skipped[0].reason, 'DEADLINE');
});

test('receipt polling runs before submissions and lost leases abort the tick', async () => {
  const g = new LeaseGuard({ chainId: 1, jobKind: 'tick', ownerToken: '0x' + 'a'.repeat(64), store: store() });
  const order = [];
  const results = await runKeeperTick({
    lease: g,
    now: 1000,
    clockNow: () => 1001,
    dueWork: [{ id: 'w1' }],
    pollReceipts: async () => { order.push('poll'); return []; },
    submit: () => { order.push('submit'); return {}; },
  });
  assert.deepEqual(order, ['poll', 'submit']);
  const hostile = new LeaseGuard({ chainId: 1, jobKind: 'tick', ownerToken: '0x' + 'a'.repeat(64),
    store: { async acquire() { return { fence: 1, expiresAt: Date.now() - 1000 }; }, async renew() { return false; }, async release() {} } });
  await assert.rejects(() => runKeeperTick({ lease: hostile, now: Date.now(), dueWork: [{ id: 'w1' }], submit: () => ({}) }), /expired/);
});