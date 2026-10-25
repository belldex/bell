// Keeper A tick logic (plan M09-01, brief G14/G20/D08/D09).
// Every tick: authenticate the cron caller, acquire a fenced lease, select
// due work via the scheduler, respect a 20-second application deadline,
// checkpoint per batch and poll receipts on the next tick. A duplicate or
// no-op tick must never send a new transaction or burn gas.
import { LeaseGuard, LeaseLostError } from './jobs.mjs';

export const TICK_APPLICATION_DEADLINE_SECONDS = 20;

export function authenticateCronCall({ headerToken, expectedToken }) {
  // Constant-time-ish comparison; the cron auth secret lives in backend env.
  if (typeof headerToken !== 'string' || typeof expectedToken !== 'string') return false;
  if (headerToken.length !== expectedToken.length) return false;
  let diff = 0;
  for (let i = 0; i < headerToken.length; i += 1) diff |= headerToken.charCodeAt(i) ^ expectedToken.charCodeAt(i);
  return diff === 0;
}

export async function runKeeperTick({
  lease, now, dueWork, submit, pollReceipts, deadlineSeconds = TICK_APPLICATION_DEADLINE_SECONDS, clockNow = Date.now,
}) {
  if (lease === null || typeof lease !== 'object') throw new TypeError('lease guard is required');
  if (!Number.isSafeInteger(now)) throw new RangeError('now must be a safe integer');
  if (!Array.isArray(dueWork)) throw new TypeError('dueWork must be an array');
  const deadlineAt = now + deadlineSeconds * 1000;

  await lease.acquire();
  const results = { submitted: [], polled: [], skipped: [], noOp: true };

  // Receipt polling first: confirmations of previous ticks are free and keep
  // the ledger honest before any new signing decision.
  if (pollReceipts) {
    lease.assertValid({ now });
    results.polled = await pollReceipts({ now, deadlineAt });
  }

  for (const work of dueWork) {
    if (clockNow() >= deadlineAt) {
      results.skipped.push({ id: work.id, reason: 'DEADLINE' });
      continue;
    }
    lease.assertValid({ now });
    if (work.alreadyFresh === true) {
      // A duplicate invocation must not extend freshness or re-sign anything.
      results.skipped.push({ id: work.id, reason: 'ALREADY_FRESH' });
      continue;
    }
    const outcome = await submit(work, { deadlineAt });
    results.submitted.push({ id: work.id, ...outcome });
    results.noOp = false;
  }

  await lease.release();
  return results;
}

export function isNoOpTick(results) {
  return results.noOp === true && results.submitted.length === 0;
}

export { LeaseGuard, LeaseLostError };