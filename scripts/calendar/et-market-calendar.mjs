/**
 * US Eastern market calendar intervals for BELL.
 *
 * It emits PRE/REGULAR/POST/OVERNIGHT/CLOSED partitions for an explicit UTC window. Trading
 * follows Robinhood's Sunday 20:00 to Friday 20:00 ET market; Chainlink's published feed window
 * ends Friday 17:00 ET, so BELL closes at that earlier boundary. NYSE holidays and early closes
 * are included from the official 2026-2028 calendar. All boundaries use Eastern wall time.
 */

/** US Eastern UTC offset in seconds for a given instant (DST-aware via Intl). */
export function etOffsetSeconds(unixSeconds) {
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

/** Convert a US Eastern wall-clock time to a Unix timestamp (seconds). */
export function etWallTimeToUnix(year, month, day, hour, minute) {
  const naive = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  // Two passes settle the DST edge: the first estimate picks the offset, the second confirms it.
  return naive - etOffsetSeconds(naive - etOffsetSeconds(naive));
}

/** Calendar date parts in US Eastern for an instant. */
export function etDateParts(unixSeconds) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(unixSeconds * 1000));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: get('weekday'),
  };
}

const WEEKEND = new Set(['Sat', 'Sun']);
const HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
  '2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19', '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25',
]);
const EARLY_CLOSES = new Set(['2026-11-27', '2026-12-24', '2027-11-26', '2028-07-03', '2028-11-24']);

function dateKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isTradingDate(date) {
  return !WEEKEND.has(date.weekday) && !HOLIDAYS.has(dateKey(date));
}

function phaseAt(date, hour, minute) {
  const minuteOfDay = hour * 60 + minute;
  const key = dateKey(date);
  const tradingDate = isTradingDate(date);
  const tomorrow = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  const nextTradingDate = isTradingDate({
    year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth() + 1,
    day: tomorrow.getUTCDate(), weekday: new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(etWallTimeToUnix(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), 12, 0) * 1000),
  });
  if (minuteOfDay < 240) return tradingDate ? 'OVERNIGHT' : 'CLOSED';
  if (!tradingDate) return minuteOfDay >= 1200 && nextTradingDate ? 'OVERNIGHT' : 'CLOSED';
  if (minuteOfDay < 570) return 'PRE';
  const regularClose = EARLY_CLOSES.has(key) ? 780 : 960;
  if (minuteOfDay < regularClose) return 'REGULAR';
  const postClose = EARLY_CLOSES.has(key) ? 1020 : date.weekday === 'Fri' ? 1020 : 1200;
  if (minuteOfDay < postClose) return 'POST';
  return minuteOfDay >= 1200 && nextTradingDate ? 'OVERNIGHT' : 'CLOSED';
}

/**
 * Build a gap-free 24/5 partition covering [start, end), using the pinned market schedule.
 */
export function buildEtMarketIntervals(start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) {
    throw new RangeError('calendar range must move forward in time');
  }
  const intervals = [];
  let cursor = start;
  while (cursor < end) {
    const { year, month, day } = etDateParts(cursor);
    const dayStart = etWallTimeToUnix(year, month, day, 0, 0);
    // Walk the Eastern calendar forward by one date, so DST days are 23h or 25h.
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    const nextDayStart = etWallTimeToUnix(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0);
    const dayEnd = Math.min(end, nextDayStart);
    const fromDay = Math.max(cursor, dayStart);
    const schedule = [
      [0, 0], [4, 0], [9, 30], [13, 0], [16, 0], [17, 0], [18, 0], [20, 0], [24, 0],
    ].map(([hour, minute]) => hour === 24 ? nextDayStart : etWallTimeToUnix(year, month, day, hour, minute));
    const boundaries = [...new Set([fromDay, dayEnd, ...schedule.filter((at) => at > fromDay && at < dayEnd)])].sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i += 1) {
      const from = boundaries[i];
      const to = boundaries[i + 1];
      if (to <= from) continue;
      const date = etDateParts(from);
      const local = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(from * 1000));
      const hour = Number(local.find((part) => part.type === 'hour')?.value ?? 0);
      const minute = Number(local.find((part) => part.type === 'minute')?.value ?? 0);
      intervals.push({ start: from, end: to, phase: phaseAt(date, hour, minute) });
    }
    cursor = dayEnd;
  }
  return mergeAdjacent(intervals);
}

function mergeAdjacent(intervals) {
  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && last.phase === interval.phase && last.end === interval.start) {
      last.end = interval.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}
