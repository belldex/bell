#!/usr/bin/env node
/**
 * CI: one keeper tick, but only while a tradeable session is open.
 *
 * The Cloudflare Worker is the primary keeper. This backstop exists so a scheduled run can
 * restore health if the Worker could not (rotated secret, cold start, quota). It refuses to
 * publish outside a supported phase and never fabricates a price.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createPublicClient, http, parseAbi } from 'viem';

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch { /* CI has no .env */ }
  return env;
}

const env = loadEnv();
if (!env.RH_TESTNET_RPC_PRIMARY || !env.YAHOO_REPORTER_PRIVATE_KEY) {
  console.log('keeper secrets are not configured; skipping.');
  process.exit(0);
}

const manifest = JSON.parse(readFileSync('evidence/deploy/testnet-46630.json', 'utf8'));
const queue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));
const client = createPublicClient({ transport: http(env.RH_TESTNET_RPC_PRIMARY) });

const interval = await client.readContract({
  address: manifest.calendarRegistry,
  abi: parseAbi(['function currentInterval(bytes32) view returns ((bytes32 assetId,uint16 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))']),
  functionName: 'currentInterval',
  args: [queue.stock.descriptorId],
});
const phase = Number(interval.phase);
if (![1, 2, 3].includes(phase)) {
  console.log(`calendar phase ${phase} has no Yahoo source; skipping keeper tick.`);
  process.exit(0);
}

try {
  const out = execFileSync('node', ['scripts/deploy/keeper-price.mjs', '--broadcast', '--gas=900000'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000,
  });
  console.log(out.trim().split('\n').slice(-8).join('\n'));
} catch (error) {
  const out = String(error.stdout ?? '') + String(error.stderr ?? '');
  console.log(out.trim().split('\n').slice(-12).join('\n'));
  // A stale or closed source is expected; do not fail the scheduled run for it.
  if (/STALE_SOURCE|no remaining validity/i.test(out)) {
    console.log('source unavailable this tick; exiting cleanly.');
    process.exit(0);
  }
  process.exit(1);
}
