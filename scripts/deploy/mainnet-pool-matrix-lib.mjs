/** Pure candidate planner for the read-only Mainnet pool matrix. */
export function buildPoolMatrixPlan({ stocks, counters, classList, references = {}, seeds = {} }) {
  const candidates = [];
  const skipped = [];
  const uniqueStocks = [...new Set(stocks)].sort();
  const counterMap = new Map(counters);
  for (const symbol of uniqueStocks) {
    if (!counterMap.has(symbol)) counterMap.set(symbol, { symbol, isStock: true });
  }

  for (const stock of uniqueStocks) {
    for (const [counter, entry] of counterMap) {
      const counterIsStock = Boolean(entry?.isStock);
      if (counterIsStock && counter === stock) continue;
      // Stock/stock pools are symmetric. Plan one canonical order only; SESSION_ONLY requires
      // exactly one stock, so cross-stock pairs can only be PRICE_GUARDED.
      if (counterIsStock && stock.localeCompare(counter) > 0) continue;
      const allowedClasses = counterIsStock ? [0] : classList;
      for (const poolClass of allowedClasses) {
        const pairKey = `${stock}/${counter}`;
        const seed = seeds[pairKey];
        if (poolClass === 0) {
          const counterKey = entry?.symbol ?? counter;
          const missingReferences = [references[`${stock}/USD`], references[`${counterKey}/USD`]]
            .some((reference) => !reference?.adapter);
          if (missingReferences) {
            skipped.push({ stock, counter, poolClass, reason: 'missing deployed reference adapter for one/both assets' });
            continue;
          }
        }
        if ((poolClass === 0 || counterIsStock) && !seed) {
          skipped.push({ stock, counter, poolClass, reason: `explicit seed amounts missing for ${pairKey}` });
          continue;
        }
        if (seed && (!/^[1-9]\d*$/.test(String(seed.amountStock)) || !/^[1-9]\d*$/.test(String(seed.amountCounter)))) {
          skipped.push({ stock, counter, poolClass, reason: `seed amounts for ${pairKey} must be positive raw-unit integers` });
          continue;
        }
        candidates.push({
          stock,
          counter,
          counterIsStock,
          counterToken: entry?.token ?? null,
          poolClass,
          seed: seed ? { amountStock: String(seed.amountStock), amountCounter: String(seed.amountCounter) } : null,
        });
      }
    }
  }

  return { candidates, skipped };
}
