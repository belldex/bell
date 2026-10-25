import test from 'node:test';
import assert from 'node:assert/strict';
import { planBoundedLogRanges } from '../src/log-planner.mjs';

test('plans inclusive log ranges of at most ten blocks across no more than two shards', () => {
  const result = planBoundedLogRanges([
    { id: 'project', fromBlock: 100n, toBlock: 125n },
    { id: 'core', fromBlock: 100n, toBlock: 125n },
  ]);
  assert.equal(result.calls.length, 6);
  assert.ok(result.calls.every(({ fromBlock, toBlock }) => toBlock - fromBlock + 1n <= 10n));
  assert.equal(result.complete, true);
});

test('bounded calls advance cursors without holes when backlog exceeds one invocation', () => {
  const ranges = [];
  let shards = [{ id: 'project', fromBlock: 1n, toBlock: 250n }, { id: 'core', fromBlock: 1n, toBlock: 250n }];
  while (shards.some(({ fromBlock, toBlock }) => fromBlock <= toBlock)) {
    const plan = planBoundedLogRanges(shards, { maxCalls: 24, maxRange: 10 });
    ranges.push(...plan.calls);
    shards = plan.nextShards;
  }
  for (const id of ['project', 'core']) {
    const selected = ranges.filter((range) => range.shardId === id);
    assert.equal(selected.length, 25);
    assert.equal(selected[0].fromBlock, 1n);
    assert.equal(selected.at(-1).toBlock, 250n);
    for (let index = 1; index < selected.length; index += 1) {
      assert.equal(selected[index].fromBlock, selected[index - 1].toBlock + 1n);
    }
  }
});

test('rejects unbounded filters and invalid range/call limits instead of truncating coverage', () => {
  assert.throws(() => planBoundedLogRanges([{ id: '1', fromBlock: 0n, toBlock: 1n }, { id: '2', fromBlock: 0n, toBlock: 1n }, { id: '3', fromBlock: 0n, toBlock: 1n }]), /two|shard/i);
  assert.throws(() => planBoundedLogRanges([{ id: 'x', fromBlock: 2n, toBlock: 1n }]), /range/i);
  assert.throws(() => planBoundedLogRanges([{ id: 'x', fromBlock: 0n, toBlock: 10n }], { maxCalls: 25 }), /24/i);
});
