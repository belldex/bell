import test from 'node:test';
import assert from 'node:assert/strict';
import { QuotaMeter, checkRpcRequest, RPC_ALLOWLIST } from '../src/quota.mjs';

const meter = () => new QuotaMeter({
  limits: { 'rpc-calls': { maxPerPeriod: 100, maxConcurrency: 2, keeperReserved: 20 } },
});

test('public traffic cannot consume the keeper reserved allowance', () => {
  const m = meter();
  for (let i = 0; i < 80; i += 1) {
    const r = m.admit({ scope: 'public', resource: 'rpc-calls', now: 0, weight: 1 });
    assert.equal(r.allowed, true);
    r.release();
  }
  const blocked = m.admit({ scope: 'public', resource: 'rpc-calls', now: 0 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'QUOTA_EXHAUSTED');
  const keeper = m.admit({ scope: 'keeper', resource: 'rpc-calls', now: 0, isKeeper: true });
  assert.equal(keeper.allowed, true);
});

test('refusal carries an explicit retry hint into the next period', () => {
  const m = meter();
  const blocked = m.admit({ scope: 's', resource: 'rpc-calls', now: 59000, weight: 101 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 1);
});

test('concurrency limit is enforced and released', () => {
  const m = meter();
  const a = m.admit({ scope: 's', resource: 'rpc-calls', now: 0 });
  const b = m.admit({ scope: 's', resource: 'rpc-calls', now: 0 });
  assert.equal(a.allowed, true);
  assert.equal(b.allowed, true);
  const c = m.admit({ scope: 's', resource: 'rpc-calls', now: 0 });
  assert.equal(c.allowed, false);
  assert.equal(c.reason, 'CONCURRENCY');
  a.release();
  const d = m.admit({ scope: 's', resource: 'rpc-calls', now: 0 });
  assert.equal(d.allowed, true);
});

test('reconcile adopts the larger observed vendor number', () => {
  const m = meter();
  m.admit({ scope: 's', resource: 'rpc-calls', now: 0, weight: 10 });
  const r = m.reconcile({ scope: 's', resource: 'rpc-calls', period: 0, observed: 50 });
  assert.deepEqual(r, { estimated: 50, observed: 50 });
});

test('rpc proxy allowlist blocks arbitrary signing, deploy, trace and flood', () => {
  assert.equal(checkRpcRequest({ method: 'eth_sendRawTransaction', params: [] }).allowed, false);
  assert.equal(checkRpcRequest({ method: 'debug_traceTransaction', params: [] }).allowed, false);
  assert.equal(checkRpcRequest({ method: 'eth_call', params: [{ to: 'not-a-contract' }] }).allowed, false);
  assert.equal(checkRpcRequest({ method: 'eth_call', params: [{ to: '0x' + 'ab'.repeat(20) }] }).allowed, true);
  assert.equal(checkRpcRequest({ method: 'eth_getLogs', params: [{ topics: ['0x1', '0x2', '0x3', '0x4', '0x5'] }] }).allowed, false);
  assert.equal(checkRpcRequest({ method: 'eth_chainId', params: [] }).allowed, true);
  assert.equal(checkRpcRequest({ method: 'eth_blockNumber', params: [], sizeBytes: 999999 }).allowed, false);
});

test('unknown resource is a hard error, never a silent allow', () => {
  assert.throws(() => meter().admit({ scope: 's', resource: 'nope', now: 0 }), /unknown resource/);
});