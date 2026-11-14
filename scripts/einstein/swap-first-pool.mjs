#!/usr/bin/env node
/**
 * One small swap on the first Einstein pool through the official BellRouter, with the session fee read back from the
 * PoolManager Swap event. Dry run by default.
 *
 *   node scripts/einstein/swap-first-pool.mjs --in usdg --amount 0.01            # simulate
 *   node scripts/einstein/swap-first-pool.mjs --in nvda --amount 0.00005 --broadcast
 *   add --key LP_TEST_PRIVATE_KEY_2 to swap from the second tester wallet
 *
 * --pool  path of the first-pool evidence file (defaults to the newest evidence/einstein/first-pool-*.json)
 * Amounts are decimal token amounts. The hook enforces its own per-trade cap, which in CLOSED is a small fraction of the seed.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, decodeEventLog, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import RouterArtifact from '../../contracts/out/BellRouter.sol/BellRouter.json' with { type: 'json' };

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const broadcast = process.argv.includes('--broadcast');
const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const dir = 'evidence/einstein';
const poolFile = arg('pool', `${dir}/${readdirSync(dir).filter((f) => f.startsWith('first-pool-')).sort().pop()}`);
const pool = JSON.parse(readFileSync(poolFile, 'utf8'));
const manifest = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
const pq = JSON.parse(readFileSync('evidence/deploy/pq-hooks-mainnet.json', 'utf8'));
const USDG = pq.assetDescriptors.USDG.token;
const NVDA = pq.assetDescriptors.NVDA.token;
const router = manifest.router;
const poolManager = manifest.poolManager;

const rpcUrl = arg('rpc', env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY);
const keyName = arg('key', 'LP_TEST_PRIVATE_KEY');
const rawKey = env[keyName];
if (!rpcUrl || !rawKey) throw new Error(`RPC and ${keyName} are required in .env`);
const account = privateKeyToAccount(rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const hookAbi = parseAbi(['function configHash() view returns (bytes32)']);
const swapEvent = parseAbi(['event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)']);

const direction = arg('in', 'usdg');
const zeroForOne = direction === 'usdg';
const decimals = zeroForOne ? 6 : 18;
const amount = BigInt(Math.round(Number(arg('amount', '0.01')) * 1e9)) * 10n ** BigInt(decimals - 9 > 0 ? decimals - 9 : 0) / (decimals < 9 ? 10n ** BigInt(9 - decimals) : 1n);
const tokenIn = zeroForOne ? USDG : NVDA;

const [balance, allowance, configHash, nonce] = await Promise.all([
  publicClient.readContract({ address: tokenIn, abi: erc20, functionName: 'balanceOf', args: [account.address] }),
  publicClient.readContract({ address: tokenIn, abi: erc20, functionName: 'allowance', args: [account.address, router] }),
  publicClient.readContract({ address: pool.hook, abi: hookAbi, functionName: 'configHash' }),
  publicClient.readContract({ address: router, abi: RouterArtifact.abi, functionName: 'nonces', args: [account.address] }),
]);
console.log(`swapper ${account.address}, ${direction.toUpperCase()} in ${amount} raw, balance ${balance}`);
if (balance < amount) throw new Error('not enough balance of the input token');

const request = {
  hook: pool.hook, zeroForOne, exactInput: true, amountSpecified: amount, limitAmount: 1n,
  sqrtPriceLimitX96: zeroForOne ? 4295128740n : 1461446703485210103287273052203988822378723970341n,
  recipient: account.address, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  expectedConfigHash: configHash, wrapInput: false, unwrapOutput: false, unwrapRefund: false, oracleUpdates: [],
};

if (allowance < amount) {
  if (!broadcast) { console.log('DRY RUN: router allowance is missing. With --broadcast it approves exactly this amount first.'); process.exit(0); }
  const h = await walletClient.writeContract({ address: tokenIn, abi: erc20, functionName: 'approve', args: [router, amount] });
  await publicClient.waitForTransactionReceipt({ hash: h });
  console.log(`approve ${h}`);
}
if (process.argv.includes('--expect-revert')) {
  // A negative test: the swap must revert with the named error. The simulation proves the reason, and a real transaction sent
  // with a fixed gas limit leaves the reverted transaction on chain as the public proof.
  const selector = arg('selector', '').toLowerCase();
  const id = arg('id', 'N?');
  let text = '';
  try { await publicClient.simulateContract({ address: router, abi: RouterArtifact.abi, functionName: 'swap', args: [request], account }); }
  catch (e) { const carrier = e?.walk?.((x) => typeof x?.data === "string"); text = JSON.stringify([e?.shortMessage, e?.details, carrier?.data, e?.message]).toLowerCase(); }
  if (!text) throw new Error('the swap did not revert, so it is not a negative test');
  if (selector && !text.includes(selector.slice(2))) throw new Error(`reverted, but not with ${selector}: ${text.slice(0, 600)}`);
  console.log(`simulation reverted with ${selector || 'an error'}, as required`);
  if (!broadcast) { console.log('DRY RUN OK. Add --broadcast to leave the reverted transaction on chain.'); process.exit(0); }
  const sent = await walletClient.sendTransaction({ to: router, data: encodeFunctionData({ abi: RouterArtifact.abi, functionName: 'swap', args: [request] }), gas: 3_000_000n });
  const r = await publicClient.waitForTransactionReceipt({ hash: sent });
  if (r.status !== 'reverted') throw new Error(`expected a reverted transaction, got ${r.status}`);
  const file = `${dir}/negatives.json`;
  let list = []; try { list = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first one */ }
  list.push({ id, tx: sent, block: Number(r.blockNumber), status: r.status, selector, gasUsed: Number(r.gasUsed), amountInRaw: String(amount), direction });
  writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
  console.log(`${id} reverted on chain: ${sent} (block ${r.blockNumber})`);
  process.exit(0);
}
let sim;
for (let attempt = 0; attempt < 5; attempt += 1) {
  try { sim = await publicClient.simulateContract({ address: router, abi: RouterArtifact.abi, functionName: 'swap', args: [request], account }); break; }
  catch (e) {
    const text = String(e?.shortMessage ?? e?.message ?? e);
    if (attempt === 4 || !/allowance|0x13be252b|exceeds/i.test(text)) { console.log(`simulation failed: ${text.slice(0, 300)}`); process.exit(1); }
    await new Promise((r) => setTimeout(r, 3000)); // the RPC may not have seen the approval yet
  }
}
console.log(`simulation passed: in ${sim.result[0]}, out ${sim.result[1]}`);
if (!broadcast) { console.log('DRY RUN OK. Add --broadcast to send.'); process.exit(0); }

const hash = await walletClient.writeContract(sim.request);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
let fee = null;
for (const log of receipt.logs) {
  if (log.address.toLowerCase() !== poolManager.toLowerCase()) continue;
  try { const ev = decodeEventLog({ abi: swapEvent, data: log.data, topics: log.topics }); fee = ev.args.fee; } catch { /* another PoolManager event */ }
}
const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
const entry = { tx: hash, block: Number(receipt.blockNumber), timestamp: Number(block.timestamp), status: receipt.status, swapper: account.address, direction, amountInRaw: String(amount), feePips: fee === null ? null : Number(fee), gasUsed: Number(receipt.gasUsed) };
const out = `${dir}/swaps.json`;
let all = []; try { all = JSON.parse(readFileSync(out, 'utf8')); } catch { /* first swap */ }
all.push(entry);
writeFileSync(out, `${JSON.stringify(all, null, 2)}\n`);
console.log(`swap ${hash} status ${receipt.status}, Swap event fee ${fee} pips, block ${receipt.blockNumber}`);
