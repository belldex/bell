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
import { checkSeedFunding, deriveInitialSqrtPrice, deriveProfileHash, resolvePoolConfig } from './mainnet-pool-config.mjs';
import { isPoolCreatePreflightReady } from './keeper-price-config.mjs';

const MAINNET_CHAIN_ID = 4663;

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv(readFileSync('.env', 'utf8'));
const rpcUrl = env.RH_MAINNET_RPC_PRIMARY;
const pk = env.RH_MAINNET_DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl) throw new Error('RH_MAINNET_RPC_PRIMARY is required');
if (!pk) throw new Error('RH_MAINNET_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is required');
const broadcast = process.argv.includes('--broadcast');

const manifest = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8'));
if (Number(manifest.chainId) !== MAINNET_CHAIN_ID) throw new Error(`manifest chainId is ${manifest.chainId}`);
const adapters = JSON.parse(readFileSync('evidence/deploy/mainnet-4663-stock-adapters.json', 'utf8'));
const assetQueue = JSON.parse(readFileSync('evidence/deploy/mainnet-4663-asset-queue.json', 'utf8'));
const references = existsSync('evidence/deploy/mainnet-4663-reference-adapters.json')
  ? JSON.parse(readFileSync('evidence/deploy/mainnet-4663-reference-adapters.json', 'utf8'))
  : null;
if (assetQueue.activationPending) {
  throw new Error('asset admission is still pending; run mainnet-admit-assets.mjs activate first');
}

const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

const chainId = await publicClient.getChainId();
if (chainId !== MAINNET_CHAIN_ID) throw new Error(`Wrong chain ${chainId}; expected ${MAINNET_CHAIN_ID}`);

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

const stockArg = process.argv.find((a) => a.startsWith('--stock='))?.slice('--stock='.length)?.toUpperCase() ?? null;
const pairCounter = (process.argv.find((a) => a.startsWith('--counterasset='))?.slice('--counterasset='.length) ?? 'WETH').toUpperCase();
const stockSymbol = stockArg ?? Object.keys(assetQueue.stocks ?? {})[0] ?? null;
if (!stockSymbol) throw new Error('no admitted stock assets in queue evidence; admit candidates first');
const counterIsStock = pairCounter !== 'WETH' && pairCounter !== 'USDG';
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
    : assetQueue.stocks?.[pairCounter] ?? null;
const pairToken = pairCounter === 'USDG'
  ? manifest.feeToken
  : pairCounter === 'WETH'
    ? manifest.weth
    : pairEntry?.token ?? null;
const pairAssetId = pairEntry?.descriptorId ?? null;
if (!pairToken || !pairAssetId) throw new Error(`unsupported or unadmitted counterasset ${pairCounter}`);
if (assetQueue.activationPending) throw new Error('asset activation is pending; finish mainnet-admit-assets activate before pool creation');
const pairAdapters = pairRequestedAsStock ? adapters.assets?.[pairCounter] : null;
if (pairRequestedAsStock && !pairAdapters) throw new Error(`counter stock ${pairCounter} has no adapter evidence`);
if (pairToken.toLowerCase() === stockAdapters.stockToken.toLowerCase()) {
  throw new Error('pool pair tokens must be distinct');
}
const refMap = references?.adapters ?? references?.feeds ?? {};
const stockReferenceAdapter = refMap[`${stockSymbol}/USD`]?.adapter ?? null;
const pairReferenceKey = `${pairCounter}/USD`;
const counterReferenceAdapter = refMap[pairReferenceKey]?.adapter ?? null;

const poolClass = Number(env.BELL_POOL_CLASS || 1);
if (![0, 1].includes(poolClass)) throw new Error('BELL_POOL_CLASS must be 0 (PRICE_GUARDED) or 1 (SESSION_ONLY)');
const EVIDENCE_PATH = `evidence/deploy/mainnet-4663-pool-${stockSymbol}-${pairCounter}-${poolClass}.json`;
const referenceAdapterA = poolClass === 0 ? stockReferenceAdapter : undefined;
const referenceAdapterB = poolClass === 0 ? counterReferenceAdapter : undefined;

// The factory compares keccak256(config-without-tokens) against the immutable profileHash it was
// deployed with. policyId survives that hash, so a mismatch here is InvalidConfiguration on chain.
// The deploy script's default is 'bell-testnet-v1' unless BELL_POLICY_ID was set, so read the
// deployed value instead of guessing.
const deployedProfileHash = await publicClient.readContract({
  address: manifest.poolFactory,
  abi: parseAbi(['function profileHash() view returns (bytes32)']),
  functionName: 'profileHash',
});

const tokenA = stockAdapters.stockToken;
const assetA = stockAssetId;
const tokenB = pairToken;
const assetB = pairAssetId;
const amountAMax = BigInt(env.BELL_MAINNET_STOCK_SEED_WEI || 10n ** 18n);
const amountBMax = pairCounter === 'WETH'
  ? BigInt(env.BELL_MAINNET_WETH_SEED_WEI || 2n * 10n ** 15n)
  : pairCounter === 'USDG'
    ? BigInt(env.BELL_MAINNET_USDG_SEED_WEI || 2n * 10n ** 6n)
    : BigInt(env.BELL_MAINNET_COUNTER_STOCK_SEED_WEI || 10n ** 18n);

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

if (pairRequestedAsStock && poolClass === 1) {
  throw new Error('SESSION_ONLY supports one stock plus one unpriced non-stock token; stock/stock requires PRICE_GUARDED');
}

if (poolClass === 0 && (!referenceAdapterA || !referenceAdapterB)) {
  throw new Error(`PRICE_GUARDED requires deployed references for ${stockSymbol}/USD and ${pairCounter}/USD; deploy reference stack first`);
}

// Verify the derived profile hash matches the deployed factory before spending gas. This is the
// only cheap way to catch a policy-id or tick-spacing mismatch.
const derivedProfileHash = deriveProfileHash(config.config);
if (derivedProfileHash !== deployedProfileHash) {
  throw new Error(
    `derived profile hash ${derivedProfileHash} does not match the deployed factory profile ${deployedProfileHash}; `
    + `check BELL_POLICY_ID (currently "${config.policyId}") and tickSpacing`,
  );
}
console.log(`Factory profile hash matches: ${deployedProfileHash}`);

// 1. The calendar must have a live interval; without one the hook has no phase and cannot open.
const pairIsStock = Boolean(pairEntry?.isStock ?? counterIsStock);
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
  tokenABalance: tokenA.toLowerCase() === manifest.feeToken.toLowerCase() ? feeBalance : tokenABalance,
  tokenBBalance: tokenB.toLowerCase() === manifest.feeToken.toLowerCase() ? feeBalance : tokenBBalance,
  weth: manifest.weth,
  amountMax: config.amountMax,
  nativeBalance,
  nativeGasReserve: BigInt(env.BELL_MAINNET_GAS_RESERVE_WEI || 5_000_000_000_000_000n),
  feeBalance,
  feeToken: manifest.feeToken,
  serviceFee,
  wrapNativeForWeth: true,
});
const shortfalls = [...funding.shortfalls];
if (shortfalls.length) {
  throw new Error(`insufficient balances for the seed: ${shortfalls.join(', ')} (fee token has ${feeDecimals} decimals)`);
}
console.log(`Balances OK. Service fee ${serviceFee} (${feeDecimals} decimals).`);

if (!broadcast) {
  console.log(JSON.stringify({
    mode: 'PREFLIGHT_ONLY',
    chainId,
    stockAssetId,
    pairAssetId,
    stockSymbol,
    counterasset: pairCounter,
    token0: config.token0,
    token1: config.token1,
    amountMax: config.amountMax.map(String),
    policyId: config.policyId,
    health: { ready: health.ready, validUntil: Number(health.validUntil) },
    calendarPhases: intervals.map((it) => Number(it.phase)),
  }, null, 2));
  console.log('Plan mode only. Re-run with explicit pair args and --broadcast to authorize transactions.');
  process.exit(0);
}

if (!process.argv.some((a) => a.startsWith('--stock=')) || !process.argv.some((a) => a.startsWith('--counterasset='))) {
  throw new Error('broadcast requires explicit --stock=<symbol> and --counterasset=<WETH|USDG|stock symbol>');
}

// 4. Approvals.
console.log(`Approving ${stockSymbol}, ${pairCounter}, and fee token to the factory...`);
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

// 6. Mine the hook salt against the live deployer nonce.
const DEPLOYER_ABI = parseAbi([
  'function initCodeHash((address token0, address token1, bytes32 asset0, bytes32 asset1, address poolManager, address positionManager, address factory, address assetRegistry, address calendarRegistry, address safetyController, address treasuryAdapter, uint8 poolClass, uint8 liquidityMode, uint8 referenceMode, int24 tickSpacing, uint128[2] tradeCap, uint128[2] windowCap, uint128[2] closureCap, bytes32 policyId, address referenceAdapter0, address referenceAdapter1) config, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key) view returns (bytes32)',
]);
const FACTORY_ABI = parseAbi([
  'function nonces(address) view returns (uint64)',
  'function createAndSeed(((address token0, address token1, bytes32 asset0, bytes32 asset1, address poolManager, address positionManager, address factory, address assetRegistry, address calendarRegistry, address safetyController, address treasuryAdapter, uint8 poolClass, uint8 liquidityMode, uint8 referenceMode, int24 tickSpacing, uint128[2] tradeCap, uint128[2] windowCap, uint128[2] closureCap, bytes32 policyId, address referenceAdapter0, address referenceAdapter1) config, bytes32 salt, uint64 nonce, uint64 deadline, address recipient, uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, uint128 liquidity, uint128[2] amountMax, uint128 maxServiceFee) request) external returns ((address hook, bytes32 poolId, uint256 tokenId, bytes32 positionKey, uint128 liquidity, uint128[2] principal))',
]);

const initCodeHash = await publicClient.readContract({
  address: manifest.hookDeployer, abi: DEPLOYER_ABI, functionName: 'initCodeHash', args: [config.config, config.key],
});
const nonce = await publicClient.readContract({
  address: manifest.poolFactory, abi: FACTORY_ABI, functionName: 'nonces', args: [account.address],
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

const deadline = BigInt(Number((await publicClient.getBlock()).timestamp) + 1200);
// PRICE_GUARDED: derive the opening price from the live Chainlink feeds so the seed sits inside
// the reference band. SESSION_ONLY keeps the creator-chosen 1:1 starting price (an explicit
// creator decision per the brief, never an oracle claim).
let sqrtPriceX96 = 79228162514264337593543950336n;
if (poolClass === 0) {
  const REF_ABI = parseAbi(['function referencePrice() view returns (uint128)']);
  const [raw0, raw1, d0, d1] = await Promise.all([
    publicClient.readContract({ address: config.config.referenceAdapter0, abi: REF_ABI, functionName: 'referencePrice' }),
    publicClient.readContract({ address: config.config.referenceAdapter1, abi: REF_ABI, functionName: 'referencePrice' }),
    publicClient.readContract({ address: config.config.token0, abi: ERC20, functionName: 'decimals' }),
    publicClient.readContract({ address: config.config.token1, abi: ERC20, functionName: 'decimals' }),
  ]);
  sqrtPriceX96 = deriveInitialSqrtPrice({
    price0_18: BigInt(raw0), price1_18: BigInt(raw1), decimals0: Number(d0), decimals1: Number(d1),
  });
  console.log(`PRICE_GUARDED initial sqrtPriceX96 from live feeds: ${sqrtPriceX96}`);
}
const request = {
  config: config.config,
  salt: mined.requestSalt,
  nonce,
  deadline,
  recipient: account.address,
  sqrtPriceX96,
  tickLower: -6000,
  tickUpper: 6000,
  liquidity: 10n ** 15n,
  amountMax: config.amountMax,
  maxServiceFee: serviceFee,
};

// 7. Simulate, then broadcast the exact simulated request.
await publicClient.simulateContract({
  address: manifest.poolFactory, abi: FACTORY_ABI, functionName: 'createAndSeed', args: [request], account,
});
console.log('createAndSeed simulation passed; broadcasting the exact simulated request');

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
  counterasset: pairCounter,
  poolClass,
  amountMax: config.amountMax.map(String),
  policyId: config.policyId,
  serviceFee: serviceFee.toString(),
  createdAt: new Date().toISOString(),
  status: 'CREATED_NOT_YET_SWAPPED',
};
writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`\nPool created: hook ${hook}`);
console.log(`Pool id:      ${poolId}`);
console.log(`Wrote ${EVIDENCE_PATH}. A swap and acceptance still have to happen before this is proven.`);
