import test from 'node:test';
import assert from 'node:assert/strict';
import { LeaseGuard, LeaseLostError } from '../src/jobs.mjs';

const memoryStore = () => {
  const state = { held: false, fence: 0 };
  return {
    state,
    async acquire({ ttlSeconds }) {
      if (state.held) throw new Error('LEASE_HELD');
      state.held = true;
      state.fence += 1;
      return { fence: state.fence, expiresAt: Date.now() + ttlSeconds * 1000 };
    },
    async renew({ ownerToken, fence }) {
      return state.held && state.fence === fence && ownerToken !== 'stale';
    },
    async release({ fence }) {
      if (state.fence === fence) state.held = false;
    },
  };
};

const makeGuard = (store, over = {}) => new LeaseGuard({
  chainId: 4663,
  jobKind: 'keeper-a-tick',
  ownerToken: '0x' + 'a1'.repeat(32),
  store,
  ...over,
});

test('acquire issues a monotonic fence for the same job kind', async () => {
  const store = memoryStore();
  const g1 = makeGuard(store);
  await g1.acquire();
  const fence1 = g1.fence;
  await g1.release();
  const g2 = makeGuard(store);
  await g2.acquire();
  assert.ok(g2.fence > fence1);
});

test('a held lease rejects overlapping workers', async () => {
  const store = memoryStore();
  const g1 = makeGuard(store);
  await g1.acquire();
  const g2 = makeGuard(store);
  await assert.rejects(() => g2.acquire(), /LEASE_HELD/);
  assert.equal(g2.fence, null);
});

test('renew reflects the authoritative store decision, not optimism', async () => {
  const g = makeGuard(memoryStore());
  await g.acquire();
  assert.equal(await g.renew(), true);
  const lostStore = {
    async acquire() { return { fence: 5, expiresAt: Date.now() + 1000 }; },
    async renew() { return false; },
    async release() {},
  };
  const lost = makeGuard(lostStore);
  await lost.acquire();
  assert.equal(await lost.renew(), false);
  assert.equal(lost.fence, null);
  assert.throws(() => lost.assertValid(), LeaseLostError);
});

test('work after expiry is refused: lost lease is never permission to sign', async () => {
  const g = makeGuard(memoryStore(), { ttlSeconds: 1 });
  await g.acquire();
  g.assertValid({ now: Date.now() });
  assert.throws(() => g.assertValid({ now: Date.now() + 60_000 }), /expired/);
});

test('assertValid throws without a lease and after release', async () => {
  const g = makeGuard(memoryStore());
  assert.throws(() => g.assertValid(), LeaseLostError);
  await g.acquire();
  await g.release();
  assert.throws(() => g.assertValid(), LeaseLostError);
});

test('constructor validates inputs', () => {
  assert.throws(() => new LeaseGuard({ chainId: 0, jobKind: 'k', ownerToken: '0x' + 'a'.repeat(64), store: {} }), /chainId/);
  assert.throws(() => new LeaseGuard({ chainId: 1, jobKind: 'k', ownerToken: 'nope', store: {} }), /ownerToken/);
  assert.throws(() => new LeaseGuard({ chainId: 1, jobKind: 'k', ownerToken: '0x' + 'a'.repeat(64), store: null }), /store/);
});
