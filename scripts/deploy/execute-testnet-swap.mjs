#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEther, stringToHex, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';
import { signYahooSourceSample } from '../../packages/protocol/src/yahoo-attestation.mjs';
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };
import SessionArtifact from '../../contracts/out/SessionRegistry.sol/SessionRegistry.json' with { type: 'json' };
import SwapExecutorArtifact from '../../contracts/out/TestnetSwapExecutor.sol/TestnetSwapExecutor.json' with { type: 'json' };

const ZERO32 = '0x' + '0'.repeat(64);

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_TESTNET_RPC_PRIMARY;
const deployerPk = env.DEPLOYER_PRIVATE_KEY;
const reporterPk = env.YAHOO_REPORTER_PRIVATE_KEY;

if (!rpcUrl || !deployerPk || !reporterPk) throw new Error('Missing keys in .env');

const poolCreated = JSON.parse(readFileSync('evidence/deploy/testnet-pool-created.json', 'utf8'));
const stockAdapters = JSON.parse(readFileSync('evidence/deploy/testnet-stock-adapters.json', 'utf8'));
const assetQueue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));

const { hook: hookAddress, poolId, token0, token1 } = poolCreated;
const { directAdapter, regularWireHash, directWireHash, regularWire } = stockAdapters;
const stockAssetId = assetQueue.stock.descriptorId;

const account = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || '0x20a066123c260bc6c5253f75e261c5056fde4bea';
const sessionRegistry = TESTNET.contracts.sessionRegistry;
const poolManager = TESTNET.contracts.poolManager;

console.log('=== Onchain Swap Execution Runner ===');
console.log('Hook:         ', hookAddress);
console.log('Pool ID:      ', poolId);
console.log('PoolManager:  ', poolManager);
console.log('Token0:       ', token0);
console.log('Token1:       ', token1);

const HOOK_ABI = parseAbi([
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] effectiveTradeCap, uint128[2] effectiveWindowCap, uint128[2] rollingRemaining, uint128[2] closureRemaining, uint128[2] referencePrice18, uint64 validUntil, uint64 closureNonce, bytes32 configHash, bytes32 stateHash))',
  'function refreshState() external returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] effectiveTradeCap, uint128[2] effectiveWindowCap, uint128[2] rollingRemaining, uint128[2] closureRemaining, uint128[2] referencePrice18, uint64 validUntil, uint64 closureNonce, bytes32 configHash, bytes32 stateHash))',
  'function buckets() view returns ((uint64 epoch, uint128[2] currentGross, uint128[2] previousGross))',
  'function state() view returns ((uint8 lifecycle, uint8 mode, bool closedLatched, uint64 closureNonce, uint64 reopenCandidateAt, uint64 oldValidUntil, uint64[2] reopenBaseObservations, uint64[2] lastOpenObservations, uint64 pauseNonce, uint64 bellStart, uint64 corporateUntil))',
]);

async function publishQuote(label) {
  const b = await publicClient.getBlock();
  const t = Number(b.timestamp);
  const price18 = parseEther('250.00');

  const sDirect = {
    descriptorId: ZERO32, feedId: ZERO32, phase: 0, price18,
    observedAt: BigInt(t), inputAt: BigInt(t), validFrom: BigInt(t),
    expiresAt: BigInt(t + 300), validUntil: BigInt(t + 120),
    reportHash: keccak256(stringToHex(`aapl-direct-swap-${label}-${t}`)),
  };
  const sigDirect = await signYahooSourceSample(sDirect, {
    sourceConfigHash: directWireHash, chainId, verifier, privateKey: reporterPk,
  });
  await walletClient.writeContract({
    address: directAdapter, abi: YahooAdapterArtifact.abi, functionName: 'publishDirect',
    args: [sDirect, sigDirect.signature],
  });

  const sStream = {
    descriptorId: ZERO32, feedId: regularWire.feedId, phase: 2, price18,
    observedAt: BigInt(t), inputAt: BigInt(t), validFrom: BigInt(t),
    expiresAt: BigInt(t + 300), validUntil: BigInt(t + 120),
    reportHash: keccak256(stringToHex(`aapl-stream-swap-${label}-${t}`)),
  };
  const sigStream = await signYahooSourceSample(sStream, {
    sourceConfigHash: regularWireHash, chainId, verifier, privateKey: reporterPk,
  });
  const txSub = await walletClient.writeContract({
    address: sessionRegistry, abi: SessionArtifact.abi, functionName: 'submitReports',
    args: [stockAssetId, [sigStream.report]],
  });
  await publicClient.waitForTransactionReceipt({ hash: txSub });

  const txRef = await walletClient.writeContract({
    address: sessionRegistry, abi: SessionArtifact.abi, functionName: 'refreshHealth',
    args: [stockAssetId],
  });
  await publicClient.waitForTransactionReceipt({ hash: txRef });

  const h = await publicClient.readContract({
    address: sessionRegistry, abi: SessionArtifact.abi, functionName: 'health',
    args: [stockAssetId],
  });
  console.log(`[Quote ${label}] Time ${t} HealthySince ${h.healthySince} ValidUntil ${h.validUntil} LatestObs ${h.latestObservation}`);
  return { now: t, health: h };
}

// Phase A: Publish Quote 1 and Start Candidate
console.log('\n--- Step A: Publishing Quote 1 & Starting Recovery Candidate ---');
await publishQuote('Q1');

console.log('Checkpointing state to start recovery candidate...');
const startCandidateTx = await walletClient.writeContract({
  address: hookAddress,
  abi: HOOK_ABI,
  functionName: 'refreshState',
});
await publicClient.waitForTransactionReceipt({ hash: startCandidateTx });

const stateA = await publicClient.readContract({ address: hookAddress, abi: HOOK_ABI, functionName: 'state' });
console.log('Candidate started at timestamp:', stateA.reopenCandidateAt.toString());

// Phase B: Wait 30s and Publish Quote 2 (Advances Observation!)
console.log('\n--- Step B: Waiting 30s and Publishing Advancing Quote 2 ---');
await new Promise((r) => setTimeout(r, 30000));
try { await walletClient.sendTransaction({ to: account.address, value: 0n }); } catch {}

await publishQuote('Q2');

console.log('Checkpointing Q2 validity on hook...');
const updateValidityTx = await walletClient.writeContract({
  address: hookAddress,
  abi: HOOK_ABI,
  functionName: 'refreshState',
});
await publicClient.waitForTransactionReceipt({ hash: updateValidityTx });
const stateB = await publicClient.readContract({ address: hookAddress, abi: HOOK_ABI, functionName: 'state' });
console.log('Hook state after Q2: oldValidUntil =', stateB.oldValidUntil.toString(), 'candidateAt =', stateB.reopenCandidateAt.toString());

// Phase C: Wait until timestamp >= reopenCandidateAt + 65s
const candidateStart = Number(stateA.reopenCandidateAt);
const targetClearTime = candidateStart + 65;
console.log(`\n--- Step C: Waiting for chain time ${targetClearTime} (65s after candidate start) ---`);
while (true) {
  const b = await publicClient.getBlock();
  const cur = Number(b.timestamp);
  console.log(`Chain time: ${cur} (target: ${targetClearTime})`);
  if (cur >= targetClearTime) break;
  try {
    const bump = await walletClient.sendTransaction({ to: account.address, value: 0n });
    await publicClient.waitForTransactionReceipt({ hash: bump });
  } catch {}
  await new Promise((r) => setTimeout(r, 3000));
}

// Phase D: Complete Recovery!
console.log('\n--- Step D: Completing Recovery on Hook ---');
const completeRecoveryTx = await walletClient.writeContract({
  address: hookAddress,
  abi: HOOK_ABI,
  functionName: 'refreshState',
});
await publicClient.waitForTransactionReceipt({ hash: completeRecoveryTx });

const policy = await publicClient.readContract({
  address: hookAddress,
  abi: HOOK_ABI,
  functionName: 'getPolicy',
});

console.log('Hook Policy after recovery completion:', {
  mode: policy.mode,
  canSwap: policy.canSwap,
  phase: policy.phase,
  reasonBits: policy.reasonBits.toString(),
  rollingRemaining: policy.rollingRemaining,
});

if (!policy.canSwap || policy.mode !== 1) {
  throw new Error(`canSwap is NOT true! mode=${policy.mode}, reasonBits=${policy.reasonBits}`);
}

console.log('\n>>> POOL IS ACTIVE AND READY FOR SWAP! <<<');

// Phase E: Deploy Swap Executor & Execute Swap!
console.log('\n--- Step E: Deploying Swap Executor & Executing First Swap ---');
const deployExecutorTx = await walletClient.deployContract({
  abi: SwapExecutorArtifact.abi,
  bytecode: SwapExecutorArtifact.bytecode.object,
  args: [poolManager],
});
const executorReceipt = await publicClient.waitForTransactionReceipt({ hash: deployExecutorTx });
const executorAddress = executorReceipt.contractAddress;
console.log('TestnetSwapExecutor deployed at:', executorAddress);

// Approve Token0 to Executor
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);
const appTx = await walletClient.writeContract({
  address: token0,
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [executorAddress, maxUint256],
});
await publicClient.waitForTransactionReceipt({ hash: appTx });

const bal0Before = await publicClient.readContract({
  address: token0, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
});
const bal1Before = await publicClient.readContract({
  address: token1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
});
console.log('Balances Before Swap:');
console.log('  Token0:', bal0Before.toString());
console.log('  Token1:', bal1Before.toString());

const poolKey = {
  currency0: token0,
  currency1: token1,
  fee: 0x800000,
  tickSpacing: 60,
  hooks: hookAddress,
};

// Swap 5 raw units of token0 for token1
const swapAmount = -5n;
console.log(`\nExecuting swap: selling 5 units of Token0 (${token0}) for Token1 (${token1})...`);
const swapTx = await walletClient.writeContract({
  address: executorAddress,
  abi: SwapExecutorArtifact.abi,
  functionName: 'executeSwap',
  args: [poolKey, true, swapAmount],
});
console.log('Swap transaction broadcasted! Hash:', swapTx);
const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapTx });
console.log('Swap confirmed in block', swapReceipt.blockNumber.toString(), 'status:', swapReceipt.status);

if (swapReceipt.status !== 'success') throw new Error('Swap transaction reverted!');

// Phase F: Verify State Changes Onchain
const bal0After = await publicClient.readContract({
  address: token0, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
});
const bal1After = await publicClient.readContract({
  address: token1, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
});

const hookBuckets = await publicClient.readContract({
  address: hookAddress, abi: HOOK_ABI, functionName: 'buckets',
});
const policyAfter = await publicClient.readContract({
  address: hookAddress, abi: HOOK_ABI, functionName: 'getPolicy',
});

console.log('\n========================================');
console.log('        ONCHAIN SWAP VERIFICATION       ');
console.log('========================================');
console.log('Spent Token0:          ', (bal0Before - bal0After).toString());
console.log('Received Token1:       ', (bal1After - bal1Before).toString());
console.log('Hook Current Gross:    ', hookBuckets.currentGross.map(x=>x.toString()));
console.log('Remaining Rolling Cap: ', policyAfter.rollingRemaining.map(x=>x.toString()));

const swapEvidence = {
  swapTx,
  blockNumber: Number(swapReceipt.blockNumber),
  hookAddress,
  poolId,
  executorAddress,
  token0,
  token1,
  spentToken0: (bal0Before - bal0After).toString(),
  receivedToken1: (bal1After - bal1Before).toString(),
  currentGross: [hookBuckets.currentGross[0].toString(), hookBuckets.currentGross[1].toString()],
  remainingCap: [policyAfter.rollingRemaining[0].toString(), policyAfter.rollingRemaining[1].toString()],
  executedAt: new Date().toISOString(),
};

writeFileSync('evidence/deploy/testnet-swap-executed.json', JSON.stringify(swapEvidence, null, 2) + '\n');
console.log('\n>>> SUCCESS! FIRST LIVE ONCHAIN SWAP EXECUTED AND BUDGET COMMITTED ON ROBINHOOD TESTNET! <<<');
