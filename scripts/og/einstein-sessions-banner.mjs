#!/usr/bin/env node
/**
 * Draws the third X image (1200 by 675) for the first Einstein pool: one real swap in each trading session and the fee the hook
 * charged for it. Everything comes from evidence/einstein/swaps.json; a session with no swap on record stops the script.
 *
 *   node scripts/og/einstein-sessions-banner.mjs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const assets = path.join(root, 'apps/web/public/assets');
const out = path.join(root, 'apps/web/public/og/einstein-sessions.png');
const swaps = JSON.parse(readFileSync(path.join(root, 'evidence/einstein/swaps.json'), 'utf8')).filter((s) => s.status === 'success');

const SESSIONS = [
  { name: 'Closed', fee: 10000, note: 'weekend, widest fee' },
  { name: 'Overnight', fee: 5000, note: '20:00 to 04:00 ET' },
  { name: 'Pre-market', fee: 3000, note: '04:00 to 09:30 ET' },
  { name: 'Regular', fee: 500, note: '09:30 to 16:00 ET' },
];
const cards = SESSIONS.map((s) => {
  const swap = [...swaps].reverse().find((x) => Number(x.feePips) === s.fee);
  if (!swap) throw new Error(`no swap on record at ${s.fee} pips (${s.name})`);
  return `<div class="card"><small>${s.name}</small><b>${s.fee / 10000}%</b><i style="height:${Math.max(6, Math.round(s.fee / 10000 * 150))}px"></i><span>${s.note}</span><code>${swap.tx.slice(0, 10)}…${swap.tx.slice(-4)}</code></div>`;
}).join('');

const font = (name, file, weight) => `@font-face{font-family:"${name}";src:url("${pathToFileURL(path.join(assets, file)).href}") format("woff2");font-weight:${weight};font-style:normal}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Instrument Sans', 'instrument-sans-v4.woff2', '400 700')}
${font('Geist Mono', 'geist-mono-v4.woff2', '400 600')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:675px;background:#171717;color:#EEECE5;font-family:"Instrument Sans",system-ui,sans-serif;overflow:hidden}
.tag{position:absolute;left:68px;top:56px;display:flex;gap:14px;align-items:center;font:500 16px/1 "Geist Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:#B7B4AD}
.tag b{padding:10px 14px;border:2px solid #C7444F;color:#E27478;font-weight:500}
h1{position:absolute;left:68px;top:124px;width:1000px;font:650 56px/1.04 "Instrument Sans",sans-serif;letter-spacing:-.045em}
h1 em{color:#E27478;font-style:normal}
.row{position:absolute;left:68px;top:292px;width:1064px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.card{display:flex;flex-direction:column;justify-content:flex-end;gap:8px;height:270px;padding:18px 18px 16px;background:#201F1D;border:1px solid #3a3835;position:relative}
.card small{font:500 13px/1 "Geist Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:#858177}
.card b{font:650 46px/1 "Instrument Sans",sans-serif;letter-spacing:-.04em;color:#EEECE5}
.card i{display:block;width:100%;background:#C7444F}
.card span{font:500 15px/1.2 "Instrument Sans",sans-serif;color:#B7B4AD}
.card code{font:500 12.5px/1 "Geist Mono",monospace;color:#E27478}
.url{position:absolute;left:68px;bottom:44px;color:#EEECE5;font:500 22px/1 "Instrument Sans",sans-serif}
.note{position:absolute;right:68px;bottom:46px;color:#858177;font:500 14px/1 "Geist Mono",monospace;letter-spacing:.06em;text-transform:uppercase}
</style></head><body>
<div class="tag"><b>Einstein Hooks v2</b><span>Tested on mainnet</span></div>
<h1>One real swap in every session. <em>Four different fees.</em></h1>
<div class="row">${cards}</div>
<p class="url">bellstocks.tech/einstein/pool</p>
<p class="note">Fee read from the PoolManager Swap event</p>
</body></html>`;

mkdirSync(path.dirname(out), { recursive: true });
const htmlPath = path.join(os.tmpdir(), 'einstein-sessions-banner.html');
writeFileSync(htmlPath, html);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome or Edge found'); process.exit(1); }
const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,675', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(htmlPath).href], { encoding: 'utf8' });
if (r.status !== 0 || !existsSync(out)) { console.error('render failed', r.stderr?.slice(0, 200)); process.exit(1); }
console.log(`wrote ${path.relative(root, out)} (${statSync(out).size} bytes)`);
