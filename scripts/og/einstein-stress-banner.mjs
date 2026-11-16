#!/usr/bin/env node
/**
 * Draws the second X image (1200 by 675) for the first Einstein pool: the attacks that were refused and the exit that stayed open
 * while the pool was paused. Everything comes from evidence/einstein/proof.json, negatives.json, pause.json and exits.json.
 *
 *   node scripts/og/einstein-stress-banner.mjs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const assets = path.join(root, 'apps/web/public/assets');
const out = path.join(root, 'apps/web/public/og/einstein-stress.png');
const read = (f) => JSON.parse(readFileSync(path.join(root, 'evidence/einstein', f), 'utf8'));

const proof = read('proof.json');
const negatives = proof.negatives.filter((n) => n.mainnetTx);
const pause = read('pause.json');
const exits = read('exits.json');
if (!pause.pause || !pause.resume || !exits.some((e) => e.during === 'paused')) throw new Error('the pause, resume and paused exit must all be on record');

const LABELS = {
  N1: 'Calendar root, ECDSA only', N2: 'Valid ECDSA, wrong post-quantum key', N3: 'A signing leaf that was already spent',
  N4: 'Pause, ECDSA only', N5: 'Swap above the per-trade cap', N7: 'Swap while the pool is paused',
};
const rows = negatives.map((n) => `<li><b>${n.id}</b><span>${LABELS[n.id] ?? n.attempt}</span><code>${n.mustRevertWith === 'AuctionActive' ? 'PolicyBlocked' : n.mustRevertWith}</code></li>`).join('');

const font = (name, file, weight) => `@font-face{font-family:"${name}";src:url("${pathToFileURL(path.join(assets, file)).href}") format("woff2");font-weight:${weight};font-style:normal}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Instrument Sans', 'instrument-sans-v4.woff2', '400 700')}
${font('Geist Mono', 'geist-mono-v4.woff2', '400 600')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:675px;background:#171717;color:#EEECE5;font-family:"Instrument Sans",system-ui,sans-serif;overflow:hidden}
.tag{position:absolute;left:68px;top:56px;display:flex;gap:14px;align-items:center;font:500 16px/1 "Geist Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:#B7B4AD}
.tag b{padding:10px 14px;border:2px solid #C7444F;color:#E27478;font-weight:500}
h1{position:absolute;left:68px;top:128px;width:500px;font:650 58px/1.03 "Instrument Sans",sans-serif;letter-spacing:-.045em}
h1 em{color:#E27478;font-style:normal}
.lede{position:absolute;left:68px;top:372px;width:460px;color:#B7B4AD;font:400 23px/1.42 "Instrument Sans",sans-serif}
.url{position:absolute;left:68px;bottom:48px;color:#EEECE5;font:500 23px/1 "Instrument Sans",sans-serif}
.panel{position:absolute;left:604px;top:56px;width:528px;padding:22px 24px 8px;background:#201F1D;border:1px solid #3a3835}
.panel h2{font:500 12.5px/1 "Geist Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:#858177;margin-bottom:12px}
ul{list-style:none}
li{display:grid;grid-template-columns:34px 1fr auto;gap:12px;align-items:center;padding:13px 0;border-top:1px solid #34322f}
li b{font:600 15px/1 "Geist Mono",monospace;color:#E27478}
li span{font:500 17px/1.25 "Instrument Sans",sans-serif;color:#EEECE5}
li code{padding:6px 9px;border:1px solid #C7444F;color:#E27478;font:500 12.5px/1 "Geist Mono",monospace;letter-spacing:.02em}
.lane{position:absolute;left:604px;top:482px;width:528px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.lane div{display:grid;gap:7px;padding:13px 12px 12px;border:2px solid #C7444F}
.lane div.exit{background:#C7444F}
.lane b{font:650 19px/1.1 "Instrument Sans",sans-serif;letter-spacing:-.02em}
.lane small{font:500 10.5px/1.25 "Geist Mono",monospace;letter-spacing:.06em;text-transform:uppercase;color:rgba(238,236,229,.82)}
.lane div.no{border-style:dashed;border-color:#7a766d}
.lane div.no small{color:#B7B4AD}
</style></head><body>
<div class="tag"><b>Einstein Hooks v2</b><span>Tested on mainnet</span></div>
<h1>Paused with two signatures. <em>The exit stayed open.</em></h1>
<p class="lede">${negatives.length} attacks on the first pool reverted on Robinhood Chain. A reverted transaction spends no signing leaf.</p>
<p class="url">bellstocks.tech/einstein/pool</p>
<div class="panel"><h2>Attempts that had to fail, all reverted</h2><ul>${rows}</ul></div>
<div class="lane">
  <div><b>Paused</b><small>two signatures</small></div>
  <div class="no"><b>Swap</b><small>refused</small></div>
  <div class="exit"><b>Exit</b><small>went through</small></div>
  <div><b>Resumed</b><small>two signatures</small></div>
</div>
</body></html>`;

mkdirSync(path.dirname(out), { recursive: true });
const htmlPath = path.join(os.tmpdir(), 'einstein-stress-banner.html');
writeFileSync(htmlPath, html);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome or Edge found'); process.exit(1); }
const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,675', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(htmlPath).href], { encoding: 'utf8' });
if (r.status !== 0 || !existsSync(out)) { console.error('render failed', r.stderr?.slice(0, 200)); process.exit(1); }
console.log(`wrote ${path.relative(root, out)} (${statSync(out).size} bytes)`);
