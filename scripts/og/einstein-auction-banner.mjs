#!/usr/bin/env node
/**
 * Draws the Opening Bell Auction countdown (1200 by 675). The cycle number, the stage and the open time are read from the auction
 * contract on mainnet when the image is made. There is no countdown, so the image does not go stale. Nothing is typed by hand.
 *
 *   RH_MAINNET_RPC_SECONDARY=<rpc> node scripts/og/einstein-auction-banner.mjs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { createPublicClient, http, parseAbi } from 'viem';

const root = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const assets = path.join(root, 'apps/web/public/assets');
const out = path.join(root, 'apps/web/public/og/einstein-auction.png');
const env = {};
for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const rpc = process.env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_SECONDARY;
const AUCTION = '0xE24092Ed409DfE4edA17c80801f989f2c5D4Ac17';
const abi = parseAbi(['function currentStage() view returns (uint8)', 'function cycleId() view returns (uint64)', 'function cycleSummary(uint64) view returns (uint64 cycleOpenTime, uint64 deadline, uint8 cycleStage, uint160 priceX96, uint128 matchedBase, bool finalized)', 'function auctionLead() view returns (uint32)', 'function settleTimeout() view returns (uint32)']);
const pc = createPublicClient({ transport: http(rpc) });
const [stage, cycle, lead, timeout] = await Promise.all([
  pc.readContract({ address: AUCTION, abi, functionName: 'currentStage' }), pc.readContract({ address: AUCTION, abi, functionName: 'cycleId' }),
  pc.readContract({ address: AUCTION, abi, functionName: 'auctionLead' }), pc.readContract({ address: AUCTION, abi, functionName: 'settleTimeout' }),
]);
const summary = await pc.readContract({ address: AUCTION, abi, functionName: 'cycleSummary', args: [cycle] });
const openTs = Number(summary[0]);
const STAGES = ['IDLE', 'ARMED', 'OPEN', 'LOCKED', 'SETTLED', 'REFUNDED'];
const stageName = STAGES[Number(stage)];
const hoursLeft = Math.max(0, (openTs - Date.now() / 1000) / 3600);
const hh = String(Math.floor(hoursLeft)).padStart(2, '0'); const mm = String(Math.floor((hoursLeft % 1) * 60)).padStart(2, '0');
const utc = (ts) => new Date(ts * 1000).toISOString().slice(11, 16);
const wib = (ts) => new Date((ts + 7 * 3600) * 1000).toISOString().slice(11, 16);
const dayShort = new Date(openTs * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const date = new Date(openTs * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });

// Timeline from open - 20 minutes to open + 20 minutes; the order window is [open - lead, open), settlement can follow until open + timeout.
const t0 = openTs - 20 * 60; const t1 = openTs + 20 * 60; const X0 = 68; const X1 = 1132;
const x = (ts) => X0 + ((ts - t0) / (t1 - t0)) * (X1 - X0);
const font = (name, file, weight) => `@font-face{font-family:"${name}";src:url("${pathToFileURL(path.join(assets, file)).href}") format("woff2");font-weight:${weight};font-style:normal}`;
const mins = [-20, -15, -10, -5, 0, 5, 10, 15, 20].map((m) => { const xx = x(openTs + m * 60); return `<line x1="${xx}" y1="448" x2="${xx}" y2="${m === 0 ? 470 : 458}" stroke="#858177" stroke-width="${m === 0 ? 3 : 1.5}"/><text x="${xx}" y="492" text-anchor="middle" fill="#858177" font-family="Geist Mono" font-size="14">${utc(openTs + m * 60)}</text>`; }).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Instrument Sans', 'instrument-sans-v4.woff2', '400 700')}
${font('Geist Mono', 'geist-mono-v4.woff2', '400 600')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:675px;background:#171717;color:#EEECE5;font-family:"Instrument Sans",system-ui,sans-serif;overflow:hidden;position:relative}
.tag{position:absolute;left:68px;top:48px;display:flex;gap:14px;align-items:center;font:500 15px/1 "Geist Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:#B7B4AD}
.tag b{padding:9px 13px;border:2px solid #C7444F;color:#E27478;font-weight:500}
.big{position:absolute;left:62px;top:100px;font:650 150px/1 "Instrument Sans",sans-serif;letter-spacing:-.06em;color:#EEECE5}
.big small{font:500 22px/1 "Geist Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:#858177;margin-left:18px;letter-spacing:.1em}
.line{position:absolute;left:68px;top:300px;width:1064px;font:650 34px/1.12 "Instrument Sans",sans-serif;letter-spacing:-.03em}
.line em{color:#E27478;font-style:normal}
.chips{position:absolute;right:68px;top:62px;display:flex;gap:10px}
.chips span{padding:8px 12px;border:1px solid #3a3835;color:#B7B4AD;font:500 13px/1 "Geist Mono",monospace;letter-spacing:.08em;text-transform:uppercase}
.chips span.on{border-color:#C7444F;color:#E27478}
svg{position:absolute;left:0;top:0}
.url{position:absolute;left:68px;bottom:34px;font:500 21px/1 "Instrument Sans",sans-serif}
.note{position:absolute;right:68px;bottom:36px;color:#858177;font:500 12px/1.4 "Geist Mono",monospace;letter-spacing:.07em;text-transform:uppercase;text-align:right}
</style></head><body>
<div class="tag"><b>Einstein Hooks v2</b><span>Opening Bell Auction</span></div>
<div class="chips"><span class="on">Cycle ${cycle} ${stageName}</span><span>Read from chain</span></div>
<p class="big">${dayShort}<small>the market reopens</small></p>
<p class="line">Orders go in for ten minutes, then <em>one price</em> for everyone.</p>
<svg width="1200" height="675" viewBox="0 0 1200 675">
  <rect x="${X0}" y="410" width="${X1 - X0}" height="14" fill="#2a2927"/>
  <rect x="${x(openTs - Number(lead))}" y="396" width="${x(openTs) - x(openTs - Number(lead))}" height="42" fill="#C7444F"/>
  <rect x="${x(openTs)}" y="410" width="${x(openTs + Number(timeout)) - x(openTs)}" height="14" fill="#7d2c35"/>
  ${mins}
  <text x="${(x(openTs - Number(lead)) + x(openTs)) / 2}" y="387" text-anchor="middle" fill="#E27478" font-family="Geist Mono" font-size="15" letter-spacing="1.5">ORDERS ${utc(openTs - Number(lead))}-${utc(openTs)} UTC</text>
  <text x="${x(openTs) + 8}" y="520" fill="#EEECE5" font-family="Instrument Sans" font-weight="600" font-size="20">Market reopens, ${utc(openTs)} UTC (${wib(openTs)} WIB)</text>
  <text x="${x(openTs + 60)}" y="396" fill="#B7B4AD" font-family="Geist Mono" font-size="13" letter-spacing="1">SETTLE WINDOW, 15 MIN</text>
  <text x="${X0}" y="520" fill="#B7B4AD" font-family="Instrument Sans" font-size="18">One buyer, one seller, two wallets</text>
</svg>
<p class="url">bellstocks.tech/einstein/pool</p>
<p class="note">An ordinary swap must be refused while the window is open.<br>Result goes on the page whatever it is.</p>
</body></html>`;

mkdirSync(path.dirname(out), { recursive: true });
const htmlPath = path.join(os.tmpdir(), 'einstein-auction-banner.html');
writeFileSync(htmlPath, html);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome or Edge found'); process.exit(1); }
const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,675', '--virtual-time-budget=4000', `--screenshot=${out}`, pathToFileURL(htmlPath).href], { encoding: 'utf8' });
if (r.status !== 0 || !existsSync(out)) { console.error('render failed', r.stderr?.slice(0, 200)); process.exit(1); }
console.log(`cycle ${cycle} ${stageName}, opens ${new Date(openTs * 1000).toISOString()}`);
console.log(`wrote ${path.relative(root, out)} (${statSync(out).size} bytes)`);
