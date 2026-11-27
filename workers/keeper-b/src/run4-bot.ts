// @ts-nocheck
/**
 * v3 Evolve run 4 arbitrage bot as its own Cloudflare Worker (bell-run4-bot), so the run does not depend on GitHub Actions.
 *
 * Every five minutes it reads the Chainlink NVDA round, and only when the round is at most six hours old it runs scripts/einstein/v3-evolve/arb.mjs, unchanged,
 * on the BELL pool and on the control pool with the same maximum size. BELL trades go through the BellRouter, control trades through the swap helper. It stops
 * trading for good when the bot wallet is worth LOSS_CAP_USD less than at the seed. No state is kept between runs: everything is read from the chain.
 * The numbers of the run come from the chain's Swap events (scripts/einstein/build-v3-proof.mjs), not from this Worker.
 *
 * Secrets: V3_EVOLVE_BOT_PRIVATE_KEY, RH_MAINNET_RPC_PRIMARY, RH_MAINNET_RPC_SECONDARY. Variable: RUN4_CONFIG (generated from run-4-config.json).
 */
import { createPublicClient, createWalletClient, http, fallback, parseAbi, parseUnits, keccak256, encodePacked, maxUint256, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { decideArb, humanState } from '../../../scripts/einstein/v3-evolve/arb.mjs';
import { sessionIntervals, sessionAt } from '../../../scripts/einstein/v3-evolve/lib.mjs';
import manifest from '../../../packages/protocol/generated/abi-manifest.json';

const FEE_OF = { CLOSED: 10000, OVERNIGHT: 5000, PRE: 3000, POST: 3000, REGULAR: 500 };
const FEED_MAX_AGE = 6 * 3600;
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)']);
const pmAbi = parseAbi(['function extsload(bytes32 slot) view returns (bytes32)']);
const executorAbi = parseAbi(['function executeSwap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool zeroForOne,int256 amountSpecified) returns (int256)']);
const hookAbi = parseAbi(['function configHash() view returns (bytes32)']);
const routerAbi = manifest.interfaces.IBellRouter;
const FEED_ABI = parseAbi(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);

const log = (row) => console.log(JSON.stringify({ at: new Date().toISOString(), ...row }));

export async function tick(env) {
  const cfg = JSON.parse(env.RUN4_CONFIG);
  const urls = [env.RH_MAINNET_RPC_PRIMARY, env.RH_MAINNET_RPC_SECONDARY].filter(Boolean);
  const transport = fallback(urls.map((u) => http(u, { retryCount: 2, retryDelay: 1000, timeout: 15000 })));
  const pc = createPublicClient({ transport, pollingInterval: 2000 });
  const key = env.V3_EVOLVE_BOT_PRIVATE_KEY;
  const bot = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
  const wc = createWalletClient({ account: bot, transport });
  const USDG = cfg.tokens.usdg; const NVDA = cfg.tokens.nvda;
  const [c0, c1] = BigInt(USDG) < BigInt(NVDA) ? [USDG, NVDA] : [NVDA, USDG];
  const usdgIsCurrency0 = c0.toLowerCase() === USDG.toLowerCase();

  const block = await pc.getBlock();
  const now = Number(block.timestamp);
  if (now > cfg.endTs) return log({ pool: 'bot', action: 'window-ended' });
  const round = await pc.readContract({ address: cfg.feed, abi: FEED_ABI, functionName: 'latestRoundData' });
  const ref = Number(round[1]) / 1e8; const feedUpdatedAt = Number(round[3]);
  const [u, n] = await Promise.all([pc.readContract({ address: USDG, abi: erc20, functionName: 'balanceOf', args: [bot.address] }), pc.readContract({ address: NVDA, abi: erc20, functionName: 'balanceOf', args: [bot.address] })]);
  const value = Number(u) / 1e6 + (Number(n) / 1e18) * ref;
  log({ pool: 'bot', action: 'status', usdg: Number(u) / 1e6, nvda: Number(n) / 1e18, valueUsd: value, ref, feedUpdatedAt });
  if (value < cfg.startValueUsd - cfg.lossCapUsd) return log({ pool: 'bot', action: 'stopped', reason: 'loss cap reached', valueUsd: value, startValueUsd: cfg.startValueUsd });
  if (now - feedUpdatedAt > FEED_MAX_AGE) return log({ pool: 'feed', action: 'stale', ageSeconds: now - feedUpdatedAt });

  for (const [token, spender] of [[USDG, cfg.router], [NVDA, cfg.router], [USDG, cfg.executor], [NVDA, cfg.executor]]) {
    const a = await pc.readContract({ address: token, abi: erc20, functionName: 'allowance', args: [bot.address, spender] });
    if (a < 2n ** 200n) { const h = await wc.writeContract({ address: token, abi: erc20, functionName: 'approve', args: [spender, maxUint256], gas: 200_000n }); await pc.waitForTransactionReceipt({ hash: h, timeout: 20000 }); }
  }
  const session = sessionAt(now, sessionIntervals(now - 86400, now + 86400));

  const poolState = async (poolId) => {
    const slot = BigInt(keccak256(encodePacked(['bytes32', 'uint256'], [poolId, 6n])));
    const hex = (x) => `0x${x.toString(16).padStart(64, '0')}`;
    const [s0, liq] = await Promise.all([pc.readContract({ address: cfg.poolManager, abi: pmAbi, functionName: 'extsload', args: [hex(slot)] }), pc.readContract({ address: cfg.poolManager, abi: pmAbi, functionName: 'extsload', args: [hex(slot + 3n)] })]);
    return { sqrtPriceX96: BigInt(s0) & ((1n << 160n) - 1n), liquidity: BigInt(liq) & ((1n << 128n) - 1n) };
  };

  const trade = async (label, poolId, feePips) => {
    const st = await poolState(poolId);
    const h = humanState({ sqrtPriceX96: st.sqrtPriceX96, liquidity: st.liquidity, usdgIsCurrency0 });
    const d = decideArb({ price: h.price, liquidity: h.liquidity, feePips, ref, maxUsdg: cfg.maxUsdg, minUsdg: cfg.minUsdg });
    if (d.side === 'none') return log({ pool: label, action: 'none', price: h.price, ref, feePips, reason: d.reason });
    const buy = d.side === 'buyNvda';
    const decimals = buy ? 6 : 18;
    const amountIn = parseUnits(d.amountIn.toFixed(decimals === 6 ? 6 : 12), decimals);
    const zeroForOne = (buy ? USDG : NVDA).toLowerCase() === c0.toLowerCase();
    const bal = buy ? u : n;
    if (bal < amountIn) return log({ pool: label, action: d.side, skipped: 'not enough inventory', amountIn: d.amountIn, price: h.price, ref });
    let data; let to;
    if (label === 'bell') {
      to = cfg.router;
      const request = { hook: cfg.pools.bell.hook, zeroForOne, exactInput: true, amountSpecified: amountIn, limitAmount: 1n,
        sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n, recipient: bot.address,
        nonce: await pc.readContract({ address: cfg.router, abi: routerAbi, functionName: 'nonces', args: [bot.address] }),
        deadline: BigInt(now + 300), expectedConfigHash: await pc.readContract({ address: cfg.pools.bell.hook, abi: hookAbi, functionName: 'configHash' }),
        wrapInput: false, unwrapOutput: false, unwrapRefund: false, oracleUpdates: [] };
      data = encodeFunctionData({ abi: routerAbi, functionName: 'swap', args: [request] });
    } else {
      to = cfg.executor;
      data = encodeFunctionData({ abi: executorAbi, functionName: 'executeSwap', args: [cfg.pools.control.key, zeroForOne, -amountIn] });
    }
    // A gas limit the wallet can afford: the estimate plus 30 percent. When the estimate itself reverts, a fixed limit lets the reverted transaction land on chain.
    let gas = 250_000n; let simulated = true; let error = null; // a swap the hook refuses uses about 90,000 gas; a larger limit can exceed the bot wallet's ETH
    try { gas = ((await pc.estimateGas({ account: bot.address, to, data })) * 13n) / 10n; } catch (e) { simulated = false; error = String(e.shortMessage ?? e).slice(0, 160); }
    // The hook refuses this trade. Landing the revert on chain is the public record of the refusal, but every attempt costs gas from a small wallet, so one attempt is sent
    // in each six hour window and the other ticks only log the refusal.
    if (!simulated && Math.floor(now / 60) % 360 >= 5) {
      return log({ pool: label, action: d.side, amountIn: d.amountIn, price: h.price, ref, feePips, simulated, status: 'refused-not-sent', error, note: 'estimate reverts: the hook refuses it; one attempt is landed every six hours' });
    }
    let tx = null; let status; let sendError = null;
    try { tx = await wc.sendTransaction({ to, data, gas }); status = (await pc.waitForTransactionReceipt({ hash: tx, timeout: 25000 })).status; }
    catch (e) { status = 'not-sent'; sendError = String(e.shortMessage ?? e.message ?? e).slice(0, 200); error ??= sendError; }
    log({ pool: label, action: d.side, amountIn: d.amountIn, token: d.token, price: h.price, ref, feePips, simulated, tx, status, error, sendError, gas: String(gas) });
  };
  await trade('bell', cfg.pools.bell.poolId, FEE_OF[session] ?? 10000);
  await trade('control', cfg.pools.control.poolId, cfg.pools.control.fee);
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env).catch((e) => log({ pool: 'loop', action: 'tick-failed', error: String(e?.shortMessage ?? e?.message ?? e).slice(0, 200) })));
  },
  async fetch() {
    return new Response('bell-run4-bot: runs on a five minute schedule. See the Worker logs.', { status: 200 });
  },
};
