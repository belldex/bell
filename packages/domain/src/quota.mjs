// Rate/quota enforcement (plan M08-05, brief G34/G35/D05/D06).
// Per scope+resource+period meters with reservation. Missing quota or a
// missing provider NEVER triggers a paid or public fallback: the call simply
// fails with 429 + Retry-After semantics. Keepers hold a reserved allowance
// that public traffic cannot consume.
const CONCURRENCY_SEMANTICS = Object.freeze({ reserved: 'reserved', shared: 'shared' });

export class QuotaMeter {
  #periods = new Map();
  #periodFn;
  #limits;

  constructor({ limits, periodFn }) {
    if (limits === null || typeof limits !== 'object') throw new TypeError('limits are required');
    for (const [resource, limit] of Object.entries(limits)) {
      if (!Number.isSafeInteger(limit.maxPerPeriod) || limit.maxPerPeriod < 1) {
        throw new RangeError(resource + '.maxPerPeriod must be positive');
      }
      if (!Number.isSafeInteger(limit.maxConcurrency) || limit.maxConcurrency < 1) {
        throw new RangeError(resource + '.maxConcurrency must be positive');
      }
      const reserved = limit.keeperReserved ?? 0;
      if (!Number.isSafeInteger(reserved) || reserved < 0 || reserved > limit.maxPerPeriod) {
        throw new RangeError(resource + '.keeperReserved must be within maxPerPeriod');
      }
    }
    this.#limits = limits;
    this.#periodFn = periodFn ?? ((now) => Math.floor(now / 60_000));
  }

  #key(scope, resource, period) {
    return scope + '|' + resource + '|' + period;
  }

  admit({ scope, resource, now, weight = 1, isKeeper = false }) {
    const limit = this.#limits[resource];
    if (!limit) throw new RangeError('unknown resource ' + resource);
    if (!Number.isSafeInteger(weight) || weight < 1) throw new RangeError('weight must be positive');
    const period = this.#periodFn(now);
    const key = this.#key(scope, resource, period);
    let bucket = this.#periods.get(key);
    if (!bucket) {
      bucket = { estimated: 0, observed: 0, reserved: limit.keeperReserved ?? 0, inFlight: 0 };
      this.#periods.set(key, bucket);
    }
    const used = Math.max(bucket.observed, bucket.estimated);
    const publicAllowance = limit.maxPerPeriod - (limit.keeperReserved ?? 0) - used;
    const available = isKeeper ? publicAllowance + (limit.keeperReserved ?? 0) : publicAllowance;
    if (weight > available) {
      return { allowed: false, reason: 'QUOTA_EXHAUSTED', retryAfter: this.#secondsToNextPeriod(now) };
    }
    if (bucket.inFlight >= limit.maxConcurrency) {
      return { allowed: false, reason: 'CONCURRENCY', retryAfter: 1 };
    }
    bucket.estimated += weight;
    bucket.inFlight += 1;
    return { allowed: true, release: () => { bucket.inFlight -= 1; } };
  }

  reconcile({ scope, resource, period, observed }) {
    const key = this.#key(scope, resource, period);
    const bucket = this.#periods.get(key);
    if (!bucket) throw new RangeError('no local bucket for that period');
    if (!Number.isSafeInteger(observed) || observed < 0) throw new RangeError('observed must be non-negative');
    bucket.observed = Math.max(bucket.observed, observed);
    if (bucket.estimated < bucket.observed) bucket.estimated = bucket.observed;
    return { estimated: bucket.estimated, observed: bucket.observed };
  }

  #secondsToNextPeriod(now) {
    const next = (this.#periodFn(now) + 1) * 60_000;
    return Math.max(1, Math.ceil((next - now) / 1000));
  }

  snapshot() {
    return [...this.#periods.entries()].map(([key, bucket]) => {
      const [scope, resource, period] = key.split('|');
      return { scope, resource, period: Number(period), estimated: bucket.estimated, observed: bucket.observed, inFlight: bucket.inFlight };
    });
  }
}

export const RPC_ALLOWLIST = Object.freeze([
  'eth_call', 'eth_getLogs', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_chainId',
  'eth_blockNumber', 'net_version',
]);

export function checkRpcRequest({ method, params, sizeBytes, allowlist = RPC_ALLOWLIST, maxSizeBytes = 256 * 1024 }) {
  if (!allowlist.includes(method)) return { allowed: false, reason: 'METHOD_NOT_ALLOWLISTED' };
  if (method === 'eth_call') {
    const [tx] = params ?? [];
    if (!tx || typeof tx.to !== 'string') return { allowed: false, reason: 'TARGET_REQUIRED' };
    if (!/^0x[0-9a-fA-F]{40}$/.test(tx.to)) return { allowed: false, reason: 'TARGET_NOT_CONTRACT' };
  }
  if (method === 'eth_getLogs' && Array.isArray(params) && params[0]?.topics?.length > 4) {
    return { allowed: false, reason: 'TOPIC_FLOOD' };
  }
  if (Number.isSafeInteger(sizeBytes) && sizeBytes > maxSizeBytes) {
    return { allowed: false, reason: 'REQUEST_TOO_LARGE' };
  }
  return { allowed: true };
}