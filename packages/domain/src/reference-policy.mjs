// Builds a reference from already-validated source state; source authentication and hook enforcement remain elsewhere.
const PRICE_SCALE = 10n ** 18n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_ANCHOR_AGE_SECONDS = 96 * 60 * 60;
const MAX_QUOTE_AGE_SECONDS = 600;
const MAX_DEVIATION_BPS = 100n;

function blocked(mode, reason) {
  return Object.freeze({ canPriceGuard: false, mode, reason, reference: null });
}

function validPrice(value) {
  return typeof value === 'bigint' && value > 0n && value <= MAX_UINT128;
}

export function buildReferencePolicy({ poolClass, now, stock, quote }) {
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('now must be a non-negative integer timestamp');
  if (poolClass === 'SESSION_ONLY') {
    return Object.freeze({ canPriceGuard: false, mode: 'SESSION_ONLY', reason: null, reference: null });
  }
  if (poolClass !== 'PRICE_GUARDED') throw new RangeError('unsupported pool class');
  if (!quote || !validPrice(quote.price18) || !Number.isSafeInteger(quote.updatedAt)
    || quote.updatedAt <= 0 || quote.updatedAt > now) return blocked('HALTED', 'QUOTE_INVALID');
  if (now - quote.updatedAt > MAX_QUOTE_AGE_SECONDS) return blocked('HALTED', 'QUOTE_STALE');
  if (!stock || !['ACTIVE', 'CLOSED'].includes(stock.mode)
    || !validPrice(stock.multiplier18)) return blocked('HALTED', 'STOCK_INVALID');

  if (stock.mode === 'ACTIVE') {
    if (!validPrice(stock.underlyingPrice18) || !validPrice(stock.directAdjustedTokenPrice18)) {
      return blocked('HALTED', 'ACTIVE_SOURCE_INVALID');
    }
    const adjustedStockPrice = stock.underlyingPrice18 * stock.multiplier18 / PRICE_SCALE;
    if (adjustedStockPrice <= 0n || adjustedStockPrice > MAX_UINT128) return blocked('HALTED', 'NORMALIZED_PRICE_OVERFLOW');
    const deviation = adjustedStockPrice > stock.directAdjustedTokenPrice18
      ? adjustedStockPrice - stock.directAdjustedTokenPrice18
      : stock.directAdjustedTokenPrice18 - adjustedStockPrice;
    if (deviation * 10000n > stock.directAdjustedTokenPrice18 * MAX_DEVIATION_BPS) {
      return blocked('HALTED', 'CROSS_SOURCE_DEVIATION');
    }
    return Object.freeze({
      canPriceGuard: true,
      mode: 'ACTIVE',
      reason: null,
      reference: Object.freeze({ numerator: adjustedStockPrice, denominator: quote.price18 }),
    });
  }

  const anchor = stock.anchor;
  if (!anchor || !validPrice(anchor.price18) || !Number.isSafeInteger(anchor.inputAt)
    || anchor.inputAt <= 0 || anchor.inputAt > now) return blocked('HALTED', 'ANCHOR_INVALID');
  if (anchor.multiplier18 !== stock.multiplier18) return blocked('HALTED', 'CORPORATE_MISMATCH');
  if (now - anchor.inputAt > MAX_ANCHOR_AGE_SECONDS) return blocked('HALTED', 'ANCHOR_EXPIRED');
  return Object.freeze({
    canPriceGuard: true,
    mode: 'FROZEN_CLOSE',
    reason: null,
    reference: Object.freeze({ numerator: anchor.price18, denominator: quote.price18 }),
  });
}
