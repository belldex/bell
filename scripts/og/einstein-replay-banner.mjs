#!/usr/bin/env node
/**
 * Draws the replay image (1200 by 675): the output of verify-einstein-pool.mjs from a fresh clone of the public repo. The verdicts are
 * parsed from the real output file, never typed, and claim titles come from proof.json.
 *
 *   node scripts/og/einstein-replay-banner.mjs <replay output file> <commit short hash>
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const [, , outputFile, commit] = process.argv;
if (!outputFile || !commit) { console.error('usage: einstein-replay-banner.mjs <replay output file> <commit>'); process.exit(2); }
const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const assets = path.join(root, 'apps/web/public/assets');
const out = path.join(root, 'apps/web/public/og/einstein-replay.png');
const proof = JSON.parse(readFileSync(path.join(root, 'evidence/einstein/proof.json'), 'utf8'));
const titles = Object.fromEntries([...proof.claims.map((c) => [c.id, c.title]), ...proof.negatives.map((n) => [n.id, n.attempt])]);
const lines = readFileSync(outputFile, 'utf8').split(/\r?\n/);
const rows = lines.map((l) => l.match(/^(P\d+|N\d+)\s+(PASS|PARTIAL|PENDING|FAIL)\b/)).filter(Boolean).map((m) => ({ id: m[1], verdict: m[2], title: titles[m[1]] ?? '' }));
const tally = lines.find((l) => /PASS, .* PARTIAL, .* PENDING, .* FAIL/.test(l));
if (!rows.length || !tally) throw new Error('the output file has no verdict lines or no tally');
const cell = (r) => `<div class="r" data-v="${r.verdict.toLowerCase()}"><i>${r.id}</i><b>${r.verdict}</b><span>${r.title.length > 44 ? `${r.title.slice(0, 43)}…` : r.title}</span></div>`;
const left = rows.slice(0, Math.ceil(rows.length / 2)); const right = rows.slice(Math.ceil(rows.length / 2));

const font = (name, file, weight) => `@font-face{font-family:"${name}";src:url("${pathToFileURL(path.join(assets, file)).href}") format("woff2");font-weight:${weight};font-style:normal}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Instrument Sans', 'instrument-sans-v4.woff2', '400 700')}
${font('Geist Mono', 'geist-mono-v4.woff2', '400 600')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:675px;background:#171717;color:#EEECE5;font-family:"Instrument Sans",system-ui,sans-serif;overflow:hidden}
.tag{position:absolute;left:68px;top:48px;display:flex;gap:14px;align-items:center;font:500 16px/1 "Geist Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:#B7B4AD}
.tag b{padding:10px 14px;border:2px solid #C7444F;color:#E27478;font-weight:500}
h1{position:absolute;left:68px;top:108px;width:1060px;font:650 48px/1.05 "Instrument Sans",sans-serif;letter-spacing:-.04em}
h1 em{color:#E27478;font-style:normal}
.term{position:absolute;left:68px;top:200px;width:1064px;padding:18px 22px;background:#0f0f0f;border:1px solid #3a3835;font:500 14px/1.45 "Geist Mono",monospace;color:#B7B4AD}
.term p{margin-bottom:10px;color:#858177;white-space:nowrap;overflow:hidden}
.term p b{color:#EEECE5;font-weight:500}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 28px}
.r{display:grid;grid-template-columns:34px 70px 1fr;gap:8px;padding:3px 0;white-space:nowrap}
.r i{font-style:normal;color:#858177}
.r b{font-weight:600}
.r[data-v=pass] b{color:#EEECE5}.r[data-v=partial] b{color:#E8A66A}.r[data-v=pending] b{color:#858177}.r[data-v=fail] b{color:#E27478}
.r span{color:#B7B4AD;overflow:hidden}
.sum{margin-top:12px;padding-top:10px;border-top:1px solid #34322f;color:#EEECE5;font-weight:600}
.foot{position:absolute;left:68px;right:68px;bottom:34px;display:flex;justify-content:space-between;align-items:baseline}
.url{font:500 21px/1 "Instrument Sans",sans-serif}
.note{color:#858177;font:500 13px/1 "Geist Mono",monospace;letter-spacing:.06em;text-transform:uppercase}
</style></head><body>
<div class="tag"><b>Einstein Hooks v2</b><span>Replayed from a fresh clone</span></div>
<h1>Empty folder. One command. <em>Every claim replayed.</em></h1>
<div class="term">
  <p><b>$</b> git clone --depth 1 github.com/belldex/bell &amp;&amp; cd bell &nbsp;<span>(commit ${commit})</span></p>
  <p><b>$</b> node scripts/einstein/verify-einstein-pool.mjs --rpc &lt;Robinhood Chain RPC&gt;</p>
  <div class="cols"><div>${left.map(cell).join('')}</div><div>${right.map(cell).join('')}</div></div>
  <p class="sum">${tally.trim()}</p>
</div>
<div class="foot"><p class="url">bellstocks.tech/einstein/pool</p><p class="note">Pending and partial are shown as they are</p></div>
</body></html>`;

mkdirSync(path.dirname(out), { recursive: true });
const htmlPath = path.join(os.tmpdir(), 'einstein-replay-banner.html');
writeFileSync(htmlPath, html);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome or Edge found'); process.exit(1); }
const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,675', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(htmlPath).href], { encoding: 'utf8' });
if (r.status !== 0 || !existsSync(out)) { console.error('render failed', r.stderr?.slice(0, 200)); process.exit(1); }
console.log(`wrote ${path.relative(root, out)} (${statSync(out).size} bytes)`);
