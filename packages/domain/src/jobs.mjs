// Lease guard for keepers and indexers (plan M07-03, brief D09).
// The durable store (job_leases + SQL above) is authoritative; this module is
// the runtime-side discipline: a lease must be re-checked after every await
// and before any signing decision, and an expired lease is never permission.
export class LeaseGuard {
  #chainId;
  #jobKind;
  #ownerToken;      // 32-byte hex, generated per process
  #store;           // { acquire, renew, release } talking to the SQL functions
  #fence = null;
  #expiresAt = null;
  #ttlSeconds;

  constructor({ chainId, jobKind, ownerToken, store, ttlSeconds = 25 }) {
    if (!Number.isInteger(chainId) || chainId <= 0) throw new RangeError('chainId must be a positive integer');
    if (typeof jobKind !== 'string' || jobKind.length === 0) throw new RangeError('jobKind is required');
    if (typeof ownerToken !== 'string' || !/^0x[0-9a-f]{64}$/.test(ownerToken)) {
      throw new RangeError('ownerToken must be a 32-byte hex token');
    }
    if (store === null || typeof store !== 'object') throw new TypeError('store is required');
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) throw new RangeError('ttlSeconds must be positive');
    this.#chainId = chainId;
    this.#jobKind = jobKind;
    this.#ownerToken = ownerToken;
    this.#store = store;
    this.#ttlSeconds = ttlSeconds;
  }

  get fence() { return this.#fence; }

  async acquire() {
    const { fence, expiresAt } = await this.#store.acquire({
      chainId: this.#chainId, jobKind: this.#jobKind, ownerToken: this.#ownerToken, ttlSeconds: this.#ttlSeconds,
    });
    this.#fence = fence;
    this.#expiresAt = expiresAt;
    return { fence, expiresAt };
  }

  // Renew returns the authoritative liveness decision, never an optimistic one.
  async renew() {
    if (this.#fence === null) throw new Error('renew requires an acquired lease');
    const alive = await this.#store.renew({
      chainId: this.#chainId, jobKind: this.#jobKind, ownerToken: this.#ownerToken,
      fence: this.#fence, ttlSeconds: this.#ttlSeconds,
    });
    if (!alive) {
      this.#fence = null;
      return false;
    }
    this.#expiresAt = Date.now() + this.#ttlSeconds * 1000;
    return true;
  }

  // Call after every await, before writes and always before signing.
  assertValid({ now = Date.now() } = {}) {
    if (this.#fence === null) throw new LeaseLostError('no lease held');
    if (now >= this.#expiresAt) throw new LeaseLostError('lease expired; re-acquire before continuing');
  }

  async release() {
    if (this.#fence === null) return;
    await this.#store.release({ chainId: this.#chainId, jobKind: this.#jobKind, ownerToken: this.#ownerToken, fence: this.#fence });
    this.#fence = null;
    this.#expiresAt = null;
  }
}

export class LeaseLostError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LeaseLostError';
  }
}
