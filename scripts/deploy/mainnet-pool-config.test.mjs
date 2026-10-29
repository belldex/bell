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
  const sorted = sortPoolTokens({ weth: WETH, wethAssetId: WETH_ASSET, stock: STOCK, stockAssetId: STOCK_ASSET });
  assert.equal(sorted.token0, WETH);
  assert.equal(sorted.asset0, WETH_ASSET);
  assert.equal(sorted.token1, STOCK);
  assert.equal(sorted.asset1, STOCK_ASSET);
});

test('asset ids follow their tokens when the stock address sorts first', () => {
  const lowStock = '0x0000000000000000000000000000000000000001';
  const sorted = sortPoolTokens({ weth: WETH, wethAssetId: WETH_ASSET, stock: lowStock, stockAssetId: STOCK_ASSET });
  assert.equal(sorted.token0, lowStock);
  assert.equal(sorted.asset0, STOCK_ASSET, 'asset0 must belong to token0, not to WETH by habit');
  assert.equal(sorted.token1, WETH);
  assert.equal(sorted.asset1, WETH_ASSET);
});

test('amountMax follows the same ordering so the quote leg is never swapped', () => {
  const config = resolvePoolConfig({
    weth: WETH, wethAssetId: WETH_ASSET, stock: STOCK, stockAssetId: STOCK_ASSET,
    wethMax: 2n * 10n ** 15n, stockMax: 100n * 10n ** 18n, ...WIRING,
  });
  assert.deepEqual(config.amountMax, [2n * 10n ** 15n, 100n * 10n ** 18n]);
});

test('a policy id names the network so a mainnet pool cannot inherit the testnet policy label', () => {
  const config = resolvePoolConfig({
    weth: WETH, wethAssetId: WETH_ASSET, stock: STOCK, stockAssetId: STOCK_ASSET,
    wethMax: 1n, stockMax: 1n, policyId: 'bell-mainnet-v1', ...WIRING,
  });
  assert.equal(config.policyId, 'bell-mainnet-v1');
  assert.equal(config.config.poolClass, 1, 'only SESSION_ONLY is enabled');
  assert.equal(config.config.liquidityMode, 0);
  assert.equal(config.config.treasuryAdapter, '0x0000000000000000000000000000000000000000');
});

test('the default policy id is a mainnet id, not the testnet one', () => {
  const config = resolvePoolConfig({
    weth: WETH, wethAssetId: WETH_ASSET, stock: STOCK, stockAssetId: STOCK_ASSET, wethMax: 1n, stockMax: 1n, ...WIRING,
  });
  assert.equal(config.policyId, 'bell-mainnet-v1');
  assert.ok(!/testnet/i.test(config.policyId));
});

test('a zero seed amount is rejected before it reaches the factory', () => {
  assert.throws(
    () => resolvePoolConfig({
      weth: WETH, wethAssetId: WETH_ASSET, stock: STOCK, stockAssetId: STOCK_ASSET, wethMax: 0n, stockMax: 1n, ...WIRING,
    }),
    /wethMax/,
  );
  assert.throws(
    () => resolvePoolConfig({
      weth: WETH, wethAssetId: WETH_ASSET, stock: STOCK, stockAssetId: STOCK_ASSET, wethMax: 1n, stockMax: 0n,
    }),
    /stockMax/,
  );
});

test('identical tokens are rejected instead of building a self-pool', () => {
  assert.throws(
    () => resolvePoolConfig({
      weth: WETH, wethAssetId: WETH_ASSET, stock: WETH, stockAssetId: STOCK_ASSET, wethMax: 1n, stockMax: 1n, ...WIRING,
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
