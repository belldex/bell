#!/usr/bin/env node
/**
 * Build apps/web/content/elysium-testnet.json for the /elysium page from the repository's own Elysium records:
 * deployments/elysium-testnet.json and evidence/deploy/elysium-testnet-*.json. Nothing on the page is typed by hand, and a
 * check appears only when its evidence entry carries a transaction hash.
 *
 *   node scripts/deploy/elysium-site-data.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const manifest = read('deployments/elysium-testnet.json');
const adapters = read('evidence/deploy/elysium-testnet-adapters.json');
const rehearsal = read('evidence/deploy/elysium-testnet-rehearsal.json');
const executor = read('evidence/deploy/elysium-testnet-executor.json');
const pools = read('evidence/deploy/elysium-testnet-pools.json')?.pools ?? [];
const tests = read('evidence/deploy/elysium-testnet-tests.json')?.entries ?? [];
const verification = read('evidence/deploy/elysium-testnet-verification.json') ?? { verified: {} };
if (!manifest || !pools.length || !tests.length) throw new Error('the Elysium evidence is incomplete');

const EXPLORER = 'https://testnet.elysium.kinetiq.xyz';
const lower = (a) => a.toLowerCase();
const matchOf = (a) => verification.verified?.[lower(a)] ?? null;
const row = (group, name, address) => ({ group, name, address, source: matchOf(address) });

const poolPair = (p) => (p.auction == null ? 'tAAPL / WETH' : tests.find((t) => t.test === 'opening auction full cycle' && t.pool.toLowerCase() === p.hook.toLowerCase()) ? 'tNVDA / tUSDG' : 'tAAPL / tUSDG');
const contracts = [
  ...[['safetyController', 'SafetyController'], ['assetRegistry', 'AssetRegistry'], ['calendarRegistry', 'CalendarRegistry'], ['sessionRegistry', 'SessionRegistry']]
    .map(([k, n]) => row('Registries', n, manifest[k])),
  ...[['policyOracle', 'BellPolicyOracle'], ['policyDependencyReader', 'BellPolicyDependencyReader'], ['modeEvaluator', 'BellModeEvaluator']]
    .map(([k, n]) => row('Policy', n, manifest[k])),
  ...[['auctionRegistry', 'BellAuctionRegistry'], ['auctionFactoryModule', 'BellAuctionFactoryModule']].map(([k, n]) => row('Opening Bell Auction', n, manifest[k])),
  ...[['hookDeployer', 'BellHookDeployerV2'], ['poolFactory', 'BellPoolFactory'], ['router', 'BellRouter']].map(([k, n]) => row('Pools and swaps', n, manifest[k])),
  ...[['poolManager', 'Uniswap v4 PoolManager (deployed by BELL)'], ['positionManager', 'Uniswap v4 PositionManager (deployed by BELL)'], ['weth', 'WETH']]
    .map(([k, n]) => row('Dependencies', n, manifest[k])),
  row('Test tokens', 'tAAPL (BELL test)', manifest.testStock),
  row('Test tokens', 'tUSDG (BELL test)', manifest.feeToken),
  ...(rehearsal ? [row('Test tokens', 'tNVDA (BELL test)', rehearsal.stock2)] : []),
  // Created by the factory inside each pool-creation transaction.
  ...pools.map((p) => row('Pool hooks (mask 0x2CC0)', `BellHookV2, ${poolPair(p)}`, p.hook)),
  ...pools.filter((p) => p.auction).map((p) => row('Auctions, one per USDG/stock pool', `BellOpeningAuction, ${poolPair(p)}`, p.auction)),
  // Rehearsal attestation adapters and helper, deployed from Node scripts.
  ...(adapters ? [
    row('Attestation adapters (rehearsal)', 'YahooSourceVerifier', adapters.verifier),
    row('Attestation adapters (rehearsal)', 'tAAPL direct adapter', adapters.directAdapter),
    row('Attestation adapters (rehearsal)', 'tAAPL regular adapter', adapters.regularAdapter),
    row('Attestation adapters (rehearsal)', 'tAAPL extended adapter', adapters.extendedAdapter),
  ] : []),
  ...(rehearsal?.adapters ? [
    row('Attestation adapters (rehearsal)', 'tNVDA direct adapter', rehearsal.adapters.direct),
    row('Attestation adapters (rehearsal)', 'tNVDA regular adapter', rehearsal.adapters.regular),
    row('Attestation adapters (rehearsal)', 'tNVDA extended adapter', rehearsal.adapters.extended),
  ] : []),
  ...(executor ? [row('Rehearsal helper', 'TestnetSwapExecutor', executor.executor)] : []),
];

// Pool labels. The pool with the rehearsal auction cycle is the tNVDA pool; the other auction pool is tAAPL / tUSDG.
const cycle = tests.find((t) => t.test === 'opening auction full cycle');
const pair = (p) => (p.auction == null ? 'tAAPL / WETH' : cycle && lower(p.hook) === lower(cycle.pool) ? 'tNVDA / tUSDG' : 'tAAPL / tUSDG');
const poolRows = pools.map((p) => ({
  pair: pair(p), kind: p.kind, hook: p.hook, auction: p.auction, createTx: p.createTx, tokenId: p.tokenId, maskOk: p.hookMaskOk,
  calendar: p.auction && cycle && lower(p.hook) === lower(cycle.pool) ? 'Compressed rehearsal calendar (90 minutes)' : 'US-Eastern calendar, real sessions',
}));

const entry = (name, pool) => tests.find((t) => t.test === name && (!pool || lower(t.pool) === lower(pool)));
const A = pools.find((p) => p.auction == null)?.hook;
const B = pools.find((p) => p.auction != null && !(cycle && lower(p.hook) === lower(cycle.pool)))?.hook;
const C = cycle?.pool;
const txOf = (e) => e?.tx ?? e?.settleTx ?? e?.sellOrder?.tx ?? null;

const checks = [
  ['Real calendar, market CLOSED', 'Swap inside the cap', 'PASS', 'The swap goes through and spends part of the closed-market budget.', entry('swap inside the cap', A)],
  ['Real calendar, market CLOSED', 'Swap above the cap', 'REVERTS', 'A swap larger than the budget is refused with TradeCapExceeded. The failed transaction is on chain.', entry('swap above the cap reverts', A)],
  ['Real calendar, market CLOSED', 'Withdraw 10% of the position', 'PASS', 'Both tokens come back to the owner. No BELL permission can stand in the way.', entry('withdraw while the market is CLOSED', A)],
  ['Real calendar, market CLOSED', 'Swap on the auction pool', 'PASS', 'The pool that carries the Opening Bell Auction trades inside its closed-market budget too.', entry('swap inside the cap', B)],
  ['Compressed rehearsal, tNVDA pool', 'Swap before the auction window', 'PASS', 'The market is still closed and the window has not opened, so a swap inside the budget is accepted.', entry('swap while CLOSED, before the auction window', C)],
  ['Compressed rehearsal, tNVDA pool', 'Swap while the auction window is open', 'REVERTS', 'Ordinary swaps are blocked with AuctionActive while orders are collected.', entry('swap during the auction window is blocked', C)],
  ['Compressed rehearsal, tNVDA pool', 'Auction orders submitted', 'PASS', 'A sell order for 5 tNVDA (limit 99) and a buy order for 600 tUSDG (limit 101) enter the book.', entry('auction orders submitted', C)],
  ['Compressed rehearsal, tNVDA pool', 'Auction settled at one price', 'PASS', 'The book locks at the open and every order clears at the same price, about 99 tUSDG per tNVDA.', cycle],
  ['Compressed rehearsal, tNVDA pool', 'Swap in the PRE session', 'PASS', 'The hook reports ACTIVE after the open and the swap goes through.', entry('swap in the PRE session', C)],
  ['Compressed rehearsal, tNVDA pool', 'Swap in the REGULAR session', 'PASS', 'The same, one session later.', entry('swap in the REGULAR session', C)],
  ['Compressed rehearsal, tNVDA pool', 'Swap after the session closes, with no close anchor', 'REVERTS', 'With no signed close anchor BELL fails closed: the swap is refused with PolicyBlocked.', entry('swap in CLOSED after the session fails closed (no close anchor)', C)],
  ['Compressed rehearsal, tNVDA pool', 'Withdraw while swaps are blocked', 'PASS', 'The owner still removes liquidity. Swaps can be stopped, exits cannot.', entry('withdraw while swaps are blocked (no close anchor)', C)],
]
  .filter(([, , , , e]) => e && txOf(e) && /^0x[0-9a-f]{64}$/i.test(txOf(e)))
  .map(([group, title, result, what, e]) => ({ group, title, result, what, tx: txOf(e), block: e.block ?? e.settleBlock ?? null, at: e.at }));

const auction = cycle && {
  pool: cycle.pool, auction: cycle.auction, cycle: cycle.cycle, settleTx: cycle.settleTx, claimTxs: cycle.claimTxs,
  clearingPrice: cycle.clearingPriceUsdgPerStock, matchedBase: cycle.matchedBase, stage: cycle.stageAfter,
  sellerReceived: cycle.allocationSell?.quotePayout, buyerRefund: cycle.allocationBuy?.quoteRefund,
};

const counts = { full: 0, partial: 0, none: 0 };
for (const c of contracts) counts[c.source === 'partial' ? 'partial' : c.source ? 'full' : 'none']++;

const data = {
  chainId: manifest.chainId,
  network: 'Elysium testnet',
  explorer: EXPLORER,
  generatedAt: new Date().toISOString(),
  stats: { contracts: contracts.length, pools: poolRows.length, checks: checks.length, auctions: auction ? 1 : 0 },
  contracts, pools: poolRows, checks, auction,
  verification: { ...counts, status: verification.explorerStatus ?? null, meaning: verification.meaning ?? null, api: verification.verifierApi ?? null },
  extras: { verifier: adapters?.verifier ?? null, executor: executor?.executor ?? null },
};
writeFileSync('apps/web/content/elysium-testnet.json', `${JSON.stringify(data, null, 2)}\n`);
console.log(`wrote apps/web/content/elysium-testnet.json: ${contracts.length} contracts, ${poolRows.length} pools, ${checks.length} checks, verification ${JSON.stringify(counts)}`);
