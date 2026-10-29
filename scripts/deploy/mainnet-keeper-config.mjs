#!/usr/bin/env node
/**
 * Generate the keeper's mainnet vars from deployment evidence.
 *
 * Hand-copying eight addresses and three hashes into wrangler.jsonc is how a keeper ends up
 * publishing to the previous deployment. This reads the evidence files the deploy scripts wrote and
 * emits exactly the var block a mainnet keeper needs, plus the secret commands.
 *
 *   node scripts/deploy/mainnet-keeper-config.mjs           # print
 *   node scripts/deploy/mainnet-keeper-config.mjs --write   # patch wrangler.jsonc
 *
 * It refuses to run while any input is still a rehearsal artefact.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const EVIDENCE = {
  manifest: 'evidence/deploy/mainnet-4663.json',
  adapters: 'evidence/deploy/mainnet-4663-stock-adapters.json',
  assets: 'evidence/deploy/mainnet-4663-asset-queue.json',
  pool: 'evidence/deploy/mainnet-4663-pool.json',
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const missing = Object.values(EVIDENCE).filter((path) => !existsSync(path));
if (missing.length) {
  console.error('Missing deployment evidence:');
  for (const path of missing) console.error(` - ${path}`);
  console.error('\nRun the deploy, yahoo-stack, admit and pool steps first. A keeper pointed at half a');
  console.error('deployment will publish to the wrong contracts.');
  process.exit(1);
}

const manifest = readJson(EVIDENCE.manifest);
const adapters = readJson(EVIDENCE.adapters);
const assets = readJson(EVIDENCE.assets);
const pool = readJson(EVIDENCE.pool);

const failures = [];
if (Number(manifest.chainId) !== 4663) failures.push(`manifest chainId is ${manifest.chainId}, expected 4663`);
if (Number(adapters.chainId) !== 4663) failures.push(`adapters chainId is ${adapters.chainId}, expected 4663`);
if (assets.activationPending) failures.push('asset admission is still pending; the keeper would publish for an inactive asset');
if (/facade|testnet|rehearsal/i.test(String(adapters.symbol))) failures.push(`stock symbol "${adapters.symbol}" looks like a rehearsal fixture`);

if (failures.length) {
  console.error('Refusing to generate a keeper config:');
  for (const line of failures) console.error(` - ${line}`);
  process.exit(1);
}

const vars = {
  BELL_EXPECTED_CHAIN_ID: '4663',
  BELL_STOCK_ASSET_ID: assets.stock.descriptorId,
  BELL_CALENDAR_REGISTRY: manifest.calendarRegistry,
  BELL_SESSION_REGISTRY: manifest.sessionRegistry,
  BELL_DIRECT_ADAPTER: adapters.directAdapter,
  BELL_HOOK_ADDRESS: pool.hook,
  BELL_REGULAR_FEED_ID: adapters.regularWire?.feedId ?? null,
  BELL_EXTENDED_FEED_ID: adapters.extendedWire?.feedId ?? null,
  BELL_REGULAR_WIRE_HASH: adapters.regularWireHash ?? null,
  BELL_EXTENDED_WIRE_HASH: adapters.extendedWireHash ?? null,
  YAHOO_SOURCE_VERIFIER_ADDRESS: adapters.verifier,
};

const nulls = Object.entries(vars).filter(([, value]) => !value).map(([key]) => key);
if (nulls.length) {
  console.error(`Refusing: these vars have no value in the evidence: ${nulls.join(', ')}`);
  process.exit(1);
}

const block = Object.entries(vars).map(([key, value]) => `    "${key}": "${value}"`).join(',\n');

if (!process.argv.includes('--write')) {
  console.log('// keeper vars for chain 4663\n{\n' + block + '\n}\n');
  console.log('Secrets (wrangler secret put, never in a file):');
  console.log('  BELL_RPC_URL               = RH_MAINNET_RPC_PRIMARY');
  console.log('  YAHOO_REPORTER_PRIVATE_KEY = YAHOO_REPORTER_PRIVATE_KEY');
  console.log('  BELL_DIRECT_WIRE_HASH      = ' + adapters.directWireHash);
  console.log('\nRe-run with --write to patch workers/keeper-b/wrangler.jsonc.');
  process.exit(0);
}

const path = 'workers/keeper-b/wrangler.jsonc';
const source = readFileSync(path, 'utf8');
const start = source.indexOf('"vars": {');
if (start < 0) throw new Error('could not find the "vars" block in wrangler.jsonc');
const openBrace = source.indexOf('{', start);
let depth = 0;
let end = -1;
for (let i = openBrace; i < source.length; i += 1) {
  if (source[i] === '{') depth += 1;
  else if (source[i] === '}') {
    depth -= 1;
    if (depth === 0) { end = i; break; }
  }
}
if (end < 0) throw new Error('could not find the end of the "vars" block');

const patched = `${source.slice(0, openBrace)}{\n${block}\n  }${source.slice(end + 1)}`;
writeFileSync(path, patched);
console.log(`Patched ${path} with ${Object.keys(vars).length} vars.`);
console.log('Now set the secrets with wrangler secret put, then deploy.');
