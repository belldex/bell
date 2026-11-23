/**
 * Einstein Hooks v3 event windows: carve CLOSED intervals for scheduled events (earnings) out of an existing calendar partition.
 *
 * The calendar stays one Merkle-committed partition of time. An event window is not a new leaf type: it is a CLOSED leaf, with its own
 * provenance hash, cut out of whatever interval it overlaps, so the hook, the registry and the close-anchor capture treat it exactly like
 * any planned closure (CLOSED fee, closure budget, recovery on reopen). If an event date moves, the carved calendar is rebuilt and a new
 * root is signed; old roots stay visible on chain.
 *
 *   carveEventWindows(intervals, events, { coverageStart, coverageEnd, provenanceFor })
 *
 * `intervals` are the {start, end, phase, provenanceHash} the calendar builder takes, `events` are {id, start, end}. Throws on anything
 * ambiguous (overlapping events, an event outside coverage, an empty or reversed window) instead of guessing.
 */
const BYTES32 = /^0x[0-9a-f]{64}$/i;

function toBig(value, name) {
  try { return BigInt(value); } catch { throw new TypeError(`${name} must be an integer`); }
}

export function carveEventWindows(intervals, events, { coverageStart, coverageEnd, provenanceFor }) {
  if (typeof provenanceFor !== 'function') throw new TypeError('provenanceFor(event) must return the 32-byte provenance hash of the event window');
  const lo = toBig(coverageStart, 'coverageStart');
  const hi = toBig(coverageEnd, 'coverageEnd');
  const windows = (events ?? []).map((e) => {
    const start = toBig(e.start, `event ${e.id} start`);
    const end = toBig(e.end, `event ${e.id} end`);
    if (end <= start) throw new RangeError(`event ${e.id}: end must be after start`);
    if (start < lo || end > hi) throw new RangeError(`event ${e.id}: window is outside the calendar coverage`);
    const provenanceHash = provenanceFor(e);
    if (typeof provenanceHash !== 'string' || !BYTES32.test(provenanceHash) || /^0x0+$/.test(provenanceHash)) throw new TypeError(`event ${e.id}: provenance must be a nonzero bytes32`);
    return { id: e.id, start, end, provenanceHash };
  }).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  for (let i = 1; i < windows.length; i += 1) {
    if (windows[i].start < windows[i - 1].end) throw new RangeError(`events ${windows[i - 1].id} and ${windows[i].id} overlap`);
  }

  const src = intervals.map((i) => ({ start: toBig(i.start, 'interval start'), end: toBig(i.end, 'interval end'), phase: i.phase, provenanceHash: i.provenanceHash }));
  const out = [];
  for (const interval of src) {
    let cursor = interval.start;
    for (const w of windows) {
      if (w.end <= cursor || w.start >= interval.end) continue;
      const cutStart = w.start > cursor ? w.start : cursor;
      const cutEnd = w.end < interval.end ? w.end : interval.end;
      if (cutStart > cursor) out.push({ ...interval, start: cursor, end: cutStart });
      // The carved piece is CLOSED even where the source interval was already CLOSED: it still carries the event's provenance, so the leaf
      // says why it is there. A window that spans several source intervals becomes one CLOSED leaf per piece, merged below.
      out.push({ start: cutStart, end: cutEnd, phase: 'CLOSED', provenanceHash: w.provenanceHash, eventId: w.id });
      cursor = cutEnd;
    }
    if (cursor < interval.end) out.push({ ...interval, start: cursor, end: interval.end });
  }
  // Merge neighbouring pieces of the same event so a window is one leaf, not one per source interval it crossed.
  const merged = [];
  for (const piece of out) {
    const last = merged[merged.length - 1];
    if (last && piece.eventId && last.eventId === piece.eventId && last.end === piece.start) last.end = piece.end;
    else merged.push({ ...piece });
  }
  for (const w of windows) {
    if (!merged.some((m) => m.eventId === w.id)) throw new Error(`event ${w.id} was not placed in the calendar`);
  }
  return merged.map(({ eventId: _eventId, ...rest }) => ({ ...rest, start: rest.start.toString(), end: rest.end.toString() }));
}

/** Which source phases an event window displaced, for the page: [{ id, start, end, replaced: ['REGULAR', ...] }]. */
export function describeEventWindows(intervals, events) {
  return events.map((e) => {
    const start = BigInt(e.start); const end = BigInt(e.end);
    const replaced = [...new Set(intervals.filter((i) => BigInt(i.end) > start && BigInt(i.start) < end).map((i) => i.phase))];
    return { id: e.id, start: start.toString(), end: end.toString(), replaced };
  });
}
