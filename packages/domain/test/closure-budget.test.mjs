import test from 'node:test';
import assert from 'node:assert/strict';
import { ClosureBudget } from '../src/closure-budget.mjs';

const makeBudget = () => new ClosureBudget([500n, 500n], 2);

test('planned closure creates one episode and repeated closure checkpoints do not refill it', () => {
  const closure = makeBudget();
  assert.equal(closure.enterPlannedClosure(), 1n);
  assert.equal(closure.consume(100n, 100n), true);
  assert.equal(closure.enterPlannedClosure(), 1n);
  assert.equal(closure.consume(400n, 400n), true);
  assert.equal(closure.consume(1n, 1n), false);
});

test('unexpected closure never creates a new episode', () => {
  const closure = makeBudget();
  assert.equal(closure.enterUnexpectedClosure(), false);
  assert.equal(closure.snapshot().closureNonce, 0n);
});

test('partial reopen and duplicate observations cannot release the episode ledger', () => {
  const closure = makeBudget();
  closure.enterPlannedClosure();
  closure.consume(200n, 200n);
  assert.equal(closure.checkpointOpen({ now: 100, observations: [100, 100], oldValidUntil: 200, validUntil: 220, healthy: true, allStocksOpen: false }), false);
  assert.equal(closure.checkpointOpen({ now: 120, observations: [120, 100], oldValidUntil: 200, validUntil: 240, healthy: true, allStocksOpen: true }), false);
  assert.equal(closure.checkpointOpen({ now: 160, observations: [120, 100], oldValidUntil: 240, validUntil: 280, healthy: true, allStocksOpen: true }), false);
  assert.equal(closure.snapshot().latched, true);
  assert.deepEqual(closure.snapshot().episodeGross, ['200', '200']);
});

test('all stocks need new observations across a 60-second recovery before next episode', () => {
  const closure = makeBudget();
  closure.enterPlannedClosure();
  closure.consume(500n, 500n);
  assert.equal(closure.checkpointOpen({ now: 100, observations: [100, 100], oldValidUntil: 200, validUntil: 220, healthy: true, allStocksOpen: true }), false);
  assert.equal(closure.checkpointOpen({ now: 160, observations: [160, 100], oldValidUntil: 220, validUntil: 280, healthy: true, allStocksOpen: true }), false);
  assert.equal(closure.checkpointOpen({ now: 161, observations: [161, 161], oldValidUntil: 280, validUntil: 281, healthy: true, allStocksOpen: true }), true);
  assert.equal(closure.snapshot().latched, false);
  assert.equal(closure.enterPlannedClosure(), 2n);
});

test('validity gap restarts recovery without clearing the old episode budget', () => {
  const closure = makeBudget();
  closure.enterPlannedClosure();
  closure.consume(100n, 100n);
  closure.checkpointOpen({ now: 100, observations: [100, 100], oldValidUntil: 200, validUntil: 220, healthy: true, allStocksOpen: true });
  assert.equal(closure.checkpointOpen({ now: 201, observations: [201, 201], oldValidUntil: 200, validUntil: 321, healthy: true, allStocksOpen: true }), false);
  assert.equal(closure.snapshot().latched, true);
  assert.deepEqual(closure.snapshot().episodeGross, ['100', '100']);
});

test('limits closure caps to uint128 and widens int128 minimum deltas before absolute value', () => {
  assert.throws(() => new ClosureBudget([1n << 128n, 1n], 1), /uint128/i);
  const closure = new ClosureBudget([1n << 127n, 10n], 1);
  closure.enterPlannedClosure();
  assert.equal(closure.consume(-(1n << 127n), 1n), true);
  assert.equal(closure.consume(1n << 127n, 1n), false);
});
