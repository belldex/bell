/**
 * US Eastern market calendar intervals for the BELL rehearsal.
 *
 * This module does not fetch schedules, infer holidays, or guess early closes. It emits the
 * regular weekday PRE/REGULAR/CLOSED partition for an explicit UTC window, using real US
 * Eastern wall-clock boundaries (04:00 / 09:30 / 16:00 ET) so the calendar survives DST changes.
 *
 * Rehearsal scope: weekdays only, no holiday table. A holiday will look like a normal session
 * to the calendar; the keeper's source-freshness check is what stops trading that day.
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

/**
 * Build a gap-free PRE/REGULAR/CLOSED partition covering [start, end).
 * PRE = 04:00-09:30 ET, REGULAR = 09:30-16:00 ET, CLOSED = the rest of the day.
 */
export function buildEtMarketIntervals(start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) {
    throw new RangeError('calendar range must move forward in time');
  }
  const intervals = [];
  let cursor = start;
  while (cursor < end) {
    const { year, month, day, weekday } = etDateParts(cursor);
    const dayStart = cursor;
    const preStart = etWallTimeToUnix(year, month, day, 4, 0);
    const openStart = etWallTimeToUnix(year, month, day, 9, 30);
    const closeStart = etWallTimeToUnix(year, month, day, 16, 0);
    // Walk the Eastern calendar forward by one date, so DST days are 23h or 25h.
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    const nextDayStart = etWallTimeToUnix(
      next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0,
    );
    const dayEnd = Math.min(end, nextDayStart);

    if (WEEKEND.has(weekday)) {
      intervals.push({ start: dayStart, end: dayEnd, phase: 'CLOSED' });
    } else {
      const boundaries = [...new Set([dayStart, preStart, openStart, closeStart, dayEnd]
        .filter((value) => value >= dayStart && value <= dayEnd))].sort((a, b) => a - b);
      const phaseAt = (value) => {
        if (value >= preStart && value < openStart) return 'PRE';
        if (value >= openStart && value < closeStart) return 'REGULAR';
        return 'CLOSED';
      };
      for (let i = 0; i < boundaries.length - 1; i += 1) {
        const from = boundaries[i];
        const to = boundaries[i + 1];
        if (to <= from) continue;
        intervals.push({ start: from, end: to, phase: phaseAt(from) });
      }
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
