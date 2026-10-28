import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskCatalog } from './task-catalog.mjs';

test('extracts stable task IDs and titles from the implementation plan', () => {
  const tasks = parseTaskCatalog([
    '#### M00-01 · Record the baseline and mandate limits',
    'not a task',
    '#### M15-05 · Hand over operations and the complete repository',
  ].join('\n'));
  assert.deepEqual(tasks, [
    { id: 'M00-01', title: 'Record the baseline and mandate limits' },
    { id: 'M15-05', title: 'Hand over operations and the complete repository' },
  ]);
});

test('rejects duplicate task IDs rather than silently losing traceability', () => {
  assert.throws(() => parseTaskCatalog('#### M00-01 · A\n#### M00-01 · B'), /duplicate/i);
});
