#!/usr/bin/env node
/**
 * v3 Evolve on mainnet, read only: what one run costs and what the wallets hold. Sends nothing.
 *
 *   node scripts/einstein/v3-evolve/mainnet-capital.mjs
 *
 * The control pool is seeded with the same liquidity and ticks as the Einstein NVDA/USDG pool (evidence/einstein/first-pool-*.json). The amounts for
 * that liquidity at the opening price are computed here, so the capital for the control side is a number and not a guess. A new BELL pool also pays
 * the factory service fee, which is the larger part of the bill.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createPublicClient, http, parseAbi } from 'viem';

const env = {};
try { for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); } } catch { /* CI */ }
for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
const dir = 'evidence/einstein';
const pool = JSON.parse(readFileSync(`${dir}/${readdirSync(dir).filter((f) => f.startsWith('first-pool-')).sort().pop()}`, 'utf8'));
const pq = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet.json', 'utf8'));
const verification = JSON.parse(readFileSync('evidence/deploy/mainnet-4663-verification.json', 'utf8'));
const USDG = pq.assetDescriptors.USDG.token; const NVDA = pq.assetDescriptors.NVDA.token;

const Q96 = 2n ** 96n;
const sqrtAtTick = (t) => BigInt(Math.floor(Math.pow(1.0001, t / 2) * 2 ** 96));
const { sqrtPriceX96, tickLower, tickUpper, liquidity } = pool.request;
const sp = BigInt(sqrtPriceX96); const a = sqrtAtTick(tickLower); const b = sqrtAtTick(tickUpper); const L = BigInt(liquidity);
const [token0, token1] = BigInt(USDG) < BigInt(NVDA) ? ['USDG', 'NVDA'] : ['NVDA', 'USDG'];
const amount0 = (L * Q96 * (b - sp)) / (sp * b); const amount1 = (L * (sp - a)) / Q96;
const dec = { USDG: 6, NVDA: 18 };
const human = (raw, sym) => Number(raw) / 10 ** dec[sym];
const seed = { [token0]: human(amount0, token0), [token1]: human(amount1, token1) };
const serviceFeeUsdg = Number(verification['factory.serviceFee'] ?? 49_000_000) / 1e6;
const nvdaUsd = pool.request.nvdaUsd;
const controlUsd = seed.USDG + seed.NVDA * nvdaUsd;

console.log(JSON.stringify({
  controlPoolSeed: { ...seed, approxUsd: Number(controlUsd.toFixed(2)), sameAsEinsteinPoolRequest: pool.poolId },
  newBellPool: { serviceFeeUsdg, seedUsd: Number(controlUsd.toFixed(2)), approxUsd: Number((serviceFeeUsdg + controlUsd).toFixed(2)) },
  bothPoolsApproxUsd: Number((serviceFeeUsdg + 2 * controlUsd).toFixed(2)),
  note: 'Excludes the arbitrage bot inventory and gas. Reusing the existing NVDA pool as the BELL side avoids the service fee but changes the "seeded in the same block" rule, so it needs a method change committed before the run.',
}, null, 2));

const rpc = env.RH_MAINNET_RPC_PRIMARY;
if (!rpc) { console.log('RH_MAINNET_RPC_PRIMARY is not set: balances skipped'); process.exit(0); }
const pc = createPublicClient({ transport: http(rpc) });
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const holders = { deployer: pq.deployer, auctionBuyer: '0xEf4ae5048CDF3c2251Bd7250d73E1D5830E21F33', auctionSeller: '0xE4d14b0494937221fA4f78a5e5a9BaD6Fa8753D3', workerGas: '0x14B71d1BA5dE1e718B1f1e05c8ec0333FE1d0079' };
for (const [name, address] of Object.entries(holders)) {
  const [u, n, e] = await Promise.all([pc.readContract({ address: USDG, abi: erc20, functionName: 'balanceOf', args: [address] }), pc.readContract({ address: NVDA, abi: erc20, functionName: 'balanceOf', args: [address] }), pc.getBalance({ address })]);
  console.log(`${name} ${address}: USDG ${human(u, 'USDG')}, NVDA ${human(n, 'NVDA')}, ETH ${Number(e) / 1e18}`);
}
