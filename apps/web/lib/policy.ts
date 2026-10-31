/**
 * BELL policy math mirrored from the brief (sections 5, 8, 6.3).
 * Pure functions, runtime-neutral. This is a UI mirror for explanation/preview only:
 * onchain contracts remain the authority.
 */

export type MarketPhase = 'UNKNOWN' | 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED';
export type PoolClass = 'PRICE_GUARDED' | 'SESSION_ONLY';
export type Lifecycle = 'LIVE' | 'RECOVERING' | 'HALTED' | 'PAUSED';

/** LP fee in Uniswap v4 units (1_000_000 = 100%): 500 = 0.05%. */
export const BASE_FEE_UNITS: Record<Exclude<MarketPhase, 'UNKNOWN'>, number> = {
  REGULAR: 500,
  PRE: 3000,
  POST: 3000,
  OVERNIGHT: 5000,
  CLOSED: 10000,
};

export const BELL_DECAY_SECONDS = 300;
export const BELL_START_FEE_UNITS = 10000;
export const CORPORATE_FEE_UNITS = 10000;
export const CORPORATE_SECONDS = 1800;
export const SERVICE_FEE_USDG = 49;
export const HOOK_PERMISSION_MASK = '0x2cc0';

export const PHASE_META: Record<MarketPhase, { label: string; window: string; tone: string; css: string }> = {
  REGULAR: { label: 'Regular', window: '09:30 – 16:00 ET', tone: 'Live active stream', css: 'var(--color-phase-regular)' },
  PRE: { label: 'Pre-market', window: '04:00 – 09:30 ET', tone: 'Extended stream', css: 'var(--color-phase-pre)' },
  POST: { label: 'Post-market', window: '16:00 – 20:00 ET', tone: 'Extended stream', css: 'var(--color-phase-post)' },
  OVERNIGHT: { label: 'Overnight', window: '20:00 – 04:00 ET', tone: 'Overnight stream', css: 'var(--color-phase-overnight)' },
  CLOSED: { label: 'Closed', window: 'Weekend · holiday · unsupported', tone: 'Frozen close anchor', css: 'var(--color-phase-closed)' },
  UNKNOWN: { label: 'Unknown', window: 'State cannot be proven', tone: 'Swaps halted', css: 'var(--color-down)' },
};

/** bellFee = base + ceil((10000 - base) * max(0, 300 - elapsed) / 300) */
export function bellFeeUnits(baseUnits: number, elapsedSeconds: number): number {
  const remaining = Math.max(0, BELL_DECAY_SECONDS - elapsedSeconds);
  return baseUnits + Math.ceil(((BELL_START_FEE_UNITS - baseUnits) * remaining) / BELL_DECAY_SECONDS);
}

/** effectiveLPFee = max(baseSessionFee, bellFee, corporateFee, repricingFee) */
export function effectiveFeeUnits(parts: {
  base: number;
  bell?: number;
  corporate?: number;
  repricing?: number;
}): number {
  return Math.max(parts.base, parts.bell ?? 0, parts.corporate ?? 0, parts.repricing ?? 0);
}

export function feePercent(units: number): string {
  const pct = units / 10_000;
  return `${pct.toFixed(pct < 0.1 ? 3 : 2)}%`;
}

/** Per-session limit factors (brief 8.2). Returns [perTradeDivisor, rollingDivisor]. */
export function sessionDivisors(phase: MarketPhase): [number, number] | null {
  switch (phase) {
    case 'REGULAR':
      return [1, 1];
    case 'PRE':
    case 'POST':
      return [2, 2];
    case 'OVERNIGHT':
      return [4, 4];
    case 'CLOSED':
      return [5, 4];
    default:
      return null;
  }
}

export function effectiveLimits(phase: MarketPhase, perTrade: bigint, rolling: bigint) {
  const d = sessionDivisors(phase);
  if (!d) return null;
  return { perTrade: perTrade / BigInt(d[0]), rolling: rolling / BigInt(d[1]) };
}

/* ------------------------------------------------------------------ */
/* Scheduled-calendar preview (America/New_York, no holidays).         */
/* Real contracts require committed calendar proofs; this is for UX.   */
/* ------------------------------------------------------------------ */

const DAY = 1440;
export const WEEK_MINUTES = 7 * DAY;

/** minutes since Monday 00:00 ET */
export const wm = (day: number, hh: number, mm = 0) => day * DAY + hh * 60 + mm;

export function phaseAtWeekMinute(m: number): Exclude<MarketPhase, 'UNKNOWN'> {
  const minute = ((m % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
  const day = Math.floor(minute / DAY); // 0 Mon .. 6 Sun
  const t = minute % DAY;
  if (day === 5) return 'CLOSED'; // Saturday
  if (day === 6) return t >= 20 * 60 ? 'OVERNIGHT' : 'CLOSED'; // Sunday reopen 20:00
  if (t < 4 * 60) return 'OVERNIGHT';
  if (t < 9 * 60 + 30) return 'PRE';
  if (t < 16 * 60) return 'REGULAR';
  if (t < (day === 4 ? 17 : 20) * 60) return 'POST';
  return day === 4 ? 'CLOSED' : 'OVERNIGHT'; // Friday closes at the Chainlink feed cutoff
}

/** Seconds since the latest bell start (regular open Mon–Fri, weekly reopen), or null. */
export function bellElapsedSeconds(m: number): number | null {
  const minute = ((m % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
  const starts = [wm(0, 9, 30), wm(1, 9, 30), wm(2, 9, 30), wm(3, 9, 30), wm(4, 9, 30), wm(6, 20, 0)];
  let best: number | null = null;
  for (const s of starts) {
    const dt = (minute - s) * 60;
    if (dt >= 0 && dt < BELL_DECAY_SECONDS) best = dt;
  }
  return best;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function formatWeekMinute(m: number): { day: string; time: string } {
  const minute = Math.round(((m % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES);
  const day = Math.floor(minute / DAY);
  const t = minute % DAY;
  const hh = String(Math.floor(t / 60)).padStart(2, '0');
  const mm = String(t % 60).padStart(2, '0');
  return { day: DAY_NAMES[day], time: `${hh}:${mm}` };
}

/** Real current time → week minute in America/New_York (calendar preview). */
export function nowWeekMinuteET(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const dayIdx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  const hh = Number(get('hour')) % 24;
  return wm(Math.max(dayIdx, 0), hh, Number(get('minute')));
}
