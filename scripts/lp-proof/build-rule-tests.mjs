#!/usr/bin/env node
/**
 * Build deployments/rule-tests.json (test D of the LP proof brief) from the transaction records that already exist.
 *
 *   node scripts/lp-proof/build-rule-tests.mjs
 *
 * The three rules are: a swap above the cap reverts, a swap while the session is uncertain reverts, and a withdraw while the
 * market is CLOSED succeeds. Today every entry is from the Elysium testnet rehearsal (chain 99801). The mainnet entries
 * (chain 4663) are listed as PENDING with no transaction: a mainnet entry is only ever written from a real transaction hash.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const tests = JSON.parse(readFileSync('evidence/deploy/elysium-testnet-tests.json', 'utf8'));
const by = (name) => tests.entries.find((e) => e.test === name);
const HASH = /^0x[0-9a-f]{64}$/i;

const RULES = [
  { id: 'swap-above-cap-reverts', rule: 'A swap above the trade cap reverts', expect: 'REVERTS', test: 'swap above the cap reverts', error: 'TradeCapExceeded' },
  { id: 'swap-in-uncertain-session-reverts', rule: 'A swap while the session is uncertain (no close anchor) reverts', expect: 'REVERTS', test: 'swap in CLOSED after the session fails closed (no close anchor)', error: 'PolicyBlocked' },
  { id: 'swap-during-auction-reverts', rule: 'A swap while the opening auction is open reverts', expect: 'REVERTS', test: 'swap during the auction window is blocked', error: 'AuctionActive' },
  { id: 'withdraw-while-closed-succeeds', rule: 'A withdraw while the market is CLOSED succeeds', expect: 'SUCCEEDS', test: 'withdraw while the market is CLOSED' },
  { id: 'withdraw-while-swaps-blocked-succeeds', rule: 'A withdraw while swaps are blocked succeeds', expect: 'SUCCEEDS', test: 'withdraw while swaps are blocked (no close anchor)' },
];

const testnet = RULES.map((r) => {
  const e = by(r.test);
  if (!e || !HASH.test(e.tx ?? '')) throw new Error(`no transaction recorded for: ${r.test}`);
  return { id: r.id, rule: r.rule, expect: r.expect, status: 'DONE', chainId: 99801, pool: e.pool, tx: e.tx, block: e.block, at: e.at, error: r.error ?? null };
});
const mainnet = RULES.map((r) => ({ id: r.id, rule: r.rule, expect: r.expect, status: 'PENDING', chainId: 4663, pool: null, tx: null, block: null, at: null, error: r.error ?? null }));

writeFileSync('deployments/rule-tests.json', `${JSON.stringify({
  note: 'Test D of the LP proof. Testnet entries are real transactions from the Elysium rehearsal. Mainnet entries stay PENDING until a real transaction exists.',
  testnet: { chainId: 99801, entries: testnet },
  mainnet: { chainId: 4663, entries: mainnet },
}, null, 2)}\n`);
console.log(`wrote deployments/rule-tests.json: ${testnet.length} testnet entries DONE, ${mainnet.length} mainnet entries PENDING`);
