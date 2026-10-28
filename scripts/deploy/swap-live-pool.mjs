#!/usr/bin/env node
/**
 * Swap against an already-live pool. Unlike execute-testnet-swap.mjs this does not run the
 * activation dance: it assumes the keeper is keeping the pool tradable and just swaps.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import SwapExecutorArtifact from '../../contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json' with { type: 'json' };

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
const amount = BigInt(arg('amount', '-5'));
const zeroForOne = arg('zeroForOne', 'true') === 'true';

const HOOK_ABI = parseAbi([
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] a, uint128[2] b, uint128[2] c, uint128[2] d, uint128[2] e, uint64 f, uint64 g, bytes32 h, bytes32 i))',
  'function buckets() view returns ((uint64 epoch, uint128[2] currentGross, uint128[2] previousGross))',
]);

const policy = await publicClient.readContract({ address: pool.hook, abi: HOOK_ABI, functionName: 'getPolicy' });
console.log('Policy before swap:', { canSwap: policy.canSwap, mode: policy.mode, reasonBits: policy.reasonBits.toString() });
if (!policy.canSwap) {
  throw new Error('Pool is not swappable right now; the keeper must refresh the session first');
}

const executorTx = await walletClient.deployContract({
  abi: SwapExecutorArtifact.abi,
  bytecode: SwapExecutorArtifact.bytecode.object,
  args: [env.BELL_POOL_MANAGER || '0x4ddb8673ad90d4d3508c61531a981bc1f22a850b'],
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
  grossAfter: bucketsAfter.currentGross.map(String),
  remaining: remaining.map((x) => String(x)),
  at: new Date().toISOString(),
}, null, 2) + '\n');
console.log('\nSaved evidence/deploy/testnet-swap-keeper.json');
