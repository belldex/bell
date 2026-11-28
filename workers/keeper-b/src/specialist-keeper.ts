// @ts-nocheck
/**
 * Specialist duties on a Cloudflare Worker, so nothing about The Specialist depends on a laptop or on GitHub Actions.
 *
 * Two wallets, two jobs. The CALLER does the permissionless work: it records each finished Opening Bell cycle (`recordAuction`), scores each finished epoch
 * (`closeEpoch`) and takes a floor checkpoint (`checkpoint`) every few hours during open sessions. Every call is simulated first, so a call that would revert
 * costs nothing. The SPECIALIST wallet is the test Specialist: in the order window of each Opening Bell it places one buy and one sell order, tightly around the
 * Chainlink reference, so both land inside the registry's price band.
 *
 * No state is kept between runs: everything is read from the chain. Secrets: SPECIALIST_CALLER_KEY, SPECIALIST_TEST_KEY, RH_MAINNET_RPC_PRIMARY,
 * RH_MAINNET_RPC_SECONDARY. Variable: SPECIALIST_CONFIG, a JSON object (see specialistConfig in scripts/specialist/worker-config.mjs).
 */
import { createPublicClient, createWalletClient, http, fallback, parseAbi, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const REGISTRY_ABI = parseAbi([
  'function specialistOf(bytes32) view returns (address)',
  'function startEpoch(bytes32) view returns (uint64)',
  'function nextEpochToClose(bytes32) view returns (uint64)',
  'function nextCycleToRecord(bytes32) view returns (uint64)',
  'function lastCheckpointSlot(bytes32) view returns (uint64)',
  'function GENESIS() view returns (uint64)',
  'function EPOCH_SECONDS() view returns (uint32)',
  'function SLOT_SECONDS() view returns (uint32)',
  'function checkpoint(bytes32)',
  'function recordAuction(bytes32)',
  'function closeEpoch(bytes32)',
]);
const AUCTION_ABI = parseAbi([
  'function currentStage() view returns (uint8)',
  'function cycleId() view returns (uint64)',
  'function assetId() view returns (bytes32)',
  'function cycleOrderCount(uint64) view returns (uint32)',
  'function cycleOrderId(uint64,uint32) view returns (uint32)',
  'function order(uint32) view returns (address owner,uint128 amountIn,uint160 limitPriceX96,uint64 cycleId,bool isBuyer,bool cancelled,bool claimed)',
  'function cycleSummary(uint64) view returns (uint64 cycleOpenTime,uint64 deadline,uint8 cycleStage,uint160 priceX96,uint128 matchedBase,bool finalized)',
  'function submitOrder(bool isBuyer,uint128 amountIn,uint160 limitPriceX96) returns (uint32)',
]);
const CAL_ABI = parseAbi(['function currentInterval(bytes32) view returns ((bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))']);
const HALT_ABI = parseAbi(['function phase(bytes32) view returns (uint8)']);
const FEED_ABI = parseAbi(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const FEED_MAX_AGE = 6 * 3600;
const STAGE_OPEN = 2;

const log = (row) => console.log(JSON.stringify({ at: new Date().toISOString(), job: 'specialist', ...row }));
const short = (e) => String(e?.shortMessage ?? e?.message ?? e).slice(0, 160);
const acct = (k) => privateKeyToAccount(k.startsWith('0x') ? k : `0x${k}`);

/** Limit price as quote raw per base raw, scaled by 2^96, for a USDG-per-NVDA price (6 and 18 decimals). Exported for the tests. */
export function limitX96(usdgPerStock, factor) {
  return BigInt(Math.round(((usdgPerStock * factor * 1e6) / 1e18) * 2 ** 96));
}

export async function tick(env) {
  if (!env.SPECIALIST_CONFIG) return;
  const cfg = JSON.parse(env.SPECIALIST_CONFIG);
  const urls = [env.RH_MAINNET_RPC_PRIMARY, env.RH_MAINNET_RPC_SECONDARY].filter(Boolean);
  const transport = fallback(urls.map((u) => http(u, { retryCount: 2, retryDelay: 1000, timeout: 15000 })));
  const pc = createPublicClient({ transport, pollingInterval: 2000 });
  const block = await pc.getBlock();
  const now = Number(block.timestamp);
  const R = cfg.registry; const stock = cfg.stock;

  const send = async (account, params, gas) => {
    const wc = createWalletClient({ account, transport });
    await pc.simulateContract({ ...params, account });
    const hash = await wc.writeContract({ ...params, gas });
    const r = await pc.waitForTransactionReceipt({ hash });
    return { hash, status: r.status };
  };

  const specialist = await pc.readContract({ address: R, abi: REGISTRY_ABI, functionName: 'specialistOf', args: [stock] });
  const assigned = !/^0x0+$/.test(specialist);

  // The test Specialist places its two Opening Bell orders while the order window is open.
  if (assigned && env.SPECIALIST_TEST_KEY && specialist.toLowerCase() === acct(env.SPECIALIST_TEST_KEY).address.toLowerCase()) {
    try { await placeOrders({ env, cfg, pc, send, now, specialist }); } catch (e) { log({ step: 'orders', action: 'failed', error: short(e) }); }
  }

  if (!env.SPECIALIST_CALLER_KEY) return;
  const caller = acct(env.SPECIALIST_CALLER_KEY);
  if (!assigned) return log({ action: 'idle', reason: 'no Specialist assigned' });

  const [genesis, epochSeconds, slotSeconds, start, nextClose, nextCycle, lastSlot, cycleId] = await Promise.all([
    pc.readContract({ address: R, abi: REGISTRY_ABI, functionName: 'GENESIS' }), pc.readContract({ address: R, abi: REGISTRY_ABI, functionName: 'EPOCH_SECONDS' }),
    pc.readContract({ address: R, abi: REGISTRY_ABI, functionName: 'SLOT_SECONDS' }), pc.readContract({ address: R, abi: REGISTRY_ABI, functionName: 'startEpoch', args: [stock] }),
    pc.readContract({ address: R, abi: REGISTRY_ABI, functionName: 'nextEpochToClose', args: [stock] }), pc.readContract({ address: R, abi: REGISTRY_ABI, functionName: 'nextCycleToRecord', args: [stock] }),
    pc.readContract({ address: R, abi: REGISTRY_ABI, functionName: 'lastCheckpointSlot', args: [stock] }), pc.readContract({ address: cfg.auction, abi: AUCTION_ABI, functionName: 'cycleId' }),
  ]);

  // 1. Record the next finished cycle, one per run.
  if (nextCycle <= cycleId) {
    const [, deadline, , , , finalized] = await pc.readContract({ address: cfg.auction, abi: AUCTION_ABI, functionName: 'cycleSummary', args: [nextCycle] });
    if (finalized || now >= Number(deadline)) {
      try { log({ action: 'recordAuction', cycle: Number(nextCycle), ...(await send(caller, { address: R, abi: REGISTRY_ABI, functionName: 'recordAuction', args: [stock] }, 500_000n)) }); } catch (e) { log({ action: 'recordAuction', skipped: short(e) }); }
    }
  }

  // 2. Score the next finished epoch.
  const epochEnd = Number(genesis) + (Number(nextClose) + 1) * Number(epochSeconds);
  if (now >= epochEnd) {
    try { log({ action: 'closeEpoch', epoch: Number(nextClose), ...(await send(caller, { address: R, abi: REGISTRY_ABI, functionName: 'closeEpoch', args: [stock] }, 800_000n)) }); } catch (e) { log({ action: 'closeEpoch', skipped: short(e) }); }
  }

  // 3. A floor checkpoint every `checkpointEverySeconds` of open session, inside the scored epochs only.
  const epoch = Math.floor((now - Number(genesis)) / Number(epochSeconds));
  const lastAt = Number(lastSlot) === 0 ? 0 : Number(genesis) + (Number(lastSlot) - 1) * Number(slotSeconds);
  if (epoch >= Number(start) && now - lastAt >= (cfg.checkpointEverySeconds ?? 7200)) {
    const assetId = await pc.readContract({ address: cfg.auction, abi: AUCTION_ABI, functionName: 'assetId' });
    let open = false;
    try {
      const leaf = await pc.readContract({ address: cfg.calendar, abi: CAL_ABI, functionName: 'currentInterval', args: [assetId] });
      const halted = Number(await pc.readContract({ address: cfg.halt, abi: HALT_ABI, functionName: 'phase', args: [assetId] })) !== 0;
      open = now >= Number(leaf.start) && now < Number(leaf.end) && leaf.phase >= 1 && leaf.phase <= 4 && !halted;
    } catch { open = false; }
    if (open) {
      try { log({ action: 'checkpoint', epoch, ...(await send(caller, { address: R, abi: REGISTRY_ABI, functionName: 'checkpoint', args: [stock] }, 600_000n)) }); } catch (e) { log({ action: 'checkpoint', skipped: short(e) }); }
    }
  }
}

async function placeOrders({ env, cfg, pc, send, now, specialist }) {
  const stage = Number(await pc.readContract({ address: cfg.auction, abi: AUCTION_ABI, functionName: 'currentStage' }));
  if (stage !== STAGE_OPEN) return;
  const me = acct(env.SPECIALIST_TEST_KEY);
  const cycle = await pc.readContract({ address: cfg.auction, abi: AUCTION_ABI, functionName: 'cycleId' });
  const count = await pc.readContract({ address: cfg.auction, abi: AUCTION_ABI, functionName: 'cycleOrderCount', args: [cycle] });
  let hasBuy = false; let hasSell = false;
  for (let i = 0; i < Number(count); i++) {
    const id = await pc.readContract({ address: cfg.auction, abi: AUCTION_ABI, functionName: 'cycleOrderId', args: [cycle, i] });
    const o = await pc.readContract({ address: cfg.auction, abi: AUCTION_ABI, functionName: 'order', args: [id] });
    if (o[0].toLowerCase() === me.address.toLowerCase() && !o[5]) { if (o[4]) hasBuy = true; else hasSell = true; }
  }
  if (hasBuy && hasSell) return;
  const round = await pc.readContract({ address: cfg.feed, abi: FEED_ABI, functionName: 'latestRoundData' });
  if (now - Number(round[3]) > FEED_MAX_AGE) return log({ step: 'orders', action: 'skipped', reason: 'reference is stale' });
  const ref = Number(round[1]) / 1e8;
  const buyUsdg = BigInt(cfg.buyUsdgRaw ?? '30000'); const sellNvda = BigInt(cfg.sellNvdaRaw ?? '150000000000000');
  for (const [token, amount] of [[cfg.usdg, buyUsdg], [cfg.nvda, sellNvda]]) {
    const [bal, allowance] = await Promise.all([pc.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [me.address] }), pc.readContract({ address: token, abi: ERC20, functionName: 'allowance', args: [me.address, cfg.auction] })]);
    if (bal < amount) return log({ step: 'orders', action: 'skipped', reason: 'balance too low', token });
    if (allowance < amount) await send(me, { address: token, abi: ERC20, functionName: 'approve', args: [cfg.auction, maxUint256] }, 120_000n);
  }
  if (!hasBuy) log({ step: 'orders', side: 'buy', cycle: Number(cycle), ...(await send(me, { address: cfg.auction, abi: AUCTION_ABI, functionName: 'submitOrder', args: [true, buyUsdg, limitX96(ref, 1.005)] }, 400_000n)) });
  if (!hasSell) log({ step: 'orders', side: 'sell', cycle: Number(cycle), ...(await send(me, { address: cfg.auction, abi: AUCTION_ABI, functionName: 'submitOrder', args: [false, sellNvda, limitX96(ref, 0.995)] }, 400_000n)) });
}
