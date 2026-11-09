#!/usr/bin/env node
/**
 * Test D, rule "a swap above the trade cap reverts", on a live mainnet pool.
 *
 * Builds a BellRouter exact-input swap whose input is larger than the pool's effective per-trade cap and
 * runs it as an eth_call first. It sends the transaction only with --broadcast --i-authorize-spend, and sends
 * it with a fixed gas limit so it lands on chain as a reverted transaction (a node would refuse to send a
 * transaction whose estimate fails). The revert must decode to TradeCapExceeded; any other reason is reported
 * and nothing is sent.
 *
 *   node scripts/lp-proof/mainnet-rule-test-cap.mjs --hook=0xc1ada05c...              # simulate only
 *   node scripts/lp-proof/mainnet-rule-test-cap.mjs --hook=0xc1ada05c... --broadcast --i-authorize-spend
 *
 * The signing key is LP_TEST_PRIVATE_KEY from the root .env. Nothing here moves tokens: the hook refuses
 * the swap before the router settles, so the cost is gas only.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, decodeErrorResult, decodeAbiParameters, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildMainnetSwapRequest, MAINNET_ROUTER_ABI } from '../deploy/mainnet-swap-request.mjs';

const WORKER = 'https://bell-keeper-b.asysyifaq25.workers.dev/pools';
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const hookPrefix = (arg('hook', '') || '').toLowerCase();
if (!hookPrefix.startsWith('0x') || hookPrefix.length < 10) throw new Error('--hook=0x... (at least the first 8 hex digits) is required');
const zeroForOne = arg('zeroForOne', 'true') === 'true';
const broadcast = process.argv.includes('--broadcast');
const authorized = process.argv.includes('--i-authorize-spend');

const env = {};
for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const pk = env.LP_TEST_PRIVATE_KEY;
if (!pk) throw new Error('LP_TEST_PRIVATE_KEY is not set in .env');
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const rpc = env.RH_MAINNET_RPC_PRIMARY;
const publicClient = createPublicClient({ transport: http(rpc) });
const walletClient = createWalletClient({ account, transport: http(rpc) });
if ((await publicClient.getChainId()) !== 4663) throw new Error('not chain 4663');
const manifest = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));

const { pools } = await (await fetch(WORKER)).json();
const pool = pools.find((p) => p.hook.toLowerCase().startsWith(hookPrefix));
if (!pool) throw new Error(`no pool with hook starting ${hookPrefix}`);
const idx = zeroForOne ? 0 : 1;
const cap = BigInt(pool.policy.effectiveTradeCap[idx]);
const amountIn = cap * 2n; // twice the cap on the input side
const symbols = pool.legs.map((l) => l.symbol);
console.log(`pool ${symbols.join('/')} hook ${pool.hook} canSwap=${pool.policy.canSwap} phase=${pool.policy.phase}`);
console.log(`effective trade cap (input side) ${cap}, test input ${amountIn}, wallet ${account.address}`);
if (!pool.policy.canSwap) throw new Error('pool cannot swap right now, so a cap revert cannot be reached (PolicyBlocked comes first)');

const HOOK_ABI = parseAbi(['function configHash() view returns (bytes32)']);
const configHash = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'configHash' });
const nonce = await publicClient.readContract({ address: manifest.router, abi: MAINNET_ROUTER_ABI, functionName: 'nonces', args: [account.address] });
const block = await publicClient.getBlock();
const request = buildMainnetSwapRequest({
  hook: pool.hook, zeroForOne, amountIn, minAmountOut: 1n, recipient: account.address,
  nonce, deadline: block.timestamp + 600n, expectedConfigHash: configHash,
  token0: pool.token0, token1: pool.token1, weth: manifest.weth, now: block.timestamp,
});
const data = encodeFunctionData({ abi: MAINNET_ROUTER_ABI, functionName: 'swap', args: [request] });

const ERRORS = parseAbi([
  'error TradeCapExceeded(uint8 currency, uint256 amount, uint256 cap)',
  'error WindowCapExceeded(uint8 currency, uint256 gross, uint256 cap)',
  'error PolicyBlocked(uint256 reasonBits)',
  'error AuctionActive()',
]);
const WRAPPED = '0x90bfb865'; // WrappedError(address,bytes4,bytes,bytes)

function revertData(err) {
  let d; err.walk?.((e) => { if (typeof e?.data === 'string' && e.data.startsWith('0x') && !d) d = e.data; return false; });
  return d ?? err.data;
}
function decodeRevert(raw) {
  if (!raw) return { name: 'UNKNOWN', raw };
  let inner = raw;
  if (raw.startsWith(WRAPPED)) {
    const [, , reason] = decodeAbiParameters([{ type: 'address' }, { type: 'bytes4' }, { type: 'bytes' }, { type: 'bytes' }], `0x${raw.slice(10)}`);
    inner = reason;
  }
  try { const d = decodeErrorResult({ abi: ERRORS, data: inner }); return { name: d.errorName, args: (d.args ?? []).map(String), raw }; }
  catch { return { name: `UNDECODED ${inner.slice(0, 10)}`, raw }; }
}

let simulated;
try {
  await publicClient.call({ account, to: manifest.router, data });
  simulated = { name: 'NO_REVERT' };
} catch (e) { simulated = decodeRevert(revertData(e)); }
console.log('simulation result:', JSON.stringify({ name: simulated.name, args: simulated.args }));
if (simulated.name !== 'TradeCapExceeded') {
  console.log('Not a TradeCapExceeded revert. Nothing will be sent.');
  process.exit(simulated.name === 'NO_REVERT' ? 2 : 1);
}
if (!broadcast) { console.log('Simulation matches the rule. No transaction sent. Add --broadcast --i-authorize-spend to land it on chain (gas only).'); process.exit(0); }
if (!authorized) throw new Error('--broadcast requires --i-authorize-spend');

const hash = await walletClient.sendTransaction({ to: manifest.router, data, gas: 2_000_000n });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`tx ${hash} status=${receipt.status} block=${receipt.blockNumber}`);
if (receipt.status !== 'reverted') throw new Error('transaction did not revert; the rule did not hold');
const evidence = {
  id: 'swap-above-cap-reverts', chainId: 4663, router: manifest.router, hook: pool.hook, poolId: pool.poolId,
  pair: symbols.join('/'), wallet: account.address, amountIn: amountIn.toString(), effectiveTradeCap: cap.toString(),
  tx: hash, block: Number(receipt.blockNumber), at: new Date().toISOString(), error: simulated.name, errorArgs: simulated.args,
  gasUsed: receipt.gasUsed.toString(),
};
mkdirSync('evidence/lp-proof', { recursive: true });
writeFileSync(`evidence/lp-proof/mainnet-rule-test-cap-${hash.slice(2, 10)}.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log('wrote evidence file; copy the tx into deployments/rule-tests.json (mainnet entry) after checking it on the explorer');
