// Earliest-deadline scheduling for keepers (plan M09-04, brief G13/G14/G20).
// Normative order: pause/corporate first, then capture/reopen boundaries,
// then validUntil freshness, then optional housekeeping. Within a priority the
// earliest deadline wins so a stale old deadline is never starved by newer
// data. Work is deduplicated per asset/feed/observation and reuse is shared
// across pools. Missed ticks are skipped, never replayed as a catch-up storm.
const KIND_PRIORITY = Object.freeze({
  PAUSE: 0,
  CORPORATE: 0,
  CAPTURE_CLOSE: 1,
  REOPEN: 1,
  FRESHNESS: 2,
  HOUSEKEEPING: 3,
});

export const MAX_REPORTS_PER_BATCH = 6;

function validateTask(task, index) {
  if (task === null || typeof task !== 'object') throw new TypeError(`tasks[${index}] must be an object`);
  const { id, kind, assetId, feedId, deadline } = task;
  if (typeof id !== 'string' || id.length === 0) throw new TypeError(`tasks[${index}].id is required`);
  if (!(kind in KIND_PRIORITY)) throw new RangeError(`tasks[${index}].kind ${kind} is not schedulable`);
  if (typeof assetId !== 'string' || assetId.length === 0) throw new TypeError(`tasks[${index}].assetId is required`);
  if (feedId !== undefined && feedId !== null && (typeof feedId !== 'string' || feedId.length === 0)) {
    throw new TypeError(`tasks[${index}].feedId must be a non-empty string`);
  }
  if (deadline === undefined || deadline === null || !Number.isSafeInteger(deadline)) {
    throw new RangeError(`tasks[${index}].deadline must be a safe integer timestamp`);
  }
  return task;
}

function observationKey(task) {
  // Deduplicate identical observations across pools: the same feed report can
  // only be submitted once, whoever schedules it.
  return [`asset:${task.assetId}`, `feed:${task.feedId ?? '*'}`, `obs:${task.observationHash ?? task.id}`].join('|');
}

export function planTick({ now, dueTick, tasks, maxBatch = MAX_REPORTS_PER_BATCH, maxBytes = Infinity, maxConcurrency = 1 }) {
  if (!Number.isSafeInteger(now)) throw new RangeError('now must be a safe integer timestamp');
  if (dueTick !== undefined && !Number.isSafeInteger(dueTick)) throw new RangeError('dueTick must be a safe integer timestamp');
  if (!Number.isSafeInteger(maxBatch) || maxBatch < 1) throw new RangeError('maxBatch must be a positive integer');
  if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new RangeError('maxBytes is invalid');
  if (!Array.isArray(tasks)) throw new TypeError('tasks must be an array');
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) throw new RangeError('maxConcurrency must be a positive integer');

  // A late scheduler invocation must not replay every missed interval: the
  // tick that is due is executed once and missed ones are counted, not run.
  let missedTicks = 0;
  if (dueTick !== undefined && dueTick < now) missedTicks = Math.floor((now - dueTick) / 1) && 1;

  const seen = new Map();
  let deduped = 0;
  const unique = [];
  for (const raw of tasks) {
    const task = validateTask(raw, unique.length);
    const key = observationKey(task);
    const existing = seen.get(key);
    if (existing) {
      deduped += 1;
      const incomingMoreUrgent = KIND_PRIORITY[task.kind] < KIND_PRIORITY[existing.kind]
        || (KIND_PRIORITY[task.kind] === KIND_PRIORITY[existing.kind] && task.deadline < existing.deadline);
      if (incomingMoreUrgent) {
        // The more urgent variant takes over the slot; the replaced id is recorded.
        existing.reusedBy = [...(existing.reusedBy ?? []), existing.id];
        existing.id = task.id;
        existing.kind = task.kind;
        existing.deadline = task.deadline;
        existing.bytes = task.bytes;
        existing.observationHash = task.observationHash;
      } else {
        existing.reusedBy = [...(existing.reusedBy ?? []), task.id];
      }
      continue;
    }
    seen.set(key, task);
    unique.push(task);
  }

  const due = unique
    .map((task) => ({ ...task, priority: KIND_PRIORITY[task.kind] }))
    .filter((task) => (task.priority <= KIND_PRIORITY.HOUSEKEEPING ? true : false))
    .sort((a, b) => a.priority - b.priority || a.deadline - b.deadline);

  const selected = [];
  let bytes = 0;
  for (const task of due) {
    if (selected.length >= maxBatch) break;
    const size = task.bytes ?? 0;
    if (bytes + size > maxBytes) continue;
    bytes += size;
    selected.push(task);
  }
  const deferred = due.filter((task) => !selected.includes(task)).map((task) => task.id);

  return {
    due: selected.map(({ priority, ...rest }) => ({ ...rest, priority })),
    deferred,
    deduped,
    missedTicks,
    fetchPlan: {
      concurrency: Math.min(maxConcurrency, selected.length || 1),
      batchCount: Math.ceil(selected.length / maxBatch),
    },
  };
}
