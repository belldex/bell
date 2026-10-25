import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceFiles = ['amounts.mjs', 'ports.mjs', 'fee-policy.mjs', 'flow-budget.mjs', 'closure-budget.mjs', 'wide-price.mjs', 'policy-config.mjs', 'seed-budget.mjs', 'source-manifest.mjs', 'freshness.mjs', 'log-planner.mjs', 'reference-policy.mjs', 'report-ledger.mjs', 'price-source.mjs', 'source-rights.mjs', 'transactions.mjs', 'scheduler.mjs', 'indexing.mjs', 'jobs.mjs', 'quota.mjs', 'catchup.mjs', 'keeper-tick.mjs', 'archive.mjs', 'backup.mjs', 'ops-status.mjs', 'freshness-trace.mjs', 'ui-state.mjs'];

test('runtime-neutral domain modules do not import Node-only or ambient process APIs', async () => {
  for (const file of sourceFiles) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*['"]node:/, `${file} imports a Node builtin`);
    assert.doesNotMatch(source, /\b(?:process|Buffer|__dirname|__filename)\b/, `${file} uses a Node ambient`);
  }
});
