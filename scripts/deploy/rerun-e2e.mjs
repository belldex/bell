#!/usr/bin/env node
/**
 * Full end-to-end rerun against the current manifest. Runs every stage in order and stops on the
 * first hard failure, so a red line always means "this stage is broken", never "later stage failed".
 * Idempotent where possible: already-admitted assets and already-active intervals are skipped.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const stages = [
  { name: 'stock token + Yahoo adapters', script: 'scripts/deploy/deploy-testnet-stock-and-adapters.mjs' },
  { name: 'asset admission', script: 'scripts/deploy/admit-testnet-assets.mjs' },
  { name: 'calendar + price + health', script: 'scripts/deploy/setup-calendar-and-price.mjs' },
  { name: 'pool create + seed', script: 'scripts/deploy/create-testnet-pool.mjs' },
];

const results = [];
for (const stage of stages) {
  console.log(`\n=== ${stage.name} ===`);
  try {
    const out = execFileSync('node', [stage.script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 });
    const tail = out.trim().split('\n').slice(-8).join('\n');
    console.log(tail);
    results.push({ stage: stage.name, ok: true, tail });
  } catch (error) {
    const out = String(error.stdout ?? '') + String(error.stderr ?? '');
    console.error('STAGE FAILED:\n' + out.split('\n').slice(-30).join('\n'));
    results.push({ stage: stage.name, ok: false, error: out.slice(-2500) });
    break;
  }
}

writeFileSync('evidence/deploy/e2e-rerun.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n');
const failed = results.find((r) => !r.ok);
console.log(failed ? `\n>>> STOPPED AT: ${failed.stage} <<<` : '\n>>> ALL STAGES COMPLETE <<<');
process.exit(failed ? 1 : 0);
