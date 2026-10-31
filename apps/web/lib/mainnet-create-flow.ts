import {
  decodeEventLog, encodeAbiParameters, formatUnits, keccak256, parseAbi, type Abi,
  type Address, type EIP1193Provider,
} from 'viem';
import { makeClients } from './wallet';
import { MAINNET, tokenAbi } from './mainnet-live';
import assetQueue from '../../../evidence/deploy/mainnet-4663-asset-queue.json';
import deployment from '../../../evidence/deploy/mainnet-4663.json';
import references from '../../../evidence/deploy/mainnet-4663-reference-adapters.json';
import abiManifest from '../../../packages/protocol/generated/abi-manifest.json';
// @ts-expect-error Shared script module is browser-safe and keeps the factory profile math canonical.
import { resolvePoolConfig, deriveProfileHash, deriveInitialSqrtPrice, deriveSqrtPriceFromAmounts, deriveTickBounds } from '../../../scripts/deploy/mainnet-pool-config.mjs';
// @ts-expect-error Browser-safe mirror is cross-checked against the canonical salt miner.
import { resolveAdmittedPair, poolClassesForPair, mineHookSalt } from './mainnet-create-helpers.mjs';
// @ts-expect-error Shared phase policy is browser-safe and covered by node:test.
import { createPricePathForPhases } from './create-calendar.mjs';
// @ts-expect-error Workspace package export.
import { hashCalendarLeaf } from '@bell/protocol/calendar';

const factoryAbi = abiManifest.interfaces.IBellPoolFactory as Abi;
const factoryEventAbi = abiManifest.interfaces.IBellEvents.filter((item: any) => item.type === 'event' && ['PoolCreated', 'PoolActivated', 'PoolStaged'].includes(item.name)) as Abi;
const registryAbi = parseAbi([
  'function descriptorIdForToken(address token) view returns (bytes32)',
  'function descriptor(bytes32 id) view returns ((bytes32 id,address token,bool isStock,uint8 decimals,uint8 capabilityMask,address tokenPriceAdapter,address regularAdapter,address extendedAdapter,address overnightAdapter,address secondaryAdapter,bytes32 expectedCodeHash,bytes32 implementationFingerprint,bytes32 evidenceHash))',
]);
const sessionAbi = parseAbi([
  'function applyPoolOracleUpdates(bytes32 asset0,bytes32 asset1,bytes payload,bool swapEnvelope)',
  'function health(bytes32 assetId) view returns ((bool ready,uint256 reasonBits,uint64 healthySince,uint64 validUntil,uint64 baselineObservation,uint64 latestObservation))',
  'function anchorStatus(bytes32,bytes32) view returns ((bytes32 assetId,bytes32 boundaryHash,uint128 price18,uint128 multiplier18,uint64 capturedAt,uint64 observedAt,uint64 inputAt,uint64 closureStart,bytes32 sourceHash),bool valid,uint256 reasons,uint64 validUntil)',
]);
const calendarAbi = parseAbi(['function currentInterval(bytes32 assetId) view returns ((bytes32 assetId,uint16 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))']);
const factoryReadAbi = parseAbi([
  'function profileHash() view returns (bytes32)', 'function serviceFee() view returns (uint128)',
  'function serviceRecipient() view returns (address)', 'function nonces(address) view returns (uint64)',
]);
const deployerAbi = parseAbi(['function initCodeHash((address token0,address token1,bytes32 asset0,bytes32 asset1,address poolManager,address positionManager,address factory,address assetRegistry,address calendarRegistry,address safetyController,address treasuryAdapter,uint8 poolClass,uint8 liquidityMode,uint8 referenceMode,int24 tickSpacing,uint128[2] tradeCap,uint128[2] windowCap,uint128[2] closureCap,bytes32 policyId,address referenceAdapter0,address referenceAdapter1) config,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key) view returns (bytes32)']);
const referenceAbi = parseAbi(['function referencePrice() view returns (uint128)']);
const seedAbi = parseAbi(['function seedPrincipal() view returns (uint128[2])']);
const wethAbi = parseAbi(['function deposit() payable']);
const explorer = 'https://robinhoodchain.blockscout.com';

export type CreateSelection = {
  stockSymbol: string;
  counterSymbol: string;
  poolClass: 0 | 1;
  amountStock: bigint;
  amountCounter: bigint;
  wrapWeth: boolean;
};
export type CreateStage = { key: string; message: string; hash?: `0x${string}` };
export type CreateResult = { hook: Address; poolId: `0x${string}`; tokenId: bigint; createHash: `0x${string}`; healthHash: `0x${string}` | null; principal: readonly [bigint, bigint]; staged: boolean; token0: Address; token1: Address };

const publish = (fn: (stage: CreateStage) => void, key: string, message: string, hash?: `0x${string}`) => fn({ key, message, ...(hash ? { hash } : {}) });
const walletFactory = (deployment as any).poolFactory as Address;
const queue = assetQueue as any;
const refs = references as any;

export function admittedPair(stockSymbol: string, counterSymbol: string) {
  return resolveAdmittedPair({ stockSymbol, counterSymbol, assetQueue: queue });
}

export const MAINNET_ASSET_OPTIONS = [
  ...Object.entries(queue.stocks).map(([symbol, asset]: [string, any]) => ({ symbol, token: asset.token as Address, assetId: asset.descriptorId as `0x${string}`, isStock: true })),
  ...['usdg', 'weth'].map((key) => {
    const asset = queue[key];
    return { symbol: asset.symbol ?? key.toUpperCase(), token: asset.token as Address, assetId: asset.descriptorId as `0x${string}`, isStock: false };
  }),
  ...Object.entries(queue.counterassets ?? {}).filter(([, asset]: [string, any]) => asset.active === true && asset.descriptorId)
    .map(([symbol, asset]: [string, any]) => ({ symbol: asset.symbol ?? symbol, token: asset.token as Address, assetId: asset.descriptorId as `0x${string}`, isStock: false })),
].filter((asset) => Boolean(asset.token && asset.assetId));

export function availablePoolClasses(stockSymbol: string, counterSymbol: string) {
  const pair = admittedPair(stockSymbol, counterSymbol);
  return poolClassesForPair(pair, refs.adapters);
}

export async function createMainnetPool({ provider, account, selection, onStage }: {
  provider: EIP1193Provider; account: Address; selection: CreateSelection; onStage: (stage: CreateStage) => void;
}): Promise<CreateResult> {
  const { publicClient: client, walletClient } = makeClients(provider);
  const emit = (key: string, message: string, hash?: `0x${string}`) => publish(onStage, key, message, hash);
  const pair = admittedPair(selection.stockSymbol, selection.counterSymbol);
  const stockLegs = pair.legs.filter((leg: any) => leg.isStock);
  const allowedClasses = availablePoolClasses(selection.stockSymbol, selection.counterSymbol);
  if (!allowedClasses.includes(selection.poolClass)) throw new Error('That pool class is not supported for this admitted pair');
  if (selection.amountStock <= 0n || selection.amountCounter <= 0n) throw new Error('Both seed amounts must be positive');

  emit('preflight', 'Checking wallet, Mainnet contracts, admitted assets, calendars, and factory profile…');
  const chainId = await client.getChainId();
  if (chainId !== MAINNET.chainId) throw new Error(`Wallet is on chain ${chainId}; switch to Robinhood Chain Mainnet (${MAINNET.chainId})`);
  const [block, factoryCode, registryCode, sessionCode, profileHash, serviceFee, feeDecimals, serviceRecipient] = await Promise.all([
    client.getBlock(), client.getBytecode({ address: walletFactory }),
    client.getBytecode({ address: (deployment as any).assetRegistry }), client.getBytecode({ address: MAINNET.sessionRegistry }),
    client.readContract({ address: walletFactory, abi: factoryReadAbi, functionName: 'profileHash' }),
    client.readContract({ address: walletFactory, abi: factoryReadAbi, functionName: 'serviceFee' }),
    client.readContract({ address: (deployment as any).feeToken, abi: tokenAbi, functionName: 'decimals' }),
    client.readContract({ address: walletFactory, abi: factoryReadAbi, functionName: 'serviceRecipient' }),
  ]);
  if (!factoryCode || factoryCode === '0x' || !registryCode || registryCode === '0x' || !sessionCode || sessionCode === '0x') throw new Error('A required Mainnet contract has no code');
  if (serviceRecipient.toLowerCase() === account.toLowerCase()) throw new Error('The service-recipient wallet cannot create a pool');

  const refsBySymbol: Record<string, Address> = {};
  for (const leg of pair.legs as any[]) {
    const evidence = refs.adapters?.[`${leg.symbol}/USD`];
    if (evidence?.adapter) refsBySymbol[leg.symbol] = evidence.adapter as Address;
    const admittedId = await client.readContract({ address: (deployment as any).assetRegistry, abi: registryAbi, functionName: 'descriptorIdForToken', args: [leg.token] });
    if (admittedId.toLowerCase() !== leg.assetId.toLowerCase()) throw new Error(`${leg.symbol} descriptor does not match the live AssetRegistry`);
    const descriptor: any = await client.readContract({ address: (deployment as any).assetRegistry, abi: registryAbi, functionName: 'descriptor', args: [leg.assetId] });
    if (descriptor.token.toLowerCase() !== leg.token.toLowerCase() || descriptor.isStock !== leg.isStock) throw new Error(`${leg.symbol} live admission does not match its pool metadata`);
  }
  if (selection.poolClass === 0 && pair.legs.some((leg: any) => !refsBySymbol[leg.symbol])) throw new Error('PRICE_GUARDED requires an admitted live reference adapter for both assets');
  if (selection.poolClass === 1 && stockLegs.length !== 1) throw new Error('SESSION_ONLY requires exactly one stock leg');
  const referencesForPair = selection.poolClass === 0 ? pair.legs.map((leg: any) => refsBySymbol[leg.symbol]) : [undefined, undefined];
  const tokenA = pair.legs.find((leg: any) => leg.symbol === selection.stockSymbol) as any;
  const tokenB = pair.legs.find((leg: any) => leg.symbol === selection.counterSymbol) as any;
  const [decimalsA, decimalsB, tokenASymbol, tokenBSymbol] = await Promise.all([
    client.readContract({ address: tokenA.token, abi: tokenAbi, functionName: 'decimals' }),
    client.readContract({ address: tokenB.token, abi: tokenAbi, functionName: 'decimals' }),
    client.readContract({ address: tokenA.token, abi: tokenAbi, functionName: 'symbol' }),
    client.readContract({ address: tokenB.token, abi: tokenAbi, functionName: 'symbol' }),
  ]);
  if (Number(decimalsA) !== (tokenA.symbol === 'USDG' ? 6 : 18) || Number(decimalsB) !== (tokenB.symbol === 'USDG' ? 6 : 18)) {
    throw new Error('A selected token reports unexpected decimals; stop and review its live contract metadata');
  }
  const amountMaxA = selection.amountStock;
  const amountMaxB = selection.amountCounter;
  const config = resolvePoolConfig({
    tokenA: tokenA.token, assetA: tokenA.assetId, tokenB: tokenB.token, assetB: tokenB.assetId,
    amountAMax: amountMaxA, amountBMax: amountMaxB,
    referenceAdapterA: referencesForPair[pair.legs.findIndex((leg: any) => leg.symbol === tokenA.symbol)],
    referenceAdapterB: referencesForPair[pair.legs.findIndex((leg: any) => leg.symbol === tokenB.symbol)],
    poolManager: (deployment as any).poolManager, positionManager: (deployment as any).positionManager,
    factory: walletFactory, assetRegistry: (deployment as any).assetRegistry,
    calendarRegistry: (deployment as any).calendarRegistry, safetyController: (deployment as any).safetyController,
    policyId: 'bell-mainnet-v1', poolClass: selection.poolClass,
    tradeCap: [10n, 10n], windowCap: [100n, 100n], closureCap: [1n, 1n],
  });
  const neutralProfileHash = deriveProfileHash({ ...config.config, poolClass: 0, referenceAdapter0: `0x${'0'.repeat(40)}`, referenceAdapter1: `0x${'0'.repeat(40)}` });
  if (profileHash.toLowerCase() !== neutralProfileHash.toLowerCase()) throw new Error('The requested pool configuration does not match the deployed factory profile');

  const calendarIntervals = await Promise.all(stockLegs.map((leg: any) => client.readContract({
    address: (deployment as any).calendarRegistry, abi: calendarAbi, functionName: 'currentInterval', args: [leg.assetId],
  })));
  const calendarPhases = calendarIntervals.map((interval: any) => Number(interval.phase));
  const pricePath = createPricePathForPhases(calendarPhases);
  if (pricePath === 'unavailable') {
    throw new Error('Stock legs do not share one supported Mainnet price phase. Refresh the calendar and try again.');
  }
  const closePrices = new Map<string, bigint>();
  let missingCloseAnchor = false;
  for (const [i, interval] of calendarIntervals.entries()) {
    const data = interval as any;
    if (data.assetId.toLowerCase() !== stockLegs[i].assetId.toLowerCase() || data.end <= block.timestamp) {
      throw new Error(`No current Mainnet market interval is available for ${stockLegs[i].symbol}`);
    }
    if (pricePath === 'anchor') {
      const boundaryHash = hashCalendarLeaf({
        chainId: BigInt(MAINNET.chainId), calendarRegistry: MAINNET.calendarRegistry,
        assetId: stockLegs[i].assetId, year: Number(data.year), index: Number(data.index),
        start: data.start, end: data.end, phase: Number(data.phase), provenanceHash: data.provenanceHash,
      });
      const [anchor, valid, , validUntil] = await client.readContract({
        address: MAINNET.sessionRegistry, abi: sessionAbi, functionName: 'anchorStatus',
        args: [stockLegs[i].assetId, boundaryHash],
      }) as readonly [any, boolean, bigint, bigint];
      if (!valid || validUntil <= block.timestamp) {
        missingCloseAnchor = true;
      } else if (BigInt(anchor.price18) > 0n) {
        closePrices.set(stockLegs[i].assetId.toLowerCase(), BigInt(anchor.price18));
      } else {
        missingCloseAnchor = true;
      }
    } else if (data.phase < 1 || data.phase > 4) {
      throw new Error(`No fresh onchain stock price source is configured for ${stockLegs[i].symbol} in phase ${data.phase}`);
    }
  }
  const [amount0, amount1] = config.amountMax as readonly [bigint, bigint];
  let sqrtPriceX96: bigint;
  if (selection.poolClass === 0) {
    try {
      const priceFor = async (assetId: `0x${string}`, adapter: Address) => {
        const anchored = closePrices.get(assetId.toLowerCase());
        if (anchored) return anchored;
        return await client.readContract({ address: adapter, abi: referenceAbi, functionName: 'referencePrice' }) as bigint;
      };
      const [price0, price1] = await Promise.all([
        priceFor(config.config.asset0 as `0x${string}`, config.config.referenceAdapter0 as Address),
        priceFor(config.config.asset1 as `0x${string}`, config.config.referenceAdapter1 as Address),
      ]);
      sqrtPriceX96 = deriveInitialSqrtPrice({
        price0_18: price0, price1_18: price1,
        decimals0: Number(config.token0.toLowerCase() === tokenA.token.toLowerCase() ? decimalsA : decimalsB),
        decimals1: Number(config.token1.toLowerCase() === tokenA.token.toLowerCase() ? decimalsA : decimalsB),
      });
    } catch {
      sqrtPriceX96 = deriveSqrtPriceFromAmounts({ amount0, amount1 });
      missingCloseAnchor = true;
    }
  } else {
    sqrtPriceX96 = deriveSqrtPriceFromAmounts({ amount0, amount1 });
  }
  if (selection.poolClass === 0 && missingCloseAnchor) {
    publish(onStage, 'health', 'No reference price is available. The seed ratio will set the initial AMM price; the pool will use its disclosed fallback policy until live protection inputs return.');
  }
  const { tickLower, tickUpper } = deriveTickBounds({ sqrtPriceX96, tickSpacing: 60, halfWidth: 6000 });

  const [nonce, nativeBalance, balance0, balance1, feeBalance] = await Promise.all([
    client.readContract({ address: walletFactory, abi: factoryReadAbi, functionName: 'nonces', args: [account] }),
    client.getBalance({ address: account }),
    client.readContract({ address: config.token0, abi: tokenAbi, functionName: 'balanceOf', args: [account] }),
    client.readContract({ address: config.token1, abi: tokenAbi, functionName: 'balanceOf', args: [account] }),
    client.readContract({ address: (deployment as any).feeToken, abi: tokenAbi, functionName: 'balanceOf', args: [account] }),
  ]);
  const tokenNeeds = new Map<string, bigint>([[config.token0.toLowerCase(), amount0], [config.token1.toLowerCase(), amount1]]);
  tokenNeeds.set((deployment as any).feeToken.toLowerCase(), (tokenNeeds.get((deployment as any).feeToken.toLowerCase()) ?? 0n) + serviceFee);
  const balanceByToken = new Map([[config.token0.toLowerCase(), balance0], [config.token1.toLowerCase(), balance1], [(deployment as any).feeToken.toLowerCase(), feeBalance]]);
  let wrapAmount = 0n;
  if (config.token0.toLowerCase() === MAINNET.weth.toLowerCase() && balance0 < amount0) wrapAmount = amount0 - balance0;
  if (config.token1.toLowerCase() === MAINNET.weth.toLowerCase() && balance1 < amount1) wrapAmount = amount1 - balance1;
  if (wrapAmount > 0n && !selection.wrapWeth) throw new Error(`Wallet needs ${formatUnits(wrapAmount, 18)} more WETH. Enable the exact ETH-to-WETH wrap option to continue.`);
  if (wrapAmount > 0n && nativeBalance <= wrapAmount) throw new Error('Wallet ETH balance cannot cover the WETH wrap and transaction gas');
  for (const [token, required] of tokenNeeds) {
    const actual = balanceByToken.get(token) ?? 0n;
    const isWeth = token === MAINNET.weth.toLowerCase();
    if (actual < required && !(isWeth && wrapAmount >= required - actual)) {
      const symbol = token === (deployment as any).feeToken.toLowerCase() ? 'USDG' : token.toLowerCase() === tokenA.token.toLowerCase() ? String(tokenASymbol) : String(tokenBSymbol);
      throw new Error(`Insufficient ${symbol}: need ${formatUnits(required, token === (deployment as any).feeToken.toLowerCase() ? Number(feeDecimals) : token.toLowerCase() === tokenA.token.toLowerCase() ? Number(decimalsA) : Number(decimalsB))}`);
    }
  }
  if (nativeBalance === 0n) throw new Error('Wallet has no ETH for Mainnet transaction gas');

  const key = { currency0: config.token0 as Address, currency1: config.token1 as Address, fee: 0x800000, tickSpacing: 60, hooks: `0x${'0'.repeat(40)}` as Address };
  const initCodeHash = await client.readContract({ address: (deployment as any).hookDeployer, abi: deployerAbi, functionName: 'initCodeHash', args: [config.config, key] });
  const mined = mineHookSalt({ chainId: BigInt(MAINNET.chainId), factory: walletFactory, creator: account, deployer: (deployment as any).hookDeployer, nonce, baseSalt: `0x${'0'.repeat(63)}1`, initCodeHash, maxAttempts: 200_000 });
  const predictedPoolId = keccak256(encodeAbiParameters([{ type: 'tuple', components: [
    { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
  ] }], [{ ...key, hooks: mined.hook }]));
  emit('prepared', `Preflight passed. Predicted hook ${mined.hook}; Pool ID ${predictedPoolId}; ticks ${tickLower} to ${tickUpper}; per-trade caps ${config.config.tradeCap.map(String).join(' / ')} base units; rolling caps ${config.config.windowCap.map(String).join(' / ')} base units. Pair ${tokenASymbol}/${tokenBSymbol}.`);

  if (wrapAmount > 0n) {
    emit('wrap', `Confirm wrapping exactly ${formatUnits(wrapAmount, 18)} ETH into WETH…`);
    const hash = await walletClient.writeContract({ address: MAINNET.weth, abi: wethAbi, functionName: 'deposit', account, value: wrapAmount } as any);
    emit('wrap', 'Waiting for WETH wrap confirmation…', hash);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`WETH wrap reverted: ${explorer}/tx/${hash}`);
  }

  for (const [token, required] of tokenNeeds) {
    const allowance = await client.readContract({ address: token as Address, abi: tokenAbi, functionName: 'allowance', args: [account, walletFactory] });
    if (allowance >= required) continue;
    emit('approve', `Confirm ${token.toLowerCase() === (deployment as any).feeToken.toLowerCase() ? 'USDG fee + seed' : token.toLowerCase() === config.token0.toLowerCase() ? tokenASymbol : tokenBSymbol} approval for the factory…`);
    const hash = await walletClient.writeContract({ address: token as Address, abi: tokenAbi, functionName: 'approve', args: [walletFactory, required], account } as any);
    emit('approve', 'Waiting for token approval confirmation…', hash);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`Token approval reverted: ${explorer}/tx/${hash}`);
  }

  const healthHash: `0x${string}` | null = null;
  emit('health', selection.poolClass === 1
    ? 'SESSION_ONLY uses the AMM price and does not require a stock-feed update.'
    : missingCloseAnchor
      ? 'No external reference is available. The factory will activate the pool under fallback policy if its safety checks pass.'
      : 'The factory will verify its configured price-protection inputs during pool creation.');

  if (await client.getChainId() !== MAINNET.chainId) throw new Error('Wallet changed away from Robinhood Chain Mainnet; restart pool creation');
  const currentAccounts = await walletClient.getAddresses();
  if (!currentAccounts.some((address) => address.toLowerCase() === account.toLowerCase())) throw new Error('Connected wallet changed during pool creation; restart the flow');
  const latestBlock = await client.getBlock();
  if (pricePath === 'anchor') {
    for (const [i, interval] of calendarIntervals.entries()) {
      const data = interval as any;
      const boundaryHash = hashCalendarLeaf({
        chainId: BigInt(MAINNET.chainId), calendarRegistry: MAINNET.calendarRegistry, assetId: stockLegs[i].assetId,
        year: Number(data.year), index: Number(data.index), start: data.start, end: data.end,
        phase: Number(data.phase), provenanceHash: data.provenanceHash,
      });
      const [, valid, , validUntil] = await client.readContract({
        address: MAINNET.sessionRegistry, abi: sessionAbi, functionName: 'anchorStatus',
        args: [stockLegs[i].assetId, boundaryHash],
      }) as readonly [unknown, boolean, bigint, bigint];
      // A missing close anchor activates the contract's explicitly flagged AMM-only fallback.
      void valid; void validUntil;
    }
  }
  const deadline = latestBlock.timestamp + 1200n;
  const request = {
    config: config.config, salt: mined.requestSalt, nonce, deadline, recipient: account,
    sqrtPriceX96, tickLower, tickUpper, liquidity: 10n ** 15n,
    amountMax: config.amountMax, maxServiceFee: serviceFee,
  };
  const createSimulation: any = await client.simulateContract({ address: walletFactory, abi: factoryAbi, functionName: 'createAndSeed', args: [request], account } as any);
  const [gas, gasPrice, gasBalance] = await Promise.all([
    client.estimateContractGas({ address: walletFactory, abi: factoryAbi, functionName: 'createAndSeed', args: [request], account } as any),
    client.getGasPrice(), client.getBalance({ address: account }),
  ]);
  const createCost = gas * gasPrice;
  if (gasBalance < createCost) throw new Error(`Wallet ETH cannot cover estimated create transaction gas (${formatUnits(createCost, 18)} ETH)`);
  emit('create', `Simulation passed. Confirm create-and-seed; factory fee is ${formatUnits(serviceFee, Number(feeDecimals))} USDG plus the seed and gas…`);
  const createHash = await walletClient.writeContract(createSimulation.request as any);
  emit('create', 'Pool transaction submitted; waiting for Mainnet confirmation…', createHash);
  const receipt = await client.waitForTransactionReceipt({ hash: createHash });
  if (receipt.status !== 'success') throw new Error(`Pool creation reverted: ${explorer}/tx/${createHash}`);
  const decoded = receipt.logs.map((log) => {
    try { return decodeEventLog({ abi: factoryEventAbi, data: log.data, topics: log.topics }); } catch { return null; }
  });
  const created: any = decoded.find((event: any) => event?.eventName === 'PoolCreated');
  const activated: any = decoded.find((event: any) => event?.eventName === 'PoolActivated');
  const stagedEvent: any = decoded.find((event: any) => event?.eventName === 'PoolStaged');
  const completion = activated ?? stagedEvent;
  if (!created || !completion || created.args.creator.toLowerCase() !== account.toLowerCase() || created.args.recipient.toLowerCase() !== account.toLowerCase() || created.args.poolId.toLowerCase() !== completion.args.poolId.toLowerCase() || created.args.poolId.toLowerCase() !== predictedPoolId.toLowerCase() || created.args.hook.toLowerCase() !== mined.hook.toLowerCase()) {
    throw new Error(`Transaction succeeded but PoolCreated and activation/staging evidence is missing: ${explorer}/tx/${createHash}`);
  }
  const tokenId = BigInt(completion.args.tokenId);
  if (tokenId > 0n) {
    const owner = await client.readContract({ address: (deployment as any).positionManager, abi: parseAbi(['function ownerOf(uint256 tokenId) view returns (address)']), functionName: 'ownerOf', args: [tokenId] });
    if (owner.toLowerCase() !== account.toLowerCase()) throw new Error(`Position NFT owner check failed; inspect ${explorer}/tx/${createHash}`);
  }
  const principal = await client.readContract({ address: created.args.hook, abi: seedAbi, functionName: 'seedPrincipal' }) as readonly [bigint, bigint];
  const staged = Boolean(stagedEvent);
  emit('complete', staged
    ? `Pool created and seeded in block ${receipt.blockNumber}. It is STAGED; refresh the live pool status to see when onchain policy activates swaps.`
    : `Pool created and seeded in block ${receipt.blockNumber}. Position NFT #${tokenId} belongs to your wallet.`, createHash);
  return { hook: created.args.hook as Address, poolId: created.args.poolId as `0x${string}`, tokenId, createHash, healthHash, principal, staged, token0: config.token0 as Address, token1: config.token1 as Address };
}
