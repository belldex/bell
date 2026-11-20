#!/usr/bin/env node
/**
 * Draws a 24 hour dial (1200 by 675): each trading session is an arc whose thickness is its fee, and the five real swaps sit on the
 * dial at the New York time of day they landed. The weekend ring is the thickest because CLOSED charges 1% all day. Swap times and
 * fees come from evidence/einstein/swaps.json; a session with no swap on record stops the script.
 *
 *   node scripts/og/einstein-clock-banner.mjs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const assets = path.join(root, 'apps/web/public/assets');
const out = path.join(root, 'apps/web/public/og/einstein-clock.png');
const swaps = JSON.parse(readFileSync(path.join(root, 'evidence/einstein/swaps.json'), 'utf8')).filter((s) => s.status === 'success');

// Session hours in New York time on a trading day, and the fee each one charges in pips.
const SESSIONS = [
  { key: 'OVERNIGHT', label: 'Overnight', from: 20, to: 28, fee: 5000 },
  { key: 'PRE', label: 'Pre-market', from: 4, to: 9.5, fee: 3000 },
  { key: 'REGULAR', label: 'Regular', from: 9.5, to: 16, fee: 500 },
  { key: 'POST', label: 'Post-market', from: 16, to: 20, fee: 3000 },
];
const CLOSED = { key: 'CLOSED', label: 'Closed (weekend)', fee: 10000 };
const R0 = 122; const THICK = (fee) => 10 + (fee / 10000) * 62; // pixels
const CX = 330; const CY = 340;
const pct = (fee) => `${fee / 10000}%`;
const pol = (r, h) => { const a = ((h % 24) / 24) * 2 * Math.PI - Math.PI / 2; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; };
const arc = (from, to, r1, r2) => {
  const [x1, y1] = pol(r2, from); const [x2, y2] = pol(r2, to); const [x3, y3] = pol(r1, to); const [x4, y4] = pol(r1, from);
  const large = (to - from) > 12 ? 1 : 0;
  return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r2},${r2} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} A${r1},${r1} 0 ${large} 0 ${x4.toFixed(1)},${y4.toFixed(1)}Z`;
};
const etHour = (ts) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ts * 1000));
  return Number(p.find((x) => x.type === 'hour').value) + Number(p.find((x) => x.type === 'minute').value) / 60;
};
const clock = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const pick = (key, fee) => { const s = [...swaps].reverse().find((x) => String(x.session).toUpperCase() === key && Number(x.feePips) === fee); if (!s) throw new Error(`no swap on record in ${key} at ${fee} pips`); return s; };

const ring = CLOSED; const closedSwap = pick('CLOSED', 10000);
const parts = [];
// The weekend ring: CLOSED covers the whole day at 1%, so it is the outer band and every trading-day session sits inside it.
parts.push(`<circle cx="${CX}" cy="${CY}" r="${R0 + THICK(ring.fee) / 2}" fill="none" stroke="#C7444F" stroke-opacity=".22" stroke-width="${THICK(ring.fee)}" stroke-dasharray="3 5"/>`);
const dots = [];
const dot = (h, r, tx, color) => { const [x, y] = pol(r, h); dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="#171717" stroke="${color}" stroke-width="3"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${color}"/>`); };
const rows = [];
const fills = { OVERNIGHT: '#7d2c35', PRE: '#b23a46', REGULAR: '#EEECE5', POST: '#b23a46' };
for (const s of SESSIONS) {
  const t = THICK(s.fee);
  parts.push(`<path d="${arc(s.from, s.to, R0, R0 + t)}" fill="${fills[s.key]}"/>`);
  const swap = pick(s.key, s.fee); const h = etHour(swap.ts);
  dot(h, R0 + t / 2, swap.tx, '#EEECE5');
  rows.push({ h, label: s.label, fee: s.fee, tx: swap.tx, time: clock(h) });
}
const ch = etHour(closedSwap.ts); dot(ch, R0 + THICK(ring.fee) / 2, closedSwap.tx, '#EEECE5');
rows.push({ h: ch, label: 'Closed, Saturday', fee: ring.fee, tx: closedSwap.tx, time: clock(ch) });
const order = ['Closed, Saturday', 'Overnight', 'Pre-market', 'Regular', 'Post-market'];
rows.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
const ticks = [0, 6, 12, 18].map((h) => { const [x1, y1] = pol(R0 - 6, h); const [x2, y2] = pol(R0 - 18, h); const [tx, ty] = pol(R0 - 36, h); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#858177" stroke-width="2"/><text x="${tx}" y="${ty + 5}" text-anchor="middle" fill="#858177" font-family="Geist Mono" font-size="14" letter-spacing="1">${String(h).padStart(2, '0')}</text>`; }).join('');

const font = (name, file, weight) => `@font-face{font-family:"${name}";src:url("${pathToFileURL(path.join(assets, file)).href}") format("woff2");font-weight:${weight};font-style:normal}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Instrument Sans', 'instrument-sans-v4.woff2', '400 700')}
${font('Geist Mono', 'geist-mono-v4.woff2', '400 600')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:675px;background:#171717;color:#EEECE5;font-family:"Instrument Sans",system-ui,sans-serif;overflow:hidden;position:relative}
svg{position:absolute;left:0;top:0}
.tag{position:absolute;left:640px;top:52px;display:flex;gap:14px;align-items:center;font:500 15px/1 "Geist Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:#B7B4AD}
.tag b{padding:9px 13px;border:2px solid #C7444F;color:#E27478;font-weight:500}
h1{position:absolute;left:640px;top:104px;width:520px;font:650 56px/1.02 "Instrument Sans",sans-serif;letter-spacing:-.045em}
h1 em{color:#E27478;font-style:normal}
.list{position:absolute;left:640px;top:288px;width:492px;list-style:none}
.list li{display:grid;grid-template-columns:62px 1fr auto;gap:14px;align-items:baseline;padding:11px 0;border-top:1px solid #34322f}
.list li:last-child{border-bottom:1px solid #34322f}
.list i{font:500 14px/1 "Geist Mono",monospace;font-style:normal;color:#858177}
.list b{font:600 19px/1 "Instrument Sans",sans-serif}
.list b span{font:600 22px/1 "Instrument Sans",sans-serif;color:#E27478;margin-left:8px}
.list code{font:500 13px/1 "Geist Mono",monospace;color:#B7B4AD}
.cap{position:absolute;left:640px;top:236px;width:490px;color:#B7B4AD;font:400 17px/1.4 "Instrument Sans",sans-serif}
.url{position:absolute;left:640px;bottom:40px;font:500 21px/1 "Instrument Sans",sans-serif}
.note{position:absolute;left:68px;bottom:36px;color:#858177;font:500 12px/1.4 "Geist Mono",monospace;letter-spacing:.07em;text-transform:uppercase;width:520px}
</style></head><body>
<svg width="640" height="675" viewBox="0 0 640 675">
  ${parts.join('\n  ')}
  <circle cx="${CX}" cy="${CY}" r="${R0 - 52}" fill="none" stroke="#2a2927" stroke-width="1"/>
  ${ticks}
  ${dots.join('\n  ')}
  <text x="${CX}" y="${CY - 6}" text-anchor="middle" fill="#EEECE5" font-family="Instrument Sans" font-weight="650" font-size="58" letter-spacing="-2">5/5</text>
  <text x="${CX}" y="${CY + 24}" text-anchor="middle" fill="#858177" font-family="Geist Mono" font-size="11" letter-spacing="1.5">NEW YORK TIME</text>
</svg>
<div class="tag"><b>Einstein Hooks v2</b><span>Tested on mainnet</span></div>
<h1>The fee follows <em>the clock.</em></h1>
<p class="cap">Arc thickness is the fee. Each dot is a real swap, placed at the time of day it landed.</p>
<ul class="list">${rows.map((r) => `<li><i>${r.time}</i><b>${r.label}<span>${pct(r.fee)}</span></b><code>${r.tx.slice(0, 8)}…${r.tx.slice(-4)}</code></li>`).join('')}</ul>
<p class="url">bellstocks.tech/einstein/pool</p>
<p class="note">Outer dashed ring: weekend, 1% all day.<br>Fees read from the PoolManager Swap events.</p>
</body></html>`;

mkdirSync(path.dirname(out), { recursive: true });
const htmlPath = path.join(os.tmpdir(), 'einstein-clock-banner.html');
writeFileSync(htmlPath, html);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome or Edge found'); process.exit(1); }
const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,675', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(htmlPath).href], { encoding: 'utf8' });
if (r.status !== 0 || !existsSync(out)) { console.error('render failed', r.stderr?.slice(0, 200)); process.exit(1); }
console.log(`wrote ${path.relative(root, out)} (${statSync(out).size} bytes)`);
