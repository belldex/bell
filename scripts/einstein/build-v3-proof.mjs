#!/usr/bin/env node
/**
 * Builds evidence/einstein/v3-evolve/proof.json, the only file the v3 Evolve page reads. No number is typed by hand: a run that has
 * started is rebuilt from its Swap events; a run that has not stays "scheduled".
 *
 *   node scripts/einstein/build-v3-proof.mjs                       scheduled runs only, no network
 *   node scripts/einstein/build-v3-proof.mjs --rpc <url>           rebuild every started run from chain
 *   node scripts/einstein/build-v3-proof.mjs --rpc <url> --run     also replay claims E1 to E9 and record the verdicts
 *
 * Run files live at evidence/einstein/v3-evolve/run-N.json. Add "config" and set "status" to "live" or "final" once the pools are seeded.
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { rpcFactory } from './verify-einstein-pool.mjs';
import { buildRun } from './v3-evolve/chain.mjs';
import { verifyRun } from './verify-v3-evolve.mjs';

const dir = 'evidence/einstein/v3-evolve';
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const read = (f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
const method = read('method.json');
const rpcUrl = arg('rpc') ?? process.env.RPC_URL;
const rpc = rpcUrl ? await rpcFactory(rpcUrl) : null;
const doRun = process.argv.includes('--run');

const CLAIMS = [
  ['E1', 'Both pools are set up the same way', 'Initialize and seed transactions for both, position ids, ticks and amounts.', 'Capital within 1 USDG, same ticks, both seeded within 120 seconds and no swap on either pool before both were seeded.'],
  ['E2', 'The control pool has no hook', 'The control pool key, read from its Initialize event.', 'Hook address is the zero address.'],
  ['E3', 'The reference price is fixed and public', 'The Chainlink round id and price at Monday 10:00 ET, recorded in proof.json.', 'The replay reads the same round, and it is fresh.'],
  ['E4', 'Fees are counted correctly', 'Every Swap event of both pools in the window.', 'The replay total equals the page total.'],
  ['E5', 'LVR is counted correctly', 'Per swap, reference price against execution price.', 'The replay total equals the page total.'],
  ['E6', 'Net LP result is correct', 'End position value against hold, read at the end block.', 'The replay result equals the page result.'],
  ['E7', 'The bot treated both pools the same', 'Bot source code, its hash, and every bot transaction.', 'Same source and the same maximum size on both pools, every transaction listed.'],
  ['E8', 'BELL refused toxic flow', 'The list of reverted transactions with their error names.', 'Every revert is linked and replays with its error.'],
  ['E9', 'Anyone can replay it', 'verify-v3-evolve.mjs from a clean clone.', 'Prints PASS for E1 to E8.'],
].map(([id, title, proof, passes]) => ({ id, title, proof, passes }));

const files = readdirSync(dir).filter((f) => /^run-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(4), 10) - parseInt(b.slice(4), 10));
const runs = [];
for (const f of files) {
  const run = read(f);
  const entry = { id: run.run, label: run.label, status: run.status, window: run.window, note: run.note ?? null, postponed: run.postponed ?? false, network: run.network ?? 'mainnet', outages: run.outages ?? [], methodCommit: run.methodCommit ?? null };
  if (run.config) {
    entry.config = run.config;
    if (rpc) { entry.result = await buildRun(run.config, rpc); entry.generatedAt = new Date().toISOString(); }
    else if (run.result) { entry.result = run.result; entry.generatedAt = run.generatedAt; }
    if (rpc && doRun && entry.result) entry.replay = await verifyRun(entry, rpc);
  }
  runs.push(entry);
}

const proof = {
  title: method.name, subtitle: method.subtitle,
  chain: { id: 4663, name: 'Robinhood Chain', explorer: 'https://robinhoodchain.blockscout.com' },
  question: method.question, design: method.design, referencePrice: method.referencePrice, metrics: method.metrics,
  limits: method.limits, notAllowed: method.notAllowed,
  methodCommit: arg('method-commit') ?? (() => { try { return read('proof.json').methodCommit ?? null; } catch { return null; } })(),
  claims: CLAIMS, runs, lastBuild: new Date().toISOString(),
};
writeFileSync(`${dir}/proof.json`, `${JSON.stringify(proof, null, 2)}\n`);
copyFileSync(`${dir}/proof.json`, 'apps/web/components/einstein/v3-evolve-proof.json');
console.log(`wrote ${dir}/proof.json (${runs.length} runs: ${runs.map((r) => `${r.id} ${r.status}`).join(', ')})`);
