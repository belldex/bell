import test from 'node:test';
import assert from 'node:assert/strict';
import { planTick, MAX_REPORTS_PER_BATCH } from '../src/scheduler.mjs';

const t = (id, kind, deadline, over = {}) => ({ id, kind, assetId: 'a1', feedId: 'f1', deadline, ...over });

test('pause/corporate beats capture/reopen beats freshness beats housekeeping regardless of deadline', () => {
  const plan = planTick({
    now: 1000,
    tasks: [
      t('house', 'HOUSEKEEPING', 10),
      t('fresh', 'FRESHNESS', 20),
      t('reopen', 'REOPEN', 30),
      t('pause', 'PAUSE', 40),
    ],
  });
  assert.deepEqual(plan.due.map((x) => x.id), ['pause', 'reopen', 'fresh', 'house']);
});

test('earliest deadline wins within a priority so stale continuity is not starved by new data', () => {
  const plan = planTick({
    now: 1000,
    tasks: [
      t('new-data', 'FRESHNESS', 5_000),
      t('stale-old', 'FRESHNESS', 1_100),
    ],
  });
  assert.deepEqual(plan.due.map((x) => x.id), ['stale-old', 'new-data']);
});

test('identical observations are deduplicated across pools and reuse is recorded', () => {
  const plan = planTick({
    now: 1000,
    tasks: [
      t('pool-a', 'FRESHNESS', 2_000, { observationHash: 'obs1' }),
      t('pool-b', 'FRESHNESS', 3_000, { observationHash: 'obs1' }),
    ],
  });
  assert.equal(plan.due.length, 1);
  assert.equal(plan.deduped, 1);
  assert.deepEqual(plan.due[0].reusedBy, ['pool-b']);
});

test('dedup keeps the more urgent variant of the same observation', () => {
  const plan = planTick({
    now: 1000,
    tasks: [
      t('fresh-a', 'FRESHNESS', 2_000, { observationHash: 'obs1' }),
      t('corp-a', 'CORPORATE', 1_500, { observationHash: 'obs1' }),
    ],
  });
  assert.equal(plan.due[0].kind, 'CORPORATE');
  assert.deepEqual(plan.due[0].reusedBy, ['fresh-a']);
});

test('batch is capped at six reports per submission', () => {
  const tasks = Array.from({ length: 10 }, (_, i) => t(`fresh-${i}`, 'FRESHNESS', 2_000 + i, { observationHash: `obs${i}` }));
  const plan = planTick({ now: 1000, tasks });
  assert.equal(MAX_REPORTS_PER_BATCH, 6);
  assert.equal(plan.due.length, 6);
  assert.equal(plan.deferred.length, 4);
  assert.equal(plan.fetchPlan.batchCount, 1);
});

test('a task that does not fit the byte budget is deferred, never silently dropped', () => {
  const plan = planTick({
    now: 1000,
    maxBytes: 500,
    tasks: [
      t('big', 'PAUSE', 1_200, { bytes: 800 }),
      t('small', 'FRESHNESS', 1_100, { bytes: 100 }),
    ],
  });
  assert.deepEqual(plan.due.map((x) => x.id), ['small']);
  assert.deepEqual(plan.deferred, ['big']);
});

test('missed ticks are skipped once instead of replaying a catch-up storm', () => {
  const plan = planTick({ now: 9_000, dueTick: 6_000, tasks: [t('f', 'FRESHNESS', 9_500)] });
  assert.equal(plan.missedTicks, 1);
  assert.equal(plan.due.length, 1);
});

test('fetch concurrency is bounded and never exceeds the selected work', () => {
  const tasks = Array.from({ length: 3 }, (_, i) => t(`f${i}`, 'FRESHNESS', 2_000 + i, { observationHash: `o${i}` }));
  const plan = planTick({ now: 1000, tasks, maxConcurrency: 8 });
  assert.equal(plan.fetchPlan.concurrency, 3);
  const plan2 = planTick({ now: 1000, tasks, maxConcurrency: 2 });
  assert.equal(plan2.fetchPlan.concurrency, 2);
});

test('invalid tasks are rejected before planning', () => {
  assert.throws(() => planTick({ now: 1, tasks: [{ id: 'x', kind: 'NOPE', assetId: 'a', deadline: 1 }] }), /not schedulable/);
  assert.throws(() => planTick({ now: 1, tasks: [{ id: 'x', kind: 'PAUSE', assetId: 'a', deadline: 'soon' }] }), /safe integer/);
  assert.throws(() => planTick({ now: 'now', tasks: [] }), /safe integer/);
});
