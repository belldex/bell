#!/usr/bin/env node
/**
 * Keeps the ANT calendar interval active on mainnet and does nothing else. A pool only swaps inside an activated interval, and each interval
 * (PRE, REGULAR, POST, OVERNIGHT) is switched on by a plain call. The price report is not published here: the swap carries it
 * (see workers/keeper-b/src/ant-update.mjs), so this loop costs gas only at a session boundary, a few transactions a day.
 *
 *   node scripts/einstein/ant-interval-keeper.mjs --state evidence/deploy/mainnet-4663-ant.json [--every 60]
 */
import { spawnSync } from 'node:child_process';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const state = arg('state', 'evidence/deploy/mainnet-4663-ant.json');
const every = Number(arg('every', '60')) * 1000;

function tick() {
  const r = spawnSync(process.execPath, ['scripts/deploy/testnet-einstein-calendar.mjs', 'activate-interval', '--asset=ANT', '--broadcast', '--i-authorize-spend'], {
    encoding: 'utf8',
    env: { ...process.env, EINSTEIN_NETWORK: 'mainnet', ANT_STATE: state, BELL_CALENDAR_DAYS: '60', BELL_CALENDAR_STATE_PREFIX: 'evidence/deploy/pq-hooks-mainnet-calendar-state' },
  });
  const line = (r.stdout || r.stderr || '').trim().split('\n').at(-1) ?? '';
  console.log(`${new Date().toISOString()} ${r.status === 0 ? line.slice(0, 160) : `failed: ${line.slice(0, 160)}`}`);
}

for (;;) { try { tick(); } catch (e) { console.log(`tick failed: ${String(e.message).slice(0, 160)}`); } await new Promise((r) => setTimeout(r, every)); }
