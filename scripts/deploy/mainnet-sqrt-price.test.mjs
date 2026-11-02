import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveSqrtPriceFromAmounts,
  deriveTickBounds,
  deriveLiquidityForSeed,
  deriveFlowCaps,
  tickToSqrtPriceX96,
  resolvePoolConfig,
} from './mainnet-pool-config.mjs';

/**
 * Regression tests for the mainnet `createAndSeed` revert that the wallet surfaced as a bare
 * "The contract function createAndSeed reverted." Two independent defects were found, and each
 * test below pins one of them with the exact values observed on chain 4663.
 */

const AAPL_SEED = 2500000000000000n; // 0.0025 AAPL, 18 decimals
const USDG_SEED = 860000n; // 0.86 USDG, 6 decimals
const CHAIN = {
  poolManager: '0x8366a39CC670B4001A1121F9cE3288b52b9e8F82',
  positionManager: '0x58Cd82a008cB9a6c0c605991b40a09BD6aa1a6fC',
  factory: '0xf677edc6346be53686E6DD42374A744cab9d0A5B',
  assetRegistry: '0x8A7e4eA0b1D3F8f9c4E1b2A3C4D5e6F708192a3B',
  calendarRegistry: '0x9B8e4eA0b1D3F8f9c4E1b2A3C4D5e6F708192a4C',
  safetyController: '0xAc8e4eA0b1D3F8f9c4E1b2A3C4D5e6F708192a5D',
};
const AAPL = { token: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', asset: `0x${'aa'.repeat(32)}` };
const USDG = { token: '0x5fC5360d0400a0fD4f2af552adD042d716F1d168', asset: `0x${'bb'.repeat(32)}` };

test('TickMath port matches the canonical value at tick 0', () => {
  assert.equal(tickToSqrtPriceX96(0), 79228162514264337593543950336n);
});

test('TickMath port is monotonic and stays inside uint160 for ordinary ticks', () => {
  const ticks = [-887272, -100000, -60000, -1, 0, 1, 60000, 217914, 887272];
  let previous = 0n;
  for (const tick of ticks) {
    const sqrt = tickToSqrtPriceX96(tick);
    assert.ok(sqrt > 0n && sqrt < 1n << 160n, `tick ${tick} out of uint160`);
    assert.ok(sqrt > previous, `tick ${tick} not monotonic`);
    previous = sqrt;
  }
});

test('the seed ratio sets the opening price, ignoring differing decimals', () => {
  // 0.0025 AAPL against 0.86 USDG is 344 USDG per AAPL. The raw pool price is token1/token0, so
  // token0 = USDG and token1 = AAPL must encode 0.86/0.0025 of value on each side.
  const sqrt = deriveSqrtPriceFromAmounts({ amount0: USDG_SEED, amount1: AAPL_SEED });
  assert.equal(sqrt, 4271696239862913720289036353088821n);
  const { currentTick, tickLower, tickUpper } = deriveTickBounds({ sqrtPriceX96: sqrt, tickSpacing: 60, halfWidth: 6000 });
  assert.equal(currentTick, 217914);
  assert.equal(tickLower, 211860);
  assert.equal(tickUpper, 223920);
});

test('liquidity is derived from the seed, not hardcoded', () => {
  const sqrt = deriveSqrtPriceFromAmounts({ amount0: USDG_SEED, amount1: AAPL_SEED });
  const { tickLower, tickUpper } = deriveTickBounds({ sqrtPriceX96: sqrt, tickSpacing: 60, halfWidth: 6000 });
  const liquidity = deriveLiquidityForSeed({ sqrtPriceX96: sqrt, tickLower, tickUpper, amount0: USDG_SEED, amount1: AAPL_SEED });
  // The old hardcoded 1e15 demanded ~18.88 AAPL for a 0.0025 AAPL seed.
  assert.equal(liquidity, 177523858275n);
  assert.ok(liquidity < 10n ** 15n);
});

test('each leg is priced on its own side of the current price', () => {
  // token0 (USDG) is supplied from the current price up to the upper tick; token1 (AAPL) is
  // supplied from the lower tick up to the current price. Pricing both on the same side still
  // yields a positive liquidity but underfunds the pool by ~34% and misreports which leg binds.
  const sqrt = deriveSqrtPriceFromAmounts({ amount0: USDG_SEED, amount1: AAPL_SEED });
  const { tickLower, tickUpper } = deriveTickBounds({ sqrtPriceX96: sqrt, tickSpacing: 60, halfWidth: 6000 });
  const liquidity = deriveLiquidityForSeed({ sqrtPriceX96: sqrt, tickLower, tickUpper, amount0: USDG_SEED, amount1: AAPL_SEED });
  const sqrtLower = tickToSqrtPriceX96(tickLower);
  const sqrtUpper = tickToSqrtPriceX96(tickUpper);
  const Q96 = 1n << 96n;
  const ceil0 = (a, b, l) => {
    const product = (l << 96n) * (b - a);
    const step1 = (product + b - 1n) / b;
    return (step1 + a - 1n) / a;
  };
  const ceil1 = (a, b, l) => (l * (b - a) + Q96 - 1n) / Q96;
  // Onchain principal recorded from the successful eth_call on chain 4663 at this liquidity.
  assert.equal(ceil0(sqrt, sqrtUpper, liquidity), 853987n);
  assert.equal(ceil1(sqrtLower, sqrt, liquidity), 2499999999991188n);
  assert.ok(ceil0(sqrt, sqrtUpper, liquidity) <= USDG_SEED);
  assert.ok(ceil1(sqrtLower, sqrt, liquidity) <= AAPL_SEED);
});

test('the derived liquidity never exceeds the seed, and one more unit would', () => {
  const sqrt = deriveSqrtPriceFromAmounts({ amount0: USDG_SEED, amount1: AAPL_SEED });
  const { tickLower, tickUpper } = deriveTickBounds({ sqrtPriceX96: sqrt, tickSpacing: 60, halfWidth: 6000 });
  const liquidity = deriveLiquidityForSeed({ sqrtPriceX96: sqrt, tickLower, tickUpper, amount0: USDG_SEED, amount1: AAPL_SEED });
  const sqrtLower = tickToSqrtPriceX96(tickLower);
  const sqrtUpper = tickToSqrtPriceX96(tickUpper);
  const Q96 = 1n << 96n;
  const ceil0 = (a, b, l) => {
    const product = (l << 96n) * (b - a);
    const step1 = (product + b - 1n) / b;
    return (step1 + a - 1n) / a;
  };
  const ceil1 = (a, b, l) => (l * (b - a) + Q96 - 1n) / Q96;
  assert.ok(ceil0(sqrt, sqrtUpper, liquidity) <= USDG_SEED, 'USDG within seed');
  assert.ok(ceil1(sqrtLower, sqrt, liquidity) <= AAPL_SEED, 'AAPL within seed');
  // Greedy maximality: one more unit must break one of the two sides.
  const nextFits =
    ceil0(sqrt, sqrtUpper, liquidity + 1n) <= USDG_SEED && ceil1(sqrtLower, sqrt, liquidity + 1n) <= AAPL_SEED;
  assert.equal(nextFits, false, 'liquidity should be maximal for this seed');
});

test('the shipped principal reproduces the seed price', () => {
  // A seed-derived pool must open at the ratio the user asked for. Observed onchain principal is
  // 0.853987 USDG against 0.0025 AAPL, i.e. 341.59 USDG per AAPL for a 344 USDG/AAPL seed.
  const principalUsdg = 853987n;
  const principalAapl = 2499999999991188n;
  const price = Number(principalUsdg) / 1e6 / (Number(principalAapl) / 1e18);
  assert.ok(Math.abs(price - 344) / 344 < 0.02, `opening price ${price} should be within 2% of the 344 seed ratio`);
});

test('liquidity derivation rejects a price outside the range', () => {
  const sqrt = deriveSqrtPriceFromAmounts({ amount0: USDG_SEED, amount1: AAPL_SEED });
  assert.throws(
    () => deriveLiquidityForSeed({ sqrtPriceX96: sqrt, tickLower: 250000, tickUpper: 260000, amount0: USDG_SEED, amount1: AAPL_SEED }),
    /strictly inside/,
  );
});

test('flow caps follow token0/token1, not the caller A/B order', () => {
  // This is the defect that reverted createAndSeed with BadSeed(): token0 was USDG but the caps
  // carried AAPL-sized numbers, so the closure cap on the USDG slot exceeded
  // maximumClosureCap(principal) = principal/10 = 63694.
  const cfg = resolvePoolConfig({
    tokenA: AAPL.token, assetA: AAPL.asset, tokenB: USDG.token, assetB: USDG.asset,
    amountAMax: AAPL_SEED, amountBMax: USDG_SEED,
    poolManager: CHAIN.poolManager, positionManager: CHAIN.positionManager, factory: CHAIN.factory,
    assetRegistry: CHAIN.assetRegistry, calendarRegistry: CHAIN.calendarRegistry, safetyController: CHAIN.safetyController,
    policyId: 'bell-mainnet-v1', poolClass: 1,
  });
  assert.equal(cfg.token0, USDG.token.toLowerCase(), 'USDG sorts first');
  assert.equal(cfg.amountMax[0], USDG_SEED);
  assert.equal(cfg.amountMax[1], AAPL_SEED);
  // Caps are per-currency: slot 0 must carry the USDG-derived value.
  assert.deepEqual([...cfg.config.tradeCap], [USDG_SEED / 10n, AAPL_SEED / 10n]);
  assert.deepEqual([...cfg.config.windowCap], [(USDG_SEED * 4n) / 10n, (AAPL_SEED * 4n) / 10n]);
  assert.deepEqual([...cfg.config.closureCap], [USDG_SEED / 20n, AAPL_SEED / 20n]);
});

test('explicit caps are reordered to match token0/token1 too', () => {
  const cfg = resolvePoolConfig({
    tokenA: AAPL.token, assetA: AAPL.asset, tokenB: USDG.token, assetB: USDG.asset,
    amountAMax: AAPL_SEED, amountBMax: USDG_SEED,
    poolManager: CHAIN.poolManager, positionManager: CHAIN.positionManager, factory: CHAIN.factory,
    assetRegistry: CHAIN.assetRegistry, calendarRegistry: CHAIN.calendarRegistry, safetyController: CHAIN.safetyController,
    policyId: 'bell-mainnet-v1', poolClass: 1,
    tradeCap: [111n, 222n], windowCap: [333n, 444n], closureCap: [55n, 66n],
  });
  // Caller supplied caps in A/B order; slot 0 is token0 (USDG), so the B value moves first.
  assert.deepEqual([...cfg.config.tradeCap], [222n, 111n]);
  assert.deepEqual([...cfg.config.windowCap], [444n, 333n]);
  assert.deepEqual([...cfg.config.closureCap], [66n, 55n]);
});

test('derived closure cap always fits maximumClosureCap for the shipped principal', () => {
  const cfg = resolvePoolConfig({
    tokenA: AAPL.token, assetA: AAPL.asset, tokenB: USDG.token, assetB: USDG.asset,
    amountAMax: AAPL_SEED, amountBMax: USDG_SEED,
    poolManager: CHAIN.poolManager, positionManager: CHAIN.positionManager, factory: CHAIN.factory,
    assetRegistry: CHAIN.assetRegistry, calendarRegistry: CHAIN.calendarRegistry, safetyController: CHAIN.safetyController,
    policyId: 'bell-mainnet-v1', poolClass: 1,
  });
  // Principal observed from the successful eth_call on chain 4663.
  const principal = [636945n, 2499999999989128n];
  const caps = cfg.config;
  for (let i = 0; i < 2; i += 1) {
    assert.ok(caps.tradeCap[i] > 0n && caps.windowCap[i] > 0n && caps.tradeCap[i] <= caps.windowCap[i]);
    let maximum = caps.tradeCap[i] * 2n;
    if (caps.windowCap[i] < maximum) maximum = caps.windowCap[i];
    const seedLimit = principal[i] / 10n;
    if (seedLimit < maximum) maximum = seedLimit;
    assert.ok(caps.closureCap[i] <= maximum, `closureCap[${i}] ${caps.closureCap[i]} > maximum ${maximum}`);
  }
});

test('a non-positive seed is rejected before any math runs', () => {
  assert.throws(() => deriveSqrtPriceFromAmounts({ amount0: 0n, amount1: 1n }), /amount0/);
  assert.throws(() => deriveFlowCaps({ seed0: 0n, seed1: 1n }), /positive/);
});
