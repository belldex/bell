// Source freshness trace (plan M01-05, brief G03/G05/D02).
// Tracks per-feed observation high-water marks over time so a source whose
// freshness silently degrades (aging heartbeats, drifting timestamps) is
// surfaced as a regression, not absorbed by permissive validation.
export class FreshnessTrace {
  #highWater = new Map(); // feedId -> { inputAt, reportedAt }

  observe({ feedId, inputAt, reportedAt, expiresAt, now }) {
    if (typeof feedId !== 'string' || feedId.length === 0) throw new RangeError('feedId is required');
    for (const [name, value] of [['inputAt', inputAt], ['reportedAt', reportedAt], ['now', now]]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(name + ' must be a non-negative integer');
    }
    if (!Number.isSafeInteger(expiresAt)) throw new RangeError('expiresAt must be a safe integer');
    const previous = this.#highWater.get(feedId);
    const record = { feedId, inputAt, reportedAt, expiresAt, now, regressions: [] };
    if (previous) {
      // Observations older than the high-water mark never refresh health or
      // timers; a feed whose newest observation keeps aging is a regression.
      if (inputAt < previous.inputAt) record.regressions.push('INPUT_OLDER_THAN_HIGH_WATER');
      const previousAge = previous.now - previous.inputAt;
      const currentAge = now - inputAt;
      if (currentAge > previousAge && currentAge > 0) record.regressions.push('FRESHNESS_DEGRADING');
    }
    if (expiresAt <= now) record.regressions.push('EXPIRED');
    this.#highWater.set(feedId, { inputAt: Math.max(inputAt, previous?.inputAt ?? inputAt), now });
    return record;
  }

  highWater(feedId) {
    return this.#highWater.get(feedId) ?? null;
  }
}

// Cross-source staleness profile: two feeds for the same asset where one is
// consistently staler than the policy bound is a trace finding for admission.
export function stalenessProfile(observations, { maxAgeSeconds }) {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) throw new RangeError('maxAgeSeconds must be positive');
  const byFeed = new Map();
  for (const o of observations) {
    const age = Math.max(0, Math.floor((o.now - o.inputAt) / 1000));
    const list = byFeed.get(o.feedId) ?? [];
    list.push(age);
    byFeed.set(o.feedId, list);
  }
  return [...byFeed.entries()].map(([feedId, ages]) => ({
    feedId,
    samples: ages.length,
    maxAgeSeconds: Math.max(...ages),
    withinPolicy: Math.max(...ages) <= maxAgeSeconds,
  }));
}