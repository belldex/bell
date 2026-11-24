/**
 * Keeps the ANT calendar interval active from the Worker's cron, so nothing has to run on the owner's computer for it.
 *
 * A pool only swaps inside an activated interval, and each interval (PRE, REGULAR, POST, OVERNIGHT) is switched on by a plain call with merkle
 * proofs. When `currentInterval` reads empty, this rebuilds the published calendar (the rebuilt root must equal the committed root, or nothing
 * is sent) and calls `activateInterval`. When the interval is still active it only reads. It never touches the price: the swap carries that
 * (see ant-update.mjs).
 */
import { buildCalendarActivation } from './calendar-maintenance.mjs';

const CALENDAR_ABI = [
  { type: 'function', name: 'currentInterval', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'tuple', components: [
    { name: 'assetId', type: 'bytes32' }, { name: 'year', type: 'uint32' }, { name: 'index', type: 'uint32' }, { name: 'start', type: 'uint64' }, { name: 'end', type: 'uint64' }, { name: 'phase', type: 'uint8' }, { name: 'provenanceHash', type: 'bytes32' }] }] },
  { type: 'function', name: 'activateInterval', stateMutability: 'nonpayable', inputs: [
    { name: 'assetId', type: 'bytes32' },
    { name: 'current', type: 'tuple', components: [{ name: 'assetId', type: 'bytes32' }, { name: 'year', type: 'uint32' }, { name: 'index', type: 'uint32' }, { name: 'start', type: 'uint64' }, { name: 'end', type: 'uint64' }, { name: 'phase', type: 'uint8' }, { name: 'provenanceHash', type: 'bytes32' }] },
    { name: 'previous', type: 'tuple', components: [{ name: 'assetId', type: 'bytes32' }, { name: 'year', type: 'uint32' }, { name: 'index', type: 'uint32' }, { name: 'start', type: 'uint64' }, { name: 'end', type: 'uint64' }, { name: 'phase', type: 'uint8' }, { name: 'provenanceHash', type: 'bytes32' }] },
    { name: 'next', type: 'tuple', components: [{ name: 'assetId', type: 'bytes32' }, { name: 'year', type: 'uint32' }, { name: 'index', type: 'uint32' }, { name: 'start', type: 'uint64' }, { name: 'end', type: 'uint64' }, { name: 'phase', type: 'uint8' }, { name: 'provenanceHash', type: 'bytes32' }] },
    { name: 'proofs', type: 'bytes32[][]' }], outputs: [] },
];

let rootsCache = { at: 0, roots: null };
/** Every root the calendar has had, newest included. The GitHub renewal workflow appends each new root to evidence/deploy/calendar-roots-ANT.json,
 *  so the Worker keeps activating intervals after the first root ends without a redeploy. The compiled-in `cfg.calendar` is the fallback. */
export async function calendarRoots(cfg, fetchImpl = fetch, nowMs = Date.now()) {
  if (rootsCache.roots && nowMs - rootsCache.at < 600_000) return rootsCache.roots;
  let roots = cfg?.calendar ? [cfg.calendar] : [];
  if (cfg?.calendarRootsUrl) {
    try {
      const r = await fetchImpl(cfg.calendarRootsUrl);
      if (r.ok) { const doc = await r.json(); if (Array.isArray(doc.roots) && doc.roots.length) roots = doc.roots; }
    } catch { /* keep the compiled-in root */ }
  }
  rootsCache = { at: nowMs, roots };
  return roots;
}

/** `cfg` is BELL_ANT_CONFIG; a root is { coverageStart, coverageEnd, year, capabilityMask, root }. */
export async function runAntCalendar({ cfg, client, wallet, account, chainId = 4663, nowSeconds = Math.floor(Date.now() / 1000), fetchImpl = fetch }) {
  if (!cfg?.calendar || !cfg.calendarRegistry || !cfg.assetId) return { status: 'skipped', reason: 'no ANT calendar configured' };
  const roots = await calendarRoots(cfg, fetchImpl, nowSeconds * 1000);
  const root = roots.find((x) => nowSeconds >= Number(x.coverageStart) && nowSeconds < Number(x.coverageEnd));
  if (!root) return { status: 'skipped', reason: 'no published ANT calendar root covers this time; a new root is needed' };
  const current = await client.readContract({ address: cfg.calendarRegistry, abi: CALENDAR_ABI, functionName: 'currentInterval', args: [cfg.assetId] });
  if (Number(current.phase) !== 0) return { status: 'calendar-current', phase: Number(current.phase) };
  const activation = buildCalendarActivation({ config: root, chainId, calendarRegistry: cfg.calendarRegistry, assetId: cfg.assetId, nowSeconds });
  const request = await client.simulateContract({
    address: cfg.calendarRegistry, abi: CALENDAR_ABI, functionName: 'activateInterval',
    args: [cfg.assetId, activation.current, activation.previous, activation.next, activation.proofs], account,
  });
  const hash = await wallet.writeContract({ ...request.request, maxFeePerGas: 100_000_000n, maxPriorityFeePerGas: 1_000_000n });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`ANT calendar activation reverted (${hash})`);
  return { status: 'calendar-activated', phase: activation.phase, txHash: hash };
}
