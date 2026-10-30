#!/usr/bin/env node
/**
 * Create and seed one requested mainnet BELL pool pair.
 *
 * Differences from the testnet script that matter on mainnet:
 *  - the seed is real value: WETH and a real stock token, plus a real service fee
 *  - the policy id is `bell-mainnet-v1`, not the testnet label
 *  - the stock leg must be ACTIVE and the calendar interval must be live before health can pass
 *  - a dry run is the default; `--broadcast` is explicit
 *
 * Hook salt mining is CPU-bound (up to 200k keccak attempts) and stays in this script rather than
 * in the keeper, because it is a one-shot operation that needs the deployer nonce.
 *
 *   node scripts/deploy/mainnet-create-pool.mjs            # preflight + simulate only
 *   node scripts/deploy/mainnet-create-pool.mjs --stock=AAPL --counterasset=WETH --broadcast
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import FactoryArtifact from '../../contracts/out/BellPoolFactory.sol/BellPoolFactory.json' with { type: 'json' };
import { mineHookSalt } from '../tooling/mine-hook-salt.mjs';
import { checkSeedFunding, deriveInitialSqrtPrice, deriveProfileHash, deriveSqrtPriceFromAmounts, deriveTickBounds, resolvePoolConfig } from './mainnet-pool-config.mjs';
import { isPoolCreatePreflightReady } from './keeper-price-config.mjs';
import { buildCreatePoolPreflight, validateCreatePoolBroadcastAuthorization } from './mainnet-create-pool-ops.mjs';

const MAINNET_CHAIN_ID = 4663;

function arg(name, fallback = null) {
  const match = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

function loadEnv(text) {
  const env = { ...process.env };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv(readFileSync('.env', 'utf8'));
const poolClass = Number(arg('pool-class', env.BELL_POOL_CLASS || '1'));
if (![0, 1].includes(poolClass)) throw new Error('pool class must be 0 PRICE_GUARDED or 1 SESSION_ONLY');
const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
const pk = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl) throw new Error('RH_MAINNET_RPC_PRIMARY is required');
if (!pk) throw new Error('RH_MAINNET_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is required');
const broadcast = process.argv.includes('--broadcast');

const manifest = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
if (Number(manifest.chainId) !== MAINNET_CHAIN_ID) throw new Error(`manifest chainId is ${manifest.chainId}`);
const adaptersPath = env.BELL_MAINNET_YAHOO_EVIDENCE || 'evidence/deploy/mainnet-4663-stock-adapters.json';
const assetQueuePath = env.BELL_MAINNET_ASSET_QUEUE || 'evidence/deploy/mainnet-4663-asset-queue.json';
const referencesPath = env.BELL_MAINNET_REFERENCE_EVIDENCE || 'evidence/deploy/mainnet-4663-reference-adapters.json';
const adapters = existsSync(adaptersPath)
  ? JSON.parse(readFileSync(adaptersPath, 'utf8'))
  : null;
const assetQueue = existsSync(assetQueuePath)
  ? JSON.parse(readFileSync(assetQueuePath, 'utf8'))
  : null;
if (!adapters?.assets) throw new Error('Yahoo stock adapter evidence missing; deploy mainnet-yahoo-stack first');
if (!assetQueue?.weth || !assetQueue?.stocks) throw new Error('mainnet asset queue missing; queue and activate WETH, USDG and stocks first');
const references = existsSync(referencesPath)
  ? JSON.parse(readFileSync(referencesPath, 'utf8'))
  : null;
if (assetQueue.activationPending) {
  throw new Error('asset admission is still pending; run mainnet-admit-assets.mjs activate first');
}

const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== MAINNET_CHAIN_ID) throw new Error(`Wrong chain ${chainId}; expected ${MAINNET_CHAIN_ID}`);
const deployerBalanceLive = await publicClient.getBalance({ address: account.address });
const gasFloor = BigInt(env.BELL_MAINNET_MIN_DEPLOYER_WEI || 7_000_000_000_000_000n);
if (broadcast && deployerBalanceLive < gasFloor) throw new Error(`deployer ETH ${deployerBalanceLive} is below mainnet floor ${gasFloor}`);

const ERC20 = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

const SESSION_ABI = parseAbi([
  'function health(bytes32 assetId) view returns ((bool ready, uint256 reasonBits, uint64 healthySince, uint64 validUntil, uint64 baselineObservation, uint64 latestObservation))',
]);

const CALENDAR_ABI = parseAbi([
  'function currentInterval(bytes32 assetId) view returns ((bytes32 assetId, uint16 year, uint32 index, uint64 start, uint64 end, uint8 phase, bytes32 provenanceHash))',
]);

const stockArg = arg('stock', env.BELL_MAINNET_SYMBOL || 'AAPL').toUpperCase();
const pairCounter = arg('counterasset', 'WETH').toUpperCase();
const counterAddressArg = arg('counter-token');
if (counterAddressArg && !/^0x[0-9a-fA-F]{40}$/.test(counterAddressArg)) {
  throw new Error('--counter-token must be a valid EVM address');
}

function counterCounterIsStock(symbol) {
  return symbol !== 'WETH' && symbol !== 'USDG';
}

const stockSymbol = stockArg ?? Object.keys(assetQueue.stocks ?? {})[0] ?? null;
const pairRequestedAsStock = counterCounterIsStock(pairCounter);
const amount0Arg = arg('amount0');
const amount1Arg = arg('amount1');
if (![0, 1].includes(poolClass)) throw new Error('BELL_POOL_CLASS must be 0 PRICE_GUARDED or 1 SESSION_ONLY');
if (!stockSymbol) throw new Error('no admitted stock assets in queue evidence; admit candidates first');
if (counterAddressArg && !process.argv.some((a) => a.startsWith('--counterasset='))) {
  throw new Error('--counter-token requires --counterasset=<display label>');
}
const counterIsCandidateStock = pairRequestedAsStock && !counterAddressArg;
const stockEntry = stockSymbol ? assetQueue.stocks?.[stockSymbol] : assetQueue.stock;
const stockAssetId = stockEntry?.descriptorId ?? null;
const stockAdapters = stockSymbol
  ? (adapters.assets?.[stockSymbol] ?? null)
  : adapters;
if (!stockAdapters || !stockAssetId) throw new Error(`no admitted adapter/descriptor for stock ${stockSymbol ?? '(unknown)'}`);
const pairEntry = pairCounter === 'USDG'
  ? assetQueue.usdg
  : pairCounter === 'WETH'
    ? assetQueue.weth
    : counterAddressArg
      ? Object.values({ ...(assetQueue.counterassets ?? {}), ...(assetQueue.assets ?? {}) }).find((entry) => entry.token?.toLowerCase() === counterAddressArg.toLowerCase()) ?? null
      : assetQueue.stocks?.[pairCounter] ?? Object.values(assetQueue.counterassets ?? {}).find((entry) => entry.symbol?.toUpperCase() === pairCounter) ?? null;
const pairToken = pairCounter === 'USDG'
  ? manifest.feeToken
  : pairCounter === 'WETH'
    ? manifest.weth
    : counterAddressArg ?? pairEntry?.token ?? null;
const admittedPairId = pairToken ? await publicClient.readContract({
  address: manifest.assetRegistry,
  abi: parseAbi(['function descriptorIdForToken(address) view returns (bytes32)']),
  functionName: 'descriptorIdForToken',
  args: [pairToken],
}).catch(() => null) : null;
const pairAssetId = pairEntry?.token?.toLowerCase() === pairToken?.toLowerCase()
  ? pairEntry.descriptorId
  : admittedPairId;
const counterLabel = counterAddressArg ? `${pairCounter}-${pairToken.slice(2, 8).toUpperCase()}` : pairCounter;
if (!pairToken || !pairAssetId) throw new Error(`unsupported or unadmitted counterasset ${pairCounter}`);
if (!pairEntry && !counterAddressArg) throw new Error(`counterasset ${pairCounter} has no queue entry; pass --counter-token=<active token address>`);
if (assetQueue.activationPending) throw new Error('asset activation is pending; finish mainnet-admit-assets activate before pool creation');
const pairDescriptor = await publicClient.readContract({
  address: manifest.assetRegistry,
  abi: parseAbi(['function descriptor(bytes32) view returns ((bytes32 id,address token,bool isStock,uint8 decimals,uint8 capabilityMask,address tokenPriceAdapter,address regularAdapter,address extendedAdapter,address overnightAdapter,address secondaryAdapter,bytes32 expectedCodeHash,bytes32 implementationFingerprint,bytes32 evidenceHash))']),
  functionName: 'descriptor',
  args: [pairAssetId],
});
const pairIsStock = pairDescriptor.isStock;
const pairAdapters = counterIsCandidateStock ? adapters.assets?.[pairCounter] : null;
if (pairIsStock && !pairAdapters) throw new Error(`counter stock ${pairCounter} has no adapter evidence`);
if (counterAddressArg && counterAddressArg.toLowerCase() !== pairDescriptor.token.toLowerCase()) {
  throw new Error(`registry descriptor token ${pairDescriptor.token} does not match --counter-token ${counterAddressArg}`);
}
if (pairToken.toLowerCase() === stockAdapters.stockToken.toLowerCase()) {
  throw new Error('pool pair tokens must be distinct');
}
const refMap = references?.adapters ?? references?.feeds ?? {};
const stockReferenceAdapter = refMap[`${stockSymbol}/USD`]?.adapter ?? null;
const pairReferenceKey = `${pairEntry?.symbol ?? pairCounter}/USD`;
const counterReferenceAdapter = refMap[pairReferenceKey]?.adapter ?? null;

const EVIDENCE_PATH = `evidence/deploy/mainnet-4663-pool-${stockSymbol}-${counterLabel}-${poolClass}.json`;
const referenceAdapterA = poolClass === 0 ? stockReferenceAdapter : undefined;
const referenceAdapterB = poolClass === 0 ? counterReferenceAdapter : undefined;
if (poolClass === 0 && !references) throw new Error('PRICE_GUARDED reference adapter evidence missing; run mainnet:reference-stack:broadcast after funding and updated stack deployment');
if (poolClass === 0 && pairIsStock && !counterReferenceAdapter) throw new Error(`missing reference adapter for counter-stock ${pairCounter}`);
if (poolClass === 0 && references) {
  const relevantFeedStatuses = [stockSymbol, pairEntry?.symbol ?? pairCounter].map((symbol) =>
    (references.feedChecks ?? []).find((entry) => entry.symbol === `${symbol}/USD`));
  const stale = relevantFeedStatuses.find((entry) => entry && !entry.usableNow);
  if (stale) throw new Error(`${stale.symbol} Chainlink round is stale/invalid; PRICE_GUARDED must fail closed until it refreshes`);
}
if (process.argv.some((entry) => entry.startsWith('--amount0=')) !== process.argv.some((entry) => entry.startsWith('--amount1='))) {
  throw new Error('specify both --amount0 and --amount1 together');
}
// The factory compares keccak256(config-without-tokens) against the immutable profileHash it was
// deployed with. policyId survives that hash, so a mismatch here is InvalidConfiguration on chain.
// The deploy script's default is 'bell-testnet-v1' unless BELL_POLICY_ID was set, so read the
// deployed value instead of guessing.
const tokenA = stockAdapters.stockToken;
const assetA = stockAssetId;
const tokenB = pairToken;
const assetB = pairAssetId;
function pairAmountEnv(token, label, fallback) {
  const explicit = env[`BELL_MAINNET_SEED_${token.toLowerCase()}`]
    ?? env[`BELL_MAINNET_SEED_${label.toUpperCase()}`]
    ?? (token.toLowerCase() === manifest.weth.toLowerCase() ? env.BELL_MAINNET_WETH_SEED_WEI : undefined)
    ?? (token.toLowerCase() === manifest.feeToken.toLowerCase() ? env.BELL_MAINNET_USDG_SEED_WEI : undefined)
    ?? (label === stockSymbol ? env.BELL_MAINNET_STOCK_SEED_WEI : undefined)
    ?? (pairIsStock && label === pairCounter ? env.BELL_MAINNET_COUNTER_STOCK_SEED_WEI : undefined)
    ?? (label === pairCounter ? env.BELL_MAINNET_COUNTER_TOKEN_SEED_WEI : undefined);
  return BigInt(explicit ?? fallback);
}
const amountAMax = amount0Arg ? BigInt(amount0Arg) : pairAmountEnv(tokenA, stockSymbol, 10n ** 18n);
const amountBMax = amount1Arg ? BigInt(amount1Arg) : pairAmountEnv(tokenB, pairEntry?.symbol ?? pairCounter,
  tokenB.toLowerCase() === manifest.weth.toLowerCase() ? 2n * 10n ** 15n
    : tokenB.toLowerCase() === manifest.feeToken.toLowerCase() ? 2n * 10n ** 6n : 10n ** 18n);
if (amountAMax <= 0n || amountBMax <= 0n) throw new Error('--amount0/--amount1 and BELL_MAINNET_SEED_* values must be positive base-unit amounts');
if ((poolClass === 0 || pairIsStock) && (!amount0Arg || !amount1Arg)) {
  throw new Error('PRICE_GUARDED and stock/stock pool setup require explicit --amount0 and --amount1 seed inventory');
}

const config = resolvePoolConfig({
  tokenA, assetA, tokenB, assetB,
  amountAMax, amountBMax,
  referenceAdapterA, referenceAdapterB,
  poolManager: manifest.poolManager,
  positionManager: manifest.positionManager,
  factory: manifest.poolFactory,
  assetRegistry: manifest.assetRegistry,
  calendarRegistry: manifest.calendarRegistry,
  safetyController: manifest.safetyController,
  policyId: env.BELL_POLICY_ID || 'bell-mainnet-v1',
  poolClass,
});
const factoryProfileHash = await publicClient.readContract({
  address: manifest.poolFactory,
  abi: parseAbi(['function profileHash() view returns (bytes32)']),
  functionName: 'profileHash',
});
const factoryCode = await publicClient.getBytecode({ address: manifest.poolFactory });
if (!factoryCode || factoryCode === '0x') throw new Error('factory has no deployed code');
const expectedCurrentProfileHash = deriveProfileHash({
  ...config.config,
  token0: '0x0000000000000000000000000000000000000000',
  token1: '0x0000000000000000000000000000000000000000',
  asset0: `0x${'0'.repeat(64)}`,
  asset1: `0x${'0'.repeat(64)}`,
  poolClass: 0,
  referenceAdapter0: '0x0000000000000000000000000000000000000000',
  referenceAdapter1: '0x0000000000000000000000000000000000000000',
});
if (factoryProfileHash !== expectedCurrentProfileHash) {
  throw new Error(`factory profile ${factoryProfileHash} differs from expected neutral profile ${expectedCurrentProfileHash}`);
}
if (poolClass === 0 && (!referenceAdapterA || !referenceAdapterB)) {
  throw new Error(`PRICE_GUARDED requires deployed references for ${stockSymbol}/USD and ${pairCounter}/USD; deploy reference stack first`);
}

// Verify the derived profile hash matches the deployed factory before spending gas. This is the
// only cheap way to catch a policy-id or tick-spacing mismatch.
const derivedProfileHash = deriveProfileHash(config.config);
console.log(`Per-pool config hash ${derivedProfileHash}; factory neutral profile ${factoryProfileHash}`);

// 1. The calendar must have a live interval; without one the hook has no phase and cannot open.
if (counterAddressArg && counterAddressArg.toLowerCase() === stockAdapters.stockToken.toLowerCase()) {
  throw new Error('counter token must differ from the selected stock token');
}
const pairStockAssetId = config.asset0.toLowerCase() === stockAssetId.toLowerCase()
  ? config.asset1
  : config.asset0;
const stockAssetIdByToken = config.token0.toLowerCase() === stockAdapters.stockToken.toLowerCase() ? config.asset0 : config.asset1;
const stockAssetIds = pairIsStock ? [stockAssetIdByToken, pairStockAssetId] : [stockAssetIdByToken];
const intervals = await Promise.all(stockAssetIds.map((id) => publicClient.readContract({
  address: manifest.calendarRegistry, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [id],
})));
for (const [index, id] of stockAssetIds.entries()) {
  if (intervals[index].assetId.toLowerCase() !== id.toLowerCase()) {
    throw new Error(`no live calendar interval for stock asset ${id}; activate its calendar first`);
  }
  console.log(`Calendar ${id}: phase ${intervals[index].phase} until ${new Date(Number(intervals[index].end) * 1000).toISOString()}`);
}

// 2. Health must already be ready. Pool creation does not create health; it consumes it.
const health = await publicClient.readContract({
  address: manifest.sessionRegistry, abi: SESSION_ABI, functionName: 'health', args: [stockAssetIdByToken],
});
const pairHealth = pairIsStock ? await publicClient.readContract({
  address: manifest.sessionRegistry, abi: SESSION_ABI, functionName: 'health', args: [pairStockAssetId],
}) : null;
const now = Number((await publicClient.getBlock()).timestamp);
console.log(`Health: ready=${health.ready} reasons=${health.reasonBits} validUntil=${health.validUntil}`);
if (!isPoolCreatePreflightReady(health, now)) {
  throw new Error('stock health is not ready; the keeper must publish a fresh report first');
}
if (pairHealth && !isPoolCreatePreflightReady(pairHealth, now)) {
  throw new Error(`${pairCounter} stock health is not ready; keeper must publish a fresh report first`);
}

// 3. Balance and allowance preflight, so a failed seed cannot burn gas on approvals only.
const [tokenABalance, tokenBBalance, nativeBalance, feeBalance, serviceFee, feeDecimals] = await Promise.all([
  publicClient.readContract({ address: tokenA, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
  publicClient.readContract({ address: tokenB, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
  publicClient.getBalance({ address: account.address }),
  publicClient.readContract({ address: manifest.feeToken, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
  publicClient.readContract({ address: manifest.poolFactory, abi: parseAbi(['function serviceFee() view returns (uint128)']), functionName: 'serviceFee' }),
  publicClient.readContract({ address: manifest.feeToken, abi: ERC20, functionName: 'decimals' }),
]);
const funding = checkSeedFunding({
  token0: config.token0,
  tokenA,
  tokenB,
  amountMax: config.amountMax,
  tokenABalance: tokenA.toLowerCase() === manifest.feeToken.toLowerCase() ? feeBalance : tokenABalance,
  tokenBBalance: tokenB.toLowerCase() === manifest.feeToken.toLowerCase() ? feeBalance : tokenBBalance,
  weth: manifest.weth,
  nativeBalance,
  nativeGasReserve: BigInt(env.BELL_MAINNET_GAS_RESERVE_WEI || 5_000_000_000_000_000n),
  feeBalance,
  feeToken: manifest.feeToken,
  serviceFee,
  wrapNativeForWeth: true,
});
const FACTORY_ABI = parseAbi([
  'function nonces(address) view returns (uint64)',
  'function createAndSeed(((address token0, address token1, bytes32 asset0, bytes32 asset1, address poolManager, address positionManager, address factory, address assetRegistry, address calendarRegistry, address safetyController, address treasuryAdapter, uint8 poolClass, uint8 liquidityMode, uint8 referenceMode, int24 tickSpacing, uint128[2] tradeCap, uint128[2] windowCap, uint128[2] closureCap, bytes32 policyId, address referenceAdapter0, address referenceAdapter1) config, bytes32 salt, uint64 nonce, uint64 deadline, address recipient, uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, uint128 liquidity, uint128[2] amountMax, uint128 maxServiceFee) request) external returns ((address hook, bytes32 poolId, uint256 tokenId, bytes32 positionKey, uint128 liquidity, uint128[2] principal))',
]);
const [poolNonce, chainBlock] = await Promise.all([
  publicClient.readContract({ address: manifest.poolFactory, abi: FACTORY_ABI, functionName: 'nonces', args: [account.address] }),
  publicClient.getBlock(),
]);
const predictedDeadline = BigInt(Number(chainBlock.timestamp) + 1200);
const token0Decimals = Number(await publicClient.readContract({ address: config.config.token0, abi: ERC20, functionName: 'decimals' }));
const token1Decimals = Number(await publicClient.readContract({ address: config.config.token1, abi: ERC20, functionName: 'decimals' }));
let initialSqrtPriceX96 = deriveSqrtPriceFromAmounts({ amount0: config.amountMax[0], amount1: config.amountMax[1] });
if (poolClass === 0) {
  const REF_ABI = parseAbi(['function referencePrice() view returns (uint128)']);
  const [reference0, reference1] = await Promise.all([
    publicClient.readContract({ address: config.config.referenceAdapter0, abi: REF_ABI, functionName: 'referencePrice' }),
    publicClient.readContract({ address: config.config.referenceAdapter1, abi: REF_ABI, functionName: 'referencePrice' }),
  ]);
  initialSqrtPriceX96 = deriveInitialSqrtPrice({
    price0_18: BigInt(reference0),
    price1_18: BigInt(reference1),
    decimals0: token0Decimals,
    decimals1: token1Decimals,
  });
}
const defaultTickBounds = deriveTickBounds({
  sqrtPriceX96: initialSqrtPriceX96,
  tickSpacing: config.config.tickSpacing,
  halfWidth: Number(env.BELL_MAINNET_TICK_HALF_WIDTH || 6000),
});
const tickLower = Number(arg('tick-lower', env.BELL_MAINNET_TICK_LOWER ?? String(defaultTickBounds.tickLower)));
const tickUpper = Number(arg('tick-upper', env.BELL_MAINNET_TICK_UPPER ?? String(defaultTickBounds.tickUpper)));
const nonce = poolNonce;
const initCodeHash = await publicClient.readContract({
  address: manifest.hookDeployer,
  abi: parseAbi(['function initCodeHash((address token0,address token1,bytes32 asset0,bytes32 asset1,address poolManager,address positionManager,address factory,address assetRegistry,address calendarRegistry,address safetyController,address treasuryAdapter,uint8 poolClass,uint8 liquidityMode,uint8 referenceMode,int24 tickSpacing,uint128[2] tradeCap,uint128[2] windowCap,uint128[2] closureCap,bytes32 policyId,address referenceAdapter0,address referenceAdapter1) config,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key) view returns (bytes32)']),
  functionName: 'initCodeHash',
  args: [config.config, config.key],
});
console.log(`Mining hook salt for nonce ${nonce} (this is CPU-bound)...`);
const mined = mineHookSalt({
  chainId: BigInt(chainId),
  factory: manifest.poolFactory,
  creator: account.address,
  deployer: manifest.hookDeployer,
  nonce: BigInt(nonce),
  baseSalt: '0x0000000000000000000000000000000000000000000000000000000000000001',
  initCodeHash,
  maxAttempts: 200_000,
});
console.log(`Mined hook ${mined.hook} after ${mined.attempts} attempts`);
const predictedRequest = {
  config: config.config,
  salt: mined.requestSalt,
  nonce,
  deadline: predictedDeadline,
  recipient: account.address,
  sqrtPriceX96: initialSqrtPriceX96,
  tickLower,
  tickUpper,
  liquidity: 10n ** 15n,
  amountMax: config.amountMax,
  maxServiceFee: serviceFee,
};
const poolCreateGasEstimate = await publicClient.estimateContractGas({
  address: manifest.poolFactory,
  abi: FACTORY_ABI,
  functionName: 'createAndSeed',
  args: [predictedRequest],
  account,
}).catch((error) => { throw new Error(`pool create gas estimate failed before broadcast: ${error.shortMessage ?? error.message}`); });
const estimatedGasWei = poolCreateGasEstimate * await publicClient.getGasPrice();
const launchGasReserve = BigInt(env.BELL_MAINNET_GAS_RESERVE_WEI || 5_000_000_000_000_000n);
const deployerBalance = await publicClient.getBalance({ address: account.address });
const preliminaryPreflight = buildCreatePoolPreflight({
  chainId,
  expectedChainId: MAINNET_CHAIN_ID,
  tokenA,
  tokenB,
  assetA,
  assetB,
  referenceAdapterA,
  referenceAdapterB,
  poolClass,
  now,
  stockHealth: pairHealth ? [health, pairHealth] : [health],
  stockCount: pairIsStock ? 2 : 1,
  activationPending: assetQueue.activationPending,
  tokenABalance: tokenA.toLowerCase() === manifest.feeToken.toLowerCase() ? feeBalance : tokenABalance,
  tokenBBalance: tokenB.toLowerCase() === manifest.feeToken.toLowerCase() ? feeBalance : tokenBBalance,
  weth: manifest.weth,
  nativeBalance,
  nativeGasReserve: BigInt(env.BELL_MAINNET_GAS_RESERVE_WEI || 5_000_000_000_000_000n),
  feeToken: manifest.feeToken,
  feeBalance,
  serviceFee,
  pairLabel: `${stockSymbol}/${counterLabel}`,
  amountAMax,
  amountBMax,
  decimalsA: Number(await publicClient.readContract({ address: tokenA, abi: ERC20, functionName: 'decimals' })),
  decimalsB: Number(await publicClient.readContract({ address: tokenB, abi: ERC20, functionName: 'decimals' })),
  estimatedGasWei,
  gasReserve: launchGasReserve,
  balanceAFeeAliased: tokenA.toLowerCase() === manifest.feeToken.toLowerCase(),
  balanceBFeeAliased: tokenB.toLowerCase() === manifest.feeToken.toLowerCase(),
});
const preflight = preliminaryPreflight;
if (deployerBalance < estimatedGasWei + launchGasReserve) {
  throw new Error(`deployer ETH ${deployerBalance} is below estimated pool gas ${estimatedGasWei} + reserve ${launchGasReserve}`);
}
if (!broadcast) {
  console.log(JSON.stringify({
    mode: 'PREFLIGHT_ONLY',
    chainId,
    stockAssetId,
    pairAssetId,
    stockSymbol,
    counterasset: counterLabel,
    token0: config.token0,
    token1: config.token1,
    amountMax: [
      config.amountMax[config.token0.toLowerCase() === tokenA.toLowerCase() ? 0 : 1],
      config.amountMax[config.token0.toLowerCase() === tokenB.toLowerCase() ? 0 : 1],
    ].map(String),
    policyId: config.policyId,
    health: { ready: health.ready, validUntil: Number(health.validUntil) },
    calendarPhases: intervals.map((it) => Number(it.phase)),
    feedStatus: references?.feedChecks?.filter((entry) => [stockSymbol, pairCounter].some((symbol) => entry.symbol === `${symbol}/USD`)) ?? [],
    preflight,
  }, null, 2));
  console.log('Plan mode only. No transaction sent.');
  process.exit(0);
}

validateCreatePoolBroadcastAuthorization({
  broadcast,
  authorized: process.argv.includes('--i-authorize-spend'),
  pairLabel: `${stockSymbol}/${counterLabel}`,
  amountMax: preflight.amountMax,
});

// 4. Approvals.
console.log(`Approving ${stockSymbol}, ${counterLabel}, and fee token to the factory...`);
for (const token of [...new Set([tokenA, tokenB, manifest.feeToken])]) {
  const hash = await walletClient.writeContract({
    address: token, abi: ERC20, functionName: 'approve', args: [manifest.poolFactory, 10n ** 24n],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

// 5. Wrap ETH if the WETH leg is short.
if (funding.nativeToWrap > 0n) {
  const needed = funding.nativeToWrap;
  console.log(`Wrapping ${needed} wei into WETH`);
  const hash = await walletClient.sendTransaction({ to: manifest.weth, value: needed });
  await publicClient.waitForTransactionReceipt({ hash });
}

const deadline = BigInt(Number((await publicClient.getBlock()).timestamp) + 1200);
// Use one seed-derived price for SESSION_ONLY and the same feed-derived price for guarded pools
// in both estimation and simulation.
const sqrtPriceX96 = initialSqrtPriceX96;
if (poolClass === 0) console.log(`PRICE_GUARDED initial sqrtPriceX96 from live feeds: ${sqrtPriceX96}`);
else console.log(`SESSION_ONLY initial sqrtPriceX96 from sorted seed ratio: ${sqrtPriceX96}`);
const request = {
  config: config.config,
  salt: mined.requestSalt,
  nonce,
  deadline,
  recipient: account.address,
  sqrtPriceX96,
  tickLower,
  tickUpper,
  liquidity: 10n ** 15n,
  amountMax: config.amountMax,
  maxServiceFee: serviceFee,
};

// 7. Simulate before any write; plan-only exits above.
await publicClient.simulateContract({
  address: manifest.poolFactory, abi: FACTORY_ABI, functionName: 'createAndSeed', args: [request], account,
});
console.log(`createAndSeed simulation passed; estimatedGas=${poolCreateGasEstimate}, estimatedCostWei=${estimatedGasWei}`);

if (!broadcast) process.exit(0);
console.log('Broadcast explicitly authorized; sending the exact simulated request');

const createTx = await walletClient.writeContract({
  address: manifest.poolFactory, abi: FACTORY_ABI, functionName: 'createAndSeed', args: [request],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
if (receipt.status !== 'success') throw new Error(`createAndSeed reverted: ${createTx}`);

const createdLog = receipt.logs
  .map((log) => {
    try { return decodeEventLog({ abi: FactoryArtifact.abi, data: log.data, topics: log.topics }); }
    catch { return null; }
  })
  .find((event) => event?.eventName === 'PoolCreated');
if (!createdLog) throw new Error('PoolCreated event missing from a successful receipt');

const hook = createdLog.args.hook;
const poolId = createdLog.args.poolId;
const code = await publicClient.getBytecode({ address: hook });
if (!code || code === '0x') throw new Error(`hook ${hook} has no runtime code`);

const evidence = {
  chainId,
  hook,
  poolId,
  createTx,
  blockNumber: Number(receipt.blockNumber),
  token0: config.token0,
  token1: config.token1,
  asset0: config.asset0,
  asset1: config.asset1,
  stockSymbol,
  counterasset: counterLabel,
  poolClass,
  amountMax: request.amountMax.map(String),
  policyId: config.policyId,
  serviceFee: serviceFee.toString(),
  createdAt: new Date().toISOString(),
  status: 'CREATED_NOT_YET_SWAPPED',
};
writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`\nPool created: hook ${hook}`);
console.log(`Pool id:      ${poolId}`);
console.log(`Wrote ${EVIDENCE_PATH}. A swap and acceptance still have to happen before this is proven.`);
