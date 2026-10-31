import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreatePoolPreflight, validateCreatePoolBroadcastAuthorization } from './mainnet-create-pool-ops.mjs';
import { deriveProfileHash } from './mainnet-pool-config.mjs';

const ZERO = '0x0000000000000000000000000000000000000000';
const TOKEN_A = '0x0000000000000000000000000000000000000001';
const TOKEN_B = '0x0000000000000000000000000000000000000002';
const WETH = '0x0000000000000000000000000000000000000003';
const USDG = '0x0000000000000000000000000000000000000004';
const REF_A = '0x0000000000000000000000000000000000000005';
const REF_B = '0x0000000000000000000000000000000000000006';

const base = {
  chainId: 4663,
  expectedChainId: 4663,
  tokenA: TOKEN_A,
  tokenB: TOKEN_B,
  assetA: `0x${'11'.repeat(32)}`,
  assetB: `0x${'22'.repeat(32)}`,
  poolClass: 0,
  now: 1000,
  stockHealth: [{ ready: true, reasonBits: 0n, validUntil: 1100n }],
  stockCount: 1,
  activationPending: false,
  tokenABalance: 100n,
  tokenBBalance: 100n,
  amountAMax: 10n,
  amountBMax: 20n,
  weth: WETH,
  nativeBalance: 100n,
  nativeGasReserve: 10n,
  feeToken: USDG,
  feeBalance: 100n,
  serviceFee: 49n,
  pairLabel: 'USDG/AAPL',
  decimalsA: 6,
  decimalsB: 18,
  referenceAdapterA: REF_A,
  referenceAdapterB: REF_B,
};

test('PRICE_GUARDED checks stock health and both per-token independent references', () => {
  const result = buildCreatePoolPreflight(base);
  assert.equal(result.poolClass, 0);
  assert.equal(result.stockCount, 1);
});

test('PRICE_GUARDED stock/counter references are resolved after canonical token sorting', () => {
  const canonical = buildCreatePoolPreflight({
    ...base,
    tokenA: TOKEN_B,
    tokenB: TOKEN_A,
    referenceAdapterA: REF_B,
    referenceAdapterB: REF_A,
  });
  assert.equal(canonical.poolClass, 0);
  assert.deepEqual(canonical.amountMax, [10n, 20n]);
});

test('seed balance validation uses requested token amounts, not a guessed canonical order', () => {
  const result = buildCreatePoolPreflight({
    ...base,
    tokenA: TOKEN_B,
    tokenB: TOKEN_A,
    tokenABalance: 20n,
    tokenBBalance: 10n,
    amountAMax: 20n,
    amountBMax: 10n,
  });
  assert.deepEqual(result.amountMax, [20n, 10n]);
});

test('SESSION_ONLY permits an unpriced non-stock counterasset with no WETH leg', () => {
  const result = buildCreatePoolPreflight({
    ...base,
    poolClass: 1,
    referenceAdapterA: ZERO,
    referenceAdapterB: ZERO,
    tokenABalance: 10n,
    tokenBBalance: 20n,
    amountAMax: 10n,
    amountBMax: 20n,
    nativeBalance: 1n,
    nativeGasReserve: 10n,
    feeToken: '0x0000000000000000000000000000000000000007',
    feeBalance: 49n,
  });
  assert.equal(result.nativeToWrap, 0n);
});

test('stock/stock is allowed only PRICE_GUARDED and requires both health reports', () => {
  const stockStock = {
    ...base,
    stockCount: 2,
    stockHealth: [base.stockHealth[0], { ready: true, reasonBits: 0n, validUntil: 1100n }],
    pairLabel: 'AAPL/NVDA',
  };
  assert.equal(buildCreatePoolPreflight(stockStock).stockCount, 2);
  assert.throws(() => buildCreatePoolPreflight({
    ...stockStock,
    poolClass: 1,
    referenceAdapterA: ZERO,
    referenceAdapterB: ZERO,
  }), /exactly one stock/);
  assert.throws(() => buildCreatePoolPreflight({
    ...stockStock,
    stockHealth: [base.stockHealth[0]],
  }), /missing health/);
});

test('a planned-closed stock is admitted without fresh health, mirroring factory _admitted', () => {
  const closed = { ready: false, reasonBits: 0n, validUntil: 0n, plannedClosed: true };
  const sessionOnly = buildCreatePoolPreflight({
    ...base,
    poolClass: 1,
    referenceAdapterA: ZERO,
    referenceAdapterB: ZERO,
    stockHealth: [closed],
  });
  assert.equal(sessionOnly.poolClass, 1);
  assert.equal(sessionOnly.staged, true);

  const guarded = buildCreatePoolPreflight({ ...base, poolClass: 0, stockHealth: [closed] });
  assert.equal(guarded.poolClass, 0);
  assert.equal(guarded.staged, true);
});

test('an open session still requires fresh health even for SESSION_ONLY', () => {
  assert.throws(() => buildCreatePoolPreflight({
    ...base,
    poolClass: 1,
    referenceAdapterA: ZERO,
    referenceAdapterB: ZERO,
    stockHealth: [{ ready: false, reasonBits: 0n, validUntil: 0n, plannedClosed: false }],
  }), /health/);
});

test('a fresh open-session health report is not reported as staged', () => {
  assert.equal(buildCreatePoolPreflight(base).staged, false);
});

test('PRICE_GUARDED admits a priced non-stock counterasset without session health', () => {
  const input = {
    ...base,
    stockCount: 1,
    stockHealth: [base.stockHealth[0]],
    referenceAdapterA: REF_A,
    referenceAdapterB: REF_B,
  };
  assert.equal(buildCreatePoolPreflight(input).stockCount, 1);
});

test('rejects stale references, pending admission and mismatched factory profile', () => {
  assert.throws(() => buildCreatePoolPreflight({ ...base, referenceAdapterB: ZERO }), /both assets/);
  assert.throws(() => buildCreatePoolPreflight({ ...base, activationPending: true }), /activation/);
  assert.throws(() => buildCreatePoolPreflight({
    ...base,
    stockHealth: [{ ready: false, reasonBits: 1n, validUntil: 1100n }],
  }), /health/);
});

test('reserved ABI fields remain zero in the shared profile passed to deriveProfileHash', () => {
  const config = {
    token0: TOKEN_A,
    token1: TOKEN_B,
    asset0: `0x${'11'.repeat(32)}`,
    asset1: `0x${'22'.repeat(32)}`,
    poolManager: TOKEN_A,
    positionManager: TOKEN_B,
    factory: TOKEN_A,
    assetRegistry: TOKEN_A,
    calendarRegistry: TOKEN_A,
    safetyController: TOKEN_A,
    treasuryAdapter: ZERO,
    poolClass: 1,
    liquidityMode: 0,
    referenceMode: 0,
    tickSpacing: 60,
    tradeCap: [10n, 10n],
    windowCap: [100n, 100n],
    closureCap: [1n, 1n],
    policyId: `0x${'33'.repeat(32)}`,
    referenceAdapter0: ZERO,
    referenceAdapter1: ZERO,
  };
  const session = deriveProfileHash(config);
  const guarded = deriveProfileHash({ ...config, poolClass: 0, referenceAdapter0: REF_A, referenceAdapter1: REF_B });
  assert.equal(session, guarded);
});

test('USDG seed requires seed plus service fee from the same USDG balance', () => {
  assert.throws(() => buildCreatePoolPreflight({
    ...base,
    tokenA: USDG,
    tokenABalance: 50n,
    feeBalance: 50n,
    amountAMax: 10n,
    feeToken: USDG,
  }), /fee token/);
});

test('USDG seed balance remains independently checked when the service token aliases a pair leg', () => {
  assert.throws(() => buildCreatePoolPreflight({
    ...base,
    tokenA: USDG,
    amountAMax: 20n,
    amountBMax: 10n,
    tokenABalance: 20n,
    feeBalance: 60n,
    serviceFee: 49n,
    feeToken: USDG,
    balanceAFeeAliased: true,
  }), /fee token/);
});

test('native balance must retain estimated pool transaction gas and reserve after wrapping', () => {
  assert.throws(() => buildCreatePoolPreflight({
    ...base,
    tokenA: WETH,
    tokenB: TOKEN_A,
    tokenABalance: 0n,
    tokenBBalance: 20n,
    amountAMax: 10n,
    amountBMax: 20n,
    nativeBalance: 100n,
    nativeGasReserve: 10n,
    estimatedGasWei: 70n,
    gasReserve: 30n,
    feeToken: USDG,
    feeBalance: 100n,
  }), /estimated create gas/);
});

test('read-only preflight returns insufficient gas as a specific shortfall instead of hiding later checks', () => {
  assert.throws(() => buildCreatePoolPreflight({
    ...base,
    estimatedGasWei: 100n,
    gasReserve: 50n,
    nativeBalance: 100n,
  }), /estimated create gas/);
});

test('broadcast requires explicit authorization and positive explicit seed amounts', () => {
  assert.equal(validateCreatePoolBroadcastAuthorization({ broadcast: false }), false);
  assert.throws(() => validateCreatePoolBroadcastAuthorization({ broadcast: true, authorized: false, pairLabel: 'USDG/AAPL', amountMax: [1n, 1n] }), /authorize-spend/);
  assert.throws(() => validateCreatePoolBroadcastAuthorization({ broadcast: true, authorized: true, pairLabel: 'USDG/AAPL', amountMax: [1n, 0n] }), /positive/);
  assert.equal(validateCreatePoolBroadcastAuthorization({ broadcast: true, authorized: true, pairLabel: 'USDG/AAPL', amountMax: [1n, 2n] }), true);
});
