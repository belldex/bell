/**
 * Einstein pool bot. A Worker on a one-minute cron that does the two things the first Einstein pool's proof still needs on time:
 *   1. a small swap in each trading session (PRE and REGULAR), so the Swap event shows that session's fee;
 *   2. the Opening Bell Auction cycle: arm the next cycle, put one buy and one sell order in from two wallets during the ten-minute
 *      order window, and call settle if nobody else has after the open.
 * It holds two throwaway test wallets with about a dollar each. Everything it does is recorded in its Durable Object and served at /state,
 * so the repo can import the transaction hashes. It never touches governance or guardian keys.
 */
import { createPublicClient, createWalletClient, http, parseAbi, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import routerAbi from './router-abi.json';

const SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const hookAbi = parseAbi(['function configHash() view returns (bytes32)']);
const calendarAbi = parseAbi(['function currentInterval(bytes32) view returns ((bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))']);
const auctionAbi = parseAbi([
  'function currentStage() view returns (uint8)', 'function cycleId() view returns (uint64)',
  'function submitOrder(bool isBuyer, uint128 amountIn, uint160 limitPriceX96) returns (uint32)',
  'function settle()', 'function armNext() returns (bool)',
  'function cycleSummary(uint64) view returns (uint64 cycleOpenTime, uint64 deadline, uint8 cycleStage, uint160 priceX96, uint128 matchedBase, bool finalized)',
]);

// Session fees in pips and the phase numbers of the calendar (1 PRE, 2 REGULAR, 3 POST). OVERNIGHT and CLOSED are already on chain.
const SESSIONS = { 1: { name: 'PRE', fee: 3000 }, 2: { name: 'REGULAR', fee: 500 } };
const SETTLE_AFTER_OPEN = 120; // seconds; give the keeper the first chance to settle
const SESSION_DELAY = 15 * 60; // a pool needs a few minutes after a session change before it trades again
const BUY_USDG = 20_000n;
const SELL_NVDA = 120_000_000_000_000n;
const MID = (162.85e6 / 1e18) * 2 ** 96; // quote raw per base raw, scaled by 2^96; limits cross it by 5%
const priceX96 = (f) => BigInt(Math.round(MID * f));

export class BotState {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/save') { await this.state.storage.put('state', await request.json()); return new Response('ok'); }
    return new Response(JSON.stringify((await this.state.storage.get('state')) ?? {}), { headers: { 'content-type': 'application/json' } });
  }
}

function clients(env) {
  const transport = http(env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY, { timeout: 25_000 });
  const pc = createPublicClient({ transport });
  const acct = (k) => privateKeyToAccount(k.startsWith('0x') ? k : `0x${k}`);
  const buyer = acct(env.LP_TEST_PRIVATE_KEY);
  const seller = acct(env.LP_TEST_PRIVATE_KEY_2);
  const wallet = (account) => createWalletClient({ account, transport });
  return { pc, buyer, seller, wallet };
}

async function send(c, account, params) {
  const sim = await c.pc.simulateContract({ ...params, account });
  const hash = await c.wallet(account).writeContract(sim.request);
  const receipt = await c.pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== 'success') throw new Error(`transaction ${hash} did not succeed`);
  return { hash, receipt, result: sim.result };
}

async function ensureAllowance(c, account, token, spender, amount) {
  const have = await c.pc.readContract({ address: token, abi: erc20, functionName: 'allowance', args: [account.address, spender] });
  if (have >= amount) return;
  await send(c, account, { address: token, abi: erc20, functionName: 'approve', args: [spender, amount] });
  await new Promise((r) => setTimeout(r, 3000)); // let the RPC see the approval
}

async function sessionSwap(env, c, state, interval, now) {
  const session = SESSIONS[Number(interval.phase)];
  if (!session || state.swaps?.[session.name] || now < Number(interval.start) + SESSION_DELAY) return;
  const amount = 10_000n; // 0.01 USDG, under every session cap of a seed this size
  await ensureAllowance(c, c.buyer, env.USDG, env.ROUTER, amount);
  const [configHash, nonce] = await Promise.all([
    c.pc.readContract({ address: env.HOOK, abi: hookAbi, functionName: 'configHash' }),
    c.pc.readContract({ address: env.ROUTER, abi: routerAbi, functionName: 'nonces', args: [c.buyer.address] }),
  ]);
  const request = {
    hook: env.HOOK, zeroForOne: true, exactInput: true, amountSpecified: amount, limitAmount: 1n, sqrtPriceLimitX96: 4295128740n,
    recipient: c.buyer.address, nonce, deadline: BigInt(now + 600), expectedConfigHash: configHash,
    wrapInput: false, unwrapOutput: false, unwrapRefund: false, oracleUpdates: [],
  };
  const done = await send(c, c.buyer, { address: env.ROUTER, abi: routerAbi, functionName: 'swap', args: [request] });
  let fee = null;
  for (const log of done.receipt.logs) {
    if (log.address.toLowerCase() === env.POOL_MANAGER.toLowerCase() && log.topics[0] === SWAP_TOPIC) fee = parseInt(log.data.slice(2 + 5 * 64, 2 + 6 * 64), 16);
  }
  state.swaps = { ...(state.swaps ?? {}), [session.name]: { tx: done.hash, block: Number(done.receipt.blockNumber), feePips: fee, expectedFee: session.fee, at: new Date().toISOString() } };
}

async function auctionStep(env, c, state, now) {
  const stage = Number(await c.pc.readContract({ address: env.AUCTION, abi: auctionAbi, functionName: 'currentStage' }));
  const cycle = String(await c.pc.readContract({ address: env.AUCTION, abi: auctionAbi, functionName: 'cycleId' }));
  state.auction = state.auction ?? { cycles: {} };
  const rec = (state.auction.cycles[cycle] = state.auction.cycles[cycle] ?? { orders: [] });
  state.auction.lastStage = stage; state.auction.lastCycle = cycle;
  if ([0, 4, 5].includes(stage)) { // idle, settled or refunded: try to arm the next CLOSED to open transition, at most every 10 minutes
    if (now - (state.auction.lastArmTry ?? 0) < 600) return;
    state.auction.lastArmTry = now;
    try {
      // armNext returns false instead of reverting when there is nothing to arm, so only send it when the simulation says true.
      const sim = await c.pc.simulateContract({ address: env.AUCTION, abi: auctionAbi, functionName: 'armNext', account: c.buyer });
      if (sim.result === true) {
        const hash = await c.wallet(c.buyer).writeContract(sim.request);
        await c.pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
        state.auction.armed = { tx: hash, at: new Date().toISOString() };
      }
    } catch { /* not armable yet */ }
    return;
  }
  if (stage === 2 && !rec.orders.length) { // OPEN: both orders go in, back to back
    await ensureAllowance(c, c.buyer, env.USDG, env.AUCTION, BUY_USDG);
    await ensureAllowance(c, c.seller, env.NVDA, env.AUCTION, SELL_NVDA);
    const b = await send(c, c.buyer, { address: env.AUCTION, abi: auctionAbi, functionName: 'submitOrder', args: [true, BUY_USDG, priceX96(1.05)] });
    rec.orders.push({ side: 'buy', wallet: c.buyer.address, tx: b.hash, block: Number(b.receipt.blockNumber) });
    const s = await send(c, c.seller, { address: env.AUCTION, abi: auctionAbi, functionName: 'submitOrder', args: [false, SELL_NVDA, priceX96(0.95)] });
    rec.orders.push({ side: 'sell', wallet: c.seller.address, tx: s.hash, block: Number(s.receipt.blockNumber) });
    return;
  }
  if (stage === 3 && rec.orders.length) { // LOCKED after the open: the keeper settles first, then this does
    const summary = await c.pc.readContract({ address: env.AUCTION, abi: auctionAbi, functionName: 'cycleSummary', args: [BigInt(cycle)] });
    if (!summary[5] && now >= Number(summary[0]) + SETTLE_AFTER_OPEN && now - (rec.lastSettleTry ?? 0) > 120) {
      rec.lastSettleTry = now;
      try { const t = await send(c, c.buyer, { address: env.AUCTION, abi: auctionAbi, functionName: 'settle' }); rec.settleTx = t.hash; } catch (e) { rec.settleNote = String(e?.shortMessage ?? e?.message ?? e).slice(0, 160); }
    }
  }
  if (rec.orders.length && !rec.result) {
    const summary = await c.pc.readContract({ address: env.AUCTION, abi: auctionAbi, functionName: 'cycleSummary', args: [BigInt(cycle)] });
    if (summary[5]) rec.result = { stage: summary[2], clearingPriceX96: String(summary[3]), matchedBase: String(summary[4]) };
  }
}

async function run(env, now) {
  const stub = env.BOT_DO.get(env.BOT_DO.idFromName('einstein-bot'));
  const state = await (await stub.fetch('https://do/state')).json();
  state.lastRun = new Date(now * 1000).toISOString();
  const c = clients(env);
  const errors = [];
  try {
    const interval = await c.pc.readContract({ address: env.CALENDAR_REGISTRY, abi: calendarAbi, functionName: 'currentInterval', args: [env.NVDA_ASSET_ID] });
    state.phase = Number(interval.phase);
    await sessionSwap(env, c, state, interval, now);
  } catch (e) { errors.push(`swap: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 160)}`); }
  try { await auctionStep(env, c, state, now); } catch (e) { errors.push(`auction: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 160)}`); }
  state.errors = errors;
  await stub.fetch('https://do/save', { method: 'POST', body: JSON.stringify(state) });
  return state;
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(run(env, Math.floor(controller.scheduledTime / 1000)).catch(async (e) => {
      const stub = env.BOT_DO.get(env.BOT_DO.idFromName('einstein-bot'));
      const state = await (await stub.fetch('https://do/state')).json();
      state.lastFailure = { at: new Date().toISOString(), message: String(e?.message ?? e).slice(0, 300) };
      await stub.fetch('https://do/save', { method: 'POST', body: JSON.stringify(state) });
    }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/run' && request.method === 'POST') {
      if (!env.BOT_TOKEN || request.headers.get('x-bot-token') !== env.BOT_TOKEN) return new Response('forbidden', { status: 403 });
      try { return Response.json(await run(env, Math.floor(Date.now() / 1000))); } catch (e) { return Response.json({ failure: String(e?.message ?? e).slice(0, 400) }, { status: 500 }); }
    }
    if (url.pathname === '/state') return env.BOT_DO.get(env.BOT_DO.idFromName('einstein-bot')).fetch('https://do/state');
    return new Response('Einstein pool bot. GET /state for what it has done.', { status: 200 });
  },
};
