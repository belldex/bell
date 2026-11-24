#!/usr/bin/env node
/**
 * Claim A5, one session at a time: a small real swap on the mainnet ANT/USDG pool, the fee read from the PoolManager Swap event, and the
 * result appended to evidence/einstein/ant-mainnet-swaps.json. The session is computed from the calendar at the block time, and the swap is
 * refused if it is not the session you named, so a label can never be attached to the wrong session.
 *
 *   node scripts/einstein/ant-session-swap.mjs --expect PRE|REGULAR|POST|OVERNIGHT|CLOSED [--usdg 0.02] --i-authorize-spend
 *
 * In a closed session there is no report to sign (the pool prices from its closing anchor), so the swap carries no update.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildAntUpdate } from '../../workers/keeper-b/src/ant-update.mjs';
import { buildEtMarketIntervals } from '../calendar/et-market-calendar.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
if (!process.argv.includes('--i-authorize-spend')) throw new Error('this sends a mainnet transaction: add --i-authorize-spend');
const expect = arg('expect');
const FEES = { REGULAR: 500, PRE: 3000, POST: 3000, OVERNIGHT: 5000, CLOSED: 10000 };
if (!FEES[expect]) throw new Error('--expect must be PRE, REGULAR, POST, OVERNIGHT or CLOSED');
const env = {}; for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const pool = JSON.parse(readFileSync('evidence/einstein/ant-pool-1795488954977.json', 'utf8'));
const dep = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
const manifest = JSON.parse(readFileSync('packages/protocol/generated/abi-manifest.json', 'utf8'));
const wr = readFileSync('workers/keeper-b/wrangler.jsonc', 'utf8');
const cfg = JSON.parse(JSON.parse(`"${wr.match(/"BELL_ANT_CONFIG": "((?:[^"\\]|\\.)*)"/)[1]}"`));
const pc = createPublicClient({ transport: http(env.RH_MAINNET_RPC_PRIMARY) });
const lp = privateKeyToAccount(env.LP_TEST_PRIVATE_KEY.startsWith('0x') ? env.LP_TEST_PRIVATE_KEY : `0x${env.LP_TEST_PRIVATE_KEY}`);
const wc = createWalletClient({ account: lp, transport: http(env.RH_MAINNET_RPC_PRIMARY) });
const GAS = { maxFeePerGas: 30_000_000n, maxPriorityFeePerGas: 1_000_000n };
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const ERC20 = parseAbi(['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const HOOK = parseAbi(['function configHash() view returns (bytes32)', 'function config() view returns ((address token0,address token1,bytes32 asset0,bytes32 asset1,address poolManager,address positionManager,address factory,address assetRegistry,address calendarRegistry,address safetyController,address treasuryAdapter,uint8 poolClass,uint8 liquidityMode,uint8 referenceMode,int24 tickSpacing,uint128[2] tradeCap,uint128[2] windowCap,uint128[2] closureCap,bytes32 policyId,address referenceAdapter0,address referenceAdapter1))']);
const SWAP = parseAbi(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);

const now = Number((await pc.getBlock()).timestamp);
const session = buildEtMarketIntervals(now - 86400, now + 86400).find((i) => now >= i.start && now < i.end)?.phase;
if (session !== expect) { console.log(`the calendar says ${session} now, not ${expect}: nothing sent`); process.exit(3); }

let updates = [];
if (expect !== 'CLOSED') {
  const b = await buildAntUpdate({ cfg, delegateKey: env.ANT_DELEGATE_PRIVATE_KEY, client: pc });
  updates = [{ assetId: b.assetId, directSample: Object.fromEntries(Object.entries(b.directSample).map(([k, v]) => ['price18', 'observedAt', 'inputAt', 'validFrom', 'expiresAt', 'validUntil', 'phase'].includes(k) ? [k, BigInt(v)] : [k, v])), directSignature: b.directSignature, reports: b.reports, closeBoundaryHash: b.closeBoundaryHash }];
}
const config = await pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'config' });
const zeroForOne = config.token0.toLowerCase() === USDG.toLowerCase();
const amount = parseUnits(arg('usdg', '0.02'), 6);
const allowance = await pc.readContract({ address: USDG, abi: ERC20, functionName: 'allowance', args: [lp.address, dep.router] });
if (allowance < amount) { const a = await wc.writeContract({ address: USDG, abi: ERC20, functionName: 'approve', args: [dep.router, amount], ...GAS }); await pc.waitForTransactionReceipt({ hash: a }); }
const req = {
  hook: pool.hook, zeroForOne, exactInput: true, amountSpecified: amount, limitAmount: 1n,
  sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n,
  recipient: lp.address, nonce: await pc.readContract({ address: dep.router, abi: manifest.interfaces.IBellRouter, functionName: 'nonces', args: [lp.address] }),
  deadline: BigInt(now + 120), expectedConfigHash: await pc.readContract({ address: pool.hook, abi: HOOK, functionName: 'configHash' }),
  wrapInput: false, unwrapOutput: false, unwrapRefund: false, oracleUpdates: updates,
};
const sim = await pc.simulateContract({ address: dep.router, abi: manifest.interfaces.IBellRouter, functionName: 'swap', args: [req], account: lp });
const hash = await wc.writeContract({ ...sim.request, ...GAS });
const rc = await pc.waitForTransactionReceipt({ hash });
const fee = Number(parseEventLogs({ abi: SWAP, logs: rc.logs }).find((l) => l.args.id.toLowerCase() === pool.poolId.toLowerCase())?.args.fee ?? -1);
console.log(`${expect}: ${rc.status}, fee ${fee} pips (expected ${FEES[expect]}), tx ${hash}`);
if (rc.status !== 'success' || fee !== FEES[expect]) process.exit(1);
const file = 'evidence/einstein/ant-mainnet-swaps.json';
const doc = JSON.parse(readFileSync(file, 'utf8'));
if (!doc.swaps.some((s) => s.session === expect)) doc.swaps.push({ session: expect, tx: hash, amountUsdg: Number(arg('usdg', '0.02')), expectedFeePips: FEES[expect] });
writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`recorded in ${file}`);
