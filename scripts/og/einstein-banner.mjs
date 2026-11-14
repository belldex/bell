#!/usr/bin/env node
/**
 * Draws the share banner (Open Graph and Twitter large card, 1200 by 630) for /einstein and writes
 * apps/web/public/og/einstein.png. It is built from the page's own facts: the grid is the governance key's 4,096 one-time
 * signing leaves, with the three spent ones (the AAPL, NVDA and TSLA calendar roots) in red and the next one outlined.
 *
 *   node scripts/og/einstein-banner.mjs
 *
 * Needs Chrome or Edge, which renders the page. Fonts are the site's own Instrument Sans and Geist Mono.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const assets = path.join(root, 'apps/web/public/assets');
const outDir = path.join(root, 'apps/web/public/og');
const out = path.join(outDir, 'einstein.png');

const SPENT = 3; // leaves 1 to 3 are spent, leaf 4 is next
const COLS = 64;
const SIZE = 424; // the grid, in pixels
const cell = SIZE / COLS;
const gap = 1.3;

let rects = '';
for (let i = 0; i < COLS * COLS; i++) {
  const x = (i % COLS) * cell + gap / 2;
  const y = Math.floor(i / COLS) * cell + gap / 2;
  const s = (cell - gap).toFixed(2);
  if (i < SPENT) rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${s}" height="${s}" fill="#C7444F"/>`;
  else if (i === SPENT) rects += `<rect x="${(x - 0.6).toFixed(2)}" y="${(y - 0.6).toFixed(2)}" width="${(cell - gap + 1.2).toFixed(2)}" height="${(cell - gap + 1.2).toFixed(2)}" fill="none" stroke="#E27478" stroke-width="1.4"/>`;
  else rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${s}" height="${s}" fill="rgba(238,236,229,0.2)"/>`;
}

const font = (name, file, weight) => `@font-face{font-family:"${name}";src:url("${pathToFileURL(path.join(assets, file)).href}") format("woff2");font-weight:${weight};font-style:normal}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Instrument Sans', 'instrument-sans-v4.woff2', '400 700')}
${font('Geist Mono', 'geist-mono-v4.woff2', '400 600')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:630px;background:#171717;color:#EEECE5;font-family:"Instrument Sans",system-ui,sans-serif;overflow:hidden}
.tag{position:absolute;left:72px;top:64px;display:flex;gap:14px;align-items:center;font:500 17px/1 "Geist Mono",monospace;letter-spacing:.16em;text-transform:uppercase}
.tag span{color:#B7B4AD}
.tag b{padding:11px 16px;border:2px solid #C7444F;color:#E27478;font-weight:500}
h1{position:absolute;left:72px;top:150px;width:600px;font:650 62px/1.02 "Instrument Sans",sans-serif;letter-spacing:-.045em}
h1 em{color:#E27478;font-style:normal}
.lede{position:absolute;left:72px;top:390px;width:540px;color:#B7B4AD;font:400 24px/1.4 "Instrument Sans",sans-serif}
.url{position:absolute;left:72px;bottom:54px;color:#EEECE5;font:500 24px/1 "Instrument Sans",sans-serif}
.grid{position:absolute;left:704px;top:92px}
.cap{position:absolute;left:704px;top:54px;width:${SIZE}px;display:flex;justify-content:space-between;align-items:baseline;color:#EEECE5;font:500 19px/1 "Instrument Sans",sans-serif}
.cap b{color:#E27478;font:500 16px/1 "Geist Mono",monospace;letter-spacing:.06em;text-transform:uppercase}
.strip{position:absolute;left:704px;top:${92 + SIZE + 16}px;width:${SIZE}px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.strip div{display:flex;flex-direction:column;justify-content:center;gap:5px;height:54px;padding:0 9px;white-space:nowrap;overflow:hidden;border:2px solid #C7444F;font:650 21px/1 "Instrument Sans",sans-serif}
.strip div small{font:500 10.5px/1 "Geist Mono",monospace;letter-spacing:.04em;color:rgba(238,236,229,.8)}
.strip .on{background:#C7444F}
.strip .next{border-style:dashed;color:#EEECE5}
.strip .next small{color:#B7B4AD}
</style></head><body>
<div class="tag"><b>Einstein Hooks v2</b><span>Live on mainnet</span></div>
<h1>Changing the rules takes <em>two signatures.</em> Leaving takes none.</h1>
<p class="lede">Post-quantum governance for BELL on Robinhood Chain. Your exit never asks for either.</p>
<p class="url">bellstocks.tech/einstein</p>
<p class="cap"><span>One square, one signature.</span><b>3 of 4,096 spent</b></p>
<svg class="grid" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="#201F1D"/>${rects}</svg>
<div class="strip"><div class="on">AAPL<small>root signed</small></div><div class="on">NVDA<small>root signed</small></div><div class="on">TSLA<small>root signed</small></div><div class="next">Next<small>not signed</small></div></div>
</body></html>`;

mkdirSync(outDir, { recursive: true });
const htmlPath = path.join(os.tmpdir(), 'einstein-banner.html');
writeFileSync(htmlPath, html);

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome or Edge found'); process.exit(1); }
const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(htmlPath).href], { encoding: 'utf8' });
if (r.status !== 0 || !existsSync(out)) { console.error('render failed', r.stderr?.slice(0, 200)); process.exit(1); }
console.log(`wrote ${path.relative(root, out)} (${statSync(out).size} bytes)`);
