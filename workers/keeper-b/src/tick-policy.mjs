/**
 * Keeper tick logic, runtime-neutral enough to unit test outside Cloudflare.
 *
 * Responsibilities:
 *   1. read the active onchain calendar phase for the configured asset
 *   2. refuse to publish when Yahoo's phase does not match that calendar phase
 *   3. publish a direct sample plus a phase-matched stream report, then refresh health
 *
 * It never relabels a Yahoo phase and never invents a price. When the market is closed or the
 * quote is stale it returns a "skipped" result so the caller can log and try again later.
 */

export const ZERO32 = `0x${'0'.repeat(64)}`;
const MAX_AGE_SECONDS = 120;

export function phaseNameForCalendarPhase(phase) {
  if (phase === 1) return 'PRE';
  if (phase === 2) return 'REGULAR';
  if (phase === 3) return 'POST';
  return null;
}

export function sessionPhaseCode(yahooPhase) {
  if (yahooPhase === 'PRE') return 1;
  if (yahooPhase === 'REGULAR') return 2;
  if (yahooPhase === 'POST') return 3;
  return null;
}

/** Pick the admitted wire for a calendar phase. Returns null for CLOSED/unsupported phases. */
export function wireForCalendarPhase(adapters, phase) {
  if (phase === 2) return adapters.regularWire ? { wire: adapters.regularWire, wireHash: adapters.regularWireHash } : null;
  if (phase === 1 || phase === 3) return adapters.extendedWire ? { wire: adapters.extendedWire, wireHash: adapters.extendedWireHash } : null;
  if (phase === 4) return adapters.overnightWire ? { wire: adapters.overnightWire, wireHash: adapters.overnightWireHash } : null;
  return null;
}

/**
 * Decide whether a quote may be published for the active calendar phase.
 * Returns { ok: true, phase } or { ok: false, reason }.
 */
export function evaluateQuote({ calendarPhase, quote, nowSeconds, maxAgeSeconds = MAX_AGE_SECONDS }) {
  const expected = phaseNameForCalendarPhase(calendarPhase);
  if (!expected) return { ok: false, reason: `calendar phase ${calendarPhase} has no Yahoo source` };
  if (!quote) return { ok: false, reason: 'no quote available' };
  if (quote.phase !== expected) return { ok: false, reason: `Yahoo phase ${quote.phase} does not match calendar phase ${expected}` };
  const age = nowSeconds - Number(quote.observedAt);
  if (!Number.isFinite(age) || age < 0) return { ok: false, reason: 'quote observation time is invalid' };
  if (age >= maxAgeSeconds) return { ok: false, reason: `quote is ${age}s old, older than ${maxAgeSeconds}s` };
  return { ok: true, phase: calendarPhase };
}

/** Report validity must not outlive either the receipt window or the observation freshness window. */
export function reportValidUntil(nowSeconds, observedAt, maxAgeSeconds = MAX_AGE_SECONDS) {
  const validUntil = Math.min(nowSeconds + maxAgeSeconds - 1, Number(observedAt) + maxAgeSeconds - 1);
  if (validUntil <= nowSeconds) throw new Error('no remaining report validity');
  return validUntil;
}
