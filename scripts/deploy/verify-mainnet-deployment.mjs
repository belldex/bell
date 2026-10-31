#!/usr/bin/env node
/**
 * Regenerate evidence/deploy/mainnet-4663-verification.json from the live chain.
 *
 * Shares `buildVerification` with the testnet verifier so the wiring checks cannot drift apart,
 * but pins the expected chain, the evidence label, and the "not covered" list to mainnet.
 * Read-only: it never sends a transaction.
 *
 * Usage:
 *   node scripts/deploy/verify-mainnet-deployment.mjs            # write evidence
 *   node scripts/deploy/verify-mainnet-deployment.mjs --check    # exit 1 if evidence is stale
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { buildVerification } from './verify-testnet-deployment.mjs';
import { loadEnvFile } from './env-loader.mjs';

const MAINNET_CHAIN_ID = 4663;
const MANIFEST_URL = new URL('../../evidence/deploy/mainnet-4663.json', import.meta.url);
const VERIFICATION_URL = new URL('../../evidence/deploy/mainnet-4663-verification.json', import.meta.url);
const BROADCAST_URL = new URL('../../contracts/broadcast/DeployTestnet.s.sol/4663/run-latest.json', import.meta.url);

const MAINNET_NOT_COVERED = [
  'PRICE_GUARDED pool class remains blocked until an independent reference pair is admitted',
  'Deployed profile is PUBLIC only (liquidityMode=0, treasuryAdapter=0): the TREASURY_ONLY path has no live deployment',
  'No pool exists at deploy time: that needs an admitted stock descriptor, an activated calendar root, and a healthy source',
  'The keeper is not pointed at these addresses until evidence/deploy/mainnet-4663.json is wired into its configuration',
  'PoolManager ownership is held by the deployer; a handover to governance has not run',
  'Stock token rights and entitlements are NOT verified by this script; it only proves the contracts are wired',
];

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

async function main() {
  const checkOnly = process.argv.includes('--check');
  const env = loadEnvFile({ filePath: process.env.BELL_ENV_FILE || new URL('../../.env', import.meta.url) });
  const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
  if (!rpcUrl) throw new Error('RH_MAINNET_RPC_PRIMARY is required');

  const manifest = JSON.parse(await readFile(MANIFEST_URL, 'utf8'));
  if (Number(manifest.chainId) !== MAINNET_CHAIN_ID) {
    throw new Error(`manifest chainId is ${manifest.chainId}, expected ${MAINNET_CHAIN_ID}`);
  }
  const broadcast = JSON.parse(await readFile(BROADCAST_URL, 'utf8').catch(() => 'null'));
  const client = createPublicClient({ transport: http(rpcUrl) });

  const next = await buildVerification({
    manifest,
    client,
    broadcast: broadcast?.receipts ? broadcast : null,
    verifiedAt: new Date().toISOString().slice(0, 10),
    expectedChainId: MAINNET_CHAIN_ID,
    status: 'PRODUCTION_DEPLOYED',
    feeTokenLabel: 'PRODUCTION_FEE_TOKEN',
    notCovered: MAINNET_NOT_COVERED,
  });

  if (checkOnly) {
    const current = JSON.parse(await readFile(VERIFICATION_URL, 'utf8'));
    const drift = [];
    if (current.manifestHash !== next.manifestHash) drift.push(`manifestHash ${current.manifestHash} != ${next.manifestHash}`);
    for (const key of Object.keys(next.contracts)) {
      const recorded = current.contracts?.[key];
      if (!recorded) { drift.push(`${key} not recorded`); continue; }
      if (!same(recorded.address, next.contracts[key].address)) drift.push(`${key} address ${recorded.address} != ${next.contracts[key].address}`);
      if (recorded.codeBytes !== next.contracts[key].codeBytes) drift.push(`${key} codeBytes ${recorded.codeBytes} != ${next.contracts[key].codeBytes}`);
    }
    if (drift.length > 0) {
      console.error('STALE VERIFICATION EVIDENCE');
      for (const line of drift) console.error(`- ${line}`);
      console.error('Run: node scripts/deploy/verify-mainnet-deployment.mjs');
      process.exit(1);
    }
    console.log('OK   mainnet verification evidence matches the live chain');
    return;
  }

  await writeFile(VERIFICATION_URL, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`wrote ${Object.keys(next.contracts).length} contracts at block ${next.blocks.verifiedAtBlock}`);
  console.log(`manifestHash ${next.manifestHash}`);
}

if (process.argv[1] && process.argv[1].endsWith('verify-mainnet-deployment.mjs')) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
