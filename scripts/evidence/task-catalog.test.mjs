import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskCatalog } from './task-catalog.mjs';

test('extracts stable task IDs and titles from the implementation plan', () => {
  const tasks = parseTaskCatalog([
    '#### M00-01 · Catat baseline dan batas mandat',
    'not a task',
    '#### M15-05 · Serahkan operasi dan repository lengkap',
  ].join('\n'));
  assert.deepEqual(tasks, [
    { id: 'M00-01', title: 'Catat baseline dan batas mandat' },
    { id: 'M15-05', title: 'Serahkan operasi dan repository lengkap' },
  ]);
});

test('rejects duplicate task IDs rather than silently losing traceability', () => {
  assert.throws(() => parseTaskCatalog('#### M00-01 · A\n#### M00-01 · B'), /duplicate/i);
});
