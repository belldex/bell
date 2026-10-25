const MAX_UINT128 = (1n << 128n) - 1n;
const INPUT_MAX_AGE = Object.freeze({ REGULAR: 60, PRE: 120, POST: 120, OVERNIGHT: 300 });
const MAX_REPORT_AGE_SECONDS = 120;

function unhealthy(reason, validUntil = null) {
  return Object.freeze({ healthy: false, reason, validUntil });
}

export function evaluateActiveSample(sample, now, phaseEnd) {
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('now must be a non-negative integer timestamp');
  if (!Number.isSafeInteger(phaseEnd) || phaseEnd <= 0) throw new RangeError('phaseEnd must be a positive integer timestamp');
  if (!sample || typeof sample !== 'object') return unhealthy('INVALID_SAMPLE');
  const inputAgeLimit = INPUT_MAX_AGE[sample.phase];
  if (inputAgeLimit === undefined) return unhealthy('UNSUPPORTED_PHASE');
  if (typeof sample.price18 !== 'bigint' || sample.price18 <= 0n || sample.price18 > MAX_UINT128) return unhealthy('INVALID_PRICE');
  const times = [sample.observedAt, sample.inputAt, sample.validFrom, sample.expiresAt];
  if (times.some((time) => !Number.isSafeInteger(time) || time <= 0)
    || sample.observedAt > now || sample.inputAt > now || sample.validFrom > sample.observedAt) {
    return unhealthy('INVALID_TIMESTAMP');
  }
  const validUntil = Math.min(sample.expiresAt, sample.observedAt + MAX_REPORT_AGE_SECONDS, phaseEnd);
  if (now >= validUntil) return unhealthy('REPORT_EXPIRED', validUntil);
  if (now - sample.inputAt > inputAgeLimit) return unhealthy('INPUT_STALE', validUntil);
  return Object.freeze({ healthy: true, reason: null, validUntil });
}
