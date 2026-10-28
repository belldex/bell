#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEther, stringToHex, maxUint256, decodeEventLog } from 'viem';
import FactoryArtifact from '../../contracts/out/BellPoolFactory.sol/BellPoolFactory.json' with { type: 'json' };
import { privateKeyToAccount } from 'viem/accounts';
import { mineHookSalt } from '../../scripts/tooling/mine-hook-salt.mjs';
import { signYahooSourceSample } from '../../packages/protocol/src/yahoo-attestation.mjs';
import { fetchYahooChartQuote } from '../../packages/protocol/src/yahoo-quote.mjs';
import { isNewYahooQuote, isPoolCreatePreflightReady, yahooWireScopeForCalendarPhase } from './keeper-price-config.mjs';
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


// Read the CURRENT deploy manifest so this script can never act on a superseded deployment.
const _manifestRaw = readFileSync(new URL('../../evidence/deploy/testnet-46630.json', import.meta.url), 'utf8');
const _manifest = JSON.parse(_manifestRaw);
const MANIFEST = Object.fromEntries(Object.entries(_manifest).map(([k, v]) => [k, String(v).toLowerCase()]));

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
const wethAddress = MANIFEST.weth;
const factoryAddress = MANIFEST.poolFactory;
const hookDeployerAddress = MANIFEST.hookDeployer;
const feeTokenAddress = MANIFEST.feeToken;
const sessionRegistry = MANIFEST.sessionRegistry;
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

async function publishFreshQuote(label, afterObservedAt = 0) {
  const calendar = await publicClient.readContract({
    address: MANIFEST.calendarRegistry,
    abi: parseAbi(['function currentInterval(bytes32) view returns ((bytes32 assetId,uint16 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))']),
    functionName: 'currentInterval',
    args: [stockAssetId],
  });
  const streamScope = yahooWireScopeForCalendarPhase(calendar.phase);
  const streamPhase = calendar.phase;
  const streamWire = streamScope === 1 ? stockAdapters.regularWire : streamScope === 2 ? stockAdapters.extendedWire : null;
  const streamWireHash = streamScope === 1 ? stockAdapters.regularWireHash : streamScope === 2 ? stockAdapters.extendedWireHash : null;
  if (!streamWire || !streamWireHash) throw new Error(`No admitted Yahoo wire for calendar phase ${calendar.phase}`);
  let directObservation = 0;
  try {
    directObservation = Number((await publicClient.readContract({ address: directAdapter, abi: YahooAdapterArtifact.abi, functionName: 'readCurrent' })).observedAt);
  } catch {}
  const highWater = Math.max(afterObservedAt, directObservation);
  let quote;
  for (;;) {
    quote = await fetchYahooChartQuote('AAPL');
    if (isNewYahooQuote(quote, calendar.phase === 1 ? 'PRE' : calendar.phase === 2 ? 'REGULAR' : 'POST', highWater, 25)) break;
    console.log(`[${label}] Waiting for a newer fresh Yahoo candle; got ${quote.phase} age=${quote.ageSeconds}s observed=${quote.observedAt}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const b = await publicClient.getBlock();
  const t = Number(b.timestamp);
  const price18 = BigInt(quote.priceRaw18);
  const observedAt = BigInt(quote.observedAt);
  const validUntil = BigInt(Math.min(Number(observedAt) + 119, t + 119));
  const inputAt = BigInt(t);

  const sDirect = {
    descriptorId: ZERO32,
    feedId: ZERO32,
    phase: 0,
    price18,
    observedAt,
    inputAt,
    validFrom: observedAt,
    expiresAt: BigInt(t + 300),
    validUntil,
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
    feedId: streamWire.feedId,
    phase: streamPhase,
    price18,
    observedAt,
    inputAt,
    validFrom: observedAt,
    expiresAt: BigInt(t + 300),
    validUntil,
    reportHash: keccak256(stringToHex(`aapl-stream-${label}-${t}`)),
  };
  const sigStream = await signYahooSourceSample(sStream, {
    sourceConfigHash: streamWireHash, chainId, verifier, privateKey: reporterPk,
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
  return { now: t, health: h, observedAt: quote.observedAt };
}

// 1. Establish initial health
console.log('\n=== Step 1: Establishing Health Baseline ===');
const { health: h1, observedAt: firstObservedAt } = await publishFreshQuote('T0');
  const baselineHealthySince = Number(h1.healthySince);
  if (!h1.ready || h1.reasonBits !== 0n) throw new Error(`Health baseline failed: ${h1.reasonBits}`);

// Poll frequently so the next minute candle extends health before its deadline.
console.log('\n=== Step 2: Renewing Quote (Extending validUntil) ===');
await new Promise((r) => setTimeout(r, 30_000));
const { health: h2 } = await publishFreshQuote('T30', firstObservedAt);
if (!h2.ready || h2.reasonBits !== 0n) throw new Error(`Health renewal failed: ${h2.reasonBits}`);
const recoverySince = Number(h2.healthySince);
if (recoverySince !== baselineHealthySince) console.log('Health continuity restarted at', recoverySince);

// Keep producing genuine later Yahoo observations until the health window covers recovery.
let latestHealth = h2;
while (Number(latestHealth.healthySince) + 65 >= Number(latestHealth.validUntil)) {
  await new Promise((r) => setTimeout(r, 15_000));
  const next = await publishFreshQuote('RECOVERY', Number((await publicClient.readContract({
    address: sessionRegistry, abi: SessionArtifact.abi, functionName: 'latestSample', args: [stockAssetId, calendar.phase],
  })).observedAt));
  latestHealth = next.health;
  if (!latestHealth.ready || latestHealth.reasonBits !== 0n) throw new Error(`Recovery refresh failed: ${latestHealth.reasonBits}`);
}

// 3. Wait until chain time >= baselineHealthySince + 65s (now validUntil has ~55s left)
const targetTime = Number(latestHealth.healthySince) + 65;
console.log(`\nWaiting until chain time reaches ${targetTime} (65s healthy, validUntil is ${latestHealth.validUntil})...`);
while (true) {
  const b = await publicClient.getBlock();
  const cur = Number(b.timestamp);
  if (cur >= targetTime) {
    console.log(`Ready! Chain time: ${cur} >= ${targetTime}. Remaining validity: ${Number(latestHealth.validUntil) - cur}s`);
    break;
  }
  try {
    const bump = await walletClient.sendTransaction({ to: account.address, value: 0n });
    await publicClient.waitForTransactionReceipt({ hash: bump });
  } catch {}
  await new Promise((r) => setTimeout(r, 3000));
}

// 3b. Approve both pool tokens and the fee token to the factory.
console.log('Approving pool tokens to factory...');
const FACTORY_ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);
const factorySpender = MANIFEST.poolFactory;
await walletClient.writeContract({
  address: MANIFEST.weth, abi: FACTORY_ERC20_ABI, functionName: 'approve',
  args: [factorySpender, 10n ** 24n],
});
await walletClient.writeContract({
  address: stockToken, abi: FACTORY_ERC20_ABI, functionName: 'approve',
  args: [factorySpender, 10n ** 24n],
});
await walletClient.writeContract({
  address: MANIFEST.feeToken, abi: FACTORY_ERC20_ABI, functionName: 'approve',
  args: [factorySpender, 10n ** 24n],
});
console.log('Approvals confirmed.');

// 3c. Fund the wallet with WETH if short, so the factory can pull the quote-leg principal.
const wethBal = await publicClient.readContract({
  address: MANIFEST.weth, abi: FACTORY_ERC20_ABI, functionName: 'balanceOf', args: [account.address],
});
const minimumWethForSeed = 2n * 10n ** 15n;
if (wethBal < minimumWethForSeed) {
  const needed = minimumWethForSeed - wethBal;
  console.log(`Wrapping ${needed} wei into WETH to cover the seed amount...`);
  await walletClient.sendTransaction({ to: MANIFEST.weth, value: needed });
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
  poolManager: MANIFEST.poolManager,
  positionManager: MANIFEST.positionManager,
  factory: factoryAddress,
  assetRegistry: MANIFEST.assetRegistry,
  calendarRegistry: MANIFEST.calendarRegistry,
  safetyController: MANIFEST.safetyController,
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
  amountMax: token0.toLowerCase() === MANIFEST.weth
    ? [2n * 10n ** 15n, 100n * 10n ** 18n]
    : [100n * 10n ** 18n, 2n * 10n ** 15n],
  maxServiceFee: 49000000n,
};

const [directBalance, stockBalance] = await Promise.all([
  publicClient.readContract({ address: MANIFEST.weth, abi: FACTORY_ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
  publicClient.readContract({ address: stockToken, abi: FACTORY_ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
]);
const feeBalance = await publicClient.readContract({ address: MANIFEST.feeToken, abi: FACTORY_ERC20_ABI, functionName: 'balanceOf', args: [account.address] });
const [feeDecimals, serviceFee] = await Promise.all([
  publicClient.readContract({ address: MANIFEST.feeToken, abi: parseAbi(['function decimals() view returns(uint8)']), functionName: 'decimals' }),
  publicClient.readContract({ address: factoryAddress, abi: parseAbi(['function serviceFee() view returns(uint128)']), functionName: 'serviceFee' }),
]);
if (directBalance < request.amountMax[token0.toLowerCase() === MANIFEST.weth ? 0 : 1]
  || stockBalance < request.amountMax[token0.toLowerCase() === stockToken.toLowerCase() ? 0 : 1]
  || feeBalance < serviceFee) throw new Error('Insufficient seed/service token balance before pool creation');
if (!isPoolCreatePreflightReady(await publicClient.readContract({ address: sessionRegistry, abi: SessionArtifact.abi, functionName: 'health', args: [stockAssetId] }), Number((await publicClient.getBlock()).timestamp))) {
  throw new Error('Stock health is not ready immediately before createAndSeed; skipping broadcast');
}
const simulate = await publicClient.simulateContract({ address: factoryAddress, abi: FACTORY_ABI, functionName: 'createAndSeed', args: [request], account });
console.log('createAndSeed simulation passed; broadcasting exact simulated request. Fee decimals:', feeDecimals);

console.log('Broadcasting createAndSeed...');
const createTx = await walletClient.writeContract(simulate.request);
console.log('TX sent:', createTx);
const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
console.log('createAndSeed mined in block', receipt.blockNumber.toString(), 'status:', receipt.status);

if (receipt.status !== 'success') throw new Error('createAndSeed reverted onchain');

// Use the emitted PoolCreated event as the authoritative result. Some testnet RPC backends returned
// inconsistent CREATE2 predictions in a post-transaction eth_call; the mined receipt is canonical.
const createdLog = receipt.logs
  .map((log) => {
    try { return decodeEventLog({ abi: FactoryArtifact.abi, data: log.data, topics: log.topics }); }
    catch { return null; }
  })
  .find((event) => event?.eventName === 'PoolCreated');
if (!createdLog) throw new Error('PoolCreated event missing from successful createAndSeed receipt');
const hookAddress = createdLog.args.hook;
const poolId = createdLog.args.poolId;
const actualCode = await publicClient.getBytecode({ address: hookAddress });
if (!actualCode || actualCode === '0x') throw new Error(`PoolCreated hook ${hookAddress} has no runtime code`);

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
  lifecycle: hookState.lifecycle,
  canSwap: hookPolicy.canSwap,
  mode: hookPolicy.mode,
  reasonBits: hookPolicy.reasonBits.toString(),
  lpFeeUnits: hookPolicy.lpFeeUnits,
  poolStatusObservedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

writeFileSync('evidence/deploy/testnet-pool-created.json', JSON.stringify(poolEvidence, null, 2) + '\n');
console.log('\n>>> SUCCESS! FIRST LIVE BELL POOL IS CREATED, SEEDED AND LIVE ON TESTNET! <<<');
