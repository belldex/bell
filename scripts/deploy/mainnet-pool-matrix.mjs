#!/usr/bin/env node
/** Read-only preflight/estimate/simulation for the configured Mainnet stock pair matrix. */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { buildPoolMatrixPlan } from './mainnet-pool-matrix-lib.mjs';

const assetsPath = 'config/assets/candidates.mainnet.json';
const queuePath = process.env.BELL_MAINNET_ASSET_QUEUE || 'evidence/deploy/mainnet-4663-asset-queue.json';
const yahooPath = process.env.BELL_MAINNET_YAHOO_EVIDENCE || 'evidence/deploy/mainnet-4663-stock-adapters.json';
const referencePath = process.env.BELL_MAINNET_REFERENCE_EVIDENCE || 'evidence/deploy/mainnet-4663-reference-adapters.json';

for (const path of [assetsPath, queuePath, yahooPath]) {
  if (!existsSync(path)) throw new Error(`required full-product evidence is missing: ${path}`);
}
const configured = JSON.parse(readFileSync(assetsPath, 'utf8')).assets;
const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
const yahoo = JSON.parse(readFileSync(yahooPath, 'utf8'));
const referenceEvidence = existsSync(referencePath) ? JSON.parse(readFileSync(referencePath, 'utf8')) : null;
const referenceMap = referenceEvidence?.adapters ?? referenceEvidence?.feeds ?? {};
const stocks = configured.map((asset) => asset.symbol)
  .filter((symbol) => queue.stocks?.[symbol]?.descriptorId && yahoo.assets?.[symbol]);
if (stocks.length !== configured.length) {
  const missing = configured.map((asset) => asset.symbol).filter((symbol) => !stocks.includes(symbol));
  throw new Error(`candidate assets lack active admission/Yahoo adapters: ${missing.join(', ')}`);
}

const counters = [
  ['WETH', queue.weth],
  ['USDG', queue.usdg],
  ...Object.entries(queue.counterassets ?? {}),
  ...stocks.map((symbol) => [symbol, { ...queue.stocks[symbol], symbol, isStock: true }]),
];
for (const [label, entry] of counters) {
  if (!entry?.descriptorId) throw new Error(`counterasset ${label} has no active descriptor`);
}

const classList = (process.env.BELL_MAINNET_POOL_CLASSES || '0,1').split(',').map((value) => Number(value.trim()));
if (classList.some((value) => ![0, 1].includes(value))) throw new Error('BELL_MAINNET_POOL_CLASSES may only contain 0 (PRICE_GUARDED) or 1 (SESSION_ONLY)');
let seeds = {};
try {
  seeds = JSON.parse(process.env.BELL_MAINNET_MATRIX_SEEDS || '{}');
} catch (error) {
  throw new Error(`BELL_MAINNET_MATRIX_SEEDS must be JSON: ${error.message}`);
}

const plan = buildPoolMatrixPlan({ stocks, counters, classList, references: referenceMap, seeds });
const runs = [];
for (const candidate of plan.candidates) {
  const args = [
    'scripts/deploy/mainnet-create-pool.mjs',
    `--stock=${candidate.stock}`,
    `--counterasset=${candidate.counter}`,
    '--no-broadcast',
  ];
  if (candidate.counterToken && !stocks.includes(candidate.counter)) args.push(`--counter-token=${candidate.counterToken}`);
  if (candidate.seed) {
    // mainnet-create-pool's amount0/amount1 CLI values are stock/counter order, before token sorting.
    args.push(`--amount0=${candidate.seed.amountStock}`, `--amount1=${candidate.seed.amountCounter}`);
  }
  const env = {
    ...process.env,
    BELL_POOL_CLASS: String(candidate.poolClass),
    BELL_MAINNET_POOL_PLAN_ONLY: '1',
    BELL_MAINNET_ASSET_QUEUE: queuePath,
    BELL_MAINNET_YAHOO_EVIDENCE: yahooPath,
    BELL_MAINNET_REFERENCE_EVIDENCE: referencePath,
  };
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env, timeout: 180_000 });
  runs.push({ ...candidate, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
}

console.log(JSON.stringify({
  mode: 'READ_ONLY_MATRIX_PREFLIGHT',
  chainId: 4663,
  candidateStocks: stocks,
  counters: counters.map(([label]) => label),
  classes: classList,
  planned: plan.candidates.length,
  passed: runs.filter((run) => run.exitCode === 0).length,
  blocked: runs.filter((run) => run.exitCode !== 0).length,
  skipped: plan.skipped,
  runs,
}, null, 2));
if (runs.some((run) => run.exitCode !== 0)) process.exit(1);
