// Pure normalization helpers only; they do not read proxy contracts or verify signed reports.
const PRICE_SCALE = 10n ** 18n;
const MAX_UINT128 = (1n << 128n) - 1n;
const PRICE_BASES = new Set(['TOKEN_ADJUSTED', 'QUOTE_USD', 'UNDERLYING']);

function failed(reason) {
  return Object.freeze({ valid: false, reason, price18: null, validUntil: null, priceBasis: null });
}

export function normalizeAggregatorPrice({ answer, feedDecimals, updatedAt, now, heartbeatSeconds, policyMaximumAgeSeconds, priceBasis }) {
  if (typeof answer !== 'bigint' || answer <= 0n) return failed('INVALID_ANSWER');
  if (!Number.isInteger(feedDecimals) || feedDecimals < 0 || feedDecimals > 18) return failed('INVALID_DECIMALS');
  if (!Number.isSafeInteger(now) || now <= 0 || !Number.isSafeInteger(updatedAt) || updatedAt <= 0
    || updatedAt > now) return failed('INVALID_TIMESTAMP');
  if (!Number.isSafeInteger(policyMaximumAgeSeconds) || policyMaximumAgeSeconds <= 0
    || !Number.isSafeInteger(heartbeatSeconds) || heartbeatSeconds < 0) return failed('INVALID_FRESHNESS_CONFIG');
  if (!PRICE_BASES.has(priceBasis)) return failed('INVALID_PRICE_BASIS');

  const maximumAge = heartbeatSeconds === 0
    ? policyMaximumAgeSeconds
    : Math.min(heartbeatSeconds, policyMaximumAgeSeconds);
  if (now - updatedAt >= maximumAge) return failed('PRICE_STALE');

  const price18 = feedDecimals <= 18
    ? answer * (10n ** BigInt(18 - feedDecimals))
    : answer / (10n ** BigInt(feedDecimals - 18));
  if (price18 <= 0n || price18 > MAX_UINT128) return failed('PRICE_OUT_OF_RANGE');
  return Object.freeze({
    valid: true,
    reason: null,
    price18,
    updatedAt,
    validUntil: Math.min(updatedAt + maximumAge, now + maximumAge),
    priceBasis,
  });
}

export function normalizeUnderlyingWithMultiplier(price18, multiplier18, priceBasis = 'UNDERLYING') {
  if (!PRICE_BASES.has(priceBasis) || typeof price18 !== 'bigint' || price18 <= 0n || price18 > MAX_UINT128) {
    throw new RangeError('price input is outside its normalized uint128 domain');
  }
  if (priceBasis === 'TOKEN_ADJUSTED' || priceBasis === 'QUOTE_USD') return price18;
  if (typeof multiplier18 !== 'bigint' || multiplier18 <= 0n || multiplier18 > MAX_UINT128) {
    throw new RangeError('underlying source requires a positive uint128 multiplier');
  }
  const adjusted = price18 * multiplier18 / PRICE_SCALE;
  if (adjusted <= 0n || adjusted > MAX_UINT128) throw new RangeError('adjusted price is outside uint128');
  return adjusted;
}
