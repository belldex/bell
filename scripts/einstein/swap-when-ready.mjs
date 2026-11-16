#!/usr/bin/env node
/**
 * Retries one small swap on the first Einstein pool until it goes through, then stops. A pool needs a few minutes after every
 * session change before it trades again, so a swap sent right at the boundary can be refused. The swap itself is
 * swap-first-pool.mjs, and every successful swap is appended to evidence/einstein/swaps.json.
 *
 *   node scripts/einstein/swap-when-ready.mjs --in usdg --amount 0.01 [--tries 15] [--wait 120]
 */
import { spawnSync } from 'node:child_process';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const tries = Number(arg('tries', '15'));
const wait = Number(arg('wait', '120'));
const direction = arg('in', 'usdg');
const amount = arg('amount', '0.01');

for (let i = 1; i <= tries; i += 1) {
  const r = spawnSync(process.execPath, ['scripts/einstein/swap-first-pool.mjs', '--in', direction, '--amount', amount, '--broadcast'], { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  console.log(`${new Date().toISOString()} try ${i}/${tries}: ${out.trim().split('\n').slice(-2).join(' | ').slice(0, 300)}`);
  if (/status success/.test(out)) process.exit(0);
  await new Promise((resolve) => setTimeout(resolve, wait * 1000));
}
console.error('no swap went through');
process.exit(1);
