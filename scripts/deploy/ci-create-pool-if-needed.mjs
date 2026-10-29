#!/usr/bin/env node
/**
 * CI: create and seed the rehearsal pool exactly once.
 *
 * Skips when a pool already exists for the current asset, when the market is closed, or when
 * health is not fresh. Pool creation itself still runs the factory simulation and the
 * fresh-health preflight inside create-testnet-pool.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createPublicClient, http, parseAbi } from 'viem';

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|["']$/g, '');
    }
  } catch { /* CI has no .env */ }
  return env;
}

const env = loadEnv();
if (!env.RH_TESTNET_RPC_PRIMARY || !env.DEPLOYER_PRIVATE_KEY) {
  console.log('deployer secrets are not configured; skipping.');
  process.exit(0);
}

const manifest = JSON.parse(readFileSync('evidence/deploy/testnet-46630.json', 'utf8'));
const queue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));
const pool = JSON.parse(readFileSync('evidence/deploy/testnet-pool-created.json', 'utf8'));
const client = createPublicClient({ transport: http(env.RH_TESTNET_RPC_PRIMARY) });

const CALENDAR_ABI = parseAbi([
  'function currentInterval(bytes32) view returns ((bytes32 assetId,uint16 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))',
]);
const SESSION_ABI = parseAbi([
  'function health(bytes32) view returns ((bool ready,uint32 reasonBits,uint64 validUntil,uint64 refreshedAt,uint64 healthySince,uint64 latestObservation))',
]);
const HOOK_ABI = parseAbi([
  'function config() view returns ((address token0,address token1,bytes32 asset0,bytes32 asset1,address poolManager,address positionManager,address factory,address assetRegistry,address calendarRegistry,address safetyController,address treasuryAdapter,uint8 poolClass,uint8 liquidityMode,uint8 referenceMode,int24 tickSpacing,uint128[2] tradeCap,uint128[2] windowCap,uint128[2] closureCap,bytes32 policyId))',
]);

// A pool already bound to this asset means there is nothing to create.
if (pool.hook && pool.stockAssetId?.toLowerCase() === queue.stock.descriptorId.toLowerCase()) {
  try {
    const config = await client.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'config' });
    if (String(config.asset0).toLowerCase() === queue.stock.descriptorId.toLowerCase()
      || String(config.asset1).toLowerCase() === queue.stock.descriptorId.toLowerCase()) {
      console.log(`pool already exists for this asset: ${pool.hook}`);
      process.exit(0);
    }
  } catch { /* stale evidence; fall through to the phase/health checks */ }
}

const block = await client.getBlock();
const now = Number(block.timestamp);
const interval = await client.readContract({
  address: manifest.calendarRegistry, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [queue.stock.descriptorId],
});
if (![1, 2, 3].includes(Number(interval.phase))) {
  console.log(`calendar phase ${Number(interval.phase)} is not tradeable; not creating a pool.`);
  process.exit(0);
}

const health = await client.readContract({
  address: manifest.sessionRegistry, abi: SESSION_ABI, functionName: 'health', args: [queue.stock.descriptorId],
});
if (!health.ready || Number(health.validUntil) <= now) {
  console.log(`health not ready (ready=${health.ready} reasons=${health.reasonBits}); not creating a pool yet.`);
  process.exit(0);
}

try {
  const out = execFileSync('node', ['scripts/deploy/create-testnet-pool.mjs'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900_000,
  });
  console.log(out.trim().split('\n').slice(-12).join('\n'));
  writeFileSync('evidence/runtime/last-ci-pool-run.json', `${JSON.stringify({ at: new Date().toISOString(), ok: true }, null, 2)}\n`);
} catch (error) {
  const out = String(error.stdout ?? '') + String(error.stderr ?? '');
  console.log(out.trim().split('\n').slice(-15).join('\n'));
  writeFileSync('evidence/runtime/last-ci-pool-run.json', `${JSON.stringify({ at: new Date().toISOString(), ok: false, tail: out.slice(-2000) }, null, 2)}\n`);
  process.exit(1);
}
