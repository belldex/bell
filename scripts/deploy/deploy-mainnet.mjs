#!/usr/bin/env node
/**
 * Mainnet deployment runner. Defaults to simulation; --broadcast is explicit.
 *
 * Wraps the same Foundry script the testnet uses, but targets chain 4663, writes
 * evidence/deploy/mainnet-4663.json, and refuses to broadcast when the read-only preflight fails.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { formatDeployManifest } from './deploy-manifest.mjs';
import { buildForgeArgs, cleanupDryRunArtifacts } from './mainnet-dry-run-cleanup.mjs';
import { loadEnvFile } from './env-loader.mjs';

const ROOT_URL = new URL('../../', import.meta.url);
const MANIFEST_PATH = new URL('evidence/deploy/mainnet-4663.json', ROOT_URL);
const MAINNET_CHAIN_ID = 4663;

const args = process.argv.slice(2);
const broadcast = args.includes('--broadcast');
const skipPreflight = args.includes('--skip-preflight');
const env = loadEnvFile({ filePath: process.env.BELL_ENV_FILE || fileURLToPath(new URL('.env', ROOT_URL)) });
const previousManifest = await readFile(MANIFEST_PATH).catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});

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
const isolatedDir = broadcast
  ? join(tmpdir(), `bell-mainnet-broadcast-${process.pid}`)
  : fileURLToPath(new URL(`evidence/deploy/.mainnet-dry-run-${process.pid}/`, ROOT_URL));
const isolatedOut = join(isolatedDir, 'out');
const isolatedCache = join(isolatedDir, 'cache');
const isolatedManifest = broadcast
  ? fileURLToPath(MANIFEST_PATH)
  : join(isolatedDir, 'mainnet-4663.json');
await Promise.all([mkdir(isolatedOut, { recursive: true }), mkdir(isolatedCache, { recursive: true })]);
const forgeArgs = buildForgeArgs({ rpcUrl, outDir: isolatedOut, cacheDir: isolatedCache, broadcast });
if (!broadcast) console.log('[SIMULATION] No transaction will be sent; Forge is invoked without --broadcast.');

console.log(broadcast ? 'Broadcasting mainnet deployment...' : 'Simulating mainnet deployment...');

const child = spawn(forgeExecutable, forgeArgs, {
  cwd: fileURLToPath(new URL('contracts/', ROOT_URL)),
  env: {
    ...env,
    DEPLOYER_PRIVATE_KEY: privateKey,
    ...(broadcast ? {} : { BELL_MANIFEST_PATH: isolatedManifest }),
    PATH: `${foundryPath};${process.env.PATH ?? ''}`,
  },
  stdio: 'inherit',
});

child.on('close', async (code) => {
  if (code !== 0) {
    if (!broadcast) {
      await cleanupDryRunArtifacts({
        manifestPath: fileURLToPath(MANIFEST_PATH),
        previousManifest,
        foundryDryRunFiles: [isolatedDir],
      });
    }
    console.error(`Deployment script failed with exit code ${code}`);
    process.exit(code ?? 1);
  }
  if (!broadcast) {
    await cleanupDryRunArtifacts({
      manifestPath: fileURLToPath(MANIFEST_PATH),
      previousManifest,
      foundryDryRunFiles: [isolatedDir],
    });
    console.log('\n[SIMULATION OK] No transaction was sent; repository evidence was restored and temporary outputs removed.');
    return;
  }
  if (broadcast) {
    console.log('\n[Broadcast complete] Verify code and wiring with pnpm mainnet:verify before using this manifest.');
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
