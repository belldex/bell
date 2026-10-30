import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePoolConfig, sortPoolTokens, checkSeedFunding } from './mainnet-pool-config.mjs';

const WETH = '0x00000000000000000000000000000000000000aa';
const STOCK = '0x00000000000000000000000000000000000000bb';
const WETH_ASSET = `0x${'11'.repeat(32)}`;
const STOCK_ASSET = `0x${'22'.repeat(32)}`;

/** Contract addresses the factory config requires; tests override only what they exercise. */
const WIRING = Object.freeze({
  poolManager: '0x00000000000000000000000000000000000000c1',
  positionManager: '0x00000000000000000000000000000000000000c2',
  factory: '0x00000000000000000000000000000000000000c3',
  assetRegistry: '0x00000000000000000000000000000000000000c4',
  calendarRegistry: '0x00000000000000000000000000000000000000c5',
  safetyController: '0x00000000000000000000000000000000000000c6',
});

test('sorts tokens canonically and keeps each assetId with its own token', () => {
  const sorted = sortPoolTokens({ tokenA: WETH, assetA: WETH_ASSET, tokenB: STOCK, assetB: STOCK_ASSET,
    referenceAdapterA: '0x0000000000000000000000000000000000000000', referenceAdapterB: '0x0000000000000000000000000000000000000000' });
  assert.equal(sorted.token0, WETH);
  assert.equal(sorted.asset0, WETH_ASSET);
  assert.equal(sorted.token1, STOCK);
  assert.equal(sorted.asset1, STOCK_ASSET);
});

test('asset ids follow their tokens when the stock address sorts first', () => {
  const lowStock = '0x0000000000000000000000000000000000000001';
  const sorted = sortPoolTokens({ tokenA: WETH, assetA: WETH_ASSET, tokenB: lowStock, assetB: STOCK_ASSET,
    referenceAdapterA: '0x0000000000000000000000000000000000000000', referenceAdapterB: '0x0000000000000000000000000000000000000000' });
  assert.equal(sorted.token0, lowStock);
  assert.equal(sorted.asset0, STOCK_ASSET, 'asset0 must belong to token0, not to WETH by habit');
  assert.equal(sorted.token1, WETH);
  assert.equal(sorted.asset1, WETH_ASSET);
});

test('reference adapters follow their tokens when pair token order is canonicalized', () => {
  const lowStock = '0x0000000000000000000000000000000000000001';
  const sorted = sortPoolTokens({
    tokenA: WETH, assetA: WETH_ASSET, tokenB: lowStock, assetB: STOCK_ASSET,
    referenceAdapterA: '0x00000000000000000000000000000000000000d1',
    referenceAdapterB: '0x00000000000000000000000000000000000000d2',
  });
  assert.equal(sorted.token0, lowStock);
  assert.equal(sorted.referenceAdapter0, '0x00000000000000000000000000000000000000d2');
  assert.equal(sorted.token1, WETH);
  assert.equal(sorted.referenceAdapter1, '0x00000000000000000000000000000000000000d1');
});

test('amountMax follows the same ordering so the quote leg is never swapped', () => {
  const config = resolvePoolConfig({
    tokenA: WETH, assetA: WETH_ASSET, tokenB: STOCK, assetB: STOCK_ASSET,
    amountAMax: 2n * 10n ** 15n, amountBMax: 100n * 10n ** 18n, ...WIRING,
  });
  assert.deepEqual(config.amountMax, [2n * 10n ** 15n, 100n * 10n ** 18n]);
});

test('a policy id names the network so a mainnet pool cannot inherit the testnet policy label', () => {
  const config = resolvePoolConfig({
    tokenA: WETH, assetA: WETH_ASSET, tokenB: STOCK, assetB: STOCK_ASSET,
    amountAMax: 1n, amountBMax: 1n, policyId: 'bell-mainnet-v1', ...WIRING,
  });
  assert.equal(config.policyId, 'bell-mainnet-v1');
  assert.equal(config.config.poolClass, 1, 'only SESSION_ONLY is enabled');
  assert.equal(config.config.liquidityMode, 0);
  assert.equal(config.config.treasuryAdapter, '0x0000000000000000000000000000000000000000');
});

test('the default policy id is a mainnet id, not the testnet one', () => {
  const config = resolvePoolConfig({
    tokenA: WETH, assetA: WETH_ASSET, tokenB: STOCK, assetB: STOCK_ASSET, amountAMax: 1n, amountBMax: 1n, ...WIRING,
  });
  assert.equal(config.policyId, 'bell-mainnet-v1');
  assert.ok(!/testnet/i.test(config.policyId));
});

test('derives the SESSION_ONLY opening price from seed amounts instead of a raw 1:1 ratio', async () => {
  const poolConfigModule = await import('./mainnet-pool-config.mjs');
  assert.equal(typeof poolConfigModule.deriveTickBounds, 'function');
  assert.equal(typeof poolConfigModule.deriveSqrtPriceFromAmounts, 'function');
  const q96 = 1n << 96n;
  const oneToOne = poolConfigModule.deriveTickBounds({ sqrtPriceX96: q96, tickSpacing: 60, halfWidth: 6000 });
  assert.deepEqual(oneToOne, { tickLower: -6000, tickUpper: 6000, currentTick: 0 });

  const stockPerEth = poolConfigModule.deriveInitialSqrtPrice({
    price0_18: 2238n * 10n ** 18n,
    price1_18: 343n * 10n ** 18n,
  });
  const priced = poolConfigModule.deriveTickBounds({ sqrtPriceX96: stockPerEth, tickSpacing: 60, halfWidth: 6000 });
  assert.ok(priced.currentTick > 10_000, 'WETH/AAPL ratio must not be treated as 1:1');
  assert.ok(priced.tickLower < priced.currentTick && priced.tickUpper > priced.currentTick);
  assert.equal(priced.tickLower % 60, 0);
  assert.equal(priced.tickUpper % 60, 0);

  const seedRatio = poolConfigModule.deriveSqrtPriceFromAmounts({
    amount0: 20_000_000n,
    amount1: 57_300_000_000_000_000n,
  });
  const impliedRawRatio = (seedRatio * seedRatio * 20_000_000n) >> 192n;
  assert.ok(impliedRawRatio <= 57_300_000_000_000_000n);
  assert.ok(seedRatio > q96, 'USDG/AAPL seed ratio must not open at a raw 1:1 price');
});

test('a zero seed amount is rejected before it reaches the factory', () => {
  assert.throws(
    () => resolvePoolConfig({
      tokenA: WETH, assetA: WETH_ASSET, tokenB: STOCK, assetB: STOCK_ASSET, amountAMax: 0n, amountBMax: 1n, ...WIRING,
    }),
    /amountAMax/,
  );
  assert.throws(
    () => resolvePoolConfig({
      tokenA: WETH, assetA: WETH_ASSET, tokenB: STOCK, assetB: STOCK_ASSET, amountAMax: 1n, amountBMax: 0n,
    }),
    /amountBMax/,
  );
});

test('identical tokens are rejected instead of building a self-pool', () => {
  assert.throws(
    () => resolvePoolConfig({
      tokenA: WETH, assetA: WETH_ASSET, tokenB: WETH, assetB: STOCK_ASSET, amountAMax: 1n, amountBMax: 1n, ...WIRING,
    }),
    /distinct/,
  );
});

test('native ETH can cover a WETH seed shortfall without existing WETH', () => {
  const result = checkSeedFunding({
    token0: WETH,
    weth: WETH,
    amountMax: [2n, 100n],
    wethBalance: 0n,
    stockBalance: 100n,
    nativeBalance: 2n,
    feeBalance: 1n,
    serviceFee: 1n,
    wrapNativeForWeth: true,
  });
  assert.deepEqual(result.shortfalls, []);
  assert.equal(result.nativeToWrap, 2n);
});

test('native ETH insufficiency is reported when WETH must be wrapped', () => {
  const result = checkSeedFunding({
    token0: WETH,
    weth: WETH,
    amountMax: [2n, 100n],
    wethBalance: 0n,
    stockBalance: 100n,
    nativeBalance: 1n,
    feeBalance: 1n,
    serviceFee: 1n,
    wrapNativeForWeth: true,
  });
  assert.deepEqual(result.shortfalls, ['native ETH 1 < WETH shortfall 2']);
});

test('wrapping preserves the configured native gas reserve', () => {
  const result = checkSeedFunding({
    token0: WETH,
    weth: WETH,
    amountMax: [2n, 100n],
    wethBalance: 0n,
    stockBalance: 100n,
    nativeBalance: 11n,
    nativeGasReserve: 10n,
    feeBalance: 1n,
    serviceFee: 1n,
    wrapNativeForWeth: true,
  });
  assert.deepEqual(result.shortfalls, ['native ETH after wrap 9 < gas reserve 10']);
  assert.equal(result.nativeToWrap, 2n);
});

test('generic seed funding checks both arbitrary pair tokens in canonical order', () => {
  const result = checkSeedFunding({
    token0: STOCK,
    tokenA: WETH,
    tokenB: STOCK,
    amountMax: [5n, 7n],
    tokenABalance: 7n,
    tokenBBalance: 4n,
    nativeBalance: 0n,
    feeBalance: 100n,
    serviceFee: 1n,
  });
  assert.deepEqual(result.shortfalls, [`token ${STOCK} balance 4 < 5`]);
  assert.equal(result.nativeToWrap, 0n);
});

test('generic seed funding wraps only the WETH side regardless of canonical order', () => {
  const result = checkSeedFunding({
    token0: STOCK,
    tokenA: WETH,
    tokenB: STOCK,
    amountMax: [5n, 10n],
    tokenABalance: 0n,
    tokenBBalance: 5n,
    weth: WETH,
    wethBalance: 0n,
    nativeBalance: 20n,
    nativeGasReserve: 5n,
    feeBalance: 1n,
    serviceFee: 1n,
    wrapNativeForWeth: true,
  });
  assert.deepEqual(result.shortfalls, []);
  assert.equal(result.nativeToWrap, 10n);
});

test('rejects generic seed inputs when an asset id or amount is missing', () => {
  assert.throws(() => resolvePoolConfig({
    tokenA: WETH, assetA: WETH_ASSET, tokenB: STOCK, assetB: STOCK_ASSET,
    amountAMax: 1n, amountBMax: undefined,
    ...WIRING,
  }), /amountBMax/);
});

test('requires USDG balance to cover both a USDG seed leg and service fee', () => {
  const result = checkSeedFunding({
    token0: WETH,
    tokenA: STOCK,
    tokenB: WETH,
    tokenABalance: 1n,
    tokenBBalance: 10n,
    amountMax: [10n, 1n],
    nativeBalance: 0n,
    feeBalance: 12n,
    feeToken: WETH,
    serviceFee: 5n,
  });
  assert.deepEqual(result.shortfalls, ['fee token 12 < service fee 5 + seed 10']);
});

test('SESSION_ONLY meme/stock pair does not require counterasset WETH funding', () => {
  const meme = '0x00000000000000000000000000000000000000dd';
  const result = checkSeedFunding({
    token0: STOCK,
    tokenA: STOCK,
    tokenB: meme,
    tokenABalance: 4n,
    tokenBBalance: 7n,
    amountMax: [4n, 7n],
    nativeBalance: 0n,
    feeBalance: 100n,
    feeToken: '0x00000000000000000000000000000000000000ee',
    serviceFee: 1n,
    weth: WETH,
    wethBalance: 0n,
  });
  assert.deepEqual(result.shortfalls, []);
  assert.equal(result.nativeToWrap, 0n);
});

test('no WETH wrapping does not reject a low native balance when WETH is not in the pair', () => {
  const result = checkSeedFunding({
    token0: STOCK,
    tokenA: STOCK,
    tokenB: '0x00000000000000000000000000000000000000dd',
    tokenABalance: 10n,
    tokenBBalance: 10n,
    amountMax: [10n, 10n],
    nativeBalance: 1n,
    nativeGasReserve: 5n,
    feeBalance: 10n,
    feeToken: '0x00000000000000000000000000000000000000ee',
    serviceFee: 1n,
    weth: WETH,
    wethBalance: 0n,
    wrapNativeForWeth: true,
  });
  assert.deepEqual(result.shortfalls, []);
});

test('deriveInitialSqrtPrice is monotonic in the price ratio', async () => {
  const { deriveInitialSqrtPrice } = await import('./mainnet-pool-config.mjs');
  const low = deriveInitialSqrtPrice({ price0_18: 100n * 10n ** 18n, price1_18: 1n * 10n ** 18n });
  const high = deriveInitialSqrtPrice({ price0_18: 200n * 10n ** 18n, price1_18: 1n * 10n ** 18n });
  assert.ok(high > low);
});

test('deriveInitialSqrtPrice handles decimal differences', async () => {
  const { deriveInitialSqrtPrice } = await import('./mainnet-pool-config.mjs');
  // 18-decimal stock at $350 vs 6-decimal USDG at $1: token1-raw / token0-raw
  // equals (350 / 1) * 10^(6-18) = 350 * 1e-12.
  const sqrt = deriveInitialSqrtPrice({ price0_18: 350n * 10n ** 18n, price1_18: 1n * 10n ** 18n, decimals0: 18, decimals1: 6 });
  const expected = integerSqrt((350n * (1n << 192n)) / (10n ** 12n));
  assert.equal(sqrt, expected);
});

test('equal per-token prices with equal decimals derive the neutral sqrt price', async () => {
  const { deriveInitialSqrtPrice } = await import('./mainnet-pool-config.mjs');
  assert.equal(deriveInitialSqrtPrice({ price0_18: 10n ** 18n, price1_18: 10n ** 18n }), 1n << 96n);
});

function integerSqrt(value) {
  if (value < 0n) throw new RangeError('negative');
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + value / x) >> 1n; }
  return x;
}

test('deriveInitialSqrtPrice rejects non-positive prices', async () => {
  const { deriveInitialSqrtPrice } = await import('./mainnet-pool-config.mjs');
  assert.throws(() => deriveInitialSqrtPrice({ price0_18: 0n, price1_18: 1n }), /price0_18/);
  assert.throws(() => deriveInitialSqrtPrice({ price0_18: 1n, price1_18: 0n }), /price1_18/);
});

test('resolvePoolConfig supports poolClass 0 with both reference adapters', async () => {
  const config = resolvePoolConfig({
    tokenA: WETH, assetA: WETH_ASSET, tokenB: STOCK, assetB: STOCK_ASSET,
    amountAMax: 1n, amountBMax: 1n, ...WIRING,
    poolClass: 0,
    referenceAdapterA: '0x00000000000000000000000000000000000000d1',
    referenceAdapterB: '0x00000000000000000000000000000000000000d2',
  });
  assert.equal(config.config.poolClass, 0);
  assert.equal(config.config.referenceAdapter0, config.token0 === WETH ? '0x00000000000000000000000000000000000000d1' : '0x00000000000000000000000000000000000000d2');
  assert.equal(config.config.referenceAdapter1, config.token1 === WETH ? '0x00000000000000000000000000000000000000d1' : '0x00000000000000000000000000000000000000d2');
});

test('PRICE_GUARDED requires references and SESSION_ONLY rejects reference claims', () => {
  const base = {
    tokenA: WETH, assetA: WETH_ASSET, tokenB: STOCK, assetB: STOCK_ASSET,
    amountAMax: 1n, amountBMax: 1n, ...WIRING,
  };
  assert.throws(() => resolvePoolConfig({ ...base, poolClass: 0 }), /both pool tokens/);
  assert.throws(() => resolvePoolConfig({
    ...base,
    referenceAdapterA: '0x00000000000000000000000000000000000000d1',
  }), /SESSION_ONLY/);
});

test('PRICE_GUARDED resolves both token sides and produces the raw-order seed ratio inputs', async () => {
  const { deriveInitialSqrtPrice } = await import('./mainnet-pool-config.mjs');
  const usdg = '0x00000000000000000000000000000000000000aa';
  const stock = '0x00000000000000000000000000000000000000bb';
  const resolved = resolvePoolConfig({
    tokenA: usdg,
    assetA: WETH_ASSET,
    tokenB: stock,
    assetB: STOCK_ASSET,
    amountAMax: 500n * 10n ** 6n,
    amountBMax: 500n * 10n ** 18n,
    poolClass: 0,
    referenceAdapterA: '0x00000000000000000000000000000000000000d1',
    referenceAdapterB: '0x00000000000000000000000000000000000000d2',
    ...WIRING,
  });
  assert.equal(resolved.config.referenceAdapter0, '0x00000000000000000000000000000000000000d1');
  assert.equal(resolved.config.referenceAdapter1, '0x00000000000000000000000000000000000000d2');
  assert.deepEqual(resolved.amountMax, [500n * 10n ** 6n, 500n * 10n ** 18n]);
  assert.ok(deriveInitialSqrtPrice({
    price0_18: 1n * 10n ** 18n,
    price1_18: 350n * 10n ** 18n,
    decimals0: 6,
    decimals1: 18,
  }) > 0n);
});

test('USDG pool seeding checks token balance, service fee, and WETH wrapping independently', () => {
  const usdg = '0x00000000000000000000000000000000000000ee';
  const result = checkSeedFunding({
    token0: usdg,
    tokenA: usdg,
    tokenB: STOCK,
    amountMax: [20n, 5n],
    tokenABalance: 60n,
    tokenBBalance: 5n,
    nativeBalance: 10n,
    feeBalance: 70n,
    feeToken: usdg,
    serviceFee: 49n,
    weth: WETH,
  });
  assert.deepEqual(result.shortfalls, []);
});
