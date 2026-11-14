import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPQMainnetChainlinkGenesis } from './pq-mainnet-chainlink-genesis.mjs';

export function buildMainnetPQWirePlan(evidence) {
  return buildPQMainnetChainlinkGenesis(evidence);
}

export function stringifyMainnetPQWirePlan(plan) {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const input = process.argv[2] ?? 'evidence/deploy/mainnet-4663-chainlink-session-adapters.json';
  const output = process.argv[3] ?? 'evidence/deploy/pq-hooks-mainnet-wire-plan.json';
  if (!existsSync(input)) throw new Error(`Chainlink adapter evidence is missing: ${input}`);
  const evidence = JSON.parse(readFileSync(input, 'utf8'));
  const plan = buildMainnetPQWirePlan(evidence);
  writeFileSync(output, stringifyMainnetPQWirePlan(plan));
  console.log(`Validated ${plan.assets.length} Mainnet stocks and wrote ${output}`);
}
