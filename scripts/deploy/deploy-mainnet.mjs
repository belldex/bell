#!/usr/bin/env node
/**
 * Mainnet deployment runner. Defaults to simulation; --broadcast is explicit.
 *
 * Wraps the same Foundry script the testnet uses, but targets chain 4663, writes
 * evidence/deploy/mainnet-4663.json, and refuses to broadcast when the read-only preflight fails.
 */
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { formatDeployManifest } from './deploy-manifest.mjs';

const ROOT_URL = new URL('../../', import.meta.url);
const MANIFEST_PATH = new URL('evidence/deploy/mainnet-4663.json', ROOT_URL);
const MAINNET_CHAIN_ID = 4663;

async function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = await readFile(new URL('.env', ROOT_URL), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {}
  return env;
}

const args = process.argv.slice(2);
const broadcast = args.includes('--broadcast');
const skipPreflight = args.includes('--skip-preflight');
const env = await loadEnv();

const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
if (!rpcUrl) {
  console.error('ERROR: RH_MAINNET_RPC_PRIMARY is required.');
  process.exit(1);
}
const privateKey = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!privateKey) {
  console.error('ERROR: RH_MAINNET_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is required.');
  process.exit(1);
}

if (!skipPreflight) {
  try {
    const out = execFileSync('node', ['scripts/deploy/mainnet-preflight.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(out.trim());
  } catch (error) {
    console.error(String(error.stdout ?? '') + String(error.stderr ?? ''));
    console.error('\nPreflight failed. Fix the reported items, or pass --skip-preflight only if you understand exactly what you are bypassing.');
    process.exit(1);
  }
}

const foundryPath = process.env.FOUNDRY_BIN || 'C:\\Users\\sifaq\\.foundry\\bin';
const forgeExecutable = process.env.FORGE_BIN || (process.platform === 'win32' ? `${foundryPath}\\forge.exe` : 'forge');
const forgeArgs = ['script', 'script/DeployTestnet.s.sol', '--rpc-url', rpcUrl, '-vv'];
if (broadcast) forgeArgs.push('--broadcast');
else console.log('[SIMULATION] No transaction will be sent. Re-run with --broadcast to deploy.');

console.log(broadcast ? 'Broadcasting mainnet deployment...' : 'Simulating mainnet deployment...');

const child = spawn(forgeExecutable, forgeArgs, {
  cwd: fileURLToPath(new URL('contracts/', ROOT_URL)),
  env: { ...env, DEPLOYER_PRIVATE_KEY: privateKey, PATH: `${foundryPath};${process.env.PATH ?? ''}` },
  stdio: 'inherit',
});

child.on('close', async (code) => {
  if (code !== 0) {
    console.error(`Deployment script failed with exit code ${code}`);
    process.exit(code ?? 1);
  }
  if (!broadcast) {
    console.log('\n[SIMULATION OK] Nothing was written. Re-run with --broadcast to deploy.');
    return;
  }
  try {
    const raw = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    if (Number(raw.chainId) !== MAINNET_CHAIN_ID) throw new Error(`manifest chainId is ${raw.chainId}, expected ${MAINNET_CHAIN_ID}`);
    const { manifest, manifestHash } = formatDeployManifest(raw);
    console.log('\n=== Mainnet deployment recorded ===');
    console.log(`Manifest:      evidence/deploy/mainnet-4663.json`);
    console.log(`Manifest hash: ${manifestHash}`);
    console.log(`SafetyController: ${manifest.safetyController}`);
    console.log(`PoolFactory:      ${manifest.poolFactory}`);
    console.log(`Router:           ${manifest.router}`);
    console.log(`PoolManager:      ${manifest.poolManager}`);
    console.log(`WETH:             ${manifest.weth}`);
  } catch (error) {
    console.error('Error validating mainnet manifest:', error.message);
    process.exit(1);
  }
});
