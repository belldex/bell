#!/usr/bin/env node
/**
 * Swap against an already-live pool. Unlike execute-testnet-swap.mjs this does not run the
 * activation dance: it assumes the keeper is keeping the pool tradable and just swaps.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import SwapExecutorArtifact from '../../contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json' with { type: 'json' };
import { resolveSessionRegistry } from './keeper-price-config.mjs';

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
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.DEPLOYER_PRIVATE_KEY : `0x${env.DEPLOYER_PRIVATE_KEY}`);
const publicClient = createPublicClient({ transport: http(env.RH_TESTNET_RPC_PRIMARY) });
const walletClient = createWalletClient({ account, transport: http(env.RH_TESTNET_RPC_PRIMARY) });

const pool = JSON.parse(readFileSync('evidence/deploy/testnet-pool-created.json', 'utf8'));
const manifest = JSON.parse(readFileSync('evidence/deploy/testnet-46630.json', 'utf8'));
const previousSwapEvidence = JSON.parse(readFileSync('evidence/deploy/testnet-swap-keeper.json', 'utf8'));
const samePool = previousSwapEvidence.poolId?.toLowerCase() === pool.poolId.toLowerCase();
const deploymentQueue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));
const adapters = JSON.parse(readFileSync('evidence/deploy/testnet-stock-adapters.json', 'utf8'));
const sessionRegistry = resolveSessionRegistry(env, manifest);
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || adapters.verifier || '0x20a066123c260bc6c5253f75e261c5056fde4bea';
const amount = BigInt(arg('amount', '-5'));
const zeroForOne = arg('zeroForOne', 'true') === 'true';

const HOOK_ABI = parseAbi([
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] a, uint128[2] b, uint128[2] c, uint128[2] d, uint128[2] e, uint64 f, uint64 g, bytes32 h, bytes32 i))',
  'function buckets() view returns ((uint64 epoch, uint128[2] currentGross, uint128[2] previousGross))',
]);

// Pool status is the policy at verification time, not a timeless property of the creation receipt.
// Refresh the report from rehearsal input only when explicitly requested; never pretend it is Yahoo data.
if (process.argv.includes('--refresh-offline')) {
  const { signYahooSourceSample } = await import('../../packages/protocol/src/yahoo-attestation.mjs');
  const { keccak256, stringToHex } = await import('viem');
  const reporterPk = env.YAHOO_REPORTER_PRIVATE_KEY;
  if (!reporterPk) throw new Error('YAHOO_REPORTER_PRIVATE_KEY required for --refresh-offline');
  const block = await publicClient.getBlock();
  const now = Number(block.timestamp);
  const chainId = await publicClient.getChainId();
  const price18 = 250n * 10n ** 18n;
  const common = {
    descriptorId: `0x${'0'.repeat(64)}`,
    phase: 2,
    price18,
    observedAt: BigInt(now),
    inputAt: BigInt(now),
    validFrom: BigInt(now),
    expiresAt: BigInt(now + 300),
    validUntil: BigInt(now + 119),
  };
  const stream = {
    ...common,
    feedId: adapters.regularWire.feedId,
    reportHash: keccak256(stringToHex(`bell-swap-offline-${now}-${price18}`)),
  };
  const signed = await signYahooSourceSample(stream, {
    sourceConfigHash: adapters.regularWireHash,
    chainId,
    verifier,
    privateKey: reporterPk,
  });
  const directSample = {
    ...common,
    phase: 0,
    feedId: `0x${'0'.repeat(64)}`,
    reportHash: keccak256(stringToHex(`bell-swap-direct-offline-${now}-${price18}`)),
  };
  const directSigned = await signYahooSourceSample(directSample, {
    sourceConfigHash: adapters.directWireHash,
    chainId,
    verifier,
    privateKey: reporterPk,
  });
  const submitTx = await walletClient.writeContract({ address: adapters.directAdapter, abi: (await import('../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json', { with: { type: 'json' } })).default.abi, functionName: 'publishDirect', args: [directSample, directSigned.signature] });
  const submitRc = await publicClient.waitForTransactionReceipt({ hash: submitTx });
  if (submitRc.status !== 'success') throw new Error('Offline direct rehearsal report failed');
  const reportTx = await walletClient.writeContract({ address: sessionRegistry, abi: (await import('../../contracts/out/SessionRegistry.sol/SessionRegistry.json', { with: { type: 'json' } })).default.abi, functionName: 'submitReports', args: [deploymentQueue.stock.descriptorId, [signed.report]] });
  if ((await publicClient.waitForTransactionReceipt({ hash: reportTx })).status !== 'success') throw new Error('Offline session report failed');
  const healthTx = await walletClient.writeContract({ address: sessionRegistry, abi: (await import('../../contracts/out/SessionRegistry.sol/SessionRegistry.json', { with: { type: 'json' } })).default.abi, functionName: 'refreshHealth', args: [deploymentQueue.stock.descriptorId] });
  if ((await publicClient.waitForTransactionReceipt({ hash: healthTx })).status !== 'success') throw new Error('Offline health refresh failed');
  const refreshTx = await walletClient.writeContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'refreshState' });
  if ((await publicClient.waitForTransactionReceipt({ hash: refreshTx })).status !== 'success') throw new Error('Hook checkpoint failed');
}

const policy = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'getPolicy' });
console.log('Policy before swap:', { canSwap: policy.canSwap, mode: policy.mode, reasonBits: policy.reasonBits.toString() });
if (!policy.canSwap) {
  throw new Error('Pool is not swappable right now; the keeper must refresh the session first');
}

const executorTx = await walletClient.deployContract({
  abi: SwapExecutorArtifact.abi,
  bytecode: SwapExecutorArtifact.bytecode.object,
  args: [manifest.poolManager],
});
const executorRc = await publicClient.waitForTransactionReceipt({ hash: executorTx });
const executor = executorRc.contractAddress;
console.log('Executor:', executor);

const ERC20_ABI = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);
const tokenIn = zeroForOne ? pool.token0 : pool.token1;
const tokenOut = zeroForOne ? pool.token1 : pool.token0;

await publicClient.waitForTransactionReceipt({
  hash: await walletClient.writeContract({ address: tokenIn, abi: ERC20_ABI, functionName: 'approve', args: [executor, maxUint256] }),
});

const beforeIn = await publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
const beforeOut = await publicClient.readContract({ address: tokenOut, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
const bucketsBefore = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'buckets' });

const swapTx = await walletClient.writeContract({
  address: executor,
  abi: SwapExecutorArtifact.abi,
  functionName: 'executeSwap',
  args: [{ currency0: pool.token0, currency1: pool.token1, fee: 0x800000, tickSpacing: 60, hooks: pool.hook }, zeroForOne, amount],
});
const rc = await publicClient.waitForTransactionReceipt({ hash: swapTx });
if (rc.status !== 'success') throw new Error('swap reverted');

const afterIn = await publicClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
const afterOut = await publicClient.readContract({ address: tokenOut, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
const bucketsAfter = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'buckets' });
const policyAfter = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'getPolicy' });
const remaining = [policyAfter.c, policyAfter.d];

console.log('\nSwap confirmed:', swapTx, 'block', rc.blockNumber.toString());
console.log('  spent   :', (beforeIn - afterIn).toString());
console.log('  received:', (afterOut - beforeOut).toString());
console.log('  gross before:', bucketsBefore.currentGross.map(String), 'prev:', bucketsBefore.previousGross.map(String));
console.log('  gross after :', bucketsAfter.currentGross.map(String), 'prev:', bucketsAfter.previousGross.map(String));
console.log('  rolling remaining:', remaining.map((x) => String(x)));

writeFileSync('evidence/deploy/testnet-swap-keeper.json', JSON.stringify({
  swapTx,
  blockNumber: Number(rc.blockNumber),
  hook: pool.hook,
  poolId: pool.poolId,
  zeroForOne,
  spent: (beforeIn - afterIn).toString(),
  received: (afterOut - beforeOut).toString(),
  grossBefore: bucketsBefore.currentGross.map(String),
  previousSwap: samePool ? previousSwapEvidence : null,
  grossAfter: bucketsAfter.currentGross.map(String),
  remaining: remaining.map((x) => String(x)),
  at: new Date().toISOString(),
}, null, 2) + '\n');
console.log('\nSaved evidence/deploy/testnet-swap-keeper.json');
