#!/usr/bin/env node
/**
 * Draw the two charts from research/replay/results.csv. No dependencies: SVG is written by hand, and a headless Chrome or Edge
 * turns it into a 1600x900 PNG when one is installed (the SVG is always written).
 *
 *   node research/replay/make-charts.mjs
 *
 * Style: monochrome, dark background, one accent, no logos.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = new URL('./', import.meta.url);
const [head, ...lines] = readFileSync(new URL('results.csv', dir), 'utf8').trim().split('\n');
const cols = head.split(',');
const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
const num = (x) => Number(x);

const W = 1600, H = 900;
const BG = '#0d0d0d', FG = '#ededed', MUTED = '#8a8a8a', FAINT = '#2a2a2a', GREY = '#6f6f6f', ACCENT = '#e5484d';
const font = "font-family=\"Inter, 'Segoe UI', Arial, sans-serif\"";
const mono = "font-family=\"'JetBrains Mono', Consolas, monospace\"";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ------------------------------------------------------------------ chart 1: LP net vs hold, per weekend, both pools
const weekends = [...new Set(rows.map((r) => r.friday))].sort();
// one value per weekend: the sum over the three stocks, as a percent of the three starting capitals
const per = weekends.map((f) => {
  const rs = rows.filter((r) => r.friday === f);
  const avg = (k) => rs.reduce((a, r) => a + num(r[k]), 0) / rs.length;
  return { f, a: avg('lp_net_a_pct') * 100, b: avg('lp_net_b_pct') * 100, gap: rs.reduce((a, r) => a + Math.abs(num(r.gap_bps)), 0) / rs.length };
});
const meanA = per.reduce((a, p) => a + p.a, 0) / per.length;
const meanB = per.reduce((a, p) => a + p.b, 0) / per.length;
const bestB = per.filter((p) => p.b - p.a > 1e-4).length; // under 0.0001 bp is rounding dust, a tie

function chart1() {
  const L = 110, R = W - 60, T = 190, B = H - 130;
  const vals = per.flatMap((p) => [p.a, p.b]);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const pad = (hi - lo) * 0.12 || 0.1;
  const y0 = lo - pad, y1 = hi + pad;
  const y = (v) => B - ((v - y0) / (y1 - y0)) * (B - T);
  const group = (R - L) / per.length;
  const bw = Math.min(26, group * 0.36);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${BG}"/>`;
  s += `<text x="${L}" y="78" fill="${FG}" ${font} font-size="38" font-weight="700">LP result after the weekend: standard pool vs BELL</text>`;
  s += `<text x="${L}" y="114" fill="${MUTED}" ${font} font-size="20">LP net vs holding the same tokens, in basis points of the starting liquidity (100 bp = 1%). Average of TSLA, NVDA and AAPL per weekend, ${per.length} weekends.</text>`;
  // legend
  s += `<rect x="${L}" y="138" width="16" height="16" fill="${GREY}"/><text x="${L + 26}" y="152" fill="${FG}" ${font} font-size="18">Standard v4 pool, 0.30% fee   mean ${meanA.toFixed(2)} bp</text>`;
  s += `<rect x="${L + 520}" y="138" width="16" height="16" fill="${FG}"/><text x="${L + 546}" y="152" fill="${FG}" ${font} font-size="18">BELL pool   mean ${meanB.toFixed(2)} bp</text>`;
  // grid and zero line
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const v = y0 + ((y1 - y0) * i) / ticks;
    s += `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="${FAINT}"/><text x="${L - 14}" y="${y(v) + 6}" fill="${MUTED}" ${mono} font-size="15" text-anchor="end">${v.toFixed(1)} bp</text>`;
  }
  s += `<line x1="${L}" x2="${R}" y1="${y(0)}" y2="${y(0)}" stroke="${ACCENT}" stroke-width="2"/>`;
  per.forEach((p, i) => {
    const cx = L + group * (i + 0.5);
    for (const [k, off, col] of [['a', -bw - 2, GREY], ['b', 2, FG]]) {
      const v = p[k], top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
      s += `<rect x="${cx + off}" y="${top}" width="${bw}" height="${h}" fill="${col}"/>`;
    }
    s += `<text transform="translate(${cx},${B + 18}) rotate(60)" fill="${MUTED}" ${mono} font-size="13">${p.f.slice(5)}</text>`;
  });
  s += `<text x="${L}" y="${H - 28}" fill="${MUTED}" ${font} font-size="16">Both pools start at the Friday close with the same liquidity and range. ${bestB} of ${per.length} weekends favour BELL. Source: research/replay (github.com/belldex/bell). Prices: Yahoo Finance, hourly bars.</text>`;
  return s + '</svg>';
}

// ------------------------------------------------------------------ chart 2: gap vs difference, every stock-weekend
function chart2() {
  const L = 130, R = W - 70, T = 190, B = H - 130;
  const pts = rows.map((r) => ({ x: Math.abs(num(r.gap_bps)) / 100, y: num(r.difference_pct_points) * 100, s: r.symbol }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x1 = Math.max(0.5, ...xs) * 1.08;
  const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
  const pad = (hi - lo) * 0.14 || 0.05;
  const y0 = lo - pad, y1 = hi + pad;
  const X = (v) => L + (v / x1) * (R - L);
  const Y = (v) => B - ((v - y0) / (y1 - y0)) * (B - T);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${BG}"/>`;
  s += `<text x="${L}" y="78" fill="${FG}" ${font} font-size="38" font-weight="700">Bigger weekend gap, bigger difference for the LP?</text>`;
  s += `<text x="${L}" y="114" fill="${MUTED}" ${font} font-size="20">Each point is one stock over one weekend. Up means the BELL LP kept more than the standard-pool LP. Vertical axis in basis points of the starting liquidity.</text>`;
  for (let i = 0; i <= 6; i++) {
    const v = y0 + ((y1 - y0) * i) / 6;
    s += `<line x1="${L}" x2="${R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${FAINT}"/><text x="${L - 14}" y="${Y(v) + 6}" fill="${MUTED}" ${mono} font-size="15" text-anchor="end">${v.toFixed(1)}</text>`;
  }
  for (let i = 0; i <= 6; i++) {
    const v = (x1 * i) / 6;
    s += `<line y1="${T}" y2="${B}" x1="${X(v)}" x2="${X(v)}" stroke="${FAINT}"/><text x="${X(v)}" y="${B + 28}" fill="${MUTED}" ${mono} font-size="15" text-anchor="middle">${v.toFixed(2)}%</text>`;
  }
  s += `<line x1="${L}" x2="${R}" y1="${Y(0)}" y2="${Y(0)}" stroke="${ACCENT}" stroke-width="2"/>`;
  // least-squares line through the points
  const n = pts.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0), sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  if (sxx > 0) { const k = sxy / sxx, c0 = my - k * mx; s += `<line x1="${X(0)}" y1="${Y(c0)}" x2="${X(x1)}" y2="${Y(c0 + k * x1)}" stroke="${MUTED}" stroke-dasharray="8 8" stroke-width="2"/>`; }
  const shape = { TSLA: (x, y) => `<circle cx="${x}" cy="${y}" r="8" fill="${FG}"/>`, NVDA: (x, y) => `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" fill="${GREY}"/>`, AAPL: (x, y) => `<path d="M${x} ${y - 9} L${x + 9} ${y + 7} L${x - 9} ${y + 7} Z" fill="none" stroke="${FG}" stroke-width="2.5"/>` };
  for (const p of pts) s += (shape[p.s] ?? shape.TSLA)(X(p.x), Y(p.y));
  s += `<text x="${(L + R) / 2}" y="${H - 70}" fill="${MUTED}" ${font} font-size="18" text-anchor="middle">Weekend gap, absolute value, Friday close to Monday pre-market open</text>`;
  s += `<text x="${R}" y="152" fill="${FG}" ${font} font-size="17" text-anchor="end">circle TSLA   square NVDA   triangle AAPL</text>`;
  s += `<text x="${L}" y="${H - 28}" fill="${MUTED}" ${font} font-size="16">Difference = LP net in BELL minus LP net in the standard pool, in basis points of the starting liquidity. Source: research/replay (github.com/belldex/bell).</text>`;
  return s + '</svg>';
}

function png(svgName, pngName) {
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
  if (!chrome) { console.log(`no Chrome or Edge found, kept ${svgName} only`); return; }
  const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`, `--screenshot=${new URL(pngName, dir).pathname.replace(/^\/([A-Za-z]:)/, '$1')}`, new URL(svgName, dir).href], { encoding: 'utf8', timeout: 60000 });
  console.log(r.status === 0 ? `wrote ${pngName}` : `could not render ${pngName}: ${r.stderr?.slice(0, 120)}`);
}

writeFileSync(new URL('chart-lp-net-by-weekend.svg', dir), chart1());
writeFileSync(new URL('chart-gap-vs-difference.svg', dir), chart2());
console.log(`wrote 2 SVG charts from ${rows.length} rows (${per.length} weekends)`);
png('chart-lp-net-by-weekend.svg', 'chart-lp-net-by-weekend.png');
png('chart-gap-vs-difference.svg', 'chart-gap-vs-difference.png');
