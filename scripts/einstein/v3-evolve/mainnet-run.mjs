#!/usr/bin/env node
/**
 * v3 Evolve on Robinhood mainnet, run 4: seeds the control pool and runs the arbitrage bot on both pools.
 *
 *   node scripts/einstein/v3-evolve/mainnet-run.mjs seed-control [--broadcast]   # dry run unless --broadcast; local, deploys the swap helper
 *   node scripts/einstein/v3-evolve/mainnet-run.mjs once
 *   node scripts/einstein/v3-evolve/mainnet-run.mjs loop [--minutes 200]
 *
 * The BELL side is the existing NVDA/USDG Einstein pool and its LP position (method.json, runFourAmendments). The control pool is a plain Uniswap v4 pool
 * with no hook and a fixed 30 bps fee, opened at the BELL pool's price at that moment with the BELL pool's liquidity and ticks. The bot is the only
 * trader this script runs; it uses scripts/einstein/v3-evolve/arb.mjs unchanged on both pools, with the same maximum size, and it only trades when the
 * Chainlink NVDA round is at most 6 hours old, so it sits out the closed hours. It stops for good when the bot wallet is worth LOSS_CAP_USD less than at
 * the seed, and logs that stop.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, keccak256, encodePacked, encodeAbiParameters, parseAbiParameters, parseEventLogs, maxUint256, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { decideArb, humanState } from './arb.mjs';
import { sessionIntervals, sessionAt } from './lib.mjs';

const CONFIG = 'evidence/einstein/v3-evolve/run-4-config.json';
const BOTLOG = 'evidence/einstein/v3-evolve/run-4-bot-log.jsonl';
const END_TS = 1796050800; // Mon 30 Nov 10:00 ET
const FEED = '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15';
const FEED_MAX_AGE = 6 * 3600;
const FEE_OF = { CLOSED: 10000, OVERNIGHT: 5000, PRE: 3000, POST: 3000, REGULAR: 500 };
const MAX_USDG = 0.5; const MIN_USDG = 0.01; const LOSS_CAP_USD = 0.5;
const command = process.argv[2] ?? 'once';
const broadcast = process.argv.includes('--broadcast');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const env = {};
try { for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); } } catch { /* CI passes the environment */ }
for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
const rpcUrls = [env.RH_MAINNET_RPC_PRIMARY, env.RH_MAINNET_RPC_SECONDARY].filter(Boolean);
const transport = rpcUrls.length > 1 ? (await import('viem')).fallback(rpcUrls.map((u) => http(u, { retryCount: 6, retryDelay: 3000, timeout: 20000 }))) : http(rpcUrls[0], { retryCount: 6, retryDelay: 3000, timeout: 20000 });
const pc = createPublicClient({ transport });
const bot = privateKeyToAccount(env.V3_EVOLVE_BOT_PRIVATE_KEY.startsWith('0x') ? env.V3_EVOLVE_BOT_PRIVATE_KEY : `0x${env.V3_EVOLVE_BOT_PRIVATE_KEY}`);
const wc = createWalletClient({ account: bot, transport });

const dep = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
const pq = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet.json', 'utf8'));
const dir = 'evidence/einstein';
const bell = JSON.parse(readFileSync(`${dir}/${readdirSync(dir).filter((f) => f.startsWith('first-pool-')).sort().pop()}`, 'utf8'));
const USDG = pq.assetDescriptors.USDG.token; const NVDA = pq.assetDescriptors.NVDA.token;
const [c0, c1] = BigInt(USDG) < BigInt(NVDA) ? [USDG, NVDA] : [NVDA, USDG];
const usdgIsCurrency0 = c0.toLowerCase() === USDG.toLowerCase();
const POOL_MANAGER = dep.poolManager; const POSM = dep.positionManager; const PERMIT2 = dep.permit2; const ROUTER = dep.router;

const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)']);
const pmAbi = parseAbi(['function extsload(bytes32 slot) view returns (bytes32)', 'function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint160 sqrtPriceX96) returns (int24 tick)',
  'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)']);
const executorAbi = parseAbi(['function executeSwap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool zeroForOne,int256 amountSpecified) returns (int256)']);
const permit2Abi = parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)']);
const posmAbi = parseAbi(['function modifyLiquidities(bytes unlockData,uint256 deadline) payable', 'function nextTokenId() view returns (uint256)']);
const hookAbi = parseAbi(['function configHash() view returns (bytes32)']);
const manifest = JSON.parse(readFileSync('packages/protocol/generated/abi-manifest.json', 'utf8'));
const routerAbi = manifest.interfaces.IBellRouter;
const log = (row) => { appendFileSync(BOTLOG, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`); };
const wait = async (hash, what) => { const r = await pc.waitForTransactionReceipt({ hash }); if (r.status !== 'success') throw new Error(`${what} failed ${hash}`); return r; };

async function poolState(poolId) {
  const slot = BigInt(keccak256(encodePacked(['bytes32', 'uint256'], [poolId, 6n])));
  const hex = (n) => `0x${n.toString(16).padStart(64, '0')}`;
  const [s0, liq] = await Promise.all([pc.readContract({ address: POOL_MANAGER, abi: pmAbi, functionName: 'extsload', args: [hex(slot)] }), pc.readContract({ address: POOL_MANAGER, abi: pmAbi, functionName: 'extsload', args: [hex(slot + 3n)] })]);
  return { sqrtPriceX96: BigInt(s0) & ((1n << 160n) - 1n), tick: Number(BigInt.asIntN(24, (BigInt(s0) >> 160n) & 0xffffffn)), liquidity: BigInt(liq) & ((1n << 128n) - 1n) };
}
async function feed() {
  const r = await pc.call({ to: FEED, data: '0xfeaf968c' });
  const w = (i) => BigInt(`0x${r.data.slice(2 + i * 64, 2 + (i + 1) * 64)}`);
  return { price: Number(w(1)) / 1e8, updatedAt: Number(w(3)), roundId: w(0).toString() };
}
async function walletValue(ref) {
  const [u, n] = await Promise.all([pc.readContract({ address: USDG, abi: erc20, functionName: 'balanceOf', args: [bot.address] }), pc.readContract({ address: NVDA, abi: erc20, functionName: 'balanceOf', args: [bot.address] })]);
  return { usdg: Number(u) / 1e6, nvda: Number(n) / 1e18, valueUsd: Number(u) / 1e6 + (Number(n) / 1e18) * ref };
}

if (command === 'seed-control') {
  if (existsSync(CONFIG)) throw new Error(`${CONFIG} exists: the control pool is already seeded`);
  const st = await poolState(bell.poolId);
  const req = bell.request;
  const key = { currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' };
  const ref = await feed();
  const Q96 = 2n ** 96n; const sq = (t) => BigInt(Math.floor(Math.pow(1.0001, t / 2) * 2 ** 96));
  const a = sq(req.tickLower); const b = sq(req.tickUpper);
  const need0 = (st.liquidity * Q96 * (b - st.sqrtPriceX96)) / (st.sqrtPriceX96 * b); const need1 = (st.liquidity * (st.sqrtPriceX96 - a)) / Q96;
  const have = await Promise.all([c0, c1].map((t) => pc.readContract({ address: t, abi: erc20, functionName: 'balanceOf', args: [bot.address] })));
  const eth = await pc.getBalance({ address: bot.address });
  console.log(JSON.stringify({ mode: broadcast ? 'BROADCAST' : 'DRY', bot: bot.address, bellTick: st.tick, bellLiquidity: String(st.liquidity), bellSqrtPriceX96: String(st.sqrtPriceX96), tickLower: req.tickLower, tickUpper: req.tickUpper, needToken0: String(need0), needToken1: String(need1), haveToken0: String(have[0]), haveToken1: String(have[1]), eth: String(eth), feed: ref }, null, 2));
  if (st.tick < req.tickLower || st.tick > req.tickUpper) throw new Error('the BELL pool price is outside the position range: nothing done');
  if (have[0] < need0 * 11n / 10n || have[1] < need1 * 11n / 10n) throw new Error('the bot wallet does not hold 110% of the seed amounts: nothing sent');
  if (!broadcast) { console.log('dry run: nothing sent'); process.exit(0); }
  const ExecutorArtifact = JSON.parse(readFileSync('contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json', 'utf8'));
  const out = { createdAt: new Date().toISOString(), txs: {} };
  const execHash = await wc.deployContract({ abi: ExecutorArtifact.abi, bytecode: ExecutorArtifact.bytecode.object, args: [POOL_MANAGER] });
  out.executor = (await wait(execHash, 'executor')).contractAddress; out.txs.executor = execHash; console.log('executor', out.executor);
  const initHash = await wc.writeContract({ address: POOL_MANAGER, abi: pmAbi, functionName: 'initialize', args: [key, st.sqrtPriceX96] });
  const initR = await wait(initHash, 'initialize');
  out.controlPoolId = parseEventLogs({ abi: pmAbi, logs: initR.logs, eventName: 'Initialize' })[0].args.id; out.txs.initialize = initHash; console.log('control pool', out.controlPoolId);
  const big = 2n ** 160n - 1n; const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
  for (const t of [c0, c1]) {
    await wait(await wc.writeContract({ address: t, abi: erc20, functionName: 'approve', args: [PERMIT2, maxUint256] }), 'approve permit2');
    await wait(await wc.writeContract({ address: PERMIT2, abi: permit2Abi, functionName: 'approve', args: [t, POSM, big, exp] }), 'permit2 approve');
  }
  const keyTuple = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
  const mintParams = encodeAbiParameters(parseAbiParameters(`${keyTuple} key,int24 tickLower,int24 tickUpper,uint256 liquidity,uint128 amount0Max,uint128 amount1Max,address owner,bytes hookData`), [key, req.tickLower, req.tickUpper, st.liquidity, 2n ** 127n, 2n ** 127n, bot.address, '0x']);
  const settleParams = encodeAbiParameters(parseAbiParameters('address currency0,address currency1'), [c0, c1]);
  const unlockData = encodeAbiParameters(parseAbiParameters('bytes actions,bytes[] params'), [encodePacked(['uint8', 'uint8'], [0x02, 0x0d]), [mintParams, settleParams]]);
  out.positionTokenId = String(await pc.readContract({ address: POSM, abi: posmAbi, functionName: 'nextTokenId' }));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const sim = await pc.simulateContract({ address: POSM, abi: posmAbi, functionName: 'modifyLiquidities', args: [unlockData, deadline], account: bot });
  const gas = await pc.estimateContractGas({ address: POSM, abi: posmAbi, functionName: 'modifyLiquidities', args: [unlockData, deadline], account: bot });
  const seedHash = await wc.writeContract({ ...sim.request, gas: (gas * 13n) / 10n });
  const seedR = await wait(seedHash, 'seed');
  out.txs.seed = seedHash; out.seedBlock = Number(seedR.blockNumber);
  const startTs = Number((await pc.getBlock({ blockNumber: seedR.blockNumber })).timestamp);
  const refNow = await feed(); const wv = await walletValue(refNow.price);
  const cfg = { chainId: 4663, createdAt: out.createdAt, window: { startTs, endTs: END_TS, startBlock: out.seedBlock },
    executor: out.executor, poolManager: POOL_MANAGER, router: ROUTER, feed: FEED, tokens: { nvda: NVDA, usdg: USDG },
    bot: { address: bot.address, maxUsdg: MAX_USDG, minUsdg: MIN_USDG, lossCapUsd: LOSS_CAP_USD, startValueUsd: wv.valueUsd, startUsdg: wv.usdg, startNvda: wv.nvda, startRefPrice: refNow.price, sourceFile: 'scripts/einstein/v3-evolve/mainnet-run.mjs', rule: 'scripts/einstein/v3-evolve/arb.mjs' },
    pools: { bell: { poolId: bell.poolId, hook: bell.hook, liquidity: String(st.liquidity), startSqrtPriceX96: String(st.sqrtPriceX96), tickLower: req.tickLower, tickUpper: req.tickUpper }, control: { poolId: out.controlPoolId, hook: key.hooks, fee: 3000, key, seedTx: seedHash, initializeTx: initHash, seedBlock: out.seedBlock, positionTokenId: out.positionTokenId } }, executorTx: execHash };
  writeFileSync(CONFIG, `${JSON.stringify(cfg, null, 2)}\n`);
  console.log(`control pool seeded: ${seedHash} block ${out.seedBlock}\nwrote ${CONFIG}`);
  process.exit(0);
}

const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
const einsteinKey = { currency0: c0, currency1: c1, fee: 0x800000, tickSpacing: 60, hooks: cfg.pools.bell.hook };
let stopped = false;

async function ensureAllowances() {
  for (const [token, spender] of [[USDG, ROUTER], [NVDA, ROUTER], [USDG, cfg.executor], [NVDA, cfg.executor]]) {
    const a = await pc.readContract({ address: token, abi: erc20, functionName: 'allowance', args: [bot.address, spender] });
    if (a < 2n ** 200n) await wait(await wc.writeContract({ address: token, abi: erc20, functionName: 'approve', args: [spender, maxUint256] }), 'approve');
  }
}

async function trade(label, poolId, feePips, ref) {
  const st = await poolState(poolId);
  const h = humanState({ sqrtPriceX96: st.sqrtPriceX96, liquidity: st.liquidity, usdgIsCurrency0 });
  const d = decideArb({ price: h.price, liquidity: h.liquidity, feePips, ref, maxUsdg: cfg.bot.maxUsdg, minUsdg: cfg.bot.minUsdg });
  if (d.side === 'none') { log({ pool: label, action: 'none', price: h.price, ref, feePips, reason: d.reason }); return; }
  const buy = d.side === 'buyNvda';
  const decimals = buy ? 6 : 18;
  const amountIn = parseUnits(d.amountIn.toFixed(decimals === 6 ? 6 : 12), decimals);
  const zeroForOne = (buy ? USDG : NVDA).toLowerCase() === c0.toLowerCase();
  const bal = await pc.readContract({ address: buy ? USDG : NVDA, abi: erc20, functionName: 'balanceOf', args: [bot.address] });
  if (bal < amountIn) { log({ pool: label, action: d.side, skipped: 'not enough inventory', amountIn: d.amountIn, price: h.price, ref }); return; }
  let tx; let status; let error = null; let sim = true;
  let call;
  if (label === 'bell') {
    const request = { hook: cfg.pools.bell.hook, zeroForOne, exactInput: true, amountSpecified: amountIn, limitAmount: 1n,
      sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n, recipient: bot.address,
      nonce: await pc.readContract({ address: ROUTER, abi: routerAbi, functionName: 'nonces', args: [bot.address] }),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 300), expectedConfigHash: await pc.readContract({ address: cfg.pools.bell.hook, abi: hookAbi, functionName: 'configHash' }),
      wrapInput: false, unwrapOutput: false, unwrapRefund: false, oracleUpdates: [] };
    call = { to: ROUTER, data: encodeFunctionData({ abi: routerAbi, functionName: 'swap', args: [request] }) };
  } else {
    call = { to: cfg.executor, data: encodeFunctionData({ abi: executorAbi, functionName: 'executeSwap', args: [cfg.pools.control.key, zeroForOne, -amountIn] }) };
  }
  try { await pc.call({ ...call, account: bot.address }); } catch (e) { sim = false; error = String(e.shortMessage ?? e).slice(0, 160); }
  try { tx = await wc.sendTransaction({ ...call, gas: 3_500_000n }); status = (await pc.waitForTransactionReceipt({ hash: tx })).status; } catch (e) { status = 'not-sent'; error ??= String(e.shortMessage ?? e).slice(0, 160); }
  log({ pool: label, action: d.side, amountIn: d.amountIn, token: d.token, price: h.price, ref, feePips, simulated: sim, tx: tx ?? null, status, error });
  console.log(`${label}: ${d.side} ${d.amountIn.toFixed(4)} ${d.token} at ${h.price.toFixed(2)} vs ref ${ref.toFixed(2)} -> ${status}${error ? ` (${error})` : ''}`);
}

async function tick() {
  const now = Number((await pc.getBlock()).timestamp);
  if (now > cfg.window.endTs) { console.log('window ended'); return false; }
  const f = await feed();
  const wv = await walletValue(f.price);
  log({ pool: 'bot', action: 'status', ...wv, ref: f.price, feedUpdatedAt: f.updatedAt });
  if (wv.valueUsd < cfg.bot.startValueUsd - cfg.bot.lossCapUsd) { log({ pool: 'bot', action: 'stopped', reason: 'loss cap reached', valueUsd: wv.valueUsd, startValueUsd: cfg.bot.startValueUsd }); console.log('loss cap reached: bot stopped'); stopped = true; return false; }
  if (now - f.updatedAt > FEED_MAX_AGE) { log({ pool: 'feed', action: 'stale', ageSeconds: now - f.updatedAt }); console.log(`feed is ${Math.round((now - f.updatedAt) / 3600)} h old: no trade`); return true; }
  await ensureAllowances();
  const session = sessionAt(now, sessionIntervals(now - 86400, now + 86400));
  await trade('bell', cfg.pools.bell.poolId, FEE_OF[session] ?? 10000, f.price);
  await trade('control', cfg.pools.control.poolId, cfg.pools.control.fee, f.price);
  return true;
}

if (command === 'once') await tick();
else if (command === 'loop') {
  const until = Date.now() + Number(arg('minutes', '200')) * 60_000;
  while (Date.now() < until) {
    try { if (!(await tick())) break; } catch (e) { console.error('tick failed', String(e.shortMessage ?? e).slice(0, 200)); log({ pool: 'loop', action: 'tick-failed', error: String(e.shortMessage ?? e).slice(0, 200) }); }
    await new Promise((r) => setTimeout(r, 300_000));
  }
}
