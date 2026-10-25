const ALLOWED_BASE_FEES = new Set([500, 3000, 5000, 10000]);

function validateBaseFee(baseSessionFee) {
  if (!ALLOWED_BASE_FEES.has(baseSessionFee)) {
    throw new RangeError('base session fee must be one of 500, 3000, 5000, or 10000 v4 fee units');
  }
}

export function bellFee(baseSessionFee, elapsedSeconds) {
  validateBaseFee(baseSessionFee);
  if (!Number.isSafeInteger(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError('bell elapsed time must be a non-negative integer number of seconds');
  }
  const remaining = Math.max(0, 300 - elapsedSeconds);
  return baseSessionFee + Math.floor(((10000 - baseSessionFee) * remaining + 299) / 300);
}

export function effectiveLpFee({ baseSessionFee, bellElapsed, corporate = false, repricing = false }) {
  validateBaseFee(baseSessionFee);
  if (typeof corporate !== 'boolean' || typeof repricing !== 'boolean') {
    throw new TypeError('corporate and repricing modifiers must be booleans');
  }
  return Math.max(
    baseSessionFee,
    bellFee(baseSessionFee, bellElapsed),
    corporate ? 10000 : 0,
    repricing ? 10000 : 0,
  );
}
