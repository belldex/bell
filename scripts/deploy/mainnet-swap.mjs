#!/usr/bin/env node
/**
 * Swap against the live mainnet pool through BellRouter.
 *
 * This deliberately does not reuse `swap-live-pool.mjs`: that script deploys and calls
 * `TestnetSwapExecutor`, a fixture that bypasses the router. A mainnet swap has to go through the
 * production `BellRouter` (nonce, deadline, slippage bound, canonical WETH), otherwise the trade
 * proves the fixture works, not the product.
 *
 *   node scripts/deploy/mainnet-swap.mjs --zeroForOne=true --amount=1000000000000000
 *   node scripts/deploy/mainnet-swap.mjs --zeroForOne=false --amount=1000000000000000
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildMainnetSwapRequest, resolveSwapLegs } from './mainnet-swap-request.mjs';

const MAINNET_CHAIN_ID = 4663;
const stockArg = process.argv.find((a) => a.startsWith('--stock='))?.slice(8)?.toUpperCase() ?? null;
const counterArg = process.argv.find((a) => a.startsWith('--counterasset='))?.slice(15)?.toUpperCase() ?? 'WETH';
const swapBroadcast = process.argv.includes('--broadcast');
if (swapBroadcast && (!stockArg || !process.argv.some((a) => a.startsWith('--counterasset=')))) {
  throw new Error('broadcast requires explicit --stock and --counterasset arguments');
}

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
const pk = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl || !pk) throw new Error('RH_MAINNET_RPC_PRIMARY and a deployer key are required');

const manifest = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
const pool = JSON.parse(readFileSync(`evidence/deploy/mainnet-4663-pool-${stockArg ?? 'AAPL'}-${counterArg}-${env.BELL_POOL_CLASS || '1'}.json`, 'utf8'));
const EVIDENCE_PATH = `evidence/deploy/mainnet-4663-swap-${pool.stockSymbol ?? stockArg ?? 'AAPL'}-${pool.counterasset ?? counterArg}.json`;
if (Number(manifest.chainId) !== MAINNET_CHAIN_ID) throw new Error('manifest chainId mismatch');

const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== MAINNET_CHAIN_ID) throw new Error(`Wrong chain ${chainId}; expected ${MAINNET_CHAIN_ID}`);

const HOOK_ABI = parseAbi([
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] a, uint128[2] b, uint128[2] c, uint128[2] d, uint128[2] e, uint64 f, uint64 g, bytes32 h, bytes32 i))',
  'function configHash() view returns (bytes32)',
  'function buckets() view returns ((uint64 epoch, uint128[2] currentGross, uint128[2] previousGross))',
]);
const ROUTER_ABI = parseAbi([
  'function swap((address hook, bool zeroForOne, bool exactInput, uint128 amountSpecified, uint128 limitAmount, uint160 sqrtPriceLimitX96, address recipient, uint64 nonce, uint64 deadline, bytes32 expectedConfigHash, bool wrapInput, bool unwrapOutput, bool unwrapRefund) request) payable returns (uint128 amountIn, uint128 amountOut)',
  'function nonces(address) view returns (uint64)',
]);
const ERC20 = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

// The pool must be swappable now. A pool that was created but is currently closed is not a
// working product, so this fails loudly instead of reporting a stale success.
const policy = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'getPolicy' });
console.log(`Policy: canSwap=${policy.canSwap} mode=${policy.mode} reasons=${policy.reasonBits}`);
if (!policy.canSwap) {
  throw new Error('pool is not swappable right now; the keeper must publish a fresh report for the active phase first');
}

const zeroForOne = arg('zeroForOne', 'true') === 'true';
const amount = BigInt(arg('amount', '0'));
if (amount <= 0n) throw new Error('--amount must be a positive integer in the input token base units');

const legs = resolveSwapLegs({ token0: pool.token0, token1: pool.token1, zeroForOne });
const useNativeInput = arg('native', 'false') === 'true';

// Exact-input router limit is minimum output in output-token base units, never amount-in units.
// Require it explicitly; a guessed default can reject a valid trade or admit an unacceptable fill.
const minAmountOutArg = arg('minAmountOut', null);
if (!minAmountOutArg) throw new Error('--minAmountOut is required in output-token base units');
const minAmountOut = BigInt(minAmountOutArg);
if (minAmountOut <= 0n) throw new Error('--minAmountOut must be a positive integer');
const broadcast = swapBroadcast;

const block = await publicClient.getBlock();
const configHash = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'configHash' });
const nonce = await publicClient.readContract({ address: manifest.router, abi: ROUTER_ABI, functionName: 'nonces', args: [account.address] });

const request = buildMainnetSwapRequest({
  hook: pool.hook,
  zeroForOne,
  amountIn: amount,
  minAmountOut,
  recipient: account.address,
  nonce,
  deadline: BigInt(Number(block.timestamp) + 600),
  expectedConfigHash: configHash,
  token0: pool.token0,
  token1: pool.token1,
  weth: manifest.weth,
  now: BigInt(Number(block.timestamp)),
  useNativeInput,
});

const beforeIn = await publicClient.readContract({ address: legs.tokenIn, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
const beforeOut = await publicClient.readContract({ address: legs.tokenOut, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
const bucketsBefore = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'buckets' });

if (!useNativeInput) {
  const balance = await publicClient.readContract({ address: legs.tokenIn, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
  if (balance < amount) throw new Error(`insufficient ${legs.tokenIn} balance: ${balance} < ${amount}`);
}

if (!broadcast) {
  const simulation = await publicClient.simulateContract({
    address: manifest.router,
    abi: ROUTER_ABI,
    functionName: 'swap',
    args: [request],
    account,
    value: useNativeInput ? amount : 0n,
  });
  console.log(JSON.stringify({ mode: 'PLAN_ONLY', chainId, stock: pool.stockSymbol, counterasset: pool.counterasset, poolId: pool.poolId, amount: amount.toString(), minAmountOut: minAmountOut.toString(), simulatedResult: simulation.result?.map?.(String) ?? null }, null, 2));
  console.log('No transaction sent. Add --broadcast to authorize the swap transaction.');
  process.exit(0);
}

if (!useNativeInput) {
  const approveHash = await walletClient.writeContract({
    address: legs.tokenIn, abi: ERC20, functionName: 'approve', args: [manifest.router, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
}

await publicClient.simulateContract({
  address: manifest.router,
  abi: ROUTER_ABI,
  functionName: 'swap',
  args: [request],
  account,
  value: useNativeInput ? amount : 0n,
});
console.log('Router swap simulation passed; broadcasting the exact simulated request');

const swapTx = await walletClient.writeContract({
  address: manifest.router,
  abi: ROUTER_ABI,
  functionName: 'swap',
  args: [request],
  value: useNativeInput ? amount : 0n,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: swapTx });
if (receipt.status !== 'success') throw new Error(`swap reverted: ${swapTx}`);

const afterIn = await publicClient.readContract({ address: legs.tokenIn, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
const afterOut = await publicClient.readContract({ address: legs.tokenOut, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
const bucketsAfter = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'buckets' });

const spent = beforeIn - afterIn;
const received = afterOut - beforeOut;
if (received <= 0n) throw new Error('swap settled with zero output; that is not a usable trade');

const evidence = {
  chainId,
  swapTx,
  blockNumber: Number(receipt.blockNumber),
  router: manifest.router,
  hook: pool.hook,
  poolId: pool.poolId,
  zeroForOne,
  tokenIn: legs.tokenIn,
  tokenOut: legs.tokenOut,
  spent: spent.toString(),
  received: received.toString(),
  grossBefore: bucketsBefore.currentGross.map(String),
  grossAfter: bucketsAfter.currentGross.map(String),
  at: new Date().toISOString(),
};
writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);

console.log(`\nSwap confirmed via BellRouter: ${swapTx}`);
console.log(`  spent   : ${spent}`);
console.log(`  received: ${received}`);
console.log(`  gross   : ${bucketsBefore.currentGross.map(String).join(',')} -> ${bucketsAfter.currentGross.map(String).join(',')}`);
console.log(`Wrote ${EVIDENCE_PATH}`);
