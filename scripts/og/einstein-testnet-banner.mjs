#!/usr/bin/env node
/**
 * Draws the v3 Evolve testnet run (1200 by 675): the two net LP result lines in bps of capital from the first swap to the end, the stretch
 * where the bot was down, and a tick for every swap the Einstein pool reverted. Every number is read from evidence/einstein/v3-evolve/proof.json,
 * run 3; nothing is typed by hand.
 *
 *   node scripts/og/einstein-testnet-banner.mjs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const assets = path.join(root, 'apps/web/public/assets');
const out = path.join(root, 'apps/web/public/og/einstein-testnet.png');
const proof = JSON.parse(readFileSync(path.join(root, 'evidence/einstein/v3-evolve/proof.json'), 'utf8'));
const run = proof.runs.find((r) => r.id === 3);
if (!run?.result) throw new Error('run 3 has no result yet');
const { bell, control, verdict } = run.result;
const t0 = run.window.startTs; const t1 = run.window.endTs;
const refused = (run.config.blocked ?? []).map((b) => Date.parse(b.at) / 1000);
const outages = run.outages ?? [];

const X0 = 68; const X1 = 1132; const Y0 = 292; const Y1 = 520; // plot box
// The series holds the position at each swap. The last point is the result at the end of the window, marked at the final reference price.
const series = (pool) => [...pool.series.map((p) => ({ t: p.ts, v: p.net / pool.startCapital * 1e4 })), { t: t1, v: pool.netBps }];
const sb = series(bell); const sc = series(control);
const all = [...sb, ...sc].map((p) => p.v);
const lo = Math.min(0, ...all); const hi = Math.max(0, ...all);
const pad = (hi - lo) * 0.18 || 1;
const vmin = lo - pad; const vmax = hi + pad;
// The longest stretch with no bot is folded into a fixed-width break, so the two stretches that have swaps in them get the room.
const gapO = [...outages].sort((m, n) => (n.toTs - n.fromTs) - (m.toTs - m.fromTs))[0] ?? null;
const GAPW = 120; const W1 = gapO ? 190 : 0; const W2 = (X1 - X0) - (gapO ? W1 + GAPW : 0);
const x = (t) => {
  if (!gapO) return X0 + ((t - t0) / (t1 - t0)) * (X1 - X0);
  if (t <= gapO.fromTs) return X0 + ((t - t0) / (gapO.fromTs - t0)) * W1;
  if (t >= gapO.toTs) return X0 + W1 + GAPW + ((t - gapO.toTs) / (t1 - gapO.toTs)) * W2;
  return X0 + W1 + ((t - gapO.fromTs) / (gapO.toTs - gapO.fromTs)) * GAPW;
};
const y = (v) => Y1 - ((v - vmin) / (vmax - vmin)) * (Y1 - Y0);
const step = (s) => {
  let d = `M${x(t0).toFixed(1)},${y(0).toFixed(1)}`; let prev = 0;
  for (const p of s) { d += ` L${x(p.t).toFixed(1)},${y(prev).toFixed(1)} L${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`; prev = p.v; }
  return `${d} L${x(t1).toFixed(1)},${y(prev).toFixed(1)}`;
};
const fmt = (n) => { const r = Math.round(n * 10) / 10; return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}`; };
const dayLabel = (t) => new Date(t * 1000).toLocaleString('en-US', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';
const gap = verdict.gapBps;

const font = (name, file, weight) => `@font-face{font-family:"${name}";src:url("${pathToFileURL(path.join(assets, file)).href}") format("woff2");font-weight:${weight};font-style:normal}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Instrument Sans', 'instrument-sans-v4.woff2', '400 700')}
${font('Geist Mono', 'geist-mono-v4.woff2', '400 600')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:675px;background:#171717;color:#EEECE5;font-family:"Instrument Sans",system-ui,sans-serif;overflow:hidden;position:relative}
svg{position:absolute;left:0;top:0}
.tag{position:absolute;left:68px;top:46px;display:flex;gap:14px;align-items:center;font:500 15px/1 "Geist Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:#B7B4AD}
.tag b{padding:9px 13px;border:2px solid #C7444F;color:#E27478;font-weight:500}
.big{position:absolute;left:62px;top:92px;font:650 120px/1 "Instrument Sans",sans-serif;letter-spacing:-.055em}
.big small{font:500 22px/1 "Geist Mono",monospace;letter-spacing:.08em;color:#858177;margin-left:14px;text-transform:uppercase}
.sub{position:absolute;left:68px;top:226px;width:760px;font:500 21px/1.3 "Instrument Sans",sans-serif;color:#B7B4AD}
.sub em{color:#EEECE5;font-style:normal}
.keys{position:absolute;right:68px;top:62px;text-align:right;font:500 14px/1.9 "Geist Mono",monospace;letter-spacing:.06em;text-transform:uppercase;color:#B7B4AD}
.keys b{display:inline-block;width:26px;height:4px;margin-right:10px;vertical-align:middle}
.url{position:absolute;left:68px;bottom:34px;font:500 21px/1 "Instrument Sans",sans-serif}
.note{position:absolute;right:68px;bottom:30px;color:#858177;font:500 12px/1.5 "Geist Mono",monospace;letter-spacing:.07em;text-transform:uppercase;text-align:right}
</style></head><body>
<div class="tag"><b>Einstein Hooks v3 Evolve</b><span>Robinhood testnet</span></div>
<div class="keys"><div><b style="background:#E27478"></b>Einstein pool</div><div><b style="background:#EEECE5"></b>Plain v4 pool, 0.30%</div><div><b style="background:#5b5852;height:10px"></b>Bot was down</div><div><b style="background:#C7444F;width:4px;height:14px;margin-right:16px"></b>Swap reverted</div></div>
<p class="big">${fmt(gap)} bps<small>Einstein vs plain v4, test tokens</small></p>
<p class="sub">Same capital, same range, one bot. The line is each pool's result against just holding, in bps of capital. <em>Not a mainnet result.</em></p>
<svg width="1200" height="675" viewBox="0 0 1200 675">
  ${gapO ? `<rect x="${X0 + W1}" y="${Y0 - 14}" width="${GAPW}" height="${Y1 - Y0 + 28}" fill="#242321"/><text x="${X0 + W1 + GAPW / 2}" y="${Y1 - 28}" text-anchor="middle" fill="#858177" font-family="Geist Mono" font-size="13" letter-spacing="1">BOT DOWN</text><text x="${X0 + W1 + GAPW / 2}" y="${Y1 - 10}" text-anchor="middle" fill="#858177" font-family="Geist Mono" font-size="13" letter-spacing="1">${Math.round((gapO.toTs - gapO.fromTs) / 3600)} H</text>` : ''}
  <line x1="${X0}" y1="${y(0)}" x2="${X1}" y2="${y(0)}" stroke="#4a4844" stroke-width="1.5" stroke-dasharray="3 5"/>
  <text x="${X0}" y="${y(0) - 8}" fill="#858177" font-family="Geist Mono" font-size="12" letter-spacing="1">HOLD THE STARTING TOKENS</text>
  <path d="${step(sc)}" fill="none" stroke="#EEECE5" stroke-width="3" stroke-linejoin="round"/>
  <path d="${step(sb)}" fill="none" stroke="#E27478" stroke-width="4.5" stroke-linejoin="round"/>
  ${refused.map((t) => `<line x1="${x(t)}" y1="${Y1 + 22}" x2="${x(t)}" y2="${Y1 + 44}" stroke="#C7444F" stroke-width="3"/>`).join('')}
  ${refused.length ? `<text x="${Math.min(...refused.map(x)) - 10}" y="${Y1 + 40}" text-anchor="end" fill="#E27478" font-family="Geist Mono" font-size="13" letter-spacing="1">${refused.length} SWAPS REVERTED</text>` : ''}
  <text x="${X0}" y="${Y1 + 74}" fill="#858177" font-family="Geist Mono" font-size="13" letter-spacing="1">${dayLabel(t0)}</text>
  <text x="${X1}" y="${Y1 + 74}" text-anchor="end" fill="#858177" font-family="Geist Mono" font-size="13" letter-spacing="1">${dayLabel(t1)}</text>
  <text x="${x(t1) - 8}" y="${y(sb.at(-1).v) - 12}" text-anchor="end" fill="#E27478" font-family="Geist Mono" font-size="15" font-weight="600">${fmt(bell.netBps)} bps</text>
  <text x="${x(t1) - 8}" y="${y(sc.at(-1).v) + 26}" text-anchor="end" fill="#EEECE5" font-family="Geist Mono" font-size="15" font-weight="600">${fmt(control.netBps)} bps</text>
</svg>
<p class="url">bellstocks.tech/einstein/v3-evolve</p>
<p class="note">${bell.swaps} + ${control.swaps} bot swaps · ${refused.length} reverted on the Einstein pool<br>Fixture price feed · every number replays from chain</p>
</body></html>`;

mkdirSync(path.dirname(out), { recursive: true });
const htmlPath = path.join(os.tmpdir(), 'einstein-testnet-banner.html');
writeFileSync(htmlPath, html);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome or Edge found'); process.exit(1); }
const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,675', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(htmlPath).href], { encoding: 'utf8' });
if (r.status !== 0 || !existsSync(out)) { console.error('render failed', r.stderr?.slice(0, 200)); process.exit(1); }
console.log(`wrote ${path.relative(root, out)} (${statSync(out).size} bytes)`);
