/**
 * Keeps the live ANT pool moving through halts, closures and reopening auctions, from the Worker's cron, so nothing runs on the owner's computer.
 * Everything it sends is permissionless and carries no authority: it cannot halt, resume or renew (those are hybrid-signed by REPORTER through the
 * `ant-halt-action` workflow), it only commits state the chain has already decided.
 *
 *   refreshState   whenever the hook's projected mode differs from the stored one or the halt registry and the latch disagree
 *   captureClose   in the last five minutes before a planned closure (weekend, holiday): a report, then the closing anchor
 *   report         while the pool is RECOVERING: one price report on chain, because a swap cannot carry it (the swap reverts while recovering, and a
 *                  revert would undo the report), and reopening needs a report that is newer than the checkpoint
 *   armResume      when the registry shows the resume window, so the reopening auction opens for orders
 *   settle         when the auction window is over (stage LOCKED) and the hook allows swaps again
 *
 * Cost: a report is about 423,000 gas, and only while the pool is recovering, a couple of minutes after a closure or a halt.
 */
import { parseAbi } from 'viem';
import { hashCalendarLeaf } from '@bell/protocol/calendar';
import { buildAntUpdate } from './ant-update.mjs';
import { isCloseCaptureWindow } from './tick-policy.mjs';

const HOOK = parseAbi([
  'function refreshState() returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))',
  'function getPolicy() view returns ((bool canSwap,uint8 mode,uint8 phase,uint16 flags,uint256 reasonBits,uint24 lpFeeUnits,uint16 bandBps,uint128[2] a,uint128[2] b,uint128[2] c,uint128[2] d,uint128[2] e,uint64 f,uint64 g,bytes32 h,bytes32 i))',
  'function state() view returns ((uint8 lifecycle,uint8 mode,bool closedLatched,uint64 closureNonce,uint64 bellStart,uint64 corporateUntil,uint64 reopenCandidateAt,uint64 oldValidUntil,uint64[2] reopenBaseObservations,uint64[2] lastOpenObservations))',
]);
const REG = parseAbi(['function phase(bytes32) view returns (uint8)']);
const AUCTION_REG = parseAbi(['function auctionFor(bytes32) view returns (address)']);
const AUCTION = parseAbi(['function armResume() returns (bool)', 'function settle()', 'function currentStage() view returns (uint8)']);
const SESSION = parseAbi(['function refreshStockWithReports(bytes32 assetId,(bytes32 descriptorId,bytes32 feedId,uint8 phase,uint128 price18,uint64 observedAt,uint64 inputAt,uint64 validFrom,uint64 expiresAt,uint64 validUntil,bytes32 reportHash) directSample,bytes directSignature,bytes[] reports) returns (uint256 reasons)']);
const CALENDAR = parseAbi([
  'function currentInterval(bytes32) view returns ((bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))',
  'function nextInterval(bytes32) view returns ((bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))',
]);
const ANCHOR = parseAbi([
  'function anchorStatus(bytes32,bytes32) view returns ((bytes32 assetId,bytes32 boundaryHash,uint128 price18,uint128 multiplier18,uint64 capturedAt,uint64 observedAt,uint64 inputAt,uint64 closureStart,bytes32 sourceHash),bool valid,uint256 reasons,uint64 validUntil)',
  'function captureClose(bytes32,bytes32) returns ((bytes32 assetId,bytes32 boundaryHash,uint128 price18,uint128 multiplier18,uint64 capturedAt,uint64 observedAt,uint64 inputAt,uint64 closureStart,bytes32 sourceHash))',
]);
const RECOVERY_PENDING = 1n << 12n;
const FEES = { maxFeePerGas: 50_000_000n, maxPriorityFeePerGas: 1_000_000n }; // 0.05 gwei: the chain runs at about 0.02

/** `cfg` is BELL_ANT_CONFIG; `cfg.pool` is { hook, poolId }, with `haltRegistry`, `auctionRegistry` and `sessionRegistry` beside it. */
export async function runAntKeeper({ cfg, delegateKey, client, wallet, account, fetchImpl = fetch, nowSeconds = Math.floor(Date.now() / 1000), chainId = 4663 }) {
  const p = cfg?.pool;
  if (!p?.hook || !cfg.haltRegistry || !cfg.auctionRegistry || !cfg.sessionRegistry) return { status: 'skipped', reason: 'no ANT pool configured' };
  const did = [];
  const send = async (label, params) => {
    const { request } = await client.simulateContract({ ...params, account });
    const gas = await client.estimateContractGas({ ...params, account });
    const hash = await wallet.writeContract({ ...request, gas: (gas * 13n) / 10n, ...FEES });
    const rc = await client.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') throw new Error(`${label} reverted (${hash})`);
    did.push({ label, txHash: hash });
  };

  const [phaseIdx, policy, st, auction] = await Promise.all([
    client.readContract({ address: cfg.haltRegistry, abi: REG, functionName: 'phase', args: [cfg.assetId] }),
    client.readContract({ address: p.hook, abi: HOOK, functionName: 'getPolicy' }),
    client.readContract({ address: p.hook, abi: HOOK, functionName: 'state' }),
    client.readContract({ address: cfg.auctionRegistry, abi: AUCTION_REG, functionName: 'auctionFor', args: [p.poolId] }),
  ]);
  const phase = ['NORMAL', 'HALTED', 'RESUME_AUCTION'][phaseIdx];
  const stage = Number(await client.readContract({ address: auction, abi: AUCTION, functionName: 'currentStage' }));
  const recovering = (BigInt(policy.reasonBits) & RECOVERY_PENDING) !== 0n;

  // 1. Settle a finished auction as soon as the hook allows swaps; an empty book closes empty.
  if (stage === 3 && policy.canSwap) await send('settle', { address: auction, abi: AUCTION, functionName: 'settle' });
  // 2. A recovering pool needs a report that is newer than the checkpoint, then the checkpoint itself.
  const publish = async () => {
    try {
      const b = await buildAntUpdate({ cfg, delegateKey, client, fetchImpl });
      const direct = Object.fromEntries(Object.entries(b.directSample).map(([k, v]) => ['price18', 'observedAt', 'inputAt', 'validFrom', 'expiresAt', 'validUntil'].includes(k) ? [k, BigInt(v)] : [k, v]));
      await send('report', { address: cfg.sessionRegistry, abi: SESSION, functionName: 'refreshStockWithReports', args: [cfg.assetId, direct, b.directSignature, b.reports] });
      return true;
    } catch (e) { did.push({ label: 'report skipped', reason: String(e?.shortMessage ?? e?.message ?? e).slice(0, 120) }); return false; }
  };
  if (recovering) await publish();
  // 2b. Before a planned closure (a weekend or a holiday) the registry needs a closing anchor captured in the last five minutes of the open
  //     session, with a fresh report on chain. Without it the pool goes HALTED at the close instead of CLOSED.
  if (cfg.calendarRegistry) {
    const [cur, nxt] = await Promise.all([
      client.readContract({ address: cfg.calendarRegistry, abi: CALENDAR, functionName: 'currentInterval', args: [cfg.assetId] }),
      client.readContract({ address: cfg.calendarRegistry, abi: CALENDAR, functionName: 'nextInterval', args: [cfg.assetId] }).catch(() => null),
    ]);
    if (nxt && isCloseCaptureWindow(cur, nxt, nowSeconds)) {
      const boundaryHash = hashCalendarLeaf({ chainId, calendarRegistry: cfg.calendarRegistry, assetId: cfg.assetId, year: Number(nxt.year), index: Number(nxt.index), start: nxt.start, end: nxt.end, phase: Number(nxt.phase), provenanceHash: nxt.provenanceHash });
      const [, valid] = await client.readContract({ address: cfg.sessionRegistry, abi: ANCHOR, functionName: 'anchorStatus', args: [cfg.assetId, boundaryHash] });
      if (!valid && (await publish())) await send('captureClose', { address: cfg.sessionRegistry, abi: ANCHOR, functionName: 'captureClose', args: [cfg.assetId, boundaryHash] });
    }
  }
  // 3. Commit the closure, or its release, whenever the projected mode differs from the stored one.
  if (policy.mode !== st.mode || (phase !== 'NORMAL' && !st.closedLatched) || (phase === 'NORMAL' && st.closedLatched && policy.mode !== 2) || recovering) {
    await send('refreshState', { address: p.hook, abi: HOOK, functionName: 'refreshState' });
  }
  // 4. Open the reopening auction for the resume window.
  if (phase === 'RESUME_AUCTION' && stage !== 2) await send('armResume', { address: auction, abi: AUCTION, functionName: 'armResume' });
  return did.length ? { status: 'acted', phase, stage, did } : { status: 'idle', phase, stage, mode: policy.mode };
}
