#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEther, stringToHex, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TESTNET } from '../../packages/protocol/src/testnet-status.mjs';
import { mineHookSalt } from '../../scripts/tooling/mine-hook-salt.mjs';
import { signYahooSourceSample } from '../../packages/protocol/src/yahoo-attestation.mjs';
import YahooAdapterArtifact from '../../contracts/out/YahooAttestedSourceAdapter.sol/YahooAttestedSourceAdapter.json' with { type: 'json' };
import SessionArtifact from '../../contracts/out/SessionRegistry.sol/SessionRegistry.json' with { type: 'json' };

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

if (!rpcUrl || !deployerPk || !reporterPk) throw new Error('Missing keys');

const stockAdapters = JSON.parse(readFileSync('evidence/deploy/testnet-stock-adapters.json', 'utf8'));
const assetQueue = JSON.parse(readFileSync('evidence/deploy/testnet-46630-asset-queue.json', 'utf8'));

const { stockToken, directAdapter, regularWireHash, directWireHash, regularWire } = stockAdapters;
const stockAssetId = assetQueue.stock.descriptorId;
const wethAssetId = assetQueue.weth.descriptorId;
const wethAddress = TESTNET.contracts.weth;
const factoryAddress = TESTNET.contracts.poolFactory;
const hookDeployerAddress = TESTNET.contracts.hookDeployer;
const feeTokenAddress = TESTNET.contracts.feeToken;
const sessionRegistry = TESTNET.contracts.sessionRegistry;
const verifier = env.YAHOO_SOURCE_VERIFIER_ADDRESS || '0x20a066123c260bc6c5253f75e261c5056fde4bea';

const account = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`);
const reporter = privateKeyToAccount(reporterPk.startsWith('0x') ? reporterPk : `0x${reporterPk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();

console.log('Deployer:      ', account.address);
console.log('Factory:       ', factoryAddress);
console.log('StockToken:    ', stockToken);
console.log('WETH:          ', wethAddress);

async function publishFreshQuote(label) {
  const b = await publicClient.getBlock();
  const t = Number(b.timestamp);
  const price18 = parseEther('250.00');

  const sDirect = {
    descriptorId: ZERO32,
    feedId: ZERO32,
    phase: 0,
    price18,
    observedAt: BigInt(t),
    inputAt: BigInt(t),
    validFrom: BigInt(t),
    expiresAt: BigInt(t + 300),
    validUntil: BigInt(t + 120),
    reportHash: keccak256(stringToHex(`aapl-direct-${label}-${t}`)),
  };
  const sigDirect = await signYahooSourceSample(sDirect, {
    sourceConfigHash: directWireHash, chainId, verifier, privateKey: reporterPk,
  });
  const tx1 = await walletClient.writeContract({
    address: directAdapter, abi: YahooAdapterArtifact.abi, functionName: 'publishDirect',
    args: [sDirect, sigDirect.signature],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx1 });

  const sStream = {
    descriptorId: ZERO32,
    feedId: regularWire.feedId,
    phase: 2,
    price18,
    observedAt: BigInt(t),
    inputAt: BigInt(t),
    validFrom: BigInt(t),
    expiresAt: BigInt(t + 300),
    validUntil: BigInt(t + 120),
    reportHash: keccak256(stringToHex(`aapl-stream-${label}-${t}`)),
  };
  const sigStream = await signYahooSourceSample(sStream, {
    sourceConfigHash: regularWireHash, chainId, verifier, privateKey: reporterPk,
  });
  const tx2 = await walletClient.writeContract({
    address: sessionRegistry, abi: SessionArtifact.abi, functionName: 'submitReports',
    args: [stockAssetId, [sigStream.report]],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx2 });

  const tx3 = await walletClient.writeContract({
    address: sessionRegistry, abi: SessionArtifact.abi, functionName: 'refreshHealth',
    args: [stockAssetId],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx3 });

  const h = await publicClient.readContract({
    address: sessionRegistry, abi: SessionArtifact.abi, functionName: 'health',
    args: [stockAssetId],
  });
  console.log(`[Quote ${label}] Block ${b.number} Time ${t}:`, {
    ready: h.ready,
    reasonBits: h.reasonBits.toString(),
    healthySince: h.healthySince.toString(),
    validUntil: h.validUntil.toString(),
  });
  return { now: t, health: h };
}

// 1. Establish initial health
console.log('\n=== Step 1: Establishing Health Baseline ===');
const { health: h1 } = await publishFreshQuote('T0');
const baselineHealthySince = Number(h1.healthySince);

// 2. Wait 30s and publish second quote to extend validUntil while preserving healthySince
console.log('\nWaiting 30 seconds before renewing quote...');
await new Promise((r) => setTimeout(r, 30000));
try {
  await walletClient.sendTransaction({ to: account.address, value: 0n });
} catch {}

console.log('\n=== Step 2: Renewing Quote (Extending validUntil) ===');
const { health: h2 } = await publishFreshQuote('T30');
if (Number(h2.healthySince) !== baselineHealthySince) {
  console.warn('healthySince moved! New healthySince:', h2.healthySince.toString());
}

// 3. Wait until chain time >= baselineHealthySince + 65s (now validUntil has ~55s left)
const targetTime = Number(h2.healthySince) + 65;
console.log(`\nWaiting until chain time reaches ${targetTime} (65s healthy, validUntil is ${h2.validUntil})...`);
while (true) {
  const b = await publicClient.getBlock();
  const cur = Number(b.timestamp);
  if (cur >= targetTime) {
    console.log(`Ready! Chain time: ${cur} >= ${targetTime}. Remaining validity: ${Number(h2.validUntil) - cur}s`);
    break;
  }
  try {
    const bump = await walletClient.sendTransaction({ to: account.address, value: 0n });
    await publicClient.waitForTransactionReceipt({ hash: bump });
  } catch {}
  await new Promise((r) => setTimeout(r, 3000));
}

// 4. Create and Seed Pool
console.log('\n=== Step 3: Pool Creation & Seeding ===');
const [token0, token1] = stockToken.toLowerCase() < wethAddress.toLowerCase()
  ? [stockToken, wethAddress]
  : [wethAddress, stockToken];
const [asset0, asset1] = stockToken.toLowerCase() < wethAddress.toLowerCase()
  ? [stockAssetId, wethAssetId]
  : [wethAssetId, stockAssetId];

const config = {
  token0,
  token1,
  asset0,
  asset1,
  poolManager: TESTNET.contracts.poolManager,
  positionManager: TESTNET.contracts.positionManager,
  factory: factoryAddress,
  assetRegistry: TESTNET.contracts.assetRegistry,
  calendarRegistry: TESTNET.contracts.calendarRegistry,
  safetyController: TESTNET.contracts.safetyController,
  treasuryAdapter: '0x0000000000000000000000000000000000000000',
  poolClass: 1, // SESSION_ONLY
  liquidityMode: 0, // PUBLIC
  referenceMode: 0,
  tickSpacing: 60,
  tradeCap: [10n, 10n],
  windowCap: [100n, 100n],
  closureCap: [1n, 1n],
  policyId: keccak256(stringToHex('bell-testnet-v1')),
};

const key = {
  currency0: token0,
  currency1: token1,
  fee: 0x800000,
  tickSpacing: 60,
  hooks: '0x0000000000000000000000000000000000000000',
};

const DEPLOYER_ABI = parseAbi([
  'function initCodeHash((address token0, address token1, bytes32 asset0, bytes32 asset1, address poolManager, address positionManager, address factory, address assetRegistry, address calendarRegistry, address safetyController, address treasuryAdapter, uint8 poolClass, uint8 liquidityMode, uint8 referenceMode, int24 tickSpacing, uint128[2] tradeCap, uint128[2] windowCap, uint128[2] closureCap, bytes32 policyId) config, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key) view returns (bytes32)',
]);
const FACTORY_ABI = parseAbi([
  'function nonces(address) view returns (uint64)',
  'function createAndSeed(((address token0, address token1, bytes32 asset0, bytes32 asset1, address poolManager, address positionManager, address factory, address assetRegistry, address calendarRegistry, address safetyController, address treasuryAdapter, uint8 poolClass, uint8 liquidityMode, uint8 referenceMode, int24 tickSpacing, uint128[2] tradeCap, uint128[2] windowCap, uint128[2] closureCap, bytes32 policyId) config, bytes32 salt, uint64 nonce, uint64 deadline, address recipient, uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, uint128 liquidity, uint128[2] amountMax, uint128 maxServiceFee) request) external returns ((address hook, bytes32 poolId, uint256 tokenId, bytes32 positionKey, uint128 liquidity, uint128[2] principal))',
  'function predict(((address token0, address token1, bytes32 asset0, bytes32 asset1, address poolManager, address positionManager, address factory, address assetRegistry, address calendarRegistry, address safetyController, address treasuryAdapter, uint8 poolClass, uint8 liquidityMode, uint8 referenceMode, int24 tickSpacing, uint128[2] tradeCap, uint128[2] windowCap, uint128[2] closureCap, bytes32 policyId) config, bytes32 salt, uint64 nonce, uint64 deadline, address recipient, uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, uint128 liquidity, uint128[2] amountMax, uint128 maxServiceFee) request) view returns (address hook, bytes32 poolId, bytes32 requestHash)',
]);

const initCodeHash = await publicClient.readContract({
  address: hookDeployerAddress,
  abi: DEPLOYER_ABI,
  functionName: 'initCodeHash',
  args: [config, key],
});

const nonce = await publicClient.readContract({
  address: factoryAddress,
  abi: FACTORY_ABI,
  functionName: 'nonces',
  args: [account.address],
});

console.log('Mining hook salt for deployer nonce', nonce.toString(), '...');
const mined = mineHookSalt({
  chainId: BigInt(chainId),
  factory: factoryAddress,
  creator: account.address,
  deployer: hookDeployerAddress,
  nonce: BigInt(nonce),
  baseSalt: '0x0000000000000000000000000000000000000000000000000000000000000001',
  initCodeHash,
  maxAttempts: 200_000,
});
console.log('Mined hook:', mined.hook, 'salt:', mined.requestSalt);

const blockEnd = await publicClient.getBlock();
const deadline = BigInt(Number(blockEnd.timestamp) + 1200);

const request = {
  config,
  salt: mined.requestSalt,
  nonce,
  deadline,
  recipient: account.address,
  sqrtPriceX96: 79228162514264337593543950336n,
  tickLower: -6000,
  tickUpper: 6000,
  liquidity: 1000000000000000n,
  amountMax: [parseEther('1000'), parseEther('0.0004')],
  maxServiceFee: 49000000n,
};

console.log('Broadcasting createAndSeed...');
const createTx = await walletClient.writeContract({
  address: factoryAddress,
  abi: FACTORY_ABI,
  functionName: 'createAndSeed',
  args: [request],
});
console.log('TX sent:', createTx);
const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
console.log('createAndSeed mined in block', receipt.blockNumber.toString(), 'status:', receipt.status);

if (receipt.status !== 'success') throw new Error('createAndSeed reverted onchain');

const predicted = await publicClient.readContract({
  address: factoryAddress,
  abi: FACTORY_ABI,
  functionName: 'predict',
  args: [request],
});

const hookAddress = predicted[0];
const poolId = predicted[1];

const HOOK_ABI = parseAbi([
  'function getPolicy() view returns ((bool canSwap, uint8 mode, uint8 phase, uint16 flags, uint256 reasonBits, uint24 lpFeeUnits, uint16 bandBps, uint128[2] effectiveTradeCap, uint128[2] effectiveWindowCap, uint128[2] rollingRemaining, uint128[2] closureRemaining, uint128[2] referencePrice18, uint64 validUntil, uint64 closureNonce, bytes32 configHash, bytes32 stateHash))',
  'function state() view returns ((uint8 lifecycle, uint8 mode, bool closedLatched, uint64 closureNonce, uint64 reopenCandidateAt, uint64 oldValidUntil, uint64[2] reopenBaseObservations, uint64[2] lastOpenObservations, uint64 pauseNonce, uint64 bellStart, uint64 corporateUntil))',
]);

const hookPolicy = await publicClient.readContract({
  address: hookAddress,
  abi: HOOK_ABI,
  functionName: 'getPolicy',
});

const hookState = await publicClient.readContract({
  address: hookAddress,
  abi: HOOK_ABI,
  functionName: 'state',
});

console.log('\n========================================');
console.log('       LIVE POOL DEPLOYMENT RECORD       ');
console.log('========================================');
console.log('Hook Address: ', hookAddress);
console.log('Pool ID:      ', poolId);
console.log('Lifecycle:    ', hookState.lifecycle, '(2 = LIVE)');
console.log('Mode:         ', hookPolicy.mode, '(1 = ACTIVE)');
console.log('CanSwap:      ', hookPolicy.canSwap);
console.log('Phase:        ', hookPolicy.phase, '(2 = REGULAR)');
console.log('LPFeeUnits:   ', hookPolicy.lpFeeUnits);

const poolEvidence = {
  hook: hookAddress,
  poolId,
  createTx,
  blockNumber: Number(receipt.blockNumber),
  token0,
  token1,
  asset0,
  asset1,
  canSwap: hookPolicy.canSwap,
  mode: hookPolicy.mode,
  lpFeeUnits: hookPolicy.lpFeeUnits,
  createdAt: new Date().toISOString(),
};

writeFileSync('evidence/deploy/testnet-pool-created.json', JSON.stringify(poolEvidence, null, 2) + '\n');
console.log('\n>>> SUCCESS! FIRST LIVE BELL POOL IS CREATED, SEEDED AND LIVE ON TESTNET! <<<');
