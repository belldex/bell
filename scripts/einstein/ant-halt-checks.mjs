/**
 * Einstein Hooks v3 proofs V1 to V7 on the live mainnet ANT pool, replayed from a public RPC. Used by verify-einstein-ant.mjs.
 * proof.v3 holds only transaction hashes; every verdict comes from receipts, event logs and block timestamps, so it still replays when the RPC
 * has pruned old state. Only the revert NAME needs the state of the block before the transaction: if the RPC no longer has it, that part is
 * reported as PARTIAL (the transaction did revert) and a full node gives PASS.
 *
 * V1  a hybrid-signed halt (Halted event, REPORTER leaf) and a swap inside its window paid 10000 pips in the PoolManager Swap event
 * V2  a resume (Resumed event), then a swap that reverted with AuctionActive inside the reopening auction
 * V3  a halt with ECDSA only reverted with InvalidPQSignature
 * V4  a halt that was never renewed or resumed lapsed by itself, the registry reads NORMAL, and a later swap paid its session's fee
 * V5  a swap inside an EVENT window at the override fee (not shown yet)
 * V6  an exit inside a halt window, with no hook log and no post-quantum signature
 * V7  Sourcify exact match for every v3 contract (match is not enough)
 */
import { parseAbi, parseEventLogs, getAddress } from 'viem';
import { buildEtMarketIntervals } from '../calendar/et-market-calendar.mjs';

const SWAP = parseAbi(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const REGISTRY_EVENTS = parseAbi([
  'event Halted(bytes32 indexed assetId, uint64 indexed haltId, uint64 startTs, uint64 recordedAt, uint64 expiresAt, bytes32 reason, uint32 leaf)',
  'event Renewed(bytes32 indexed assetId, uint64 indexed haltId, uint64 expiresAt, uint32 leaf)',
  'event Resumed(bytes32 indexed assetId, uint64 indexed haltId, uint64 resumeTs, uint64 auctionEndsAt, uint32 leaf)',
]);
const REG = parseAbi(['function phase(bytes32) view returns (uint8)', 'function haltedUntil(bytes32) view returns (uint64)']);
const SEL = { AuctionActive: 'b37f7006', InvalidPQSignature: '7fd2fae9' };
const FEE_OF_PHASE = { 1: 3000, 2: 500, 3: 3000, 4: 5000, 5: 10000 };

const rc = (pc, hash) => pc.getTransactionReceipt({ hash }).catch(() => null);
const ts = async (pc, r) => Number((await pc.getBlock({ blockNumber: r.blockNumber })).timestamp);
const feeOf = (r, poolId) => parseEventLogs({ abi: SWAP, logs: r.logs }).find((l) => l.args.id.toLowerCase() === poolId.toLowerCase())?.args.fee ?? null;
const registryEvent = (r, reg, name) => parseEventLogs({ abi: REGISTRY_EVENTS, logs: r.logs.filter((l) => l.address.toLowerCase() === reg.toLowerCase()) }).find((l) => l.eventName === name);
/** { data } when the RPC returned the revert data, { gone: true } when it has pruned the state of that block. */
async function revertData(pc, hash) {
  const tx = await pc.getTransaction({ hash }); const r = await rc(pc, hash); let data = ''; let msg = '';
  try { await pc.call({ account: tx.from, to: tx.to, data: tx.input, blockNumber: r.blockNumber - 1n }); } catch (e) { let c = e; msg = String(e?.details ?? e?.shortMessage ?? e?.message ?? ''); while (c && !data) { data = typeof c.data === 'string' && c.data.startsWith('0x') ? c.data : ''; c = c.cause; } }
  return data ? { data } : { gone: /historical state|not available|missing trie|header not found/i.test(msg) };
}
const sessionFee = (t) => { const iv = buildEtMarketIntervals(t - 86400, t + 86400).find((i) => t >= i.start && t < i.end); return { fee: iv ? FEE_OF_PHASE[Number(iv.phase)] : null, phase: iv?.phase ?? null }; };
const revertVerdict = (status, rv, name, okNote, what) => {
  if (status !== 'reverted') return { verdict: 'FAIL', note: `${what} status ${status}` };
  if (rv.data?.includes(SEL[name])) return { verdict: 'PASS', note: okNote };
  if (rv.data) return { verdict: 'FAIL', note: `${what} reverted, but not with ${name}` };
  return { verdict: 'PARTIAL', note: `${what} did revert on mainnet (receipt status 0); this RPC no longer has the state of the block before it, so the error name ${name} (0x${SEL[name]}) needs an archive node to read.` };
};

export async function haltChecks({ pc, proof, out }) {
  const v = proof.v3;
  if (!v) return false;
  const c = v.checks ?? {}; const reg = v.haltRegistry; const asset = v.asset; const pool = v.pool;

  // V1 and V6 need the window of the first halt: from its Halted event until the resume that ended it.
  let window1 = null;
  if (c.V1?.haltTx) {
    const h = await rc(pc, c.V1.haltTx);
    const ev = h && registryEvent(h, reg, 'Halted');
    const resumed = c.V2?.resumeTx ? await rc(pc, c.V2.resumeTx) : null;
    if (ev && h.status === 'success') window1 = { from: Number(ev.args.recordedAt), to: Math.min(Number(ev.args.expiresAt), resumed ? await ts(pc, resumed) : Infinity), leaf: ev.args.leaf };
  }
  if (c.V1?.swapTx) {
    const s = await rc(pc, c.V1.swapTx);
    const t = s ? await ts(pc, s) : 0; const fee = s ? feeOf(s, pool) : null;
    out.V1 = window1 && s?.status === 'success' && t >= window1.from && t < window1.to && fee === 10000
      ? { verdict: 'PASS', note: `A hybrid-signed halt was recorded (Halted event, REPORTER leaf ${window1.leaf}); a swap inside its window paid ${fee} pips in the Swap event.` }
      : { verdict: 'FAIL', note: `halt window ${JSON.stringify(window1)}, swap at ${t} status ${s?.status} fee ${fee}` };
  }
  if (c.V2?.resumeTx && c.V2.swapTx) {
    const [r, s] = await Promise.all([rc(pc, c.V2.resumeTx), rc(pc, c.V2.swapTx)]);
    const ev = r && registryEvent(r, reg, 'Resumed');
    if (!ev || r.status !== 'success') out.V2 = { verdict: 'FAIL', note: 'the resume transaction has no Resumed event' };
    else {
      const inWindow = s && (await ts(pc, s)) >= (await ts(pc, r)) && (await ts(pc, s)) < Number(ev.args.auctionEndsAt);
      const res = revertVerdict(s?.status, s?.status === 'reverted' ? await revertData(pc, c.V2.swapTx) : {}, 'AuctionActive', `A hybrid-signed resume was recorded (Resumed event, REPORTER leaf ${ev.args.leaf}); a swap sent inside the reopening auction reverted with AuctionActive (0x${SEL.AuctionActive}).`, 'the swap');
      out.V2 = inWindow ? res : { verdict: 'FAIL', note: 'the swap was not inside the resume window' };
    }
  }
  if (c.V3?.tx) {
    const r = await rc(pc, c.V3.tx);
    out.V3 = revertVerdict(r?.status, r?.status === 'reverted' ? await revertData(pc, c.V3.tx) : {}, 'InvalidPQSignature', `A halt with the REPORTER ECDSA signature and no post-quantum signature reverted with InvalidPQSignature (0x${SEL.InvalidPQSignature}).`, 'the halt');
  }
  if (v.v4?.haltTx) {
    const h = await rc(pc, v.v4.haltTx);
    const ev = h && registryEvent(h, reg, 'Halted');
    const now = Number((await pc.getBlock()).timestamp);
    if (!ev || h.status !== 'success') out.V4 = { verdict: 'FAIL', note: 'the second halt transaction has no Halted event' };
    else if (now < Number(ev.args.expiresAt)) out.V4 = { verdict: 'PENDING', note: `The halt recorded in ${v.v4.haltTx.slice(0, 10)}… lapses on its own at ${new Date(Number(ev.args.expiresAt) * 1000).toISOString()}; nothing renews it.` };
    else if (c.V4?.swapTx) {
      const logs = await pc.getLogs({ address: reg, events: REGISTRY_EVENTS, fromBlock: h.blockNumber, toBlock: 'latest', args: { assetId: asset } });
      const touched = logs.filter((l) => l.eventName !== 'Halted' && l.args.haltId === ev.args.haltId);
      const s = await rc(pc, c.V4.swapTx);
      const t = s ? await ts(pc, s) : 0; const fee = s ? feeOf(s, pool) : null; const want = sessionFee(t);
      const phase = ['NORMAL', 'HALTED', 'RESUME_AUCTION'][await pc.readContract({ address: reg, abi: REG, functionName: 'phase', args: [asset] })];
      out.V4 = touched.length === 0 && phase === 'NORMAL' && s?.status === 'success' && t > Number(ev.args.expiresAt) && want.fee && fee === want.fee
        ? { verdict: 'PASS', note: `The halt recorded in ${v.v4.haltTx.slice(0, 10)}… was never renewed or resumed (no Renewed or Resumed event); it lapsed by itself at ${new Date(Number(ev.args.expiresAt) * 1000).toISOString()}, the registry reads NORMAL, and a swap after that paid ${fee} pips, the fee of the session it happened in.` }
        : { verdict: 'FAIL', note: `renew/resume events ${touched.length}, registry ${phase}, swap ${s?.status} at ${t}, fee ${fee}, session fee ${want.fee}` };
    } else out.V4 = { verdict: 'PENDING', note: 'the halt has lapsed; the swap at the normal session fee is not recorded yet' };
  }
  out.V5 ??= { verdict: 'PENDING', note: 'Not shown yet, and it cannot be shown on this calendar: the CalendarRegistry only accepts a new root that starts where the active one ends (queueRoot rejects an overlap), and the ANT root runs to 1 Jan 2027. An EVENT window can only be carved into the next root. The carving is built and tested (scripts/calendar/event-windows.mjs, a hook test and a SessionRegistry close-capture test); the swap inside a window waits for that root and a real earnings date.' };
  if (c.V6?.tx) {
    const r = await rc(pc, c.V6.tx);
    const t = r ? await ts(pc, r) : 0;
    const touched = r ? r.logs.some((l) => l.address.toLowerCase() === v.hook.toLowerCase()) : null;
    out.V6 = r?.status === 'success' && window1 && t >= window1.from && t < window1.to && touched === false
      ? { verdict: 'PASS', note: `Liquidity was removed through the PositionManager inside the first halt's window (block ${r.blockNumber}); the hook emitted no log and no post-quantum signature was needed.` }
      : { verdict: 'FAIL', note: `status ${r?.status}, halt window ${JSON.stringify(window1)}, exit at ${t}, hook logs ${touched}` };
  }
  try {
    const rows = await Promise.all(Object.entries(v.contracts).map(async ([name, a]) => [name, (await (await fetch(`https://sourcify.dev/server/v2/contract/4663/${getAddress(a)}`)).json()).match ?? 'none']));
    const exact = rows.filter(([, m]) => m === 'exact_match').length;
    out.V7 = exact === rows.length ? { verdict: 'PASS', note: `Sourcify shows an exact match for all ${rows.length} v3 contracts.` }
      : { verdict: 'PARTIAL', note: `Sourcify: ${rows.map(([n, m]) => `${n} ${m}`).join(', ')}. They were built without a compiler metadata hash (bytecode_hash none), so an exact match needs a rebuild and a redeploy; the owner chose to leave them as match.` };
  } catch (e) { out.V7 = { verdict: 'PENDING', note: `could not read sourcify.dev: ${String(e.cause?.code ?? e.message).slice(0, 80)}` }; }
  return true;
}
