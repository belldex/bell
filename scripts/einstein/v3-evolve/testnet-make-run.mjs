#!/usr/bin/env node
/**
 * Writes evidence/einstein/v3-evolve/run-3.json (the Robinhood testnet run) from testnet-run-config.json and the bot log. The page and
 * the replay read the pool ids, seed blocks, bot address and refused swaps from it; every number is then rebuilt from Swap events.
 *
 *   node scripts/einstein/v3-evolve/testnet-make-run.mjs [--status live|final]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createPublicClient, http, decodeErrorResult } from 'viem';
import { positionAmounts } from './lib.mjs';
import HookArtifact from '../../../contracts/out/BellHookV3.sol/BellHookV3.json' with { type: 'json' };
import ExecutorArtifact from '../../../contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json' with { type: 'json' };

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const env = {}; for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const cfg = JSON.parse(readFileSync('evidence/einstein/v3-evolve/testnet-run-config.json', 'utf8'));
const pc = createPublicClient({ transport: http(env.RH_TESTNET_RPC_SECONDARY || env.RH_TESTNET_RPC_PRIMARY) });
const usdgIsCurrency0 = BigInt(cfg.tokens.usdg) < BigInt(cfg.tokens.nvda);
const req = cfg.einstein.request;
const sqrt0 = Number(req.sqrtPriceX96) / 2 ** 96;
const held = positionAmounts(Number(req.liquidity), sqrt0, req.tickLower, req.tickUpper);
const seed = { usdg: String(Math.round(usdgIsCurrency0 ? held.amount0 : held.amount1)), nvda: String(Math.round(usdgIsCurrency0 ? held.amount1 : held.amount0)) };
const pool = (p, extra) => ({ poolId: p.poolId, hook: p.hook, positionId: extra.positionId, tickLower: req.tickLower, tickUpper: req.tickUpper, liquidity: req.liquidity, seed, usdgIsCurrency0, initSqrtPriceX96: req.sqrtPriceX96, seedTx: extra.seedTx, seedBlock: p.seedBlock });
const sha = createHash('sha256').update(readFileSync(cfg.bot.sourceFile, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

// Refused swaps: bot transactions on the Einstein pool that landed as reverted. Each is replayed one block earlier to read the error.
const blocked = [];
const logPath = 'evidence/einstein/v3-evolve/testnet-bot-log.jsonl';
const rows = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const reverted = rows.filter((r) => r.pool === 'bell' && r.tx && r.status === 'reverted');
for (const r of reverted) {
  const tx = await pc.getTransaction({ hash: r.tx });
  let data = null;
  try { await pc.call({ to: tx.to, data: tx.input, account: tx.from, blockNumber: tx.blockNumber - 1n }); } catch (e) { let c = e; while (c && !data) { data = typeof c.data === 'string' && c.data.startsWith('0x') ? c.data : null; c = c.cause; } }
  let error = r.error ?? 'reverted'; let selector = data ? data.slice(0, 10) : '0x00000000';
  try { if (data) error = decodeErrorResult({ abi: [...HookArtifact.abi, ...ExecutorArtifact.abi], data }).errorName; } catch { /* keep the logged text */ }
  blocked.push({ tx: r.tx, error, selector, at: r.at });
}

// Stretches where the bot and the price keeper did not run (longer than 20 minutes between two price updates). They are published as they are.
const feedTimes = rows.filter((r) => r.pool === 'feed' && r.action === 'setPrice').map((r) => Date.parse(r.at) / 1000);
const outages = [];
for (let i = 1; i < feedTimes.length; i += 1) if (feedTimes[i] - feedTimes[i - 1] > 20 * 60) outages.push({ fromTs: Math.round(feedTimes[i - 1]), toTs: Math.round(feedTimes[i]) });

const run = {
  run: 3, label: 'Testnet run, 21 to 23 November', network: 'testnet', status: arg('status', 'live'),
  window: { startTs: cfg.window.startTs, endTs: cfg.window.endTs },
  note: `Robinhood testnet, test tokens, a fixture price feed that follows a published seeded path. It tests the machinery, not mainnet economics.${cfg.stoppedEarly ? ` ${cfg.stoppedEarly.reason} The planned end was ${new Date(cfg.stoppedEarly.plannedEndTs * 1000).toISOString()}.` : ''}`,
  outages,
  config: {
    chain: { id: 46630, name: 'Robinhood Chain testnet', explorer: 'https://explorer.testnet.chain.robinhood.com', publicRpc: 'https://rpc.testnet.chain.robinhood.com', poolManager: cfg.poolManager, feed: cfg.feed, feedKind: 'fixture' },
    decimals: { usdg: 6, nvda: 18 },
    window: { startTs: cfg.window.startTs, endTs: cfg.window.endTs },
    blocks: { start: cfg.window.startBlock },
    pools: {
      bell: pool({ ...cfg.pools.bell }, { positionId: String(cfg.einstein.tokenId), seedTx: cfg.pools.bell.createTx }),
      control: pool({ ...cfg.pools.control }, { positionId: 'see seed tx', seedTx: cfg.pools.control.seedTx }),
    },
    path: cfg.path,
    bot: { addresses: [cfg.bot.address], sourceFile: cfg.bot.sourceFile, sourceUrl: `https://github.com/belldex/bell/blob/main/${cfg.bot.sourceFile}`, sourceSha256: sha, maxUsdg: cfg.bot.maxUsdg },
    blocked,
  },
};
const out = 'evidence/einstein/v3-evolve/run-3.json';
const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
run.methodCommit = prev.methodCommit ?? arg('method-commit', null);
writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
console.log(`wrote ${out}: ${rows.filter((r) => r.action === 'buyNvda' || r.action === 'sellNvda').length} bot trades logged, ${blocked.length} refused on the Einstein pool`);
