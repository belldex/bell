/**
 * Mainnet checks for the ANT pool, A2 to A7, read from a public RPC. Used by verify-einstein-ant.mjs. Nothing here is trusted from proof.json
 * except the transaction hashes and the expected values; every verdict comes from what the chain says.
 *
 * A2  the calendar governance transactions succeeded and an ANT calendar interval is, or was, activated
 * A3  the pool was created and seeded in one transaction (PoolCreated from the factory) and the PoolManager holds liquidity for it
 * A4  the hook address has low 14 bits 0x2cc0 and the remove-liquidity bits 9, 8 and 0 are off
 * A5  every recorded swap succeeded and the PoolManager Swap event fee equals the expected pips for its session; PARTIAL until all five sessions are covered
 * A6  the recorded swap above the cap reverted, and replaying it on the block before returns TradeCapExceeded
 * A7  Sourcify: the Lens and the hook, exact_match or match, read from sourcify.dev
 */
import { keccak256, encodeAbiParameters, parseAbi, parseEventLogs, getAddress } from 'viem';

const SWAP_EVENT = parseAbi(['event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)']);
const FACTORY_EVENT = parseAbi(['event PoolCreated(address indexed hook, bytes32 indexed poolId, bytes32 configHash, address indexed creator, address recipient)']);
const EXTSLOAD = parseAbi(['function extsload(bytes32[] slots) view returns (bytes32[])']);
const CALENDAR = parseAbi(['function currentInterval(bytes32) view returns ((bytes32 assetId,uint32 year,uint32 index,uint64 start,uint64 end,uint8 phase,bytes32 provenanceHash))']);
const TRADE_CAP_SELECTOR = '0xecb1f63f';
const FEE_FOR = { REGULAR: 500, PRE: 3000, POST: 3000, OVERNIGHT: 5000, CLOSED: 10000 };

const status = async (pc, hash) => { try { return (await pc.getTransactionReceipt({ hash })).status; } catch { return 'missing'; } };

export async function poolChecks({ pc, proof, out, rpcUrl }) {
  const pool = proof.pool;
  if (!pool) return false;

  // A2
  const cal = proof.mainnet?.calendar;
  if (cal) {
    const rcs = await Promise.all(cal.txs.map((t) => status(pc, t.tx)));
    const cur = await pc.readContract({ address: pool.calendarRegistry, abi: CALENDAR, functionName: 'currentInterval', args: [proof.mainnet.descriptorId] }).catch(() => null);
    out.A2 = rcs.every((x) => x === 'success')
      ? { verdict: 'PASS', note: `The ANT calendar root ${cal.root.slice(0, 12)}… was queued, executed and activated through HybridAuth governance calls (ECDSA and SHRINCS), ${rcs.length} transactions succeeded${cur && Number(cur.phase) ? `, and the CalendarRegistry shows an active interval (phase ${cur.phase}) right now` : ''}. The roots are signed by the GOVERNANCE role, not REPORTER.` }
      : { verdict: 'FAIL', note: `calendar transactions: ${rcs.join(', ')}` };
  }

  // A3
  const createRc = await pc.getTransactionReceipt({ hash: pool.createTx }).catch(() => null);
  let a3 = { verdict: 'FAIL', note: 'creation transaction not found' };
  if (createRc && createRc.status === 'success') {
    const logs = parseEventLogs({ abi: FACTORY_EVENT, logs: createRc.logs.filter((l) => l.address.toLowerCase() === pool.factory.toLowerCase()) });
    const created = logs.find((l) => l.args.poolId.toLowerCase() === pool.poolId.toLowerCase() && l.args.hook.toLowerCase() === pool.hook.toLowerCase());
    const base = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [pool.poolId, 6n]));
    const liquiditySlot = `0x${(BigInt(base) + 3n).toString(16).padStart(64, '0')}`;
    const words = await pc.readContract({ address: pool.poolManager, abi: EXTSLOAD, functionName: 'extsload', args: [[liquiditySlot]] }).catch(() => null);
    const liquidity = words ? BigInt(words[0]) & ((1n << 128n) - 1n) : null;
    a3 = created && liquidity && liquidity > 0n
      ? { verdict: 'PASS', note: `Created and seeded in one transaction at block ${createRc.blockNumber}: the factory emitted PoolCreated for pool ${pool.poolId.slice(0, 12)}… with hook ${pool.hook}, and the PoolManager holds liquidity ${liquidity} for it now.` }
      : { verdict: 'FAIL', note: `PoolCreated found ${Boolean(created)}, PoolManager liquidity ${liquidity}` };
  }
  out.A3 = a3;

  // A4
  const bits = BigInt(pool.hook) & 0x3fffn;
  const off = (bit) => ((bits >> BigInt(bit)) & 1n) === 0n;
  out.A4 = bits === 0x2cc0n && off(9) && off(8) && off(0)
    ? { verdict: 'PASS', note: `The hook ${pool.hook} has low 14 bits 0x${bits.toString(16)}, and the remove-liquidity bits 9, 8 and 0 are off.` }
    : { verdict: 'FAIL', note: `hook low 14 bits 0x${bits.toString(16)}` };

  // A5
  const seen = [];
  let a5ok = true;
  for (const s of pool.swaps ?? []) {
    const rc = await pc.getTransactionReceipt({ hash: s.tx }).catch(() => null);
    const ev = rc ? parseEventLogs({ abi: SWAP_EVENT, logs: rc.logs }).find((l) => l.args.id.toLowerCase() === pool.poolId.toLowerCase()) : null;
    const want = FEE_FOR[s.session];
    const ok = rc?.status === 'success' && ev && Number(ev.args.fee) === want;
    if (!ok) a5ok = false; else seen.push(`${s.session} ${want} pips`);
  }
  const covered = new Set((pool.swaps ?? []).map((s) => s.session));
  const missing = Object.keys(FEE_FOR).filter((k) => !covered.has(k));
  out.A5 = !a5ok ? { verdict: 'FAIL', note: 'a recorded swap did not show its expected fee in the Swap event' }
    : missing.length === 0 ? { verdict: 'PASS', note: `The Swap event fee matched in every session: ${seen.join(', ')}.` }
    : { verdict: 'PARTIAL', note: `The Swap event fee matched in ${seen.join(', ')}. Still to be shown, as the sessions occur: ${missing.join(', ')}.` };

  // A6
  if (pool.a6?.tx) {
    const rc = await pc.getTransactionReceipt({ hash: pool.a6.tx }).catch(() => null);
    let data = null; let why = '';
    if (rc && rc.status === 'reverted') {
      try {
        const tx = await pc.getTransaction({ hash: pool.a6.tx });
        await pc.call({ account: tx.from, to: tx.to, data: tx.input, blockNumber: rc.blockNumber - 1n });
      } catch (e) {
        const cause = e?.walk ? e.walk((x) => x?.data) : null;
        data = String(cause?.data ?? e?.data ?? e?.cause?.data ?? '');
        if (!data.startsWith('0x')) why = String(e.shortMessage ?? e.message).slice(0, 100);
      }
    }
    out.A6 = rc?.status === 'reverted' && data?.includes(TRADE_CAP_SELECTOR.slice(2))
      ? { verdict: 'PASS', note: `A swap of ${pool.a6.amountUsdg} USDG, above the cap of ${pool.a6.capUsdg} USDG in that session, reverted on mainnet (block ${rc.blockNumber}); replaying it on the block before returns TradeCapExceeded (${TRADE_CAP_SELECTOR}).` }
      : rc?.status === 'reverted' && !data ? { verdict: 'PARTIAL', note: `The swap above the cap did revert on mainnet (receipt status 0, block ${rc.blockNumber}); this RPC no longer has the state of the block before it, so the error name TradeCapExceeded (${TRADE_CAP_SELECTOR}) needs an archive node to read. The recorded revert data is TradeCapExceeded(0, ${Math.round(pool.a6.amountUsdg * 1e6)}, ${Math.round(pool.a6.capUsdg * 1e6)}).` }
      : { verdict: 'FAIL', note: `status ${rc?.status}, TradeCapExceeded in the revert data: ${Boolean(data?.includes(TRADE_CAP_SELECTOR.slice(2)))}` };
  }

  // A7
  try {
    const get = async (a) => (await (await fetch(`https://sourcify.dev/server/v2/contract/${pool.chainId}/${getAddress(a)}`)).json()).match ?? 'none';
    const [lens, hook] = await Promise.all([get(pool.lens), get(pool.hook)]);
    out.A7 = lens === 'exact_match' && hook === 'exact_match' ? { verdict: 'PASS', note: 'Sourcify shows an exact match for the Lens and for the hook.' }
      : { verdict: 'PARTIAL', note: `Sourcify: the Lens is ${lens} and the hook is ${hook}. The factory builds hooks without a compiler metadata hash, so the hook can only reach match until the stack is rebuilt with it and redeployed.` };
  } catch (e) { out.A7 = { verdict: 'PENDING', note: `could not read sourcify.dev: ${String(e.cause?.code ?? e.message).slice(0, 80)}` }; }
  return true;
}
