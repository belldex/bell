#!/usr/bin/env node
/**
 * Runs the ANT pool checks A4, A5 and A6 on the Robinhood testnet rehearsal pool and records the transactions:
 *   A4  the hook address decoded: low 14 bits 0x2cc0, remove-liquidity bits 9, 8 and 0 off
 *   A5  a swap in the current session, with the fee read from the PoolManager Swap event and compared with the session table
 *   A6  a swap above the per-trade cap, sent with a fixed gas limit so the revert lands on chain, with its error decoded
 *
 *   node scripts/einstein/ant-testnet-proofs.mjs --pool evidence/einstein/testnet-ant-pool-<ts>.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, decodeEventLog, decodeErrorResult, decodeAbiParameters, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import ExecutorArtifact from '../../contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json' with { type: 'json' };
import HookArtifact from '../../contracts/out/BellHookV3.sol/BellHookV3.json' with { type: 'json' };
import FlowBudgetArtifact from '../../contracts/out/FlowBudget.sol/FlowBudget.json' with { type: 'json' };
const ERRORS = [...HookArtifact.abi, ...FlowBudgetArtifact.abi.filter((e) => e.type === 'error')];
import { sessionIntervals, sessionAt } from './v3-evolve/lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const env = {}; for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); }
const poolLog = JSON.parse(readFileSync(arg('pool'), 'utf8'));
const ant = JSON.parse(readFileSync('evidence/deploy/testnet-46630-ant.json', 'utf8'));
const inputs = JSON.parse(readFileSync('evidence/deploy/testnet-46630-pq-inputs.json', 'utf8'));
const manifest = JSON.parse(readFileSync('evidence/deploy/pq-hooks-testnet-46630.json', 'utf8'));
const run1 = JSON.parse(readFileSync('evidence/einstein/v3-evolve/testnet-run-config.json', 'utf8'));
const EXECUTOR = run1.executor;
const USDG = manifest.assetDescriptors.USDG.token; const STOCK = ant.token;
const [c0, c1] = BigInt(STOCK) < BigInt(USDG) ? [STOCK, USDG] : [USDG, STOCK];
const key = { currency0: c0, currency1: c1, fee: 0x800000, tickSpacing: 60, hooks: poolLog.hook };
const pk = env.DEPLOYER_PRIVATE_KEY; const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const pc = createPublicClient({ transport: http(env.RH_TESTNET_RPC_PRIMARY) });
const wc = createWalletClient({ account, transport: http(env.RH_TESTNET_RPC_PRIMARY) });
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)']);
const SWAP = parseAbi(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const FEE_OF = { CLOSED: 10000, OVERNIGHT: 5000, PRE: 3000, POST: 3000, REGULAR: 500 };
const out = { chainId: 46630, pool: poolLog.poolId, hook: poolLog.hook, createTx: poolLog.txs.createAndSeed, note: 'Testnet rehearsal. Test ANT token, fixture feed.', checks: {} };

// A4
const bits = BigInt(poolLog.hook) & 0x3fffn;
const off = [9n, 8n, 0n].every((b) => ((bits >> b) & 1n) === 0n);
out.checks.A4 = { verdict: bits === 0x2cc0n && off ? 'PASS' : 'FAIL', note: `hook ${poolLog.hook}, low 14 bits 0x${bits.toString(16)}, remove-liquidity bits 9, 8 and 0 ${off ? 'off' : 'ON'}` };

for (const t of [USDG, STOCK]) {
  const a = await pc.readContract({ address: t, abi: erc20, functionName: 'allowance', args: [account.address, EXECUTOR] });
  if (a < 2n ** 200n) await pc.waitForTransactionReceipt({ hash: await wc.writeContract({ address: t, abi: erc20, functionName: 'approve', args: [EXECUTOR, maxUint256] }) });
}
const swap = async (usdgIn, gas) => {
  const zeroForOne = USDG.toLowerCase() === c0.toLowerCase();
  const args = [key, zeroForOne, -parseUnits(String(usdgIn), 6)];
  let sim = true; try { await pc.simulateContract({ address: EXECUTOR, abi: ExecutorArtifact.abi, functionName: 'executeSwap', args, account }); } catch { sim = false; }
  const hash = await wc.writeContract({ address: EXECUTOR, abi: ExecutorArtifact.abi, functionName: 'executeSwap', args, gas });
  const r = await pc.waitForTransactionReceipt({ hash });
  return { hash, receipt: r, simulated: sim, args };
};

// A5: a small swap in whatever session the chain is in right now. A new interval opens with a bell fee that decays over BELL_DURATION_SECONDS (300 s)
// from the maximum to the session fee, so wait it out; the fee read right after an interval opens is higher than the table.
const waitUntil = Number(arg('after', '0'));
while (Number((await pc.getBlock()).timestamp) < waitUntil) await new Promise((r) => setTimeout(r, 10_000));
const now = Number((await pc.getBlock()).timestamp);
const session = sessionAt(now, sessionIntervals(now - 86400, now + 86400));
const small = await swap(1, 3_000_000n);
let fee = null;
if (small.receipt.status === 'success') for (const l of small.receipt.logs) { try { const ev = decodeEventLog({ abi: SWAP, data: l.data, topics: l.topics }); if (ev.eventName === 'Swap' && ev.args.id.toLowerCase() === poolLog.poolId.toLowerCase()) fee = Number(ev.args.fee); } catch { /* not a Swap */ } }
out.checks.A5 = { verdict: fee === FEE_OF[session] ? 'PASS' : 'FAIL', tx: small.hash, session, feePips: fee, expectedPips: FEE_OF[session], note: `swap in ${session}, Swap event fee ${fee} pips, table says ${FEE_OF[session]}` };

// A6: a swap far above the cap. Sent anyway with a fixed gas limit so the revert is a transaction.
const big = await swap(900, 3_500_000n);
let error = null;
if (big.receipt.status === 'reverted') {
  const tx = await pc.getTransaction({ hash: big.hash });
  let data = null; try { await pc.call({ to: tx.to, data: tx.input, account: tx.from, blockNumber: tx.blockNumber - 1n }); } catch (e) { let c = e; while (c && !data) { data = typeof c.data === 'string' && c.data.startsWith('0x') ? c.data : null; c = c.cause; } }
  if (data?.startsWith('0x90bfb865')) { const [, , reason] = decodeAbiParameters([{ type: 'address' }, { type: 'bytes4' }, { type: 'bytes' }, { type: 'bytes' }], `0x${data.slice(10)}`); try { error = decodeErrorResult({ abi: ERRORS, data: reason }).errorName; } catch { error = `selector ${String(reason).slice(0, 10)}`; } }
  else if (data) { try { error = decodeErrorResult({ abi: [...ERRORS, ...ExecutorArtifact.abi], data }).errorName; } catch { error = `selector ${data.slice(0, 10)}`; } }
  out.checks.A6 = { verdict: error === 'TradeCapExceeded' ? 'PASS' : 'FAIL', tx: big.hash, error, note: `a 900 USDG swap reverted with ${error}` };
} else out.checks.A6 = { verdict: 'FAIL', tx: big.hash, note: 'the oversized swap did not revert' };

out.recordedAt = new Date().toISOString();
const file = 'evidence/einstein/ant-testnet-proofs.json';
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
for (const [id, r] of Object.entries(out.checks)) console.log(id, r.verdict, r.note);
console.log(`wrote ${file}`);
