/**
 * The decision rule of the v3 Evolve arbitrage bot. One function, used unchanged for the BELL pool and the control pool: the only
 * inputs that differ between the pools are what the pools themselves differ in (price, liquidity and the fee they charge right now).
 * Nothing here knows which pool it is looking at, so it cannot favour either.
 *
 * The rule: trade the pool toward the reference price until the price after the trade, with the fee on top, equals the reference.
 * Past that point the trade would lose money, so the bot stops there. The trade is cut to maxUsdg, the same cap on both pools, and
 * skipped when it is smaller than minUsdg. If a BELL cap, a fee or a closed session turns a trade away, that is a result, not a bug.
 */
const Q96 = 2 ** 96;

/** USDG per NVDA and the pool liquidity in human units, from the raw pool state. */
export function humanState({ sqrtPriceX96, liquidity, usdgIsCurrency0, decimals = { usdg: 6, nvda: 18 } }) {
  const dU = 10 ** decimals.usdg; const dN = 10 ** decimals.nvda;
  const ratio = (Number(sqrtPriceX96) / Q96) ** 2; // token1 raw per token0 raw
  const price = usdgIsCurrency0 ? dN / dU / ratio : ratio * dN / dU;
  return { price, liquidity: Number(liquidity) / Math.sqrt(dU * dN) };
}

/**
 * Returns { side: 'buyNvda' | 'sellNvda' | 'none', amountIn, token, price, reason }. amountIn is in whole tokens of the input token:
 * USDG when buying NVDA, NVDA when selling it.
 */
export function decideArb({ price, liquidity, feePips, ref, maxUsdg, minUsdg = 0.01 }) {
  const f = feePips / 1e6;
  if (!(price > 0 && liquidity > 0 && ref > 0)) return { side: 'none', reason: 'bad input' };
  const sqrtP = Math.sqrt(price);
  if (price / (1 - f) < ref) { // NVDA is cheaper here than the reference even after the fee: buy it
    const target = ref * (1 - f); // stop when the price after the trade, grossed up for the fee, reaches the reference
    const net = liquidity * (Math.sqrt(target) - sqrtP);
    const gross = Math.min(maxUsdg, net / (1 - f));
    return gross < minUsdg ? { side: 'none', reason: 'edge smaller than the minimum size' } : { side: 'buyNvda', token: 'USDG', amountIn: gross, price, reason: 'below reference' };
  }
  if (price * (1 - f) > ref) { // NVDA is dearer here than the reference even after the fee: sell it
    const target = ref / (1 - f);
    const net = liquidity * (1 / Math.sqrt(target) - 1 / sqrtP);
    const gross = net / (1 - f);
    const notional = gross * price;
    const capped = notional > maxUsdg ? maxUsdg / price : gross;
    return capped * price < minUsdg ? { side: 'none', reason: 'edge smaller than the minimum size' } : { side: 'sellNvda', token: 'NVDA', amountIn: capped, price, reason: 'above reference' };
  }
  return { side: 'none', reason: 'price is inside the fee band around the reference' };
}
