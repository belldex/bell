#!/usr/bin/env node
/**
 * Replays the Einstein Hooks v3 Evolve LP economics proof against a public RPC. No keys, no team API.
 *
 *   node scripts/einstein/verify-v3-evolve.mjs --rpc <public Robinhood Chain RPC> --run 1 [--proof evidence/einstein/v3-evolve/proof.json]
 *
 * It rebuilds the run from the Swap events with the same code that built the page and compares the numbers. PASS, FAIL or PENDING
 * per claim E1 to E8; E9 passes when E1 to E8 do. PENDING is never a PASS. A run that has not started stays PENDING.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { rpcFactory, runProof } from './verify-einstein-pool.mjs';
import { buildRun, feedAt } from './v3-evolve/chain.mjs';

const ZERO = '0x0000000000000000000000000000000000000000';
const INITIALIZE = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const hex = (n) => `0x${n.toString(16)}`;

async function initializedWith(rpc, cfg, pool) {
  const logs = await rpc('eth_getLogs', [{ address: cfg.chain.poolManager, topics: [INITIALIZE, pool.poolId], fromBlock: hex(pool.seedBlock - 5000), toBlock: hex(pool.seedBlock) }]);
  if (!logs.length) return null;
  return `0x${logs[0].data.slice(2 + 2 * 64 + 24, 2 + 3 * 64)}`.toLowerCase(); // id, currency0 and currency1 are topics; the data is fee, tickSpacing, hooks, sqrtPriceX96, tick
}

export async function verifyRun(run, rpc, root = '.') {
  const out = {};
  const pending = (why) => Object.fromEntries(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'].map((id) => [id, { verdict: 'PENDING', note: why }]));
  if (run.status === 'scheduled' || !run.config) return { ...pending(run.note ?? 'The run has not started, so there is nothing to check.'), E9: { verdict: 'PENDING', note: 'Nothing to replay yet.' } };
  const cfg = run.config;
  const again = await buildRun({ ...cfg, blocks: run.result.blocks }, rpc);
  const { bell, control } = cfg.pools;
  const b = again.bell; const c = again.control;

  const sameTicks = bell.tickLower === control.tickLower && bell.tickUpper === control.tickUpper;
  const capitalGap = Math.abs(b.startCapital - c.startCapital);
  const seedGap = Math.abs(bell.seedBlock - control.seedBlock);
  out.E1 = capitalGap <= 1 && sameTicks && seedGap <= 2
    ? { verdict: 'PASS', note: `capital ${b.startCapital} and ${c.startCapital} USDG (gap ${capitalGap.toFixed(4)}), same ticks, seeded ${seedGap} blocks apart` }
    : { verdict: 'FAIL', note: `capital gap ${capitalGap.toFixed(4)} USDG, same ticks ${sameTicks}, seed gap ${seedGap} blocks` };

  const hooks = [await initializedWith(rpc, cfg, bell), await initializedWith(rpc, cfg, control)];
  out.E2 = hooks[1] === ZERO && hooks[0] === bell.hook.toLowerCase()
    ? { verdict: 'PASS', note: `control pool hook is the zero address, BELL pool hook is ${bell.hook}` }
    : { verdict: 'FAIL', note: `Initialize events gave hooks ${hooks.join(' and ')}` };

  const end = await feedAt(rpc, cfg.chain.feed, run.result.blocks.end);
  const r = run.result.reference.end;
  out.E3 = r.fresh && end.roundId === r.roundId && near(end.price, r.price)
    ? { verdict: 'PASS', note: `feed round ${end.roundId} at ${end.price} read again at block ${run.result.blocks.end}, published ${end.updatedAt}` }
    : { verdict: 'FAIL', note: `end round fresh ${r.fresh}, replay read ${end.roundId} at ${end.price}` };

  const cmp = (id, key, what) => {
    const ok = near(b[key], run.result.bell[key]) && near(c[key], run.result.control[key]);
    out[id] = ok ? { verdict: 'PASS', note: `${what}: BELL ${b[key]}, control ${c[key]} (matches the page)` } : { verdict: 'FAIL', note: `${what} differs: replay ${b[key]} and ${c[key]}, page ${run.result.bell[key]} and ${run.result.control[key]}` };
  };
  cmp('E4', 'feesEarned', 'fees earned'); cmp('E5', 'lvr', 'LVR'); cmp('E6', 'netBps', 'net LP result in bps');

  const src = cfg.bot?.sourceFile && existsSync(`${root}/${cfg.bot.sourceFile}`) ? createHash('sha256').update(readFileSync(`${root}/${cfg.bot.sourceFile}`)).digest('hex') : null;
  const botRows = [...b.rows, ...c.rows].filter((x) => x.kind === 'bot');
  const tooBig = botRows.filter((x) => x.inToken === 'USDG' && x.in > cfg.bot.maxUsdg + 1e-9);
  const botSides = [b, c].map((p) => p.rows.filter((x) => x.kind === 'bot').length);
  out.E7 = src && src === cfg.bot.sourceSha256 && !tooBig.length && botSides[0] > 0 && botSides[1] > 0
    ? { verdict: 'PASS', note: `bot source matches ${cfg.bot.sourceSha256.slice(0, 12)}…, ${botSides[0]} bot swaps on BELL and ${botSides[1]} on the control, none above ${cfg.bot.maxUsdg} USDG` }
    : { verdict: 'FAIL', note: `source hash ${src ? src.slice(0, 12) : 'missing'} vs ${cfg.bot?.sourceSha256?.slice(0, 12)}, over-size ${tooBig.length}, bot swaps ${botSides.join(' and ')}` };

  if (!cfg.blocked?.length) out.E8 = { verdict: 'PENDING', note: 'No refused swap is on record for this run.' };
  else {
    const res = await runProof({ chain: { id: 4663 }, claims: [{ id: 'E8', checks: cfg.blocked.map((x) => ({ kind: 'revertReason', tx: x.tx, selector: x.selector, error: x.error, label: x.error })) }] }, rpc);
    out.E8 = { verdict: res[0].verdict === 'PASS' ? 'PASS' : 'FAIL', note: res[0].note };
  }
  const all = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'];
  out.E9 = all.every((id) => out[id].verdict === 'PASS') ? { verdict: 'PASS', note: 'E1 to E8 all pass from a public RPC.' }
    : { verdict: all.some((id) => out[id].verdict === 'FAIL') ? 'FAIL' : 'PARTIAL', note: 'Not every one of E1 to E8 passes yet.' };
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const proof = JSON.parse(readFileSync(arg('proof', 'evidence/einstein/v3-evolve/proof.json'), 'utf8'));
  const url = arg('rpc', process.env.RPC_URL);
  if (!url) { console.error('usage: verify-v3-evolve.mjs --rpc <public RPC url> --run 1'); process.exit(2); }
  const rpc = await rpcFactory(url);
  const chainId = parseInt(await rpc('eth_chainId', []), 16);
  if (chainId !== proof.chain.id) { console.error(`RPC is chain ${chainId}, expected ${proof.chain.id}`); process.exit(2); }
  const run = proof.runs.find((x) => x.id === Number(arg('run', '1')));
  if (!run) { console.error('no such run in proof.json'); process.exit(2); }
  const res = await verifyRun(run, rpc);
  for (const [id, r] of Object.entries(res)) console.log(`${id.padEnd(3)} ${r.verdict.padEnd(7)} ${r.note}`);
  const vals = Object.values(res);
  const n = (v) => vals.filter((r) => r.verdict === v).length;
  console.log(`\n${n('PASS')} PASS, ${n('PARTIAL')} PARTIAL, ${n('PENDING')} PENDING, ${n('FAIL')} FAIL`);
  process.exit(n('FAIL') ? 1 : 0);
}
