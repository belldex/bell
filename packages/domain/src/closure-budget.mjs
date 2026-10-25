// Episode-ledger model for SDK/reference tests; it is not an onchain funds-safety boundary.
const MAX_UINT128 = (1n << 128n) - 1n;
const MIN_INT128 = -(1n << 127n);
const MAX_INT128 = (1n << 127n) - 1n;

export class ClosureBudget {
  #caps;
  #stockCount;
  #closureNonce = 0n;
  #latched = false;
  #episodes = new Map();
  #reopenCandidate = null;

  constructor(closureCaps, stockCount) {
    if (!Number.isInteger(stockCount) || stockCount < 1 || stockCount > 2) {
      throw new RangeError('stockCount must be one or two');
    }
    if (!Array.isArray(closureCaps) || closureCaps.length !== 2
      || closureCaps.some((cap) => typeof cap !== 'bigint' || cap <= 0n || cap > MAX_UINT128)) {
      throw new RangeError('closure caps must be two positive uint128 bigint raw-unit limits');
    }
    this.#caps = [...closureCaps];
    this.#stockCount = stockCount;
  }

  enterPlannedClosure() {
    if (this.#latched) return this.#closureNonce;
    this.#closureNonce += 1n;
    this.#latched = true;
    this.#episodes.set(this.#closureNonce, [0n, 0n]);
    this.#reopenCandidate = null;
    return this.#closureNonce;
  }

  enterUnexpectedClosure() {
    this.#reopenCandidate = null;
    return false;
  }

  consume(delta0, delta1) {
    if (!this.#latched) return false;
    const deltas = [delta0, delta1];
    if (deltas.some((delta) => typeof delta !== 'bigint' || delta === 0n || delta < MIN_INT128 || delta > MAX_INT128)) return false;
    const amounts = deltas.map((delta) => delta < 0n ? -delta : delta);
    const used = this.#episodes.get(this.#closureNonce);
    const candidate = amounts.map((amount, index) => used[index] + amount);
    if (candidate.some((amount, index) => amount > this.#caps[index])) return false;
    this.#episodes.set(this.#closureNonce, candidate);
    return true;
  }

  checkpointOpen({ now, observations, oldValidUntil, validUntil, healthy, allStocksOpen }) {
    if (!this.#latched) return false;
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(oldValidUntil)
      || !Number.isSafeInteger(validUntil) || !Array.isArray(observations)
      || observations.length !== this.#stockCount
      || observations.some((value) => !Number.isSafeInteger(value) || value <= 0 || value > now)) {
      throw new RangeError('invalid recovery checkpoint');
    }
    if (!healthy || !allStocksOpen || now >= validUntil) {
      this.#reopenCandidate = null;
      return false;
    }

    if (this.#reopenCandidate === null || now >= oldValidUntil) {
      this.#reopenCandidate = { at: now, baseline: [...observations] };
      return false;
    }

    const elapsed = now - this.#reopenCandidate.at;
    const advanced = observations.every((value, index) => value > this.#reopenCandidate.baseline[index]);
    if (elapsed >= 60 && advanced) {
      this.#latched = false;
      this.#reopenCandidate = null;
      return true;
    }
    return false;
  }

  snapshot() {
    const episodeGross = this.#episodes.get(this.#closureNonce) ?? [0n, 0n];
    return Object.freeze({
      closureNonce: this.#closureNonce,
      latched: this.#latched,
      episodeGross: Object.freeze(episodeGross.map(String)),
      reopenCandidateAt: this.#reopenCandidate?.at ?? null,
    });
  }
}
