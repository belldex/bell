#!/usr/bin/env node
/**
 * Copies what the Einstein pool bot Worker has done on chain into the evidence files that the proof is built from. Nothing it reads is
 * trusted: build-proof.mjs and the replay script check every transaction against the chain.
 *
 *   node scripts/einstein/import-bot-state.mjs --file bot-state.json
 *   node scripts/einstein/import-bot-state.mjs --url https://bell-einstein-bot.<account>.workers.dev/state
 *
 * Session swaps are appended to evidence/einstein/swaps.json. Auction cycles that had orders go to evidence/einstein/auction.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const state = arg('file') ? JSON.parse(readFileSync(arg('file'), 'utf8')) : await (await fetch(arg('url') ?? (() => { throw new Error('pass --file or --url'); })())).json();
const read = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };

const swapsFile = 'evidence/einstein/swaps.json';
const swaps = read(swapsFile, []);
let added = 0;
for (const [session, s] of Object.entries(state.swaps ?? {})) {
  if (swaps.some((x) => x.tx === s.tx)) continue;
  swaps.push({ tx: s.tx, block: s.block, status: 'success', swapper: 'bot', direction: 'usdg', amountInRaw: '10000', feePips: s.feePips, session, source: 'bot' });
  added += 1;
}
if (added) writeFileSync(swapsFile, `${JSON.stringify(swaps, null, 2)}\n`);

const cycles = Object.entries(state.auction?.cycles ?? {}).filter(([, c]) => c.orders?.length);
if (cycles.length) writeFileSync('evidence/einstein/auction.json', `${JSON.stringify({ source: 'bot', cycles: Object.fromEntries(cycles) }, null, 2)}\n`);
console.log(`${added} swap(s) added, ${cycles.length} auction cycle(s) with orders`);
if (state.errors?.length) console.log('bot errors:', state.errors.join(' | '));
