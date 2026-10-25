// Indexer lag and catch-up quota control (plan M10-05, brief G35/G36/D06/D07).
// The planner budget is a measured design limit, not something to silently
// raise at runtime. If the measured head rate does not fit the free-tier
// budget, admission fails loudly with INDEX_LAGGING - no paid fallback.
export const INDEX_LAGGING_THRESHOLD_SECONDS = 120;
export const PLANNER_MAX_CALLS_PER_MINUTE = 24;

export function measureHeadroom({ measuredHeadRatePerMinute, chunkSize, shardCount, plannerMaxCallsPerMinute = PLANNER_MAX_CALLS_PER_MINUTE }) {
  if (!Number.isSafeInteger(measuredHeadRatePerMinute) || measuredHeadRatePerMinute < 0) {
    throw new RangeError('measuredHeadRatePerMinute must be a non-negative integer');
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new RangeError('chunkSize must be positive');
  if (!Number.isSafeInteger(shardCount) || shardCount < 1) throw new RangeError('shardCount must be positive');
  const callsNeededPerMinute = Math.ceil(measuredHeadRatePerMinute / chunkSize) * shardCount;
  return {
    callsNeededPerMinute,
    fits: callsNeededPerMinute <= plannerMaxCallsPerMinute,
    deficit: Math.max(0, callsNeededPerMinute - plannerMaxCallsPerMinute),
  };
}

export function catchupPlan({ backlogBlocks, maxBackfillPerMinute, now, lastIndexedAt, keeperReservePerMinute = 0 }) {
  if (!Number.isSafeInteger(backlogBlocks) || backlogBlocks < 0) throw new RangeError('backlogBlocks must be non-negative');
  if (!Number.isSafeInteger(maxBackfillPerMinute) || maxBackfillPerMinute < 1) {
    throw new RangeError('maxBackfillPerMinute must be positive');
  }
  if (!Number.isSafeInteger(keeperReservePerMinute) || keeperReservePerMinute < 0) {
    throw new RangeError('keeperReservePerMinute must be non-negative');
  }
  if (keeperReservePerMinute > maxBackfillPerMinute) {
    throw new RangeError('keeper reserve must fit within the backfill budget');
  }
  if (!Number.isSafeInteger(lastIndexedAt)) throw new RangeError('lastIndexedAt must be a safe integer');
  if (!Number.isSafeInteger(now)) throw new RangeError('now must be a safe integer');
  const lagSeconds = Math.floor((now - lastIndexedAt) / 1000);
  const lagging = lagSeconds > INDEX_LAGGING_THRESHOLD_SECONDS;
  const effectiveRate = maxBackfillPerMinute - keeperReservePerMinute;
  const clearMinutes = Math.ceil(backlogBlocks / effectiveRate);
  return {
    lagSeconds,
    lagging,
    status: lagging ? 'INDEX_LAGGING' : 'OK',
    clearMinutes,
    note: 'Planning figure only; if the measured rate cannot clear the backlog, admission fails instead of raising limits.',
  };
}