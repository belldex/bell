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
import { buildMainnetSwapRequest, MAINNET_ROUTER_ABI, resolveSwapLegs } from './mainnet-swap-request.mjs';
import { validateMainnetSwapPreflight, validateSwapBroadcastAuthorization } from './mainnet-swap-ops.mjs';
import { fetchPoolOracleUpdates, ORACLE_POOL_CONFIG_ABI, resolveOraclePair, validateOraclePoolPair } from './mainnet-prepare-request.mjs';

const MAINNET_CHAIN_ID = 4663;
const stockArg = process.argv.find((a) => a.startsWith('--stock='))?.slice(8)?.toUpperCase() ?? null;
const counterArg = process.argv.find((a) => a.startsWith('--counterasset='))?.slice(15)?.toUpperCase() ?? 'WETH';
const swapBroadcast = process.argv.includes('--broadcast');
if (swapBroadcast && (!stockArg || !process.argv.some((a) => a.startsWith('--counterasset=')))) {
  throw new Error('broadcast requires explicit --stock and --counterasset arguments');
}

function loadEnv(text) {
  const env = { ...process.env };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
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
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] effectiveTradeCap, uint128[2] effectiveWindowCap, uint128[2] rollingRemaining, uint128[2] closureRemaining, uint128[2] referencePrice18, uint64 validUntil, uint64 closureNonce, bytes32 configHash, bytes32 stateHash))',
  'function configHash() view returns (bytes32)',
  'function buckets() view returns ((uint64 epoch, uint128[2] currentGross, uint128[2] previousGross))',
]);
const ROUTER_ABI = MAINNET_ROUTER_ABI;
const ERC20 = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

// The pool must be swappable now. A pool that is closed or halted fails before any approval/write.
const policy = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'getPolicy' });
console.log(`Policy: canSwap=${policy.canSwap} mode=${policy.mode} reasons=${policy.reasonBits}`);

const zeroForOne = arg('zeroForOne', 'true') === 'true';
const amount = BigInt(arg('amount', '0'));
if (amount <= 0n) throw new Error('--amount must be a positive integer in the input token base units');

const legs = resolveSwapLegs({ token0: pool.token0, token1: pool.token1, zeroForOne });
const useNativeInput = arg('native', 'false') === 'true';
const broadcast = swapBroadcast;

// Exact-input router limit is minimum output in output-token base units, never amount-in units.
// Require it explicitly; a guessed default can reject a valid trade or admit an unacceptable fill.
const minAmountOutArg = arg('minAmountOut', null);
if (!minAmountOutArg) throw new Error('--minAmountOut is required in output-token base units');
const minAmountOut = BigInt(minAmountOutArg);
if (minAmountOut <= 0n) throw new Error('--minAmountOut must be a positive integer');
const block = await publicClient.getBlock();
const configHash = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'configHash' });
const nonce = await publicClient.readContract({ address: manifest.router, abi: ROUTER_ABI, functionName: 'nonces', args: [account.address] });

const beforeIn = useNativeInput ? 0n : await publicClient.readContract({ address: legs.tokenIn, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
const beforeOut = await publicClient.readContract({ address: legs.tokenOut, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
const bucketsBefore = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'buckets' });
const poolConfig = await publicClient.readContract({
  address: pool.hook,
  abi: ORACLE_POOL_CONFIG_ABI,
  functionName: 'config',
});
const swapPolicy = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'getPolicy' });
const remainingGross = poolConfig.windowCap[zeroForOne ? 0 : 1] - bucketsBefore.currentGross[zeroForOne ? 0 : 1];
const liveState = await publicClient.readContract({ address: pool.hook, abi: parseAbi(['function state() view returns ((uint8 lifecycle,uint8 mode,bool closedLatched,uint64 closureNonce,uint64 reopenCandidateAt,uint64 oldValidUntil,uint64[2] reopenBaseObservations,uint64[2] lastOpenObservations,uint64 pauseNonce,uint64 bellStart,uint64 corporateUntil))']), functionName: 'state' });
validateMainnetSwapPreflight({
  poolLive: Number(liveState.lifecycle) === 2,
  canSwap: policy.canSwap,
  reasonBits: policy.reasonBits,
  policyMode: policy.mode,
  inputBalance: beforeIn,
  amount,
  remainingGross,
  rollingRemaining: swapPolicy.rollingRemaining[zeroForOne ? 0 : 1],
  minAmountOut,
  nativeBalance: await publicClient.getBalance({ address: account.address }),
  useNativeInput,
});
const quoteUrl = arg('quote-url', env.BELL_QUOTE_SERVICE_URL);
let oracleUpdates = [];
if (quoteUrl) {
  const assetQueue = JSON.parse(readFileSync(env.BELL_MAINNET_ASSET_QUEUE || 'evidence/deploy/mainnet-4663-asset-queue.json', 'utf8'));
  const pair = resolveOraclePair({ stock: stockArg ?? pool.stockSymbol, counterasset: counterArg, assetQueue });
  validateOraclePoolPair(pair, poolConfig);
  oracleUpdates = await fetchPoolOracleUpdates({ pair, quoteUrl });
}
const request = buildMainnetSwapRequest({
  hook: pool.hook, zeroForOne, amountIn: amount, minAmountOut, recipient: account.address,
  nonce, deadline: block.timestamp + 600n, expectedConfigHash: configHash,
  token0: pool.token0, token1: pool.token1, weth: manifest.weth, now: block.timestamp,
  useNativeInput, oracleUpdates,
});
const poolLiveCode = await publicClient.getBytecode({ address: pool.hook });
if (!poolLiveCode || poolLiveCode === '0x') throw new Error(`pool hook ${pool.hook} has no code`);
if (!broadcast) {
  await publicClient.simulateContract({ address: manifest.router, abi: ROUTER_ABI, functionName: 'swap', args: [request], account, value: useNativeInput ? amount : 0n });
  console.log(JSON.stringify({ mode: 'PLAN_ONLY', chainId, stock: pool.stockSymbol, counterasset: pool.counterasset, poolId: pool.poolId, amount: amount.toString(), minAmountOut: minAmountOut.toString(), note: 'simulation passed; no transaction sent' }, null, 2));
  console.log('No transaction sent. Add --broadcast --i-authorize-spend only after reviewing.');
  process.exit(0);
}

validateSwapBroadcastAuthorization({
  broadcast,
  authorized: process.argv.includes('--i-authorize-spend'),
  pairLabel: `${pool.stockSymbol}/${pool.counterasset}`,
  amount,
  minAmountOut,
});

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
