#!/usr/bin/env node
/**
 * v3 Evolve on Robinhood testnet: the fixture price keeper and the arbitrage bot in one loop.
 *
 * Every STEP seconds it (1) moves the fixture NVDA feed along a published, seeded price path, then (2) runs the same decision rule
 * (scripts/einstein/v3-evolve/arb.mjs) on the Einstein pool and on the control pool, with the same maximum size, and sends the trades
 * through the same swap helper. A trade that reverts is sent anyway with a fixed gas limit, so the revert is on chain and linked.
 * The path is seeded from the config file, so anyone can regenerate it and compare it with the PriceSet events of the fixture feed.
 *
 *   node scripts/einstein/v3-evolve/testnet-bot.mjs init  --einstein <pool log> --control <control pool log> --end 2026-11-23T15:00:00Z
 *   node scripts/einstein/v3-evolve/testnet-bot.mjs once
 *   node scripts/einstein/v3-evolve/testnet-bot.mjs loop
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, encodePacked, parseUnits, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { decideArb, humanState } from './arb.mjs';
import { sessionIntervals, sessionAt } from './lib.mjs';
import FeedArtifact from '../../../contracts/out/MockChainlinkFeed.sol/MockChainlinkFeed.json' with { type: 'json' };
import ExecutorArtifact from '../../../contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json' with { type: 'json' };

const CONFIG = 'evidence/einstein/v3-evolve/testnet-run-config.json';
const BOTLOG = 'evidence/einstein/v3-evolve/testnet-bot-log.jsonl';
const FEE_OF = { CLOSED: 10000, OVERNIGHT: 5000, PRE: 3000, POST: 3000, REGULAR: 500 };
const command = process.argv[2] ?? 'once';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const acct = (name) => { const k = env[name]; return privateKeyToAccount(k.startsWith('0x') ? k : `0x${k}`); };
const keeper = acct('DEPLOYER_PRIVATE_KEY'); // owns the fixture feed
const botAccount = acct('LP_TEST_PRIVATE_KEY');   // the bot wallet
const pc = createPublicClient({ transport: http(rpcUrl) });
const keeperWc = createWalletClient({ account: keeper, transport: http(rpcUrl) });
const botWc = createWalletClient({ account: botAccount, transport: http(rpcUrl) });

/** Seeded random walk. mulberry32 is public domain; Box-Muller turns it into normal steps. */
function pathPrice(cfg, step) {
  let a = cfg.path.seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const sigma = cfg.path.sigmaDay * Math.sqrt(cfg.path.stepSeconds / 86400);
  let p = cfg.path.startPrice;
  for (let k = 1; k <= step; k++) {
    const z = Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    p *= Math.exp(sigma * z);
    if (cfg.window.startTs + k * cfg.path.stepSeconds >= cfg.path.jump.atTs && cfg.window.startTs + (k - 1) * cfg.path.stepSeconds < cfg.path.jump.atTs) p *= 1 + cfg.path.jump.pct / 100;
  }
  return p;
}

if (command === 'init') {
  const einstein = JSON.parse(readFileSync(arg('einstein'), 'utf8'));
  const control = JSON.parse(readFileSync(arg('control'), 'utf8'));
  const manifest = JSON.parse(readFileSync('evidence/deploy/pq-hooks-testnet-46630.json', 'utf8'));
  const fixtures = JSON.parse(readFileSync('evidence/deploy/testnet-46630-einstein-fixtures.json', 'utf8'));
  const inputs = JSON.parse(readFileSync('evidence/deploy/testnet-46630-pq-inputs.json', 'utf8'));
  const startBlock = Math.max(einstein.block, control.seedBlock);
  const startTs = Number((await pc.getBlock({ blockNumber: BigInt(startBlock) })).timestamp);
  const endTs = Math.floor(Date.parse(arg('end')) / 1000);
  const cfg = {
    chainId: 46630, createdAt: new Date().toISOString(),
    window: { startTs, endTs, startBlock },
    feed: fixtures.feed.address, executor: control.executor, poolManager: inputs.poolManager,
    tokens: { nvda: manifest.assetDescriptors.NVDA.token, usdg: manifest.assetDescriptors.USDG.token },
    bot: { address: botAccount.address, maxUsdg: 100, minUsdg: 0.5, stepSeconds: 300, sourceFile: 'scripts/einstein/v3-evolve/testnet-bot.mjs', rule: 'scripts/einstein/v3-evolve/arb.mjs' },
    path: { seed: Number(arg('seed', '20261121')), sigmaDay: 0.04, stepSeconds: 300, startPrice: Number(fixtures.feed.initialPriceE8) / 1e8, jump: { atTs: Math.floor(Date.parse('2026-11-23T14:30:00Z') / 1000), pct: -2.5, note: 'a gap at the Monday 09:30 ET open' } },
    pools: {
      bell: { poolId: einstein.poolId, hook: einstein.hook, createTx: einstein.txs.createAndSeed, seedBlock: einstein.block, key: null },
      control: { poolId: control.poolId, hook: '0x0000000000000000000000000000000000000000', fee: 3000, key: control.key, seedTx: control.txs.seed, initializeTx: control.txs.initialize, seedBlock: control.seedBlock },
    },
    einstein, controlLog: { executorTx: control.txs.executor },
  };
  writeFileSync(CONFIG, `${JSON.stringify(cfg, null, 2)}\n`);
  console.log(`wrote ${CONFIG}; window ${new Date(startTs * 1000).toISOString()} to ${new Date(endTs * 1000).toISOString()}`);
  process.exit(0);
}

const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
const feedAbi = FeedArtifact.abi;
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)']);
const pmAbi = parseAbi(['function extsload(bytes32 slot) view returns (bytes32)']);
const [c0, c1] = BigInt(cfg.tokens.nvda) < BigInt(cfg.tokens.usdg) ? [cfg.tokens.nvda, cfg.tokens.usdg] : [cfg.tokens.usdg, cfg.tokens.nvda];
const usdgIsCurrency0 = c0.toLowerCase() === cfg.tokens.usdg.toLowerCase();
const einsteinKey = { currency0: c0, currency1: c1, fee: 0x800000, tickSpacing: 60, hooks: cfg.pools.bell.hook };
const controlKey = cfg.pools.control.key;
const log = (row) => appendFileSync(BOTLOG, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);

async function poolState(poolId) {
  const slot = BigInt(keccak256(encodePacked(['bytes32', 'uint256'], [poolId, 6n])));
  const hex = (n) => `0x${n.toString(16).padStart(64, '0')}`;
  const [s0, liq] = await Promise.all([pc.readContract({ address: cfg.poolManager, abi: pmAbi, functionName: 'extsload', args: [hex(slot)] }), pc.readContract({ address: cfg.poolManager, abi: pmAbi, functionName: 'extsload', args: [hex(slot + 3n)] })]);
  const sqrtPriceX96 = BigInt(s0) & ((1n << 160n) - 1n);
  return { sqrtPriceX96, liquidity: BigInt(liq) & ((1n << 128n) - 1n) };
}

async function ensureAllowance(token) {
  const a = await pc.readContract({ address: token, abi: erc20, functionName: 'allowance', args: [botAccount.address, cfg.executor] });
  if (a < 2n ** 200n) { const h = await botWc.writeContract({ address: token, abi: erc20, functionName: 'approve', args: [cfg.executor, maxUint256] }); await pc.waitForTransactionReceipt({ hash: h }); }
}

async function trade(label, key, poolId, feePips, ref) {
  const st = await poolState(poolId);
  const h = humanState({ sqrtPriceX96: st.sqrtPriceX96, liquidity: st.liquidity, usdgIsCurrency0 });
  const d = decideArb({ price: h.price, liquidity: h.liquidity, feePips, ref, maxUsdg: cfg.bot.maxUsdg, minUsdg: cfg.bot.minUsdg });
  if (d.side === 'none') { log({ pool: label, action: 'none', price: h.price, ref, feePips, reason: d.reason }); return; }
  const buy = d.side === 'buyNvda';
  const inToken = buy ? cfg.tokens.usdg : cfg.tokens.nvda;
  const decimals = buy ? 6 : 18;
  const amountIn = parseUnits(d.amountIn.toFixed(Math.min(decimals, 6)), decimals);
  const zeroForOne = inToken.toLowerCase() === c0.toLowerCase();
  const args = [key, zeroForOne, -amountIn];
  let hash; let status; let error = null; let sim = true;
  try { await pc.simulateContract({ address: cfg.executor, abi: ExecutorArtifact.abi, functionName: 'executeSwap', args, account: botAccount }); }
  catch (e) { sim = false; error = (e.cause?.data?.errorName ?? e.cause?.cause?.data?.errorName ?? e.shortMessage ?? String(e)).toString().slice(0, 160); }
  try {
    hash = await botWc.writeContract({ address: cfg.executor, abi: ExecutorArtifact.abi, functionName: 'executeSwap', args, gas: 3_500_000n });
    const r = await pc.waitForTransactionReceipt({ hash }); status = r.status;
  } catch (e) { status = 'not-sent'; error ??= String(e.shortMessage ?? e).slice(0, 160); }
  log({ pool: label, action: d.side, amountIn: d.amountIn, token: d.token, price: h.price, ref, feePips, simulated: sim, tx: hash ?? null, status, error });
  console.log(`${label}: ${d.side} ${d.amountIn.toFixed(4)} ${d.token} at ${h.price.toFixed(2)} vs ref ${ref.toFixed(2)} -> ${status}${error ? ` (${error})` : ''}`);
}

async function tick() {
  const now = Number((await pc.getBlock()).timestamp);
  if (now > cfg.window.endTs) { console.log('window ended'); return false; }
  const step = Math.max(0, Math.floor((now - cfg.window.startTs) / cfg.path.stepSeconds));
  const ref = pathPrice(cfg, step);
  const e8 = BigInt(Math.round(ref * 1e8));
  const h = await keeperWc.writeContract({ address: cfg.feed, abi: feedAbi, functionName: 'setPrice', args: [e8] });
  await pc.waitForTransactionReceipt({ hash: h });
  log({ pool: 'feed', action: 'setPrice', step, price: ref, tx: h });
  await ensureAllowance(cfg.tokens.usdg); await ensureAllowance(cfg.tokens.nvda);
  const intervals = sessionIntervals(now - 86400, now + 86400);
  const session = sessionAt(now, intervals);
  await trade('bell', einsteinKey, cfg.pools.bell.poolId, FEE_OF[session] ?? 10000, ref);
  await trade('control', controlKey, cfg.pools.control.poolId, cfg.pools.control.fee, ref);
  return true;
}

if (command === 'once') await tick();
else if (command === 'loop') {
  for (;;) {
    try { if (!(await tick())) break; } catch (e) { console.error('tick failed', String(e.shortMessage ?? e).slice(0, 200)); log({ pool: 'loop', action: 'tick-failed', error: String(e.shortMessage ?? e).slice(0, 200) }); }
    await new Promise((r) => setTimeout(r, cfg.path.stepSeconds * 1000));
  }
}
