// Quota/admission status snapshot (plan M12-05, brief G34/G35).
// Aggregates quota meter, catchup forecast and RPC proxy state into one
// ops dashboard shape. The dashboard never authorizes swaps or reads
// licensed payloads; it is derived state for operators.
export function statusSnapshot({ quotaSnapshot, catchup, rpcProxy, incidentCount, generatedAt }) {
  if (!Array.isArray(quotaSnapshot)) throw new TypeError('quotaSnapshot must be an array');
  if (catchup === null || typeof catchup !== 'object') throw new TypeError('catchup is required');
  if (!Number.isSafeInteger(incidentCount) || incidentCount < 0) throw new RangeError('incidentCount must be non-negative');
  const exhausted = quotaSnapshot.filter((q) => q.estimated >= q.observed && q.estimated > 0 && q.observed > 0);
  const admission = catchup.status === 'OK' && incidentCount === 0 && !rpcProxy?.blocked
    ? 'ADMITTING'
    : 'THROTTLED';
  return {
    generatedAt,
    admission,
    indexLagSeconds: catchup.lagSeconds ?? null,
    indexStatus: catchup.status,
    quotas: quotaSnapshot.map((q) => ({
      scope: q.scope, resource: q.resource, period: q.period,
      usage: q.estimated, observed: q.observed, inFlight: q.inFlight,
      state: q.estimated >= q.observed && q.inFlight > 0 ? 'BUSY' : 'OK',
    })),
    incidents: incidentCount,
    rpcProxy: { allowlisted: rpcProxy?.allowlistSize ?? 0, blocked: rpcProxy?.blocked === true },
    note: 'Derived state only; the dashboard is not an authorization source.',
  };
}