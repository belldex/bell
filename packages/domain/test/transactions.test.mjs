import test from 'node:test';
import assert from 'node:assert/strict';
import { NonceLedger } from '../src/transactions.mjs';

const H = (n) => '0x' + n.toString(16).padStart(64, '0');
const ledger = (over = {}) => new NonceLedger({ signer: '0x' + '11'.repeat(20), ...over });
const signed = (l, nonce, over = {}) => l.recordSigned({
  nonce,
  txHash: H(nonce),
  signedBytes: '0x02f8' + nonce.toString(16).padStart(4, '0'),
  action: 'submitReports',
  maxFeePerGas: 1_000_000_000n,
  ...over,
});

test('records signed bytes before any broadcast and exposes them for recovery', () => {
  const l = ledger();
  signed(l, 7n);
  assert.deepEqual(l.nextAction(7n), { action: 'BROADCAST', txHash: H(7n), signedBytes: l.pending()[0].signedBytes });
});

test('broadcast retry replays identical bytes and never resets the first broadcast time', () => {
  const l = ledger();
  signed(l, 1n);
  l.markBroadcast(1n, { now: 100 });
  l.markBroadcast(1n, { now: 200 });
  const action = l.nextAction(1n);
  assert.equal(action.action, 'POLL_RECEIPT');
  assert.equal(action.attempts, 2);
  assert.equal(l.pending()[0].firstBroadcastAt, 100);
});

test('timeout is not treated as failure: duplicate invocation cannot re-sign the nonce', () => {
  const l = ledger();
  signed(l, 2n);
  l.markBroadcast(2n, { now: 1 });
  assert.throws(() => signed(l, 2n), /already has/);
});

test('replacement keeps the nonce and strictly raises the fee', () => {
  const l = ledger();
  signed(l, 3n);
  l.markBroadcast(3n, { now: 1 });
  const plan = l.planReplacement(3n, { newMaxFeePerGas: 2_000_000_000n });
  assert.equal(plan.nonce, 3n);
  l.markReplaced(3n, { txHash: H(0xabc), signedBytes: '0x02f9beef', maxFeePerGas: 2_000_000_000n });
  assert.equal(l.nextAction(3n).txHash, H(0xabc));
  assert.throws(() => l.planReplacement(3n, { newMaxFeePerGas: 2_000_000_000n }), /strictly exceed/);
});

test('replacement budget is bounded so a lost lease cannot create a nonce gap', () => {
  const l = ledger({ maxRetries: 2 });
  signed(l, 4n);
  l.markBroadcast(4n, { now: 1 });
  l.markBroadcast(4n, { now: 2 });
  l.markBroadcast(4n, { now: 3 });
  assert.throws(() => l.planReplacement(4n, { newMaxFeePerGas: 5_000_000_000n }), /budget exhausted/);
  assert.equal(l.nextAction(4n).action, 'ESCALATE');
});

test('crash matrix: after-sign before-broadcast still broadcasts the same bytes', () => {
  const l = ledger();
  signed(l, 5n);
  // process died before markBroadcast; recovery reads durable state
  assert.equal(l.nextAction(5n).action, 'BROADCAST');
  assert.equal(l.nextAction(5n).signedBytes, l.pending()[0].signedBytes);
});

test('crash matrix: after-broadcast before receipt reconciles from chain evidence', () => {
  const l = ledger();
  signed(l, 6n);
  l.markBroadcast(6n, { now: 1 });
  l.reconcile({ pendingNonce: 7n, latestNonce: 7n });
  assert.equal(l.nextAction(6n).state, 'MINED_UNKNOWN_STATUS');
  assert.equal(l.allocate(), 7n);
});

test('reconcile marks confirmed receipts and reverts reorged mining back to broadcast', () => {
  const l = ledger();
  signed(l, 10n);
  l.markBroadcast(10n, { now: 1 });
  l.reconcile({ pendingNonce: 11n, latestNonce: 12n, confirmedHashes: [H(10n)] });
  assert.equal(l.nextAction(10n).state, 'MINED_SUCCESS');

  const l2 = ledger();
  signed(l2, 10n);
  l2.markBroadcast(10n, { now: 1 });
  l2.reconcile({ pendingNonce: 11n, latestNonce: 12n, confirmedHashes: [H(10n)] });
  l2.reconcile({ pendingNonce: 10n, latestNonce: 11n, reorgedHashes: [H(10n)] });
  assert.equal(l2.nextAction(10n).action, 'POLL_RECEIPT');
});

test('reconcile adopts a higher chain nonce without violating the local high-water mark', () => {
  const l = ledger();
  signed(l, 2n);
  assert.throws(() => signed(l, 1n), /below the reconciled high-water/);
  l.reconcile({ pendingNonce: 9n, latestNonce: 9n });
  assert.equal(l.allocate(), 9n);
});

test('reconcile rejects impossible pending values', () => {
  const l = ledger();
  assert.throws(() => l.reconcile({ pendingNonce: 10n, latestNonce: 5n }), /cannot exceed/);
});

test('mined transactions leave the pending set', () => {
  const l = ledger();
  signed(l, 1n);
  l.markBroadcast(1n, { now: 1 });
  l.markMined(1n, { status: 1n });
  assert.deepEqual(l.pending(), []);
  assert.equal(l.nextAction(1n).action, 'DONE');
  assert.equal(l.nextAction(1n).state, 'MINED_SUCCESS');
});

test('constructor validates signer and retry bounds', () => {
  assert.throws(() => new NonceLedger({ signer: 'nope' }), /20-byte/);
  assert.throws(() => new NonceLedger({ signer: '0x' + '11'.repeat(20), maxRetries: 0 }), /maxRetries/);
});
