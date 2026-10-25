import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTaskStatus } from './sync-task-status.mjs';
import { validateTaskStatus } from './check-release.mjs';

const catalog = [{ id: 'M00-01', title: 'Baseline' }, { id: 'M00-02', title: 'Toolchain' }];

test('preserves status and evidence for existing tasks while adding new tasks as NOT_STARTED', () => {
  const result = mergeTaskStatus(catalog, {
    tasks: { 'M00-01': { status: 'IN_PROGRESS', evidence: ['config/release-baseline.json'] } },
  });
  assert.deepEqual(result, {
    'M00-01': { title: 'Baseline', status: 'IN_PROGRESS', evidence: ['config/release-baseline.json'], blockers: [] },
    'M00-02': { title: 'Toolchain', status: 'NOT_STARTED', evidence: [], blockers: [] },
  });
});

test('accepts explicit updates and refuses unknown IDs or status names', () => {
  const result = mergeTaskStatus(catalog, { tasks: {} }, {
    'M00-02': { status: 'BLOCKED_DEPENDENCY', blockers: ['Foundry unavailable'] },
  });
  assert.equal(result['M00-02'].status, 'BLOCKED_DEPENDENCY');
  assert.deepEqual(result['M00-02'].blockers, ['Foundry unavailable']);
  assert.throws(() => mergeTaskStatus(catalog, { tasks: {} }, { 'M99-99': { status: 'DONE' } }), /unknown/i);
  assert.throws(() => mergeTaskStatus(catalog, { tasks: {} }, { 'M00-01': { status: 'SKIPPED' } }), /status/i);
});

test('release check requires the complete 80-task catalog and known statuses', () => {
  const taskStatus = {
    planTaskCount: 1,
    implementationPlanSha256: 'c'.repeat(64),
    tasks: { 'M00-01': { title: 'Baseline', status: 'NOT_STARTED', evidence: [], blockers: [] } },
  };
  const expected = [{ id: 'M00-01', title: 'Baseline' }];
  assert.equal(validateTaskStatus(taskStatus, expected, 'c'.repeat(64)), true);
  assert.throws(() => validateTaskStatus(taskStatus, 80, 'c'.repeat(64)), /80|task/i);
  assert.throws(() => validateTaskStatus({ ...taskStatus, tasks: { 'M00-01': { status: 'SKIPPED' } } }, expected, 'c'.repeat(64)), /status/i);
  assert.throws(() => validateTaskStatus({ ...taskStatus, tasks: { 'M00-01': { title: 'Baseline', status: 'DONE', evidence: [], blockers: [] } } }, expected, 'c'.repeat(64)), /evidence/i);
  assert.throws(() => validateTaskStatus({ ...taskStatus, tasks: { 'M00-01': { title: 'Baseline', status: 'BLOCKED_ACCESS', evidence: [], blockers: [] } } }, expected, 'c'.repeat(64)), /blocker/i);
  assert.throws(() => validateTaskStatus({ ...taskStatus, tasks: { 'M00-02': { title: 'Forged task', status: 'NOT_STARTED', evidence: [], blockers: [] } } }, expected, 'c'.repeat(64)), /catalog|task id|title/i);
});
