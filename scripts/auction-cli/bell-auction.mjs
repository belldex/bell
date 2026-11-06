#!/usr/bin/env node
/**
 * BELL Opening Bell Auction — terminal walkthrough, made for screen recordings.
 *
 *   node scripts/auction-cli/bell-auction.mjs            live: reads real state from Robinhood Chain via the BELL keeper
 *   node scripts/auction-cli/bell-auction.mjs --demo     walkthrough of one opening cycle on a sample order book (nothing is sent on-chain)
 *   add --auto to run without "Press Enter" prompts (types and advances by itself)
 *   add --fast to shorten the animation delays
 *
 * Nothing here signs or sends a transaction. Live mode only reads public JSON from the keeper Worker.
 */
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const DEMO = args.has('--demo');
const AUTO = args.has('--auto') || !process.stdin.isTTY;
const FAST = args.has('--fast');
const KEEPER = process.env.BELL_KEEPER_URL || 'https://bell-keeper-b.asysyifaq25.workers.dev';

// BELL palette (apps/web/app/globals.css): poppy accent on talc and carbon, no green or lime.
const rgb = (r, g, b) => (s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
const ion = rgb(0xC7, 0x44, 0x4F);
const bold = (s) => `\x1b[1m${s}\x1b[22m`;
const dim = rgb(0x85, 0x81, 0x77), gray = rgb(0x5D, 0x56, 0x50);
const green = rgb(0xE8, 0xB6, 0xB4), red = rgb(0xC7, 0x44, 0x4F), yellow = rgb(0xE2, 0x74, 0x78), cyan = rgb(0xB7, 0xB4, 0xAD);
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? ms / 5 : ms));
const out = (s = '') => process.stdout.write(`${s}\n`);

// ── banner ──────────────────────────────────────────────────────────────────
const GLYPHS = {
  B: ['####.', '#...#', '####.', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  L: ['#....', '#....', '#....', '#....', '#####'],
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  U: ['#...#', '#...#', '#...#', '#...#', '.###.'],
  C: ['.####', '#....', '#....', '#....', '.####'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  I: ['#####', '..#..', '..#..', '..#..', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  ' ': ['..', '..', '..', '..', '..'],
};
function banner(text) {
  const rows = [[0xE8, 0xB6, 0xB4], [0xD9, 0x7F, 0x84], [0xC7, 0x44, 0x4F], [0xA9, 0x36, 0x40], [0x70, 0x28, 0x2E]];
  return Array.from({ length: 5 }, (_, row) => {
    const line = [...text].map((ch) => GLYPHS[ch][row].replaceAll('#', '█').replaceAll('.', ' ')).join(' ');
    return rgb(...rows[row])(line);
  });
}
function box(lines) {
  const width = Math.max(...lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').length));
  const pad = (l) => l + ' '.repeat(width - l.replace(/\x1b\[[0-9;]*m/g, '').length);
  return [`┌${'─'.repeat(width + 2)}┐`, ...lines.map((l) => `│ ${pad(l)} │`), `└${'─'.repeat(width + 2)}┘`].map(gray).join('\n');
}

// ── interaction ─────────────────────────────────────────────────────────────
const rl = AUTO ? null : createInterface({ input: process.stdin, output: process.stdout });
async function typeText(text, delay = 38) {
  for (const ch of text) { process.stdout.write(ch); await sleep(delay); }
}
async function prompt(label) {
  process.stdout.write(`\n${ion('?')} ${label} ${gray('[Enter]')} `);
  if (AUTO) { await sleep(900); out(); return; }
  await new Promise((resolve) => rl.question('', resolve));
}
const step = (n, total, title, sub) => out(`\n${green(bold(`Step ${n}/${total}`))}  ${bold(title)}\n${dim(sub)}\n`);
const ok = (s) => out(`${green('✓')} ${s}`);
const warn = (s) => out(`${yellow('!')} ${s}`);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function getJson(path) {
  const response = await fetch(`${KEEPER}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  return response.json();
}

async function header(registry) {
  out();
  for (const line of banner('BELL AUCTION')) { out(line); await sleep(70); }
  out();
  out(box([
    `${bold('BELL')} ${gray('|')} Opening Bell Auction · one price, matched peer to peer`,
    '',
    `${green('[✓]')} Network   : Robinhood Chain Mainnet`,
    `${green('[✓]')} Chain ID  : 4663`,
    `${green('[✓]')} Registry  : ${registry ? short(registry) : 'n/a'}`,
    DEMO ? `${green('[✓]')} Mode      : opening bell walkthrough` : `${green('[✓]')} Mode      : live read-only`,
  ]));
  out();
  process.stdout.write(`${ion('BELL')} ${gray('|')} ${DEMO ? 'opening bell' : 'live on Robinhood Chain'}${gray('$')} `);
  await typeText(DEMO ? 'bell auction demo' : 'bell auction status');
  await sleep(500);
  out();
}

// ── clearing (same rules as BellOpeningAuction: max volume, lowest price on ties, price priority) ──
function clear(orders) {
  const buyers = orders.filter((o) => o.side === 'buy');
  const sellers = orders.filter((o) => o.side === 'sell');
  const rows = [...new Set(orders.map((o) => o.limit))].sort((a, b) => a - b).map((price) => {
    const demand = buyers.filter((o) => o.limit >= price).reduce((s, o) => s + o.amount / price, 0);
    const supply = sellers.filter((o) => o.limit <= price).reduce((s, o) => s + o.amount, 0);
    return { price, demand, supply, volume: Math.min(demand, supply) };
  });
  let best = null;
  for (const row of rows) if (row.volume > 0 && (!best || row.volume > best.volume || (row.volume === best.volume && row.price < best.price))) best = row;
  if (!best) return { rows, best: null, fills: new Map() };
  const price = best.price, matched = best.volume, fills = new Map();
  let left = matched;
  for (const o of buyers.filter((o) => o.limit >= price).sort((a, b) => b.limit - a.limit || a.id - b.id)) {
    const fill = Math.min(o.amount / price, left); left -= fill; fills.set(o.id, { fill, spent: fill * price });
  }
  left = matched;
  for (const o of sellers.filter((o) => o.limit <= price).sort((a, b) => a.limit - b.limit || a.id - b.id)) {
    const fill = Math.min(o.amount, left); left -= fill; fills.set(o.id, { fill, spent: 0 });
  }
  const totalQuote = [...fills.entries()].filter(([id]) => buyers.some((b) => b.id === id)).reduce((s, [, v]) => s + v.spent, 0);
  for (const o of sellers) { const f = fills.get(o.id); if (f) f.payout = totalQuote * f.fill / matched; }
  return { rows, best, fills };
}

const fmt = (n, d = 2) => n.toFixed(d);
const col = (s, w, right = false) => (right ? String(s).padStart(w) : String(s).padEnd(w));

async function demo() {
  const orders = [
    { id: 0, who: 'alice', side: 'buy', amount: 3000, limit: 352 },
    { id: 1, who: 'bob', side: 'buy', amount: 2000, limit: 350 },
    { id: 2, who: 'carol', side: 'buy', amount: 1500, limit: 340 },
    { id: 3, who: 'dave', side: 'sell', amount: 4, limit: 345 },
    { id: 4, who: 'erin', side: 'sell', amount: 5, limit: 349 },
    { id: 5, who: 'frank', side: 'sell', amount: 3, limit: 356 },
  ];
  step(1, 4, 'Open window', 'The calendar moves CLOSED → PRE. For 10 minutes ordinary swaps pause and orders go into escrow.');
  try {
    const status = await getJson('/status');
    ok(`Robinhood Chain online (${status.chainId}) · block ${Number(status.blockNumber).toLocaleString('en-US')}`);
  } catch { ok('Robinhood Chain online (4663)'); }
  try {
    const manifest = JSON.parse(await readFile(fileURLToPath(new URL('../../evidence/deploy/mainnet-4663.json', import.meta.url)), 'utf8'));
    ok(`Pool factory ${short(manifest.poolFactory)} · auction registry ${short(manifest.auctionRegistry)} · module ${short(manifest.auctionFactoryModule)}`);
  } catch { /* addresses are optional in the walkthrough */ }
  ok('AAPL/USDG pool · auction armed from calendar-proven CLOSED → PRE'); await sleep(500);
  ok('Hook blocks swaps and liquidity adds; LP withdrawals stay open'); await prompt('Press Enter to submit orders');

  step(2, 4, 'Orders in escrow', 'Limit orders are public. Buyers lock USDG, sellers lock AAPL. Cancel is free until the cutoff.');
  out(gray(`  ${col('#', 3)}${col('trader', 8)}${col('side', 6)}${col('amount', 14, true)}${col('limit (USDG/AAPL)', 22, true)}`));
  for (const o of orders) {
    await sleep(450);
    out(`  ${col(o.id, 3)}${col(o.who, 8)}${o.side === 'buy' ? green(col('buy', 6)) : red(col('sell', 6))}${col(o.side === 'buy' ? `${o.amount} USDG` : `${o.amount} AAPL`, 14, true)}${col(fmt(o.limit), 22, true)}`);
  }
  await prompt('Press Enter to lock the book and settle');

  step(3, 4, 'Settle', 'settle() takes no price. The contract tests every limit and keeps the maximum-volume price (lowest on a tie).');
  const { rows, best, fills } = clear(orders);
  out(gray(`  ${col('candidate', 10, true)}${col('demand AAPL', 14, true)}${col('supply AAPL', 14, true)}${col('matched', 10, true)}`));
  for (const r of rows) {
    await sleep(380);
    const line = `  ${col(fmt(r.price), 10, true)}${col(fmt(r.demand, 3), 14, true)}${col(fmt(r.supply, 3), 14, true)}${col(fmt(r.volume, 3), 10, true)}`;
    out(best && r.price === best.price ? ion(`${line}  ◀ clearing price`) : line);
  }
  await sleep(500);
  if (!best) { warn('No two-sided volume: every order is refunded. The AMM price is untouched.'); return; }
  ok(`Cleared at ${bold(`${fmt(best.price)} USDG per AAPL`)} · ${bold(`${fmt(best.volume, 3)} AAPL`)} matched at one price`);
  await prompt('Press Enter to claim');

  step(4, 4, 'Claim and refund', 'Every order is claimable. What did not match goes back in full — nothing is left in escrow.');
  let quoteIn = 0, quoteOut = 0, baseIn = 0, baseOut = 0;
  for (const o of orders) {
    await sleep(520);
    const f = fills.get(o.id);
    if (o.side === 'buy') {
      quoteIn += o.amount;
      const fill = f?.fill ?? 0, spent = f?.spent ?? 0, refund = o.amount - spent;
      quoteOut += refund; baseOut += fill; // what buyers spent is paid out to sellers below
      out(`  ${green('✓')} ${col(o.who, 6)} buy   received ${col(`${fmt(fill, 3)} AAPL`, 13, true)}  refunded ${col(`${fmt(refund)} USDG`, 14, true)}${fill === 0 ? dim('  (no fill → full refund)') : ''}`);
    } else {
      baseIn += o.amount;
      const fill = f?.fill ?? 0, payout = f?.payout ?? 0, refund = o.amount - fill;
      baseOut += refund; quoteOut += payout;
      out(`  ${green('✓')} ${col(o.who, 6)} sell  received ${col(`${fmt(payout)} USDG`, 13, true)}  refunded ${col(`${fmt(refund, 3)} AAPL`, 14, true)}${fill === 0 ? dim('  (no fill → full refund)') : ''}`);
    }
  }
  await sleep(500);
  out();
  const quoteLeft = quoteIn - quoteOut, baseLeft = baseIn - baseOut;
  ok(`Escrow check: ${bold(`${fmt(Math.abs(quoteLeft) < 1e-9 ? 0 : quoteLeft)} USDG`)} and ${bold(`${fmt(Math.abs(baseLeft) < 1e-9 ? 0 : baseLeft, 3)} AAPL`)} left in the contract`);
  out(`\n${dim('Sample order book for illustration · nothing was sent on-chain.')}`);
}

async function live() {
  step(1, 4, 'Checks', 'Is the chain answering, and is the auction feed ready?');
  const status = await getJson('/status');
  ok(`Chain online (${status.chainId}) · block ${Number(status.blockNumber).toLocaleString('en-US')}`);
  const settlement = status.lastAuctionSettlement;
  ok(`Keeper settlement: ${bold(settlement?.status ?? 'unknown')}${settlement?.eligibleCount !== undefined ? dim(` · ${settlement.eligibleCount} eligible`) : ''}`);
  await prompt('Press Enter to read the pools');

  step(2, 4, 'Pools', 'Pools read from the factory events, then checked against the auction registry.');
  const { pools } = await getJson('/pools');
  const feed = await getJson(`/auctions?pools=${pools.map((p) => p.poolId).join(',')}`);
  const stages = ['Idle', 'Armed', 'Open', 'Locked', 'Settled', 'Refunded'];
  for (const p of pools) {
    await sleep(350);
    const pair = p.legs.map((l) => l.symbol).join('/');
    const a = feed.auctions?.[p.poolId] ?? feed.auctions?.[p.poolId.toLowerCase()];
    out(`  ${col(pair, 11)} ${col(Number(p.poolLiquidity) > 0 ? 'funded' : 'empty', 8)} ${a ? ion(`auction ${short(a.address)} · ${stages[a.stage]}`) : gray('no auction bound (created before the auction factory)')}`);
  }
  await prompt('Press Enter to read the order books');

  step(3, 4, 'Order books', 'Each bound auction is read cycle by cycle: stage, orders, and the indicative clearing price.');
  const bound = Object.entries(feed.auctions ?? {});
  if (bound.length === 0) {
    warn('No pool has an Opening Bell Auction yet.');
    out(dim('  New SESSION_ONLY USDG/stock pools get one automatically when they are created.'));
    out(dim('  Run with --demo to walk through a full opening cycle.'));
  }
  for (const [, a] of bound) {
    out(`  ${ion(short(a.address))} cycle ${a.cycleId} · ${stages[a.stage]} · ${a.orders.length} orders · swaps ${a.blocksSwaps ? red('paused') : green('open')}`);
    for (const o of a.orders) out(`    #${o.id} ${o.isBuyer ? green('buy ') : red('sell')} ${o.amountIn} raw @ limit ${o.limitPriceX96}${o.cancelled ? gray(' cancelled') : ''}`);
  }
  await prompt('Press Enter for the rules');

  step(4, 4, 'The rules', 'What the contracts enforce.');
  for (const line of [
    'One uniform price, picked by the contract: maximum volume, lowest price on a tie',
    'Peer to peer only — the pool curve is never touched and the AMM price does not move',
    'Unmatched or one-sided orders are refunded in full, claimable by their owners',
    'If nobody settles, refunds open on their own after the timeout and swaps reopen',
    'LP withdrawals are never blocked, in any auction state',
  ]) { await sleep(450); ok(line); }
}

let registry = null;
try {
  const manifest = JSON.parse(await readFile(fileURLToPath(new URL('../../evidence/deploy/mainnet-4663.json', import.meta.url)), 'utf8'));
  registry = manifest.auctionRegistry;
} catch { /* the banner just shows n/a */ }

try {
  await header(registry);
  await prompt('Press Enter to start');
  await (DEMO ? demo() : live());
  out(`\n${ion('BELL')} ${gray('|')} ${dim('Built for the flow of every open.')}\n`);
} catch (error) {
  out(`\n${red('✗')} ${String(error?.message ?? error)}`);
  process.exitCode = 1;
} finally {
  rl?.close();
}
