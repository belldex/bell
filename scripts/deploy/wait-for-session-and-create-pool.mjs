#!/usr/bin/env node
/**
 * Wait for the next tradeable session, then create and seed the pool.
 *
 * `create-testnet-pool.mjs` deliberately refuses to run during CLOSED phases because there is no
 * admitted Yahoo wire to report. This driver waits for the calendar to reach a supported phase
 * (PRE or REGULAR), refreshes health, and then runs the normal creation path once.
 *
 * It does not fabricate a price or skip the factory preflight; it only removes the timing
 * problem of being awake at the right moment.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi } from 'viem';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const manifest = JSON.parse(readFileSync('evidence/deploy/testnet-46630.json', 'utf8'));
const queue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));
const client = createPublicClient({ transport: http(env.RH_TESTNET_RPC_PRIMARY) });

const CALENDAR_ABI = parseAbi([
  'function currentInterval(bytes32) view returns ((bytes32 assetId,uint16 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))',
]);
const SESSION_ABI = parseAbi([
  'function health(bytes32) view returns ((bool ready,uint32 reasonBits,uint64 validUntil,uint64 refreshedAt,uint64 healthySince,uint64 latestObservation))',
]);

function phaseLabel(phase) {
  return phase === 1 ? 'PRE' : phase === 2 ? 'REGULAR' : phase === 3 ? 'POST' : phase === 5 ? 'CLOSED' : `UNKNOWN(${phase})`;
}

async function readPhase() {
  const interval = await client.readContract({
    address: manifest.calendarRegistry,
    abi: CALENDAR_ABI,
    functionName: 'currentInterval',
    args: [queue.stock.descriptorId],
  });
  const block = await client.getBlock();
  return { phase: Number(interval.phase), start: Number(interval.start), end: Number(interval.end), now: Number(block.timestamp) };
}

async function readHealth() {
  return client.readContract({
    address: manifest.sessionRegistry,
    abi: SESSION_ABI,
    functionName: 'health',
    args: [queue.stock.descriptorId],
  });
}

function run(script, args = []) {
  console.log(`\n>>> node ${script} ${args.join(' ')}`);
  const out = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900_000 });
  console.log(out.trim().split('\n').slice(-12).join('\n'));
  return out;
}

for (;;) {
  const state = await readPhase();
  const label = phaseLabel(state.phase);
  console.log(`[${new Date().toISOString()}] calendar phase ${state.phase} (${label}), window ${new Date(state.start * 1000).toISOString()} .. ${new Date(state.end * 1000).toISOString()}`);

  if (state.phase === 1 || state.phase === 2 || state.phase === 3) {
    // The deployed Cloudflare keeper owns publishing; wait for its health instead of
    // publishing from here, so two signers never race on the same reporter nonce.
    const health = await readHealth();
    const fresh = health.ready && Number(health.validUntil) > state.now;
    if (!fresh) {
      console.log(`session open but health is not ready yet (ready=${health.ready} reasons=${health.reasonBits}); waiting for the Cloudflare keeper`);
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      continue;
    }
    console.log(`health ready (validUntil ${new Date(Number(health.validUntil) * 1000).toISOString()}); creating pool`);
    run('scripts/deploy/create-testnet-pool.mjs');
    console.log('\n>>> Pool created during a live session. <<<');
    process.exit(0);
  }

  const waitSeconds = Math.max(30, Math.min(600, state.end - state.now + 5));
  console.log(`market closed; checking again in ${waitSeconds}s`);
  await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
}
