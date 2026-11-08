#!/usr/bin/env node
/**
 * Fetch the real Friday-close and Monday-open prices that the weekend replay needs.
 *
 *   node research/replay/fetch-prices.mjs            writes research/replay/data/weekends.json and weekends.csv
 *
 * Source: Yahoo Finance public chart endpoint, 1-hour bars with pre and post market included. Nothing here is signed or
 * authenticated: it is public price data, recorded with the exact URL and the time it was fetched, so anyone can fetch the
 * same bars and compare. Hourly bars are the finest interval Yahoo serves for this range, so every price below is the
 * open or the close of an hourly bar, not a tick.
 *
 * What is NOT available from this source: the 20:00 to 04:00 ET overnight session (Blue Ocean and similar venues). The
 * "close" used by the replay is the last post-market bar on Friday (about 20:00 ET) and the "open" is the first
 * pre-market bar on Monday (04:00 ET), which is where BELL's CLOSED to PRE transition, and so its Opening Bell Auction, sits.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const SYMBOLS = ['TSLA', 'NVDA', 'AAPL'];
const WEEKENDS = Number(process.env.REPLAY_WEEKENDS || 20);
const RANGE = '6mo';
const UA = { 'User-Agent': 'Mozilla/5.0 (BELL research replay)' };
const urlFor = (s) => `https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1h&range=${RANGE}&includePrePost=true`;

const etParts = (sec) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
};

async function bars(symbol) {
  const r = await fetch(urlFor(symbol), { headers: UA });
  if (!r.ok) throw new Error(`${symbol}: HTTP ${r.status}`);
  const j = await r.json();
  const res = j.chart?.result?.[0];
  if (!res) throw new Error(`${symbol}: no data`);
  const q = res.indicators.quote[0];
  const out = [];
  res.timestamp.forEach((t, i) => {
    if (q.open[i] == null || q.close[i] == null) return;
    out.push({ t, ...etParts(t), open: q.open[i], close: q.close[i] });
  });
  return out;
}

const round = (x) => Math.round(x * 1e4) / 1e4;
const rows = [];
const fetchedAt = new Date().toISOString();
const perSymbol = {};
for (const s of SYMBOLS) perSymbol[s] = await bars(s);

// Fridays present in the data (the last complete weekends first)
const fridays = [...new Set(perSymbol.TSLA.filter((b) => b.weekday === 'Fri').map((b) => b.date))].sort();
const todayET = etParts(Math.floor(Date.now() / 1000)).date;

for (const friday of fridays) {
  const fri = new Date(`${friday}T12:00:00Z`);
  const nextDays = [1, 2, 3, 4].map((d) => new Date(fri.getTime() + d * 86400_000).toISOString().slice(0, 10));
  for (const symbol of SYMBOLS) {
    const all = perSymbol[symbol];
    const fb = all.filter((b) => b.date === friday);
    if (!fb.length) continue;
    const regular = fb.filter((b) => (b.hour > 9 || (b.hour === 9 && b.minute >= 30)) && b.hour < 16);
    const post = fb.filter((b) => b.hour >= 16);
    const friRegularClose = regular.length ? regular[regular.length - 1].close : null;
    const friPostClose = post.length ? post[post.length - 1].close : friRegularClose;
    // The first trading day after the weekend: Monday, or the next day with bars if Monday was a holiday.
    const openDate = nextDays.find((d) => all.some((b) => b.date === d && b.date > friday));
    if (!openDate || openDate >= todayET) continue; // the weekend has not finished, or has no data yet
    const ob = all.filter((b) => b.date === openDate);
    const pre = ob.filter((b) => b.hour >= 4 && (b.hour < 9 || (b.hour === 9 && b.minute < 30)));
    const reg = ob.filter((b) => (b.hour > 9 || (b.hour === 9 && b.minute >= 30)) && b.hour < 16);
    const monPreOpen = pre.length ? pre[0].open : null;
    const monRegOpen = reg.length ? reg[0].open : null;
    if (friRegularClose == null || friPostClose == null || monPreOpen == null || monRegOpen == null) continue;
    rows.push({
      friday, open_date: openDate, monday_holiday: openDate !== nextDays.find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 1) ? 1 : 0,
      symbol, fri_regular_close: round(friRegularClose), fri_post_close: round(friPostClose),
      mon_pre_open: round(monPreOpen), mon_regular_open: round(monRegOpen),
      gap_pre: round((monPreOpen - friPostClose) / friPostClose), gap_regular: round((monRegOpen - friPostClose) / friPostClose),
    });
  }
}

// Keep the most recent WEEKENDS complete weekends that every symbol has.
const complete = [...new Set(rows.map((r) => r.friday))].filter((f) => SYMBOLS.every((s) => rows.some((r) => r.friday === f && r.symbol === s))).sort().slice(-WEEKENDS);
const kept = rows.filter((r) => complete.includes(r.friday)).sort((a, b) => a.friday.localeCompare(b.friday) || a.symbol.localeCompare(b.symbol));

mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
writeFileSync(new URL('./data/weekends.json', import.meta.url), JSON.stringify({
  source: 'Yahoo Finance public chart endpoint, interval=1h, includePrePost=true',
  urls: Object.fromEntries(SYMBOLS.map((s) => [s, urlFor(s)])),
  fetchedAt,
  definitions: {
    fri_post_close: 'close of the last post-market hourly bar on Friday (about 20:00 ET); the price both pools start at',
    mon_pre_open: 'open of the first pre-market hourly bar on the next trading day (04:00 ET); the price BELL reopens at',
    mon_regular_open: 'open of the 09:30 ET bar, recorded for reference',
    gap_pre: '(mon_pre_open - fri_post_close) / fri_post_close',
  },
  notLimits: 'The 20:00 to 04:00 ET overnight session is not in this source.',
  weekends: complete, rows: kept,
}, null, 2) + '\n');
const header = 'friday,open_date,monday_holiday,symbol,fri_regular_close,fri_post_close,mon_pre_open,mon_regular_open,gap_pre,gap_regular';
writeFileSync(new URL('./data/weekends.csv', import.meta.url), [header, ...kept.map((r) => [r.friday, r.open_date, r.monday_holiday, r.symbol, r.fri_regular_close, r.fri_post_close, r.mon_pre_open, r.mon_regular_open, r.gap_pre, r.gap_regular].join(','))].join('\n') + '\n');
// Flat integer arrays for the Foundry test: prices in 1e-4 USD, because JSON numbers with decimals cannot be read as uints.
const e4 = (x) => Math.round(x * 1e4);
writeFileSync(new URL('./data/replay-input.json', import.meta.url), JSON.stringify({
  n: kept.length,
  friday: kept.map((r) => r.friday), open_date: kept.map((r) => r.open_date), symbol: kept.map((r) => r.symbol),
  close_e4: kept.map((r) => e4(r.fri_post_close)), open_e4: kept.map((r) => e4(r.mon_pre_open)), regular_open_e4: kept.map((r) => e4(r.mon_regular_open)),
}) + '\n');
console.log(`${kept.length} rows: ${complete.length} weekends x ${SYMBOLS.length} symbols, ${complete[0]} to ${complete[complete.length - 1]}`);
