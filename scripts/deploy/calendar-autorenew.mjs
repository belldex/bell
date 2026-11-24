#!/usr/bin/env node
/**
 * Renews a mainnet calendar root on its own, step by step, from a scheduler. It never decides from memory: each run reads the asset's state file
 * and the chain time, picks the one next step, runs it through testnet-einstein-calendar.mjs (the lifecycle script the PQ stack already uses:
 * queue, execute-governance, activate-root, activate-interval), and exits. A step that is not due yet is not an error.
 *
 *   node scripts/deploy/calendar-autorenew.mjs --asset ANT [--dry]
 *
 * The registry accepts a new root only when it starts where the active one ends, so the queue step is due in the last 30 days of the current
 * root, and the next root runs to the end of the next UTC year. A root operation expires seven days after it is queued and a missed window cannot be
 * recovered (the (asset, year) slot is burned), so every step is attempted on every run until it is done. Roots are also written to
 * evidence/deploy/calendar-roots-<ASSET>.json, which the Worker reads to keep intervals active after the first root ends.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const RENEW_WITHIN_SECONDS = 30 * 86_400;

/** Pure decision. `state` is the asset's calendar state file, `now` is chain time. Returns { action, reason }. */
export function nextAction(state, now) {
  if (!state?.stage) return { action: 'alert', reason: 'no calendar state for this asset' };
  const start = Number(state.coverageStart); const end = Number(state.coverageEnd);
  const future = start > now;
  if (state.stage === 'GOVERNANCE_QUEUED') {
    if (now >= start) return { action: 'alert', reason: 'the queued root reached its coverage start before it was activated: its window is gone and the asset needs a new identity' };
    return now >= Number(state.governanceEta) ? { action: 'execute-governance', reason: 'the governance delay has passed' } : { action: 'wait', reason: `governance ETA ${new Date(Number(state.governanceEta) * 1000).toISOString()}` };
  }
  if (state.stage === 'QUEUED') {
    if (now >= start) return { action: 'alert', reason: 'the queued root reached its coverage start before it was activated: its window is gone and the asset needs a new identity' };
    if (state.rootExpiry && now > Number(state.rootExpiry)) return { action: 'alert', reason: 'the queued root operation expired' };
    return now >= Number(state.rootEta) ? { action: 'activate-root', reason: 'the root delay has passed' } : { action: 'wait', reason: `root ETA ${new Date(Number(state.rootEta) * 1000).toISOString()}` };
  }
  if (state.stage === 'ROOT_ACTIVE' || state.stage === 'INTERVAL_ACTIVE') {
    if (future) return { action: 'wait', reason: `the next root starts ${new Date(start * 1000).toISOString()}` };
    if (now >= end) return { action: 'alert', reason: 'the active root has ended and no next root is active' };
    if (state.stage === 'ROOT_ACTIVE') return { action: 'activate-interval', reason: 'the root is active and its coverage has started' };
    return end - now <= RENEW_WITHIN_SECONDS ? { action: 'queue', reason: `${((end - now) / 86400).toFixed(0)} days of coverage left` } : { action: 'idle', reason: `${((end - now) / 86400).toFixed(0)} days of coverage left` };
  }
  return { action: 'alert', reason: `unknown stage ${state.stage}` };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const asset = arg('asset');
  if (!asset) throw new Error('usage: calendar-autorenew.mjs --asset ANT [--dry]');
  const dry = process.argv.includes('--dry');
  const prefix = 'evidence/deploy/pq-hooks-mainnet-calendar-state';
  const stateFile = `${prefix}-${asset}.json`;
  if (!existsSync(stateFile)) throw new Error(`no state file ${stateFile}`);
  const { createPublicClient, http } = await import('viem');
  const rpc = process.env.RH_MAINNET_RPC_PRIMARY || 'https://rpc.mainnet.chain.robinhood.com';
  const now = Number((await createPublicClient({ transport: http(rpc) }).getBlock()).timestamp);
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const decision = nextAction(state, now);
  console.log(`${asset}: stage ${state.stage}, ${decision.action}: ${decision.reason}`);
  if (decision.action === 'alert') { console.log(`::error::${asset} calendar: ${decision.reason}`); process.exit(2); }
  if (['idle', 'wait'].includes(decision.action) || dry) process.exit(0);
  const env = { ...process.env, EINSTEIN_NETWORK: 'mainnet', BELL_CALENDAR_DAYS: '365', BELL_CALENDAR_STATE_PREFIX: prefix, ANT_STATE: 'evidence/deploy/mainnet-4663-ant.json' };
  const r = spawnSync(process.execPath, ['scripts/deploy/testnet-einstein-calendar.mjs', decision.action, `--asset=${asset}`, '--broadcast', '--i-authorize-spend'], { encoding: 'utf8', env });
  process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? '');
  if (r.status !== 0) process.exit(r.status ?? 1);
  // Keep the roots file the Worker reads in step with the state: every root that was queued is listed with the metadata needed to rebuild it.
  const after = JSON.parse(readFileSync(stateFile, 'utf8'));
  const rootsFile = `evidence/deploy/calendar-roots-${asset}.json`;
  const doc = existsSync(rootsFile) ? JSON.parse(readFileSync(rootsFile, 'utf8')) : { asset, assetId: after.assetId, calendarRegistry: after.calendarRegistry, roots: [] };
  if (after.root && !doc.roots.some((x) => x.root.toLowerCase() === after.root.toLowerCase())) {
    doc.roots.push({ root: after.root, year: after.year, coverageStart: Number(after.coverageStart), coverageEnd: Number(after.coverageEnd), capabilityMask: 30 });
    doc.roots.sort((a, b) => a.coverageStart - b.coverageStart);
  }
  writeFileSync(rootsFile, `${JSON.stringify(doc, null, 2)}\n`);
}
