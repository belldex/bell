import test from 'node:test';
import assert from 'node:assert/strict';
import { statusSnapshot } from '../src/ops-status.mjs';

test('admission is ADMITTING only when index, quota and incidents are clean', () => {
  const clean = statusSnapshot({
    quotaSnapshot: [{ scope: 's', resource: 'rpc', period: 0, estimated: 5, observed: 0, inFlight: 1 }],
    catchup: { status: 'OK', lagSeconds: 30 },
    rpcProxy: { allowlistSize: 9, blocked: false },
    incidentCount: 0, generatedAt: 1,
  });
  assert.equal(clean.admission, 'ADMITTING');
  const throttled = statusSnapshot({
    quotaSnapshot: [],
    catchup: { status: 'INDEX_LAGGING', lagSeconds: 150 },
    rpcProxy: { allowlistSize: 9, blocked: false },
    incidentCount: 0, generatedAt: 1,
  });
  assert.equal(throttled.admission, 'THROTTLED');
  const inc = statusSnapshot({ quotaSnapshot: [], catchup: { status: 'OK', lagSeconds: 1 }, rpcProxy: { allowlistSize: 9, blocked: false }, incidentCount: 2, generatedAt: 1 });
  assert.equal(inc.admission, 'THROTTLED');
});

test('dashboard is derived state and exposes quota busy states', () => {
  const snap = statusSnapshot({
    quotaSnapshot: [{ scope: 'keeper', resource: 'rpc', period: 0, estimated: 90, observed: 90, inFlight: 2 }],
    catchup: { status: 'OK', lagSeconds: 5 },
    rpcProxy: { allowlistSize: 9, blocked: true },
    incidentCount: 0, generatedAt: 42,
  });
  assert.equal(snap.quotas[0].state, 'BUSY');
  assert.equal(snap.rpcProxy.blocked, true);
  assert.match(snap.note, /not an authorization source/);
});

test('inputs are validated', () => {
  assert.throws(() => statusSnapshot({ quotaSnapshot: 'x', catchup: {}, incidentCount: 0, generatedAt: 1 }), /array/);
  assert.throws(() => statusSnapshot({ quotaSnapshot: [], catchup: {}, incidentCount: -1, generatedAt: 1 }), /non-negative/);
});