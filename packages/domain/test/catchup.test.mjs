import test from 'node:test';
import assert from 'node:assert/strict';
import { measureHeadroom, catchupPlan, INDEX_LAGGING_THRESHOLD_SECONDS } from '../src/catchup.mjs';

test('head rate that does not fit the pinned planner budget fails admission loudly', () => {
  const fits = measureHeadroom({ measuredHeadRatePerMinute: 100, chunkSize: 10, shardCount: 2 });
  assert.equal(fits.fits, true); // 10*2 = 20 calls/min <= 24
  const over = measureHeadroom({ measuredHeadRatePerMinute: 200, chunkSize: 10, shardCount: 2 });
  assert.equal(over.fits, false); // 20*2 = 40 calls/min > 24
  assert.equal(over.deficit, 16);
});

test('the 48 small-range calls scenario is not claimed as sufficient', () => {
  const plan = measureHeadroom({ measuredHeadRatePerMinute: 480, chunkSize: 1, shardCount: 1 });
  assert.equal(plan.fits, false); // 48 calls/min vs 24 budget
});

test('lag beyond 120 seconds reports INDEX_LAGGING, not a silent OK', () => {
  const ok = catchupPlan({ backlogBlocks: 10, maxBackfillPerMinute: 60, now: 300_000, lastIndexedAt: 280_000 });
  assert.equal(ok.status, 'OK');
  const lag = catchupPlan({ backlogBlocks: 5000, maxBackfillPerMinute: 60, now: 400_000, lastIndexedAt: 250_000 });
  assert.equal(lag.lagSeconds, 150);
  assert.equal(lag.status, 'INDEX_LAGGING');
  assert.ok(INDEX_LAGGING_THRESHOLD_SECONDS === 120);
});

test('keeper reserve is protected from backfill consumption', () => {
  const plan = catchupPlan({ backlogBlocks: 1000, maxBackfillPerMinute: 60, keeperReservePerMinute: 12, now: 1000_000, lastIndexedAt: 990_000 });
  assert.equal(plan.clearMinutes, Math.ceil(1000 / 48));
  assert.throws(() => catchupPlan({ backlogBlocks: 1, maxBackfillPerMinute: 10, keeperReservePerMinute: 20, now: 0, lastIndexedAt: 0 }), /within the backfill budget/);
});

test('inputs are validated', () => {
  assert.throws(() => measureHeadroom({ measuredHeadRatePerMinute: -1, chunkSize: 1, shardCount: 1 }), /non-negative/);
  assert.throws(() => catchupPlan({ backlogBlocks: -1, maxBackfillPerMinute: 1, now: 0, lastIndexedAt: 0 }), /non-negative/);
});