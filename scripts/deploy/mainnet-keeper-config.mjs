#!/usr/bin/env node
/** Generate evidence-bound multi-asset Mainnet Worker vars before pool creation. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildMainnetChainlinkKeeperVars, replaceWranglerVars } from './mainnet-keeper-config-lib.mjs';

const EVIDENCE = {
  manifest: 'evidence/deploy/mainnet-4663.json',
  verification: 'evidence/deploy/mainnet-4663-verification.json',
  adapters: 'evidence/deploy/mainnet-4663-chainlink-session-adapters.json',
  assets: 'evidence/deploy/mainnet-4663-asset-queue.json',
  assetState: 'evidence/deploy/mainnet-4663-asset-state.json',
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const missing = Object.values(EVIDENCE).filter((path) => !existsSync(path));
if (missing.length) {
  console.error('Missing deployment evidence:');
  for (const path of missing) console.error(` - ${path}`);
  process.exit(1);
}

const evidence = Object.fromEntries(Object.entries(EVIDENCE).map(([key, path]) => [key, readJson(path)]));
const calendarStates = {};
for (const symbol of Object.keys(evidence.assets.stocks ?? {}).sort()) {
  const path = `evidence/deploy/mainnet-4663-calendar-state-${symbol}.json`;
  if (!existsSync(path)) {
    console.error(`Missing calendar evidence for ${symbol}: ${path}`);
    process.exit(1);
  }
  calendarStates[symbol] = readJson(path);
}

let vars;
try {
  vars = buildMainnetChainlinkKeeperVars({ ...evidence, calendarStates });
} catch (error) {
  console.error(`Refusing to generate Mainnet keeper config: ${error.message}`);
  process.exit(1);
}

if (!process.argv.includes('--write')) {
  console.log('// Mainnet keeper vars; RPC and keys remain Wrangler secrets.');
  console.log(JSON.stringify(vars, null, 2));
  console.log('\nSecrets to set (values are never printed):');
  console.log('  BELL_RPC_URL                 = Mainnet RPC endpoint (secret; value not printed)');
  console.log('  BELL_TRANSACTION_PRIVATE_KEY = funded keeper relayer key (secret; value not printed)');
  console.log('\nChainlink mode reads prices onchain and disables the signed /quote endpoint.');
  console.log('The RPC and transaction-key secrets must already exist in Wrangler.');
  console.log('Re-run with --write to patch workers/keeper-b/wrangler.jsonc.');
  process.exit(0);
}

const path = 'workers/keeper-b/wrangler.jsonc';
const source = readFileSync(path, 'utf8');
writeFileSync(path, replaceWranglerVars(source, vars));
console.log(`Patched ${path} with ${Object.keys(vars).length} evidence-derived Mainnet vars.`);
console.log('Keep BELL_RPC_URL and BELL_TRANSACTION_PRIVATE_KEY configured as Wrangler secrets.');
