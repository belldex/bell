#!/usr/bin/env node
/**
 * Draws the X image (1200 by 675) for the first Einstein pool and writes apps/web/public/og/einstein-pool.png.
 * Everything on it comes from evidence/einstein/proof.json: the hook address, which of its 14 permission bits are lit, and the
 * verdict counts of the last replay.
 *
 *   node scripts/og/einstein-pool-banner.mjs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const assets = path.join(root, 'apps/web/public/assets');
const outDir = path.join(root, 'apps/web/public/og');
const out = path.join(outDir, 'einstein-pool.png');

const proof = JSON.parse(readFileSync(path.join(root, 'evidence/einstein/proof.json'), 'utf8'));
if (!proof.pool) throw new Error('proof.json has no pool yet');
const hook = proof.pool.hook;
const low = Number(BigInt(hook) & 0x3fffn);
const verdicts = proof.claims.map((c) => c.result?.verdict ?? 'PENDING');
const count = (v) => verdicts.filter((x) => x === v).length;

const NAMES = ['before initialize', 'after initialize', 'before add liquidity', 'after add liquidity', 'before remove liquidity', 'after remove liquidity',
  'before swap', 'after swap', 'before donate', 'after donate', 'before swap delta', 'after swap delta', 'after add delta', 'after remove delta'];
const EXIT = new Set([4, 5, 13]);
const cells = NAMES.map((name, i) => {
  const on = ((low >> (13 - i)) & 1) === 1;
  const cls = EXIT.has(i) ? 'exit' : on ? 'on' : 'off';
  return `<li class="${cls}"><i></i><span>${name}</span></li>`;
}).join('');

const font = (name, file, weight) => `@font-face{font-family:"${name}";src:url("${pathToFileURL(path.join(assets, file)).href}") format("woff2");font-weight:${weight};font-style:normal}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Instrument Sans', 'instrument-sans-v4.woff2', '400 700')}
${font('Geist Mono', 'geist-mono-v4.woff2', '400 600')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:675px;background:#171717;color:#EEECE5;font-family:"Instrument Sans",system-ui,sans-serif;overflow:hidden}
.tag{position:absolute;left:68px;top:56px;display:flex;gap:14px;align-items:center;font:500 16px/1 "Geist Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:#B7B4AD}
.tag b{padding:10px 14px;border:2px solid #C7444F;color:#E27478;font-weight:500}
h1{position:absolute;left:68px;top:128px;width:520px;font:650 60px/1.02 "Instrument Sans",sans-serif;letter-spacing:-.045em}
h1 em{color:#E27478;font-style:normal}
.lede{position:absolute;left:68px;top:350px;width:480px;color:#B7B4AD;font:400 23px/1.42 "Instrument Sans",sans-serif}
.url{position:absolute;left:68px;bottom:48px;color:#EEECE5;font:500 23px/1 "Instrument Sans",sans-serif}
.panel{position:absolute;left:640px;top:56px;width:492px;padding:26px;background:#201F1D;border:1px solid #3a3835}
.addr{font:500 15px/1.5 "Geist Mono",monospace;letter-spacing:.01em;color:#858177;word-break:break-all;margin-bottom:22px}
.addr b{color:#E27478;font-weight:600}
ol{list-style:none;display:grid;grid-template-columns:repeat(7,1fr);gap:8px 7px}
li{display:grid;gap:7px;align-content:start}
li i{display:block;aspect-ratio:1;background:rgba(238,236,229,.09)}
li.on i{background:#C7444F;box-shadow:0 0 0 1px #E27478 inset}
li.exit i{background:transparent;border:2px dashed #B7B4AD}
li span{font:500 9.5px/1.22 "Geist Mono",monospace;letter-spacing:.03em;text-transform:uppercase;color:#858177}
li.on span{color:#EEECE5}
li.exit span{color:#B7B4AD}
.note{margin-top:20px;color:#B7B4AD;font:400 15.5px/1.5 "Instrument Sans",sans-serif}
.stats{position:absolute;left:640px;top:482px;width:492px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.stats div{display:grid;gap:8px;padding:14px 14px 13px;border:2px solid #C7444F}
.stats div.solid{background:#C7444F}
.stats div.dim{border-style:dashed;border-color:#5a5750}
.stats b{font:650 34px/1 "Instrument Sans",sans-serif;letter-spacing:-.03em}
.stats small{font:500 11px/1 "Geist Mono",monospace;letter-spacing:.1em;text-transform:uppercase;color:rgba(238,236,229,.85)}
.stats .dim small{color:#B7B4AD}
</style></head><body>
<div class="tag"><b>Einstein Hooks v2</b><span>First pool live</span></div>
<h1>The first pool is live. <em>Exit never calls its hook.</em></h1>
<p class="lede">NVDA/USDG on Robinhood Chain, with every claim linked to a transaction or marked pending.</p>
<p class="url">bellstocks.tech/einstein/pool</p>
<div class="panel">
  <p class="addr">0x${hook.slice(2, 38)}<b>${hook.slice(38)}</b></p>
  <ol>${cells}</ol>
  <p class="note">Lit squares are the five callbacks this hook has. The three dashed ones are the remove-liquidity callbacks, and they are off.</p>
</div>
<div class="stats">
  <div class="solid"><b>${count('PASS')}</b><small>proven</small></div>
  <div><b>${count('PARTIAL')}</b><small>partly proven</small></div>
  <div class="dim"><b>${count('PENDING')}</b><small>pending</small></div>
</div>
</body></html>`;

mkdirSync(outDir, { recursive: true });
const htmlPath = path.join(os.tmpdir(), 'einstein-pool-banner.html');
writeFileSync(htmlPath, html);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome or Edge found'); process.exit(1); }
const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,675', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(htmlPath).href], { encoding: 'utf8' });
if (r.status !== 0 || !existsSync(out)) { console.error('render failed', r.stderr?.slice(0, 200)); process.exit(1); }
console.log(`wrote ${path.relative(root, out)} (${statSync(out).size} bytes)`);
