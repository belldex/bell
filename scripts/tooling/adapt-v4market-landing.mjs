import { readFile, writeFile } from 'node:fs/promises';

const templateDir = new URL('../../apps/web/public/templates/v4market/', import.meta.url);
const htmlUrl = new URL('index.html', templateDir);
const motionUrl = new URL('_next/static/immutable/chunks/0p9qvp398s0rj.js', templateDir);
const navUrl = new URL('_next/static/immutable/chunks/23p0ekqmz26t0.js', templateDir);

// 1. Read clean source from Downloads
const cleanHtml = await readFile('C:/Users/sifaq/Downloads/v4market-template/v4market/index.html', 'utf8');

const marker = 'self.__next_f.push([1,';
const startIdx = cleanHtml.indexOf(marker);
const endIdx = cleanHtml.lastIndexOf('])');
const contentStr = cleanHtml.slice(startIdx + marker.length, endIdx);
const unquoted = JSON.parse(contentStr);
const lines = unquoted.split('\n');

// 2. Story section replacements (Line 32)
const storyReplacements = [
  ['"The","marketplace","for","Uniswap","v4","hooks"', '"Liquidity","that knows","the","bell"'],
  ['Building a v4 hook? This is your market. One pool stacks up to five v4 hooks, and every swap pays each of them.', 'BELL applies session-aware fees, bounded gross flow and planned-close controls to tokenized-stock pools.'],
  ['"Build a v4 hook"', '"Explore BELL pools"'],
  ['"Create a pool"', '"Explore pools"'],
  ['"$$V4M"', '"BELL"'],
  ['Explorer ↗', 'Pool preview'],
  ['A v4 pool gets one hook, forever', 'One immutable BELL policy per pool'],
  ["The hook is fixed in the pool key when the pool opens, and nothing can be added later. So each pool runs one team's code. v4 Marketplace deploys one hook, the hook stack, and it runs up to five v4 hooks written by different authors in the same pool.", 'The BELL hook address and risk profile are fixed when a pool is created. Each pool binds its session, reference and flow-budget policy immutably.'],
  ['Watch live swaps', 'Review pool preview'],
  ['Every swap pays every v4 hook it passes through', 'Every swap follows the immutable pool policy'],
  ["Each hook sets a royalty from 0 to 10 basis points, with 30 for the whole stack. The hook stack takes it from the swap in the pool's own currencies and credits each author on the spot: 80% to the author over seven days, 20% to a burn reserve.", 'BELL does not take principal or add a hook fee. Session fees and gross-flow caps are checked in both pool currencies.'],
  ['"The hook stack"', '"BELL policy"'],
  ['One v4 hook for every v4 Marketplace pool, running up to five v4 hooks in order. Each runs with a hard gas limit. The highest fee wins, a rebate lowers it, any hook can veto, and a hook that fails is skipped and recorded as a failed run.', 'Each BELL pool has one immutable policy instance. Missing, stale or conflicting session and source state fails closed.'],
  ['Explore the hook stack', 'Explore BELL policy'],
  ['"Storefronts"', '"Pool classes"'],
  ['Ship your v4 hook from a storefront with verified source and get paid on every swap that runs it. Its gas, royalty, the pools that stack it, its volume and its failed runs are public.', 'PRICE_GUARDED requires independent references for both assets. SESSION_ONLY provides session controls and raw-unit limits without independent counterasset price protection.'],
  ['Explore storefronts', 'Explore pool classes'],
  ['"Royalties"', '"Weekend controls"'],
  ['Paid in the currency the swap moves, as claims held on the PoolManager. Authors claim after seven days. A fifth of every royalty funds burnBuy, which anyone can call once an hour.', 'A closed stock uses a historical close anchor captured before market close. Anchor age, corporate state, price provenance and one non-refilling closure-episode budget remain binding.'],
  ['Explore royalties', 'Explore closure controls'],
  ['"Stakes and failed runs"', '"Recovery and exit"'],
  ["Every listed v4 hook has 10,000 $V4M staked behind it. Three failed runs in a week burn 10% and remove the hook. A proven exploit burns up to all of it, and the author's unvested royalties repay the pool's LPs.", 'Trading resumes only after the required fresh checkpoints and recovery interval. BELL swap guards do not gate in-kind LP removal or fee collection.'],
  ['Explore stakes', 'Review position exit'],
];
for (const [from, to] of storyReplacements) {
  lines[32] = lines[32].replace(from, to);
}

// 3. Cases section replacements (Line 40)
const casesReplacements = [
  ['Four house hooks on day one', 'Session fees by market state'],
  ['The house storefront opens with four v4 hooks that hold no funds. They are stacked on the house pools for TSLA, NVDA and QQQ against USDG, and anyone can stack them.', 'The configured fee follows the verified stock session. Bell, corporate-action and repricing guards can raise it; invalid or unexpected state halts swaps.'],
  ['Volatility fee', 'Regular session'],
  ["The fee follows the pool's own recent moves: a moving average of tick changes between swaps sets it between 0.05% and 2%.", 'Base LP fee: 0.05%. Healthy active market inputs are required; stale or unknown inputs halt swaps.'],
  ['Anti-snipe', 'Opening bell fee'],
  ['A 25% fee the moment a pool opens, falling to nothing over ten minutes. Made for the v4 Marketplace pool a Pons coin opens beside its Pons pool.', 'The opening bell fee decays over 300 seconds after supported market open and never undercuts the current session fee.'],
  ['Agent rebate', 'Corporate-action guard'],
  ["A swap sent by a wallet that holds an ERC-8004 agent identity pays a quarter less fee. Agents find the pools through the hook stack's events.", 'A stock-token pause or multiplier change invalidates trading until post-boundary data is consistent.'],
  ['Weekend gap guard', 'Planned-close guard'],
  ['While the stock market is closed, the fee widens to 1% and swaps that push the price outside 2% of the last close are refused.', 'Planned closures require a provenance-bound close anchor. The closed band and non-refilling episode budget remain binding.'],
];
for (const [from, to] of casesReplacements) {
  lines[40] = lines[40].replace(from, to);
}

// 4. Wall section (Line 41)
lines[41] = lines[41].replace('A v4 hook for every pool', 'A session policy for every pool');
lines[41] = lines[41].replace(
  'A stacked hook can do what a standalone hook does on a single swap. Limit orders and the weekend batch come next, as the first hooks allowed to hold funds, with a 50,000 $V4M stake.',
  'Every pool shows its class, market session, effective fee, data freshness, anchor provenance, flow budget and halt reason before signing.'
);

// 5. Build section (Line 42)
lines[42] = lines[42].replace('Build a v4 hook', 'Explore BELL pools');
lines[42] = lines[42].replace('Build a v4 hook', 'Explore BELL pools');
lines[42] = lines[42].replace(
  'Start from the template or any listed hook, compile it on the site, deploy it from your wallet and list it in one flow. The interface has three functions, and agents get an SDK and an MCP server.',
  'Browse the BELL pool preview, compare immutable risk classes, or inspect the rehearsal interface. Current sample data is not an executable quote.'
);
lines[42] = lines[42].replace('Open a storefront', 'Create pool preview');
lines[42] = lines[42].replace('Open a storefront', 'Create pool preview');

// 6. Footer copyright (Line 30)
lines[30] = lines[30].replace('© 2026 v4 Marketplace', '© 2026 BELL / BOURSE-EVENT LIQUIDITY LAYER');
lines[30] = lines[30].replace('All rights reserved.', 'Production swaps are not enabled. Mainnet release has not been approved.');

// 7. Title & Metadata (Line 48)
lines[48] = lines[48].replace('v4 Marketplace: stack Uniswap v4 hooks in one pool', 'BELL — Liquidity that knows the bell');
lines[48] = lines[48].replace('v4 Marketplace: stack Uniswap v4 hooks in one pool', 'BELL — Liquidity that knows the bell');
lines[48] = lines[48].replace('v4 Marketplace: stack Uniswap v4 hooks in one pool', 'BELL — Liquidity that knows the bell');

const newUnquoted = lines.join('\n');
const newFlightJson = JSON.stringify(newUnquoted);

// 8. Static HTML (before marker)
let staticHtml = cleanHtml.slice(0, startIdx);
const allReplacements = [...storyReplacements, ...casesReplacements];
for (const [from, to] of allReplacements) {
  staticHtml = staticHtml.replaceAll(from, to);
}
staticHtml = staticHtml.replaceAll('A v4 hook for every pool', 'A session policy for every pool');
staticHtml = staticHtml.replaceAll(
  'A stacked hook can do what a standalone hook does on a single swap. Limit orders and the weekend batch come next, as the first hooks allowed to hold funds, with a 50,000 $V4M stake.',
  'Every pool shows its class, market session, effective fee, data freshness, anchor provenance, flow budget and halt reason before signing.'
);
staticHtml = staticHtml.replaceAll(
  'Start from the template or any listed hook, compile it on the site, deploy it from your wallet and list it in one flow. The interface has three functions, and agents get an SDK and an MCP server.',
  'Browse the BELL pool preview, compare immutable risk classes, or inspect the rehearsal interface. Current sample data is not an executable quote.'
);
staticHtml = staticHtml.replaceAll('© 2026 v4 Marketplace', '© 2026 BELL / BOURSE-EVENT LIQUIDITY LAYER');
staticHtml = staticHtml.replaceAll('All rights reserved.', 'Production swaps are not enabled. Mainnet release has not been approved.');
staticHtml = staticHtml.replaceAll('v4 Marketplace: stack Uniswap v4 hooks in one pool', 'BELL — Liquidity that knows the bell');
staticHtml = staticHtml.replaceAll(
  'Building a v4 hook? Four house hooks already earn on every swap: volatility fee, anti-snipe, agent rebate and weekend gap guard.<a href="/templates/v4market/protocol">Read the protocol.</a>',
  'BELL testnet rehearsal · Production swaps are not enabled. Mainnet release has not been approved.<a href="/protocol">Read BELL policy.</a>'
);
staticHtml = staticHtml.replaceAll(
  '<span class="w">The</span><span class="w">marketplace</span><span class="w">for</span><span class="w">Uniswap</span><span class="w">v4</span><span class="w">hooks</span>',
  '<span class="w">Liquidity</span><span class="w">that knows</span><span class="w">the</span><span class="w">bell</span>'
);

const newHtml = staticHtml + marker + newFlightJson + cleanHtml.slice(endIdx);
await writeFile(htmlUrl, newHtml, 'utf8');

// 9. Kinetic words (0p9qvp398s0rj.js)
let motion = await readFile(motionUrl, 'utf8');
if (!motion.includes('e=["Liquidity","that knows","the","bell"]')) {
  motion = motion.replace(
    'function({words:e}){',
    'function({words:e}){e=["Liquidity","that knows","the","bell"];'
  );
  await writeFile(motionUrl, motion, 'utf8');
}

// 10. Navigation bar & footer branding (23p0ekqmz26t0.js)
let nav = await readFile(navUrl, 'utf8');
nav = nav.replaceAll(
  'Building a v4 hook? Four house hooks already earn on every swap: volatility fee, anti-snipe, agent rebate and weekend gap guard.',
  'BELL testnet rehearsal · Production swaps are not enabled. Mainnet release has not been approved.'
);
nav = nav.replaceAll('"logo-v",children:"v"', '"logo-v",children:"B"');
nav = nav.replaceAll('"4"]}', '"ELL"]}');
nav = nav.replaceAll('"logo-sub",children:"MARKETPLACE"', '"logo-sub",children:"BOURSE-EVENT LIQUIDITY LAYER"');
nav = nav.replaceAll('"label":"Live swaps"', '"label":"Pool preview"');
nav = nav.replaceAll('"label":"Create a pool"', '"label":"Explore pools"');
nav = nav.replaceAll('"label":"Build a v4 hook"', '"label":"BELL pool classes"');
nav = nav.replaceAll('"label":"Storefronts"', '"label":"Risk policy"');
nav = nav.replaceAll('"label":"Royalties"', '"label":"Exit policy"');
await writeFile(navUrl, nav, 'utf8');

console.log('BELL adaptation successfully completed.');
