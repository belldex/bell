/**
 * Mainnet calendar timeline planning.
 *
 * Testnet (46630) queues and activates a calendar root in the same block. Mainnet does not:
 * `CalendarRegistry.queueRoot` requires `coverageStart >= now + CALENDAR_PUBLICATION_LEAD_SECONDS`
 * and stamps an ETA of `now + GOVERNANCE_MINIMUM_DELAY_SECONDS`, while `activateRoot` refuses to
 * run before the ETA or at/after `coverageStart`, and dies after the operation expiry.
 *
 * That leaves a real window to hit, and a deployment that misses it burns the single-slot
 * `(asset, year)` root permanently. This module computes the window from chain constants so the
 * operator sees the constraint before spending gas, instead of discovering it as `ROOT_TIME`.
 *
 * It is pure: no RPC, no wall clock. `now` is always passed in.
 */

export const DAY_SECONDS = 86_400;

/** Mirrors PolicyConstants.CALENDAR_PUBLICATION_LEAD_SECONDS (applied when chainid != 46630). */
export const MAINNET_CALENDAR_PUBLICATION_LEAD_SECONDS = 604_800;
/** Mirrors PolicyConstants.GOVERNANCE_MINIMUM_DELAY_SECONDS. */
export const MAINNET_GOVERNANCE_MINIMUM_DELAY_SECONDS = 172_800;
/** Mirrors PolicyConstants.GOVERNANCE_OPERATION_EXPIRY_SECONDS. */
export const MAINNET_GOVERNANCE_OPERATION_EXPIRY_SECONDS = 604_800;

/** Choose a coverage start that leaves enough time to queue/activate the root without rounding to midnight. */
export function planCalendarCoverageStart({ now, noticeSeconds, activationBufferSeconds = 300 } = {}) {
  for (const [name, value] of Object.entries({ now, noticeSeconds, activationBufferSeconds })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return now + Math.max(noticeSeconds, activationBufferSeconds);
}

const PHASE_PRE_START = [4, 0];
const PHASE_REGULAR_START = [9, 30];
const PHASE_CLOSED_START = [16, 0];
const WEEKEND = new Set(['Sat', 'Sun']);

function etOffsetSeconds(unixSeconds) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(unixSeconds * 1000));
  const zone = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-05:00';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(zone);
  if (!match) return -5 * 3600;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 3600 + Number(match[3]) * 60);
}

function etWallTimeToUnix(year, month, day, hour, minute) {
  const naive = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  return naive - etOffsetSeconds(naive - etOffsetSeconds(naive));
}

/** Which phase the US-Eastern session table puts an instant in. */
export function sessionPhaseAt(unixSeconds) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(unixSeconds * 1000));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  if (WEEKEND.has(get('weekday'))) return 'CLOSED';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const preStart = etWallTimeToUnix(year, month, day, ...PHASE_PRE_START);
  const openStart = etWallTimeToUnix(year, month, day, ...PHASE_REGULAR_START);
  const closeStart = etWallTimeToUnix(year, month, day, ...PHASE_CLOSED_START);
  if (unixSeconds >= preStart && unixSeconds < openStart) return 'PRE';
  if (unixSeconds >= openStart && unixSeconds < closeStart) return 'REGULAR';
  return 'CLOSED';
}

function utcYear(unixSeconds) {
  return new Date(unixSeconds * 1000).getUTCFullYear();
}

/**
 * Plan a plain governance operation (asset admission, safety actions).
 *
 * Unlike a calendar root there is no publication notice and no leaf window: `activateAsset`
 * only checks `eta <= now <= expiry`. Modelling that separately keeps the calendar's extra
 * constraints from leaking into asset admission, where they would be wrong.
 */
export function planGovernanceOperation(input) {
  if (!input || typeof input !== 'object') throw new TypeError('governance timeline input is required');
  const { now } = input;
  if (!Number.isSafeInteger(now)) throw new TypeError('now must be a safe integer');
  const delaySeconds = input.delaySeconds ?? MAINNET_GOVERNANCE_MINIMUM_DELAY_SECONDS;
  const expirySeconds = input.expirySeconds ?? MAINNET_GOVERNANCE_OPERATION_EXPIRY_SECONDS;
  if (!Number.isSafeInteger(delaySeconds) || delaySeconds <= 0) {
    throw new RangeError('delaySeconds must be a positive integer; mainnet governance is not instant');
  }
  if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= 0) {
    throw new RangeError('expirySeconds must be a positive integer');
  }

  const eta = now + delaySeconds;
  const expiry = eta + expirySeconds;
  return Object.freeze({
    ok: true,
    queuedAt: now,
    eta,
    expiry,
    earliest: eta,
    latest: expiry,
    windowSeconds: expiry - eta,
    isExecutableAt: (at) => Number.isSafeInteger(at) && at >= eta && at <= expiry,
    describe: (at) => {
      if (at < eta) return { state: 'WAITING', secondsRemaining: eta - at };
      if (at > expiry) return { state: 'EXPIRED', secondsOverdue: at - expiry };
      return { state: 'EXECUTABLE', secondsRemaining: expiry - at };
    },
  });
}

/**
 * Plan a mainnet calendar root operation.
 *
 * @param {object} input
 * @param {number} input.now                chain head timestamp (seconds)
 * @param {number} input.coverageStart      intended first covered second
 * @param {number} input.coverageDays       whole days of coverage
 * @param {number} [input.etaDelaySeconds]  override for tests; defaults to the on-chain 48h delay
 * @param {number} [input.noticeSeconds]    override for tests; defaults to the on-chain 7d notice
 * @returns {Readonly<object>} plan with `ok`, `violations`, and the derived window
 */
export function planMainnetCalendarTimeline(input) {
  if (!input || typeof input !== 'object') throw new TypeError('timeline input is required');
  const { now, coverageStart, coverageDays } = input;
  for (const [name, value] of Object.entries({ now, coverageStart, coverageDays })) {
    if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`);
  }
  if (coverageDays <= 0) throw new RangeError('coverageDays must be a positive whole number of days');

  const etaDelaySeconds = input.etaDelaySeconds ?? MAINNET_GOVERNANCE_MINIMUM_DELAY_SECONDS;
  const noticeSeconds = input.noticeSeconds ?? MAINNET_CALENDAR_PUBLICATION_LEAD_SECONDS;
  const expirySeconds = input.expirySeconds ?? MAINNET_GOVERNANCE_OPERATION_EXPIRY_SECONDS;

  const violations = [];
  const earliestCoverageStart = now + noticeSeconds;
  if (coverageStart < earliestCoverageStart) {
    violations.push(
      `coverageStart is inside the ${noticeSeconds / DAY_SECONDS}-day publication notice; `
      + `the earliest acceptable value is ${earliestCoverageStart}`,
    );
  }

  const queueAt = now;
  const rootEta = now + etaDelaySeconds;
  const activateRootEarliest = rootEta;
  const operationExpiry = rootEta + expirySeconds;
  // activateRoot accepts a timestamp only when it is >= ETA, < coverageStart, and <= expiry.
  // The last two both bound the window; whichever is earlier is the real deadline.
  const activateRootLatest = Math.min(coverageStart, operationExpiry);
  const activateRootWindowSeconds = activateRootLatest - activateRootEarliest;
  if (activateRootWindowSeconds <= 0) {
    violations.push('there is no activation window: the ETA is not before coverageStart');
  }
  // Not fatal — the operator can still activate early — but the window is narrower than
  // coverageStart implies, and a late activation is unrecoverable because the slot is single-use.
  const expiryBindsWindow = operationExpiry < coverageStart;

  const coverageEnd = coverageStart + coverageDays * DAY_SECONDS;
  if (utcYear(coverageStart) !== utcYear(coverageEnd - 1)) {
    violations.push(
      'coverage crosses a UTC year boundary, but a root is single-slot per (asset, year); '
      + 'shorten coverageDays or move coverageStart',
    );
  }

  return Object.freeze({
    ok: violations.length === 0,
    violations: Object.freeze(violations),
    now,
    queueAt,
    rootEta,
    earliestCoverageStart,
    coverageStart,
    coverageEnd,
    coverageDays,
    activateRootEarliest,
    activateRootLatest,
    activateRootLatestExclusive: true,
    activateRootWindowSeconds,
    operationExpiry,
    expiryBindsWindow,
    // What the chain clock will be showing when activation becomes possible. Useful because
    // activateInterval additionally requires the clock to be inside a leaf window.
    activationPhase: sessionPhaseAt(activateRootEarliest),
    activationPhaseAtCoverageStart: sessionPhaseAt(coverageStart),
  });
}
