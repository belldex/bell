import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../../apps/web/public/templates/v4market/', import.meta.url);
const html = new URL('index.html', root);
const motion = new URL('_next/static/immutable/chunks/0p9qvp398s0rj.js', root);

const copy = [
  ['<title>v4 Marketplace: stack Uniswap v4 hooks in one pool</title>', '<title>BELL — Liquidity that knows the bell</title>'],
  ['Stack up to five hooks in one Uniswap v4 pool. Every swap pays every v4 hook it passes through, and every hook has its author&#x27;s $V4M stake behind it.', 'Session-aware fees, bounded gross flow and planned-close controls for tokenized-stock liquidity. Testnet rehearsal; production swaps are not enabled.'],
  ['v4 Marketplace: stack Uniswap v4 hooks in one pool', 'BELL — Liquidity that knows the bell'],
  ['Stack up to five v4 hooks in a new v4 pool, in one transaction.', 'Review a BELL pool configuration. Mainnet pool creation is not enabled.'],
  ['Compile your hook, deploy it from your wallet and list it.', 'Inspect BELL pool classes and their explicit risk disclosures.'],
  ['List your v4 hook, set its royalty and stake $V4M behind it.', 'Check immutable pool session, reference and budget policy.'],
  ['<span class="w">The</span><span class="w">marketplace</span><span class="w">for</span><span class="w">Uniswap</span><span class="w">v4</span><span class="w">hooks</span>', '<span class="w">Liquidity</span><span class="w">that knows</span><span class="w">the</span><span class="w">bell</span>'],
  ['Building a v4 hook? This is your market. One pool stacks up to five v4 hooks, and every swap pays each of them.', 'BELL applies session-aware fees, bounded gross flow and planned-close controls to tokenized-stock pools.'],
  ['Build a v4 hook', 'Explore BELL pools'],
  ['Create a pool', 'Explore pools'],
  ['href="/templates/v4market/app/build-hook"', 'href="/pools"'],
  ['href="/templates/v4market/app/create-pool"', 'href="/create"'],
  ['href="/templates/v4market/app"', 'href="/pools"'],
  ['href="/templates/v4market/protocol"', 'href="/protocol"'],
  ['A v4 pool gets one hook, forever', 'One immutable BELL policy per pool'],
  ['The hook is fixed in the pool key when the pool opens, and nothing can be added later. So each pool runs one team&#x27;s code. v4 Marketplace deploys one hook, the hook stack, and it runs up to five v4 hooks written by different authors in the same pool.', 'The BELL hook address and risk profile are fixed when a pool is created. Each pool binds its session, reference and flow-budget policy immutably.'],
  ['Watch live swaps', 'Review pool preview'],
  ['Every swap pays every v4 hook it passes through', 'Every swap follows the immutable pool policy'],
  ['Each hook sets a royalty from 0 to 10 basis points, with 30 for the whole stack. The hook stack takes it from the swap in the pool&#x27;s own currencies and credits each author on the spot: 80% to the author over seven days, 20% to a burn reserve.', 'BELL does not take principal or add a hook fee. Session fees and gross-flow caps are checked in both pool currencies.'],
  ['The hook stack', 'BELL policy'],
  ['One v4 hook for every v4 Marketplace pool, running up to five v4 hooks in order. Each runs with a hard gas limit. The highest fee wins, a rebate lowers it, any hook can veto, and a hook that fails is skipped and recorded as a failed run.', 'Each BELL pool has one immutable policy instance. Missing, stale or conflicting session and source state fails closed.'],
  ['Four house hooks on day one', 'Session fees by market state'],
  ['The house storefront opens with four v4 hooks that hold no funds. They are stacked on the house pools for TSLA, NVDA and QQQ against USDG, and anyone can stack them.', 'The configured fee follows the verified stock session. Bell, corporate-action and repricing guards can raise it; invalid or unexpected state halts swaps.'],
  ['Volatility fee', 'Regular session'],
  ['The fee follows the pool&#x27;s own recent moves: a moving average of tick changes between swaps sets it between 0.05% and 2%.', 'Base LP fee: 0.05%. Healthy active market inputs are required; stale or unknown inputs halt swaps.'],
  ['Anti-snipe', 'Opening bell fee'],
  ['A 25% fee the moment a pool opens, falling to nothing over ten minutes. Made for the v4 Marketplace pool a Pons coin opens beside its Pons pool.', 'The opening bell fee decays over 300 seconds after supported market open and never undercuts the current session fee.'],
  ['Agent rebate', 'Corporate-action guard'],
  ['A swap sent by a wallet that holds an ERC-8004 agent identity pays a quarter less fee. Agents find the pools through the hook stack&#x27;s events.', 'A stock-token pause or multiplier change invalidates trading until post-boundary data is consistent.'],
  ['Weekend gap guard', 'Planned-close guard'],
  ['While the stock market is closed, the fee widens to 1% and swaps that push the price outside 2% of the last close are refused.', 'Planned closures require a provenance-bound close anchor. The closed band and non-refilling episode budget remain binding.'],
  ['A v4 hook for every pool', 'A session policy for every pool'],
  ['A stacked hook can do what a standalone hook does on a single swap. Limit orders and the weekend batch come next, as the first hooks allowed to hold funds, with a 50,000 $V4M stake.', 'Every pool shows its class, market session, effective fee, data freshness, anchor provenance, flow budget and halt reason before signing.'],
  ['GDPR: v4 Marketplace keeps no account and no profile. Your wallet address is public chain data; the consent you give for cookies is stored in your browser only and can be withdrawn on the cookies page. Requests: through X.', 'BELL is a testnet rehearsal. Sample data is illustrative; production swaps are not enabled and mainnet release has not been approved.'],
  ['Ac 2026 v4 Marketplace', '© 2026 BELL / BOURSE-EVENT LIQUIDITY LAYER'],
  ['All rights reserved', 'Production swaps are not enabled. Mainnet release has not been approved.'],
];

for (const url of [html, motion]) {
  let text = await readFile(url, 'utf8');
  for (const [before, after] of copy) text = text.replaceAll(before, after);
  await writeFile(url, text, 'utf8');
}

console.log('Adapted the extracted homepage and kinetic text bundle for BELL.');
