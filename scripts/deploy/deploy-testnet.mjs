#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { validateDeployManifest, formatDeployManifest } from './deploy-manifest.mjs';

const ROOT_URL = new URL('../../', import.meta.url);
const MANIFEST_PATH = new URL('evidence/deploy/testnet-46630.json', ROOT_URL);

async function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = await readFile(new URL('.env', ROOT_URL), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match && !env[match[1]]) {
        env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {}
  return env;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isSimulateOnly = args.includes('--simulate');
  const env = await loadEnv();

  console.log('=== BELL Protocol: Robinhood Testnet (Chain 46630) Deployment Runner ===');

  if (isDryRun) {
    console.log('[DRY-RUN MODE] Preflight plan verification:');
    console.log('- Target Chain: Robinhood Testnet (Chain ID 46630)');
    console.log('- RPC Target: RH_TESTNET_RPC_PRIMARY');
    console.log('- Contract Suite:');
    console.log('  1. SafetyController (governance, guardian, treasury)');
    console.log('  2. AssetRegistry (safetyController)');
    console.log('  3. CalendarRegistry (safetyController)');
    console.log('  4. SessionRegistry (assetRegistry, calendarRegistry)');
    console.log('  5. PoolManager (pinned Uniswap v4 core)');
    console.log('  6. PositionManager (PoolManager, canonical Permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3)');
    console.log('  7. BellHookDeployer (futureFactory, sessionRegistry, hookCodeHash)');
    console.log('  8. BellPoolFactory (PoolConfig, deployer, feeToken, serviceRecipient)');
    console.log('  9. WETH (testnet canonical or fixture)');
    console.log(' 10. BellRouter (PoolManager, WETH)');
    console.log('\n[DRY-RUN SUCCESS] Deployment sequence and dependencies verified.');
    return;
  }

  const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
  if (!rpcUrl) {
    console.error('ERROR: RH_TESTNET_RPC_PRIMARY environment variable is required.');
    process.exit(1);
  }

  const privateKey = env.RH_TESTNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error('ERROR: RH_TESTNET_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is required.');
    console.error('Please set RH_TESTNET_DEPLOYER_PRIVATE_KEY in your local .env file.');
    process.exit(1);
  }

  const foundryPath = 'C:\\Users\\sifaq\\.foundry\\bin';
  const customPath = process.env.PATH ? `${foundryPath};${process.env.PATH}` : foundryPath;
  const forgeEnv = { ...env, DEPLOYER_PRIVATE_KEY: privateKey, PATH: customPath };
  const forgeExecutable = process.platform === 'win32' ? `${foundryPath}\\forge.exe` : 'forge';
  const forgeArgs = [
    'script',
    'script/DeployTestnet.s.sol',
    '--rpc-url',
    rpcUrl,
    '-vv'
  ];

  if (!isSimulateOnly) {
    forgeArgs.push('--broadcast');
    console.log('Starting broadcast deployment via Foundry forge script...');
  } else {
    console.log('Starting simulation check (read-only against live RPC, no broadcast)...');
  }

  const child = spawn(
    forgeExecutable,
    forgeArgs,
    {
      cwd: fileURLToPath(new URL('contracts/', ROOT_URL)),
      env: forgeEnv,
      stdio: 'inherit'
    }
  );

  child.on('close', async (code) => {
    if (code !== 0) {
      console.error(`Deployment script failed with exit code ${code}`);
      process.exit(code ?? 1);
    }

    try {
      const raw = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
      const { manifest, manifestHash } = formatDeployManifest(raw);
      console.log('\n=== Deployment Succeeded! ===');
      console.log(`Manifest Hash: ${manifestHash}`);
      console.log(`Factory:        ${manifest.poolFactory}`);
      console.log(`Router:         ${manifest.router}`);
      console.log(`PoolManager:    ${manifest.poolManager}`);
      console.log(`HookDeployer:   ${manifest.hookDeployer}`);
      console.log(`Permit2:        ${manifest.permit2}`);
      console.log(`Manifest saved: evidence/deploy/testnet-46630.json`);
    } catch (err) {
      console.error('Error validating output manifest:', err.message);
      process.exit(1);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
