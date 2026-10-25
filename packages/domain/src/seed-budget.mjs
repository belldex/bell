const MAX_UINT128 = (1n << 128n) - 1n;

function validatePair(values, label) {
  if (!Array.isArray(values) || values.length !== 2
    || values.some((value) => typeof value !== 'bigint' || value <= 0n || value > MAX_UINT128)) {
    throw new RangeError(`${label} must contain two positive uint128 raw-unit values`);
  }
}

export function maximumClosureCap(tradeCap, windowCap, seedPrincipal) {
  validatePair(tradeCap, 'tradeCap');
  validatePair(windowCap, 'windowCap');
  validatePair(seedPrincipal, 'seedPrincipal');
  return tradeCap.map((trade, index) => {
    if (trade > windowCap[index]) throw new RangeError('trade cap must not exceed rolling window cap');
    const twiceTrade = trade * 2n;
    const oneTenthSeed = seedPrincipal[index] / 10n;
    return [twiceTrade, windowCap[index], oneTenthSeed].reduce((minimum, value) => value < minimum ? value : minimum);
  });
}
