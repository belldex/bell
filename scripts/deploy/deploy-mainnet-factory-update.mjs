#!/usr/bin/env node
/** Safely replace the immutable Mainnet hook template/factory while reusing active registries. */
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, formatEther, http, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { formatDeployManifest } from './deploy-manifest.mjs';
import { deriveProfileHash } from './mainnet-pool-config.mjs';
import { loadEnvFile } from './env-loader.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const contractRoot = join(root, 'contracts');
const broadcast = process.argv.includes('--broadcast');
const env = loadEnvFile({ filePath: process.env.BELL_ENV_FILE || join(root, '.env') });
const manifestPath = join(root, 'evidence/deploy/mainnet-4663.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const rpc = env.RH_MAINNET_RPC_PRIMARY;
const privateKey = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!rpc || !privateKey) throw new Error('Mainnet RPC and deployer key are required in the selected BELL env file');
if (Number(manifest.chainId) !== 4663) throw new Error('Refusing to upgrade a manifest outside Robinhood Mainnet');

const privateKeyHex = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
const account = privateKeyToAccount(privateKeyHex);
if (account.address.toLowerCase() !== manifest.deployer.toLowerCase()) {
  throw new Error('Selected deployer key does not match the current production deployment owner');
}
const client = createPublicClient({ transport: http(rpc) });
if (await client.getChainId() !== 4663) throw new Error('Mainnet RPC returned the wrong chain ID');

const outputName = `.factory-update-${process.pid}.json`;
const outputPath = join(root, 'evidence/deploy', outputName);
const outputRelative = `../evidence/deploy/${outputName}`;
const isolatedDir = join(tmpdir(), `bell-factory-update-forge-${process.pid}`);
await Promise.all([mkdir(join(isolatedDir, 'out'), { recursive: true }), mkdir(join(isolatedDir, 'cache'), { recursive: true })]);
const foundryPath = process.env.FOUNDRY_BIN || 'C:\\Users\\sifaq\\.foundry\\bin';
const forge = process.env.FORGE_BIN || join(foundryPath, process.platform === 'win32' ? 'forge.exe' : 'forge');
const childEnv = {
  ...env,
  ...process.env,
  PATH: `${foundryPath}${delimiter}${process.env.PATH ?? ''}`,
  BELL_FACTORY_UPDATE_OUTPUT: outputRelative,
  RH_MAINNET_DEPLOYER_PRIVATE_KEY: privateKeyHex,
  BELL_UPGRADE_DEPLOYER: account.address,
  BELL_UPGRADE_SESSION_REGISTRY: manifest.sessionRegistry,
  BELL_UPGRADE_POOL_MANAGER: manifest.poolManager,
  BELL_UPGRADE_POSITION_MANAGER: manifest.positionManager,
  BELL_UPGRADE_ASSET_REGISTRY: manifest.assetRegistry,
  BELL_UPGRADE_CALENDAR_REGISTRY: manifest.calendarRegistry,
  BELL_UPGRADE_SAFETY_CONTROLLER: manifest.safetyController,
  BELL_UPGRADE_FEE_TOKEN: manifest.feeToken,
  BELL_UPGRADE_SERVICE_RECIPIENT: manifest.serviceRecipient,
};

function runForge(send) {
  const args = [
    'script', 'script/UpgradeMainnetFactory.s.sol', '--rpc-url', rpc,
    '--out', join(isolatedDir, 'out'), '--cache-path', join(isolatedDir, 'cache'),
  ];
  if (send) args.push('--broadcast');
  return new Promise((resolve, reject) => {
    const child = spawn(forge, args, { cwd: contractRoot, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(`${stdout}\n${stderr}`) : reject(new Error(`Forge exited ${code}`)));
  });
}

function expectedProfileHash(factory) {
  const zero = '0x0000000000000000000000000000000000000000';
  return deriveProfileHash({
    token0: zero, token1: zero, asset0: `0x${'0'.repeat(64)}`, asset1: `0x${'0'.repeat(64)}`,
    poolManager: manifest.poolManager, positionManager: manifest.positionManager,
    factory, assetRegistry: manifest.assetRegistry, calendarRegistry: manifest.calendarRegistry,
    safetyController: manifest.safetyController, treasuryAdapter: zero,
    poolClass: 0, liquidityMode: 0, referenceMode: 0, tickSpacing: 60,
    tradeCap: [10n, 10n], windowCap: [100n, 100n], closureCap: [1n, 1n],
    policyId: keccak256(stringToHex(env.BELL_POLICY_ID || 'bell-mainnet-v1')),
    referenceAdapter0: zero, referenceAdapter1: zero,
  });
}

try {
  console.log(broadcast ? 'Simulating the Mainnet factory upgrade before broadcast…' : '[SIMULATION] No transaction will be sent.');
  const simulation = await runForge(false);
  const estimateMatch = simulation.match(/Estimated amount required:\s*([0-9.]+) ETH/i);
  if (!estimateMatch) throw new Error('Forge did not report a deployment cost; refusing to continue');
  const simulatedResult = JSON.parse(await readFile(outputPath, 'utf8'));
  if (simulatedResult.profileHash.toLowerCase() !== expectedProfileHash(simulatedResult.poolFactory).toLowerCase()) {
    throw new Error('Factory simulation does not match the UI production profile');
  }
  const [ethWhole, ethFraction = ''] = estimateMatch[1].split('.');
  const estimatedWei = BigInt(ethWhole) * 10n ** 18n + BigInt(ethFraction.padEnd(18, '0').slice(0, 18) || '0');
  console.log(`Estimated upgrade cost: ${formatEther(estimatedWei)} ETH`);
  if (!broadcast) {
    console.log('Simulation complete. Use --broadcast only after reviewing the addresses and estimated cost.');
    await rm(outputPath, { force: true });
    await rm(isolatedDir, { recursive: true, force: true });
    process.exit(0);
  }

  const balance = await client.getBalance({ address: account.address });
  const requiredWithMargin = estimatedWei * 110n / 100n;
  console.log(`Available deployer balance: ${formatEther(balance)} ETH`);
  if (balance < requiredWithMargin) {
    throw new Error(`Insufficient deployer ETH: need at least ${formatEther(requiredWithMargin)} ETH including 10% gas margin`);
  }

  console.log('Broadcasting the verified factory/template upgrade…');
  await runForge(true);
  const result = JSON.parse(await readFile(outputPath, 'utf8'));
  if (result.profileHash.toLowerCase() !== expectedProfileHash(result.poolFactory).toLowerCase()) {
    throw new Error('Broadcast factory profile differs from the production UI profile; inspect the deployment before updating the manifest');
  }
  const updated = {
    ...manifest,
    hookDeployer: result.hookDeployer,
    poolFactory: result.poolFactory,
    note: 'Factory and hook template upgraded; verified Mainnet asset/session/calendar registries and liquidity infrastructure are reused.',
  };
  const formatted = formatDeployManifest(updated);
  await writeFile(manifestPath, `${JSON.stringify(formatted.manifest, null, 2)}\n`, 'utf8');
  console.log(`Updated Mainnet manifest: factory ${formatted.manifest.poolFactory}`);

  for (const [label, script] of [
    ['Mainnet verification', 'scripts/deploy/verify-mainnet-deployment.mjs'],
    ['Keeper config update', 'scripts/deploy/mainnet-keeper-config.mjs'],
  ]) {
    console.log(`${label}…`);
    const args = [script, ...(label === 'Keeper config update' ? ['--write'] : [])];
    const child = spawn(process.execPath, args, { cwd: root, env: childEnv, stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    if (code !== 0) throw new Error(`${label} failed after the onchain deployment; finish its evidence/config update before enabling the UI`);
  }

  console.log(`Factory upgrade complete. New hook template code hash: ${result.profileHash}`);
} finally {
  await rm(outputPath, { force: true });
  await rm(isolatedDir, { recursive: true, force: true });
}
