#!/usr/bin/env node
/**
 * CI: print the rehearsal state so a scheduled run is diagnosable from its log alone.
 * Read-only; safe to run every few minutes.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi } from 'viem';

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch { /* no local .env in CI; process.env wins */ }
  return env;
}

const env = loadEnv();
if (!env.RH_TESTNET_RPC_PRIMARY) {
  console.log('RH_TESTNET_RPC_PRIMARY is not set; nothing to inspect.');
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

const block = await client.getBlock();
const now = Number(block.timestamp);
const interval = await client.readContract({
  address: manifest.calendarRegistry, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [queue.stock.descriptorId],
});
const health = await client.readContract({
  address: manifest.sessionRegistry, abi: SESSION_ABI, functionName: 'health', args: [queue.stock.descriptorId],
});

const phase = Number(interval.phase);
console.log(JSON.stringify({
  chainTime: now,
  iso: new Date(now * 1000).toISOString(),
  assetId: queue.stock.descriptorId,
  calendar: { phase, start: Number(interval.start), end: Number(interval.end) },
  health: { ready: health.ready, reasonBits: health.reasonBits.toString(), validUntil: Number(health.validUntil) },
  pool: { hook: pool.hook, poolId: pool.poolId },
}, null, 2));
