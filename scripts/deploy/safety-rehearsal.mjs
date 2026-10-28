#!/usr/bin/env node
/**
 * Safety-path rehearsal: prove the emergency controls actually stop and restart trading on a live pool.
 *
 * Sequence (all onchain, all verified):
 *   1. confirm the pool is tradable
 *   2. guardian pauses the pool -> getPolicy().canSwap must go false immediately
 *   3. a swap attempt must revert
 *   4. guardian un-pauses -> after the recovery window the pool must become tradable again
 *   5. a real swap succeeds again
 *
 * This is the difference between "the hook has a pause flag" and "pulling the brake actually stops
 * the car". It has never been exercised on a live pool before.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import SwapExecutorArtifact from '../../contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json' with { type: 'json' };
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';

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
const HOOK = pool.hook;
const SAFETY = TESTNET.contracts.safetyController;

const HOOK_ABI = parseAbi([
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] a, uint128[2] b, uint128[2] c, uint128[2] d, uint128[2] e, uint64 f, uint64 g, bytes32 h, bytes32 i))',
  'function refreshState() external returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] a, uint128[2] b, uint128[2] c, uint128[2] d, uint128[2] e, uint64 f, uint64 g, bytes32 h, bytes32 i))',
  'function buckets() view returns ((uint64 epoch, uint128[2] currentGross, uint128[2] previousGross))',
]);
const SAFETY_ABI = parseAbi([
  'function pausePool(address hook) external',
  'function unpausePool(address hook) external',
  'function pauseState(bytes32 target) view returns (bool paused, uint64 nonce)',
]);
const ERC20_ABI = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);

async function policy() {
  return publicClient.readContract({ address: HOOK, abi: HOOK_ABI, functionName: 'getPolicy' });
}
async function commit() {
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({ address: HOOK, abi: HOOK_ABI, functionName: 'refreshState' }),
  });
  return publicClient.readContract({ address: HOOK, abi: HOOK_ABI, functionName: 'getPolicy' });
}
async function attemptSwap(label, expectSuccess) {
  // Executor is deployed per run to keep the rehearsal self-contained.
  const deployTx = await walletClient.deployContract({
    abi: SwapExecutorArtifact.abi,
    bytecode: SwapExecutorArtifact.bytecode.object,
    args: [TESTNET.contracts.poolManager],
  });
  const rc = await publicClient.waitForTransactionReceipt({ hash: deployTx });
  const executor = rc.contractAddress;
  await publicClient.waitForTransactionReceipt({
    hash: await walletClient.writeContract({
      address: pool.token0, abi: ERC20_ABI, functionName: 'approve', args: [executor, maxUint256],
    }),
  });
  let swapHash;
  let reverted = false;
  try {
    swapHash = await walletClient.writeContract({
      address: executor,
      abi: SwapExecutorArtifact.abi,
      functionName: 'executeSwap',
      args: [{ currency0: pool.token0, currency1: pool.token1, fee: 0x800000, tickSpacing: 60, hooks: HOOK }, true, -3n],
    });
    const rc2 = await publicClient.waitForTransactionReceipt({ hash: swapHash });
    if (rc2.status !== 'success') reverted = true;
  } catch {
    reverted = true;
  }
  console.log(`  [${label}] swap attempt: ${reverted ? 'REVERTED (blocked)' : 'SUCCESS'}`);
  if (expectSuccess === reverted) {
    throw new Error(`${label}: swap outcome did not match expectation (expected success=${expectSuccess})`);
  }
  return reverted ? null : swapHash;
}

console.log('=== SAFETY-PATH REHEARSAL ON LIVE POOL ===');
console.log('hook:', HOOK, '\n');

// 1. baseline
let p = await commit();
console.log('1. baseline:', { mode: p.mode, canSwap: p.canSwap, reasons: p.reasonBits.toString() });
if (!p.canSwap) throw new Error('pool must be tradable before the rehearsal; run the keeper first');

// 2. pause
console.log('\n2. guardian pauses the pool...');
await publicClient.waitForTransactionReceipt({
  hash: await walletClient.writeContract({ address: SAFETY, abi: SAFETY_ABI, functionName: 'pausePool', args: [HOOK] }),
});
p = await commit();
console.log('   after pause:', { mode: p.mode, canSwap: p.canSwap, reasons: p.reasonBits.toString() });
if (p.canSwap) throw new Error('PAUSE DID NOT STOP TRADING — this is a critical safety failure');
if ((p.reasonBits & 1n) === 0n) throw new Error('expected MANUAL_PAUSE reason bit after pausing');

// 3. swap while paused must revert
console.log('\n3. swap attempt while paused (must be blocked)...');
await attemptSwap('paused', false);

// 4. un-pause
console.log('\n4. guardian un-pauses...');
await publicClient.waitForTransactionReceipt({
  hash: await walletClient.writeContract({ address: SAFETY, abi: SAFETY_ABI, functionName: 'unpausePool', args: [HOOK] }),
});
p = await commit();
console.log('   after un-pause:', { mode: p.mode, canSwap: p.canSwap, reasons: p.reasonBits.toString() });
if (p.canSwap) {
  console.log('   pool resumed immediately.');
} else {
  console.log('   pool entered recovery; waiting for the 60-second window...');
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15_000));
    try { await walletClient.sendTransaction({ to: account.address, value: 0n }); } catch {}
    p = await commit();
    console.log('   checkpoint:', { mode: p.mode, canSwap: p.canSwap, reasons: p.reasonBits.toString() });
    if (p.canSwap) break;
  }
  if (!p.canSwap) throw new Error('pool did not recover after un-pause');
}

// 5. real swap succeeds again
console.log('\n5. executing a real swap on the recovered pool...');
const bucketsBefore = await publicClient.readContract({ address: HOOK, abi: HOOK_ABI, functionName: 'buckets' });
const swapHash = await attemptSwap('recovered', true);
const bucketsAfter = await publicClient.readContract({ address: HOOK, abi: HOOK_ABI, functionName: 'buckets' });
console.log('   gross before:', bucketsBefore.currentGross.map(String));
console.log('   gross after :', bucketsAfter.currentGross.map(String));

writeFileSync('evidence/deploy/testnet-safety-rehearsal.json', JSON.stringify({
  hook: HOOK,
  pauseVerified: true,
  blockedWhilePaused: true,
  unpauseVerified: true,
  swapAfterRecovery: swapHash,
  grossAfter: bucketsAfter.currentGross.map(String),
  at: new Date().toISOString(),
}, null, 2) + '\n');
console.log('\n>>> SAFETY PATH PROVEN: PAUSE STOPS TRADING, UN-PAUSE RESTORES IT <<<');
