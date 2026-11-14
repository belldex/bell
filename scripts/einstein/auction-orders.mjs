#!/usr/bin/env node
/**
 * The Opening Bell Auction cycle for the first Einstein pool, with two real orders on opposite sides from two different wallets.
 *
 *   node scripts/einstein/auction-orders.mjs status
 *   node scripts/einstein/auction-orders.mjs prepare --broadcast   # fund wallet 2 and approve the auction (once)
 *   node scripts/einstein/auction-orders.mjs run --broadcast       # waits for the order window, submits both orders,
 *                                                                  # waits for the auction to settle, claims, writes the evidence
 *
 * The order window is the 10 minutes before the CLOSED to open boundary. Outside it submitOrder reverts with AuctionNotOpen.
 * Buyer is LP_TEST_PRIVATE_KEY (USDG in), seller is LP_TEST_PRIVATE_KEY_2 (NVDA in). Limits cross the market so both fill.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const command = process.argv[2] ?? 'status';
const broadcast = process.argv.includes('--broadcast');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const dir = 'evidence/einstein';
const pool = JSON.parse(readFileSync(`${dir}/${readdirSync(dir).filter((f) => f.startsWith('first-pool-')).sort().pop()}`, 'utf8'));
const pq = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet.json', 'utf8'));
const USDG = pq.assetDescriptors.USDG.token;
const NVDA = pq.assetDescriptors.NVDA.token;
const rpcUrl = arg('rpc', env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY);
const pc = createPublicClient({ transport: http(rpcUrl) });
const acct = (k) => privateKeyToAccount(env[k].startsWith('0x') ? env[k] : `0x${env[k]}`);
const buyer = acct('LP_TEST_PRIVATE_KEY');
const seller = acct('LP_TEST_PRIVATE_KEY_2');
const wc = (a) => createWalletClient({ account: a, transport: http(rpcUrl) });

const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)']);
const registry = parseAbi(['function auctionFor(bytes32) view returns (address)']);
const auctionAbi = parseAbi([
  'function currentStage() view returns (uint8)', 'function cycleId() view returns (uint64)', 'function openTime() view returns (uint64)',
  'function submitOrder(bool isBuyer, uint128 amountIn, uint160 limitPriceX96) returns (uint32)',
  'function settle()', 'function claimUnfilled(uint64 cycle, uint32 id)',
  'function indicativeClearing() view returns (uint160 priceX96, uint128 matchedBase)',
  'function cycleSummary(uint64) view returns (uint64 cycleOpenTime, uint64 deadline, uint8 cycleStage, uint160 priceX96, uint128 matchedBase, bool finalized)',
  'event OrderSubmitted(uint64 indexed cycleId, uint32 indexed orderId, address indexed owner, bool isBuyer, uint128 amountIn, uint160 limitPriceX96)',
]);
const STAGES = ['IDLE', 'ARMED', 'OPEN', 'LOCKED', 'SETTLED', 'REFUNDED'];
const auction = await pc.readContract({ address: pq.contracts.auctionRegistry, abi: registry, functionName: 'auctionFor', args: [pool.poolId] });

// 162.85 USD per NVDA as quote raw (6 decimals) per base raw (18 decimals), scaled by 2^96. Buy 5% above, sell 5% below, so they cross.
const mid = (162.85e6 / 1e18) * 2 ** 96;
const priceX96 = (f) => BigInt(Math.round(mid * f));
const BUY_USDG = 20_000n;           // 0.02 USDG, above the 8891 raw minimum
const SELL_NVDA = 120_000_000_000_000n; // 0.00012 NVDA, above the 5.4e13 raw minimum

const stage = async () => Number(await pc.readContract({ address: auction, abi: auctionAbi, functionName: 'currentStage' }));
const sendTx = async (account, params) => {
  const sim = await pc.simulateContract({ ...params, account });
  const hash = await wc(account).writeContract(sim.request);
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`tx ${hash} failed`);
  return { hash, receipt: r };
};
const log = (...a) => console.log(new Date().toISOString(), ...a);

if (command === 'status') {
  const [s, open, cycle] = await Promise.all([stage(), pc.readContract({ address: auction, abi: auctionAbi, functionName: 'openTime' }), pc.readContract({ address: auction, abi: auctionAbi, functionName: 'cycleId' })]);
  const now = Math.floor(Date.now() / 1000);
  console.log(`auction ${auction}, cycle ${cycle}, stage ${STAGES[s]}, opens ${new Date(Number(open) * 1000).toISOString()} (orders accepted from ${new Date((Number(open) - 600) * 1000).toISOString()}), in ${Math.round((Number(open) - now) / 3600 * 10) / 10} h`);
  for (const [name, a] of [['buyer', buyer], ['seller', seller]]) {
    const [u, n, e] = await Promise.all([pc.readContract({ address: USDG, abi: erc20, functionName: 'balanceOf', args: [a.address] }), pc.readContract({ address: NVDA, abi: erc20, functionName: 'balanceOf', args: [a.address] }), pc.getBalance({ address: a.address })]);
    console.log(`${name} ${a.address} USDG ${u} NVDA ${n} ETH ${Number(e) / 1e18}`);
  }
} else if (command === 'prepare') {
  const plan = [];
  const nvdaHave = await pc.readContract({ address: NVDA, abi: erc20, functionName: 'balanceOf', args: [seller.address] });
  const ethHave = await pc.getBalance({ address: seller.address });
  if (nvdaHave < SELL_NVDA + SELL_NVDA / 10n) plan.push(['send NVDA to seller', async () => sendTx(buyer, { address: NVDA, abi: erc20, functionName: 'transfer', args: [seller.address, SELL_NVDA + SELL_NVDA / 5n - nvdaHave] })]);
  if (ethHave < parseEther('0.0002')) plan.push(['send gas to seller', async () => wc(buyer).sendTransaction({ to: seller.address, value: parseEther('0.0003') - ethHave }).then((h) => pc.waitForTransactionReceipt({ hash: h }))]);
  const needs = [[buyer, USDG, BUY_USDG, 'buyer approves USDG'], [seller, NVDA, SELL_NVDA, 'seller approves NVDA']];
  for (const [a, token, amount, label] of needs) {
    const al = await pc.readContract({ address: token, abi: erc20, functionName: 'allowance', args: [a.address, auction] });
    if (al < amount) plan.push([label, async () => sendTx(a, { address: token, abi: erc20, functionName: 'approve', args: [auction, amount] })]);
  }
  console.log(plan.length ? `to do: ${plan.map((p) => p[0]).join('; ')}` : 'nothing to prepare');
  if (broadcast) for (const [label, fn] of plan) { await fn(); log('done:', label); }
} else if (command === 'run') {
  log(`waiting for the order window of auction ${auction}`);
  while ((await stage()) !== 2) {
    const s = await stage();
    if (s > 2) throw new Error(`the order window has passed (stage ${STAGES[s]})`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
  log('order window is OPEN, submitting both orders');
  const evidence = { auction, cycle: String(await pc.readContract({ address: auction, abi: auctionAbi, functionName: 'cycleId' })), orders: [] };
  const b = await sendTx(buyer, { address: auction, abi: auctionAbi, functionName: 'submitOrder', args: [true, BUY_USDG, priceX96(1.05)] });
  evidence.orders.push({ side: 'buy', wallet: buyer.address, tx: b.hash, block: Number(b.receipt.blockNumber) }); log('buy order', b.hash);
  const s = await sendTx(seller, { address: auction, abi: auctionAbi, functionName: 'submitOrder', args: [false, SELL_NVDA, priceX96(0.95)] });
  evidence.orders.push({ side: 'sell', wallet: seller.address, tx: s.hash, block: Number(s.receipt.blockNumber) }); log('sell order', s.hash);
  const [indicative, matched] = await pc.readContract({ address: auction, abi: auctionAbi, functionName: 'indicativeClearing' });
  evidence.indicative = { priceX96: String(indicative), matchedBase: String(matched) };
  writeFileSync(`${dir}/auction.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  log(`indicative clearing price ${indicative}, matched base ${matched}. Waiting for the keeper to settle after the open.`);
  for (let i = 0; i < 200; i += 1) {
    const sum = await pc.readContract({ address: auction, abi: auctionAbi, functionName: 'cycleSummary', args: [BigInt(evidence.cycle)] });
    if (sum[5]) { evidence.settled = { stage: STAGES[sum[2]], clearingPriceX96: String(sum[3]), matchedBase: String(sum[4]) }; break; }
    if (i === 40) { try { const t = await sendTx(buyer, { address: auction, abi: auctionAbi, functionName: 'settle' }); evidence.settleTx = t.hash; log('settle sent by the buyer', t.hash); } catch (e) { log('settle not possible yet:', String(e.shortMessage ?? e.message).slice(0, 120)); } }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  writeFileSync(`${dir}/auction.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  log('final', JSON.stringify(evidence.settled ?? 'not settled within the wait'));
} else {
  throw new Error('usage: auction-orders.mjs status|prepare|run');
}
