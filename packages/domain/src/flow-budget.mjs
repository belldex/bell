// Runtime-neutral policy model for quotes/reference tests; the immutable onchain hook remains authoritative.
const WINDOW_SECONDS = 300;
const MAX_UINT128 = (1n << 128n) - 1n;
const MIN_INT128 = -(1n << 127n);
const MAX_INT128 = (1n << 127n) - 1n;
const SESSION_FACTORS = Object.freeze({
  REGULAR: { trade: [1n, 1n], window: [1n, 1n] },
  PRE: { trade: [1n, 2n], window: [1n, 2n] },
  POST: { trade: [1n, 2n], window: [1n, 2n] },
  OVERNIGHT: { trade: [1n, 4n], window: [1n, 4n] },
  CLOSED: { trade: [1n, 5n], window: [1n, 4n] },
});
const GUARDED_FACTOR = Object.freeze({ trade: [1n, 5n], window: [1n, 4n] });

function capPair(values, name) {
  if (!Array.isArray(values) || values.length !== 2) throw new TypeError(`${name} must have two currency caps`);
  return values.map((value) => {
    if (typeof value !== 'bigint' || value <= 0n || value > MAX_UINT128) {
      throw new RangeError(`${name} values must be positive uint128 bigint values`);
    }
    return value;
  });
}

function scaleFloor(cap, [numerator, denominator]) {
  return cap * numerator / denominator;
}

function signedBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^-?(?:0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  return null;
}

export class FlowBudget {
  #tradeCap;
  #windowCap;
  #epoch = null;
  #current = [0n, 0n];
  #previous = [0n, 0n];
  #lastTimestamp = null;

  constructor({ tradeCap, windowCap }) {
    this.#tradeCap = capPair(tradeCap, 'tradeCap');
    this.#windowCap = capPair(windowCap, 'windowCap');
    if (this.#tradeCap.some((cap, index) => cap > this.#windowCap[index])) {
      throw new RangeError('trade caps must not exceed window caps');
    }
  }

  consume(timestamp, delta0, delta1, phase, { guarded = false } = {}) {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new RangeError('timestamp must be a non-negative integer');
    if (this.#lastTimestamp !== null && timestamp < this.#lastTimestamp) throw new RangeError('time cannot move backwards');
    const factors = SESSION_FACTORS[phase];
    if (!factors) throw new RangeError('unsupported session phase');
    if (typeof guarded !== 'boolean') throw new TypeError('guarded must be boolean');
    const deltas = [signedBigInt(delta0), signedBigInt(delta1)];
    if (deltas.some((delta) => delta === null || delta < MIN_INT128 || delta > MAX_INT128)) return false;
    const amounts = deltas.map((delta) => delta < 0n ? -delta : delta);
    if (amounts.some((amount) => amount === 0n)) return false;

    const tradeFactor = guarded && factors.trade[0] * GUARDED_FACTOR.trade[1] > GUARDED_FACTOR.trade[0] * factors.trade[1]
      ? GUARDED_FACTOR.trade : factors.trade;
    const windowFactor = guarded && factors.window[0] * GUARDED_FACTOR.window[1] > GUARDED_FACTOR.window[0] * factors.window[1]
      ? GUARDED_FACTOR.window : factors.window;
    const tradeLimits = this.#tradeCap.map((cap) => scaleFloor(cap, tradeFactor));
    const windowLimits = this.#windowCap.map((cap) => scaleFloor(cap, windowFactor));
    if (amounts.some((amount, index) => tradeLimits[index] === 0n || windowLimits[index] === 0n || amount > tradeLimits[index])) return false;

    const epoch = Math.floor(timestamp / WINDOW_SECONDS);
    let current = [...this.#current];
    let previous = [...this.#previous];
    if (this.#epoch === null || epoch > this.#epoch) {
      previous = this.#epoch !== null && epoch === this.#epoch + 1 ? [...this.#current] : [0n, 0n];
      current = [0n, 0n];
    }
    if (amounts.some((amount, index) => previous[index] + current[index] + amount > windowLimits[index])) return false;

    this.#epoch = epoch;
    this.#current = current.map((amount, index) => amount + amounts[index]);
    this.#previous = previous;
    this.#lastTimestamp = timestamp;
    return true;
  }

  snapshot() {
    return Object.freeze({
      epoch: this.#epoch,
      currentGross: Object.freeze(this.#current.map(String)),
      previousGross: Object.freeze(this.#previous.map(String)),
      lastTimestamp: this.#lastTimestamp,
    });
  }
}
