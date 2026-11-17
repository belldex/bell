#!/usr/bin/env node
/**
 * Draws the v3 Evolve announcement image (1200 by 675): the two pools of the test and its window. Everything comes from
 * evidence/einstein/v3-evolve/method.json and proof.json, and the image says the run has not started while it has not.
 *
 *   node scripts/og/einstein-v3-banner.mjs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const assets = path.join(root, 'apps/web/public/assets');
const out = path.join(root, 'apps/web/public/og/einstein-v3-evolve.png');
const proof = JSON.parse(readFileSync(path.join(root, 'evidence/einstein/v3-evolve/proof.json'), 'utf8'));
const run = proof.runs[0];
const started = run.status !== 'scheduled';
const et = (ts) => new Date(ts * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false });

const font = (name, file, weight) => `@font-face{font-family:"${name}";src:url("${pathToFileURL(path.join(assets, file)).href}") format("woff2");font-weight:${weight};font-style:normal}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Instrument Sans', 'instrument-sans-v4.woff2', '400 700')}
${font('Geist Mono', 'geist-mono-v4.woff2', '400 600')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:675px;background:#171717;color:#EEECE5;font-family:"Instrument Sans",system-ui,sans-serif;overflow:hidden}
.tag{position:absolute;left:68px;top:56px;display:flex;gap:14px;align-items:center;font:500 16px/1 "Geist Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:#B7B4AD}
.tag b{padding:10px 14px;border:2px solid #C7444F;color:#E27478;font-weight:500}
h1{position:absolute;left:68px;top:124px;width:1000px;font:650 60px/1.03 "Instrument Sans",sans-serif;letter-spacing:-.045em}
h1 em{color:#E27478;font-style:normal}
.row{position:absolute;left:68px;top:300px;width:1064px;display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{padding:22px 26px 20px;background:#201F1D;border:1px solid #3a3835;height:210px}
.card.bell{border:2px solid #C7444F}
.card small{font:500 13px/1 "Geist Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:#858177}
.card h2{margin:12px 0 14px;font:650 32px/1 "Instrument Sans",sans-serif;letter-spacing:-.03em}
.card p{font:500 19px/1.4 "Instrument Sans",sans-serif;color:#B7B4AD}
.card p b{color:#EEECE5;font-weight:600}
.foot{position:absolute;left:68px;right:68px;bottom:44px;display:flex;justify-content:space-between;align-items:flex-end}
.url{color:#EEECE5;font:500 22px/1 "Instrument Sans",sans-serif}
.win{color:#B7B4AD;font:500 15px/1.5 "Geist Mono",monospace;letter-spacing:.05em;text-transform:uppercase;text-align:right}
.win b{color:#E27478;font-weight:500}
</style></head><body>
<div class="tag"><b>Einstein Hooks v3 Evolve</b><span>${started ? 'Run in progress' : 'Run 1 not started yet'}</span></div>
<h1>Same capital. Same range. <em>Only the hook differs.</em></h1>
<div class="row">
  <div class="card bell"><small>Pool 1</small><h2>BELL pool</h2><p>NVDA/USDG with the Einstein hook.<br>Session fees: <b>0.05%</b> regular, <b>0.30%</b> pre and post, <b>0.50%</b> overnight, <b>1%</b> closed.</p></div>
  <div class="card"><small>Pool 2</small><h2>Plain Uniswap v4</h2><p>NVDA/USDG with no hook.<br>Fixed fee: <b>0.30%</b>, the common v4 tier. Seeded in the same block or the next.</p></div>
</div>
<div class="foot">
  <p class="url">bellstocks.tech/einstein/v3-evolve</p>
  <p class="win">${et(run.window.startTs)} <b>to</b> ${et(run.window.endTs)} ET<br>Net LP result, from Swap events, replayable</p>
</div>
</body></html>`;

mkdirSync(path.dirname(out), { recursive: true });
const htmlPath = path.join(os.tmpdir(), 'einstein-v3-banner.html');
writeFileSync(htmlPath, html);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome or Edge found'); process.exit(1); }
const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,675', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(htmlPath).href], { encoding: 'utf8' });
if (r.status !== 0 || !existsSync(out)) { console.error('render failed', r.stderr?.slice(0, 200)); process.exit(1); }
console.log(`wrote ${path.relative(root, out)} (${statSync(out).size} bytes)`);
