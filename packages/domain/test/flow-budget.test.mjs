import test from 'node:test';
import assert from 'node:assert/strict';
import { FlowBudget } from '../src/flow-budget.mjs';

const budget = () => new FlowBudget({
  tradeCap: [1000n, 1000n],
  windowCap: [2000n, 2000n],
});

test('counts gross flow in both directions without a reversal refund', () => {
  const flow = budget();
  assert.equal(flow.consume(1, -1000n, 1000n, 'REGULAR'), true);
  assert.equal(flow.consume(2, 1000n, -1000n, 'REGULAR'), true);
  assert.equal(flow.consume(3, -1n, 1n, 'REGULAR'), false);
});

test('retains the previous 300-second bucket at a one-epoch boundary', () => {
  const flow = new FlowBudget({ tradeCap: [1000n, 1000n], windowCap: [3000n, 3000n] });
  assert.equal(flow.consume(299, -1000n, 1000n, 'REGULAR'), true);
  assert.equal(flow.consume(300, -1000n, 1000n, 'REGULAR'), true);
  assert.equal(flow.consume(599, -1000n, 1000n, 'REGULAR'), true);
  assert.equal(flow.consume(599, -1n, 1n, 'REGULAR'), false);
});

test('tightening the session cap does not erase existing gross history', () => {
  const flow = budget();
  assert.equal(flow.consume(10, -1000n, 1000n, 'REGULAR'), true);
  assert.equal(flow.consume(11, -1n, 1n, 'PRE'), false);
});

test('a rejected two-currency candidate leaves both counters unchanged', () => {
  const flow = budget();
  assert.equal(flow.consume(10, -1000n, 1000n, 'REGULAR'), true);
  const before = flow.snapshot();
  assert.equal(flow.consume(11, -1n, 5000n, 'REGULAR'), false);
  assert.deepEqual(flow.snapshot(), before);
});

test('rejects zero fills, unsafe numeric inputs, and backward time', () => {
  const flow = budget();
  assert.equal(flow.consume(1, 0n, 1n, 'REGULAR'), false);
  assert.equal(flow.consume(1, 1, -1, 'REGULAR'), false);
  assert.equal(flow.consume(2, 1n, -1n, 'REGULAR'), true);
  assert.throws(() => flow.consume(1, 1n, -1n, 'REGULAR'), /time/i);
});

test('rejects BalanceDelta values outside int128 while safely widening the signed minimum', () => {
  const signedMinimumFlow = new FlowBudget({ tradeCap: [1n << 127n, 10n], windowCap: [1n << 127n, 10n] });
  assert.equal(signedMinimumFlow.consume(1, -(1n << 127n), 1n, 'REGULAR'), true);
  const flow = budget();
  assert.equal(flow.consume(1, 1n << 127n, 1n, 'REGULAR'), false);
});
