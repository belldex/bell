#!/usr/bin/env node
/**
 * Writes evidence/einstein/v3-evolve/run-4.json (the mainnet run) from run-4-config.json. The page and the replay read the pool ids, the start block, the
 * bot address and the bot source hash from it, and every number is rebuilt from Swap events (build-v3-proof.mjs). Needs no keys and no network.
 *
 *   node scripts/einstein/v3-evolve/mainnet-make-run.mjs [--status live|final] [--method-commit <hash>]
 *
 * Run 4 amendment (method.json, runFourAmendments): the BELL side is the existing pool, so both pools are measured from the window start block, with the
 * BELL position's tokens valued at that block. Both pools start from the same price, the same liquidity and the same ticks.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { positionAmounts } from './lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const cfg = JSON.parse(readFileSync('evidence/einstein/v3-evolve/run-4-config.json', 'utf8'));
const bell = cfg.pools.bell; const control = cfg.pools.control;
const first = JSON.parse(readFileSync('evidence/einstein/first-pool-1794682147060.json', 'utf8'));
const usdgIsCurrency0 = BigInt(cfg.tokens.usdg) < BigInt(cfg.tokens.nvda);
const sqrt0 = Number(bell.startSqrtPriceX96) / 2 ** 96;
const held = positionAmounts(Number(bell.liquidity), sqrt0, bell.tickLower, bell.tickUpper);
const seed = { usdg: String(Math.round(usdgIsCurrency0 ? held.amount0 : held.amount1)), nvda: String(Math.round(usdgIsCurrency0 ? held.amount1 : held.amount0)) };
const sha = createHash('sha256').update(readFileSync(cfg.bot.sourceFile, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const pool = (p, extra) => ({ poolId: p.poolId, hook: p.hook, positionId: extra.positionId, tickLower: bell.tickLower, tickUpper: bell.tickUpper, liquidity: bell.liquidity, seed, usdgIsCurrency0, initSqrtPriceX96: bell.startSqrtPriceX96, seedTx: extra.seedTx, seedBlock: cfg.window.startBlock, initBlock: extra.initBlock });

const run = {
  run: 4, label: 'Thanksgiving weekend, 26 to 30 November', network: 'mainnet', status: arg('status', 'live'),
  window: { startTs: cfg.window.startTs, endTs: cfg.window.endTs },
  note: 'Mainnet, real tokens, about 5 USDG in total. The BELL side is the existing NVDA/USDG pool; the control pool was seeded at the BELL pool\'s price with the same liquidity and ticks, and both are measured from that block. The bot trades only while the Chainlink NVDA round is at most 6 hours old. This shows the mechanism on mainnet at a small size. It is not an economics result for real capital.',
  outages: [],
  config: {
    chain: { id: 4663, name: 'Robinhood Chain', explorer: 'https://robinhoodchain.blockscout.com', publicRpc: 'https://rpc.mainnet.chain.robinhood.com', poolManager: cfg.poolManager, feed: cfg.feed, feedKind: 'chainlink' },
    decimals: { usdg: 6, nvda: 18 },
    window: { startTs: cfg.window.startTs, endTs: cfg.window.endTs },
    blocks: { start: cfg.window.startBlock },
    pools: {
      bell: pool(bell, { positionId: String(first.tokenId ?? 'existing position'), seedTx: first.txs?.createAndSeed ?? null, initBlock: first.block }),
      control: pool(control, { positionId: control.positionTokenId, seedTx: control.seedTx, initBlock: control.seedBlock }),
    },
    bot: { addresses: [cfg.bot.address], sourceFile: cfg.bot.sourceFile, sourceUrl: `https://github.com/belldex/bell/blob/main/${cfg.bot.sourceFile}`, sourceSha256: sha, maxUsdg: cfg.bot.maxUsdg },
    blocked: [],
  },
};
const out = 'evidence/einstein/v3-evolve/run-4.json';
const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
run.methodCommit = arg('method-commit', prev.methodCommit ?? null);
writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
console.log(`wrote ${out}; seed per pool ${seed.usdg} raw USDG and ${seed.nvda} raw NVDA`);
