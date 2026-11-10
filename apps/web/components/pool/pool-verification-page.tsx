'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, CircleAlert, ExternalLink, RefreshCw } from 'lucide-react';
import { parseUnits } from 'viem';
import { KEEPER_URL } from '@/config/mainnet';
import { readLivePools, type LivePool } from '@/lib/mainnet-live';
import { TokenPair } from '@/components/ui/TokenLogo';
import { AppLoadingState } from '@/components/app/AppLoadingState';
import verification from '@/content/mainnet-verification.json';
import '@/components/proof/proof.css';
import './pool-verification.css';

type PoolReceipt = {
  event: string;
  blockNumber: string;
  transactionHash: `0x${string}`;
  logIndex: number;
  fee?: number;
  explorerUrl: string;
  args?: Record<string, unknown>;
};
type StatusResponse = {
  chainId: number;
  observedAt: string;
  blockNumber: string;
  lens: string;
  hook: string;
  hookFlags: string;
  hasAuction: boolean;
  auction: string;
  status: {
    allowed: boolean;
    reason: `0x${string}`;
    session: number;
    currentFeePips: number;
    maxIn0: string;
    maxIn1: string;
    auctionWindow: boolean;
    nextTransition: string;
  };
};
type ReceiptResponse = { receipts: PoolReceipt[]; nextCursor: string | null; complete: boolean; observedAt: string; blockNumber: string };

const SESSION = ['Unknown', 'PRE', 'REGULAR', 'POST', 'OVERNIGHT', 'CLOSED'];
const ERROR_SOURCE = 'https://github.com/belldex/bell/blob/main/contracts/src/';
const EXPLORER = 'https://robinhoodchain.blockscout.com';

export function PoolVerificationPage({ poolId, lensAddress }: { poolId: string; lensAddress: string | null }) {
  const [pool, setPool] = useState<LivePool | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [receipts, setReceipts] = useState<PoolReceipt[]>([]);
  const [receiptCursor, setReceiptCursor] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState('');
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [zeroForOne, setZeroForOne] = useState(true);
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const ruleRows = useMemo(() => verification.ruleTests.filter((row) => row.poolId?.toLowerCase() === poolId.toLowerCase()), [poolId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    readLivePools().then((pools) => {
      if (!active) return;
      const found = pools.find((item) => item.poolId.toLowerCase() === poolId.toLowerCase());
      setPool(found ?? null);
      setError(found ? '' : 'This pool is not in the live factory directory.');
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'The live pool directory could not be read.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [poolId, revision]);

  useEffect(() => {
    let active = true;
    setReceiptBusy(true);
    fetch(`${KEEPER_URL}/pools/${poolId}/receipts?limit=100`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? `Receipt endpoint returned HTTP ${response.status}`);
        return body as ReceiptResponse;
      })
      .then((body) => {
        if (!active) return;
        setReceipts(body.receipts ?? []);
        setReceiptCursor(body.nextCursor ?? null);
        setReceiptError('');
      })
      .catch((cause) => { if (active) setReceiptError(cause instanceof Error ? cause.message : 'Live receipts are unavailable.'); })
      .finally(() => { if (active) setReceiptBusy(false); });
    return () => { active = false; };
  }, [poolId]);

  async function loadMoreReceipts() {
    if (!receiptCursor || receiptBusy) return;
    setReceiptBusy(true);
    try {
      const response = await fetch(`${KEEPER_URL}/pools/${poolId}/receipts?limit=100&cursor=${encodeURIComponent(receiptCursor)}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `Receipt endpoint returned HTTP ${response.status}`);
      setReceipts((current) => [...current, ...(body.receipts ?? [])]);
      setReceiptCursor(body.nextCursor ?? null);
      setReceiptError('');
    } catch (cause) {
      setReceiptError(cause instanceof Error ? cause.message : 'More receipts could not be loaded.');
    } finally { setReceiptBusy(false); }
  }

  async function checkSwap(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusError('');
    setStatus(null);
    if (!pool) return;
    let rawAmount: bigint;
    try {
      const inputLeg = pool.legs[zeroForOne ? 0 : 1];
      rawAmount = parseUnits(amount, inputLeg.decimals);
    } catch {
      setStatusError('Enter a valid amount using the input token’s decimals.');
      return;
    }
    setStatusBusy(true);
    try {
      const query = new URLSearchParams({ zeroForOne: String(zeroForOne), amountIn: rawAmount.toString() });
      const response = await fetch(`${KEEPER_URL}/pools/${poolId}/status?${query}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `Lens status returned HTTP ${response.status}`);
      setStatus(body as StatusResponse);
    } catch (cause) {
      setStatusError(cause instanceof Error ? cause.message : 'The live Lens status could not be read.');
    } finally { setStatusBusy(false); }
  }

  const session = status ? SESSION[status.status.session] ?? 'Unknown' : null;
  const feePct = status?.status.currentFeePips ? `${(status.status.currentFeePips / 10_000).toFixed(3)}%` : 'Unavailable';
  const hookFlags = status?.hookFlags ?? (pool ? `0x${(Number(BigInt(pool.hook) & 0x3fffn)).toString(16).padStart(4, '0')}` : null);
  const exitClear = hookFlags !== null && (Number.parseInt(hookFlags, 16) & 0x301) === 0;

  return <div className="app-content-frame space-y-7">
    <Link href="/pools/" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={16} aria-hidden="true" /> All live pools</Link>
    {loading && <AppLoadingState label="Reading the pool directory and receipts" variant="detail" />}
    {error && !loading && <section className="border border-down/40 bg-down/5 p-5 text-sm text-down" role="alert">Pool data unavailable: {error}</section>}
    {pool && <>
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-line pb-6">
        <div className="flex min-w-0 items-center gap-4"><TokenPair symbols={[pool.legs[0].symbol, pool.legs[1].symbol]} size={44} />
          <div className="min-w-0"><p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Public pool verification · Robinhood Chain</p>
            <h1 className="mt-3 font-display text-3xl text-ink sm:text-4xl">{pool.legs[0].symbol} / {pool.legs[1].symbol}</h1>
            <p className="mt-2 break-all font-mono text-xs text-dim">Pool ID {pool.poolId}</p>
          </div>
        </div>
        <div className="flex gap-2"><button type="button" onClick={() => setRevision((value) => value + 1)} className="inline-flex min-h-10 items-center gap-2 border border-line px-3 font-mono text-xs uppercase text-muted" disabled={loading}><RefreshCw size={14} aria-hidden="true" /> Refresh</button><Link href="/verify/" className="inline-flex min-h-10 items-center gap-2 border border-ion/40 px-3 font-mono text-xs uppercase text-ion">How to verify <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Onchain pool checks">
        <div className="border border-line bg-surface/50 p-5"><p className="font-mono text-[10px] uppercase text-dim">Hook permissions</p><p className="mt-2 inline-flex items-center gap-2 text-xl text-ink">{exitClear ? <><Check size={17} className="text-ion" /> PASS</> : <><CircleAlert size={17} className="text-warn" /> Check required</>}</p><p className="mt-1 break-all font-mono text-xs text-dim">{hookFlags ?? 'Not available'}</p></div>
        <div className="border border-line bg-surface/50 p-5"><p className="font-mono text-[10px] uppercase text-dim">Auction</p><p className="mt-2 text-xl text-ink">{status ? (status.hasAuction ? status.status.auctionWindow ? 'Collecting orders' : 'Bound · window closed' : 'No auction') : 'Read live status'}</p><p className="mt-1 break-all font-mono text-xs text-dim">{status?.auction ?? 'Status is read when you check a swap'}</p></div>
        <div className="border border-line bg-surface/50 p-5"><p className="font-mono text-[10px] uppercase text-dim">Current session</p><p className="mt-2 text-xl text-ink">{session ?? 'Not queried'}</p><p className="mt-1 font-mono text-xs text-dim">LP fee {feePct ?? '—'}</p></div>
        <div className="border border-line bg-surface/50 p-5"><p className="font-mono text-[10px] uppercase text-dim">Status source</p><p className="mt-2 break-all font-mono text-xs text-ink">{lensAddress ?? 'Lens not registered'}</p><p className="mt-1 font-mono text-xs text-dim">{status ? `Block ${status.blockNumber}` : 'No value is assumed'}</p></div>
      </section>

      <section className="border border-line bg-surface/40 p-5 sm:p-6" aria-labelledby="check-swap-title">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-[0.12em] text-ion">Read-only quote preflight</p><h2 id="check-swap-title" className="mt-2 font-display text-2xl text-ink">Would this swap pass BELL&apos;s rules?</h2></div><p className="font-mono text-[10px] text-dim">No wallet signature or transaction</p></div>
        <p className="mt-3 max-w-3xl text-sm text-muted">This read calls <code>BellSwapLens.getSwapStatus</code> for the exact input and direction below. It does not approve tokens or execute the swap.</p>
        <form className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={checkSwap}>
          <label className="grid gap-2 font-mono text-[10px] uppercase text-dim">Direction<select value={zeroForOne ? '0' : '1'} onChange={(event) => setZeroForOne(event.target.value === '0')} className="min-h-11 border border-line bg-bg-1 px-3 text-sm text-ink"><option value="0">{pool.legs[0].symbol} → {pool.legs[1].symbol}</option><option value="1">{pool.legs[1].symbol} → {pool.legs[0].symbol}</option></select></label>
          <label className="grid gap-2 font-mono text-[10px] uppercase text-dim">Exact input amount · {pool.legs[zeroForOne ? 0 : 1].symbol}<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={`Amount in ${pool.legs[zeroForOne ? 0 : 1].symbol}`} className="min-h-11 border border-line bg-bg-1 px-3 font-mono text-sm text-ink" /></label>
          <button type="submit" disabled={statusBusy || !amount || !lensAddress} className="min-h-11 self-end border border-ion/50 px-5 font-mono text-xs uppercase text-ion disabled:cursor-not-allowed disabled:opacity-40">{statusBusy ? 'Reading…' : 'Check onchain'}</button>
        </form>
        {statusError && <p role="alert" className="mt-4 border border-warn/40 p-3 text-sm text-warn">{statusError}</p>}
        {status && <div className={`mt-5 border p-4 ${status.status.allowed ? 'border-ion/40' : 'border-warn/50'}`} role="status" aria-live="polite">
          <p className="font-mono text-xs uppercase text-dim">{status.status.allowed ? 'Allowed by BELL policy' : 'Blocked by BELL policy'}</p>
          <p className="mt-2 text-2xl text-ink">{status.status.allowed ? 'PASS' : `Blocked · ${status.status.reason}`}</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="font-mono text-[10px] uppercase text-dim">Fee</dt><dd className="mt-1 text-ink">{feePct}{status.status.currentFeePips > 0 && ` · ${status.status.currentFeePips} pips`}</dd></div><div><dt className="font-mono text-[10px] uppercase text-dim">Remaining gross budget</dt><dd className="mt-1 break-all font-mono text-xs text-ink">token0 {status.status.maxIn0}<br/>token1 {status.status.maxIn1}</dd></div><div><dt className="font-mono text-[10px] uppercase text-dim">Next transition</dt><dd className="mt-1 text-ink">{status.status.nextTransition === '0' ? 'Not available' : new Date(Number(status.status.nextTransition) * 1000).toLocaleString()}</dd></div></dl>
          <p className="mt-3 font-mono text-[10px] text-dim">Read at block {status.blockNumber} · {new Date(status.observedAt).toLocaleString()} · <a className="underline" href={`${EXPLORER}/address/${lensAddress}`} target="_blank" rel="noreferrer">Lens contract <ExternalLink size={11} className="inline" /></a></p>
        </div>}
      </section>

      <section className="border border-line p-5 sm:p-6" aria-labelledby="receipts-title">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-[0.12em] text-ion">Live indexer receipts</p><h2 id="receipts-title" className="mt-2 font-display text-2xl text-ink">Pool and rule history</h2></div><a className="inline-flex items-center gap-1 text-xs text-ion underline" href={`${KEEPER_URL}/pools/${poolId}/receipts`} target="_blank" rel="noreferrer">Open JSON <ExternalLink size={12} /></a></div>
        {receiptError && <p className="mt-4 border border-warn/40 p-3 text-sm text-warn" role="status">Receipts unavailable: {receiptError}</p>}
        {receiptBusy && receipts.length === 0 && <AppLoadingState label="Loading pool receipts" variant="detail" />}
        {!receiptBusy && receipts.length === 0 && !receiptError && <p className="mt-4 text-sm text-muted">No receipts in the scanned block range. Load earlier blocks to continue the search.</p>}
        {receipts.length > 0 && <div className="pf-scroll mt-4"><table className="legal__table pf-table verify__table"><thead><tr><th>Event</th><th>Block</th><th>Fee</th><th>Transaction</th></tr></thead><tbody>{receipts.map((receipt) => <tr key={`${receipt.transactionHash}-${receipt.logIndex}`}><td>{receipt.event}</td><td>{receipt.blockNumber}</td><td>{receipt.fee ?? '—'}</td><td><a href={receipt.explorerUrl} target="_blank" rel="noreferrer">Open receipt <ExternalLink size={11} className="inline" /></a></td></tr>)}</tbody></table></div>}
        {receiptCursor && <button type="button" className="mt-4 border border-line px-4 py-2 font-mono text-xs uppercase text-muted" onClick={loadMoreReceipts} disabled={receiptBusy}>{receiptBusy ? 'Loading…' : 'Load earlier receipts'}</button>}
        {ruleRows.length > 0 && <ul className="verify__rule-list">{ruleRows.map((rule) => <li key={rule.id}><span>{rule.rule}</span><strong>{rule.status}</strong>{rule.tx && <a href={`${EXPLORER}/tx/${rule.tx}`} target="_blank" rel="noreferrer">Receipt <ExternalLink size={11} /></a>}</li>)}</ul>}
      </section>

      <section className="border-t border-line pt-5" aria-labelledby="errors-title"><h2 id="errors-title" className="font-mono text-xs uppercase tracking-[0.12em] text-muted">Relevant contract errors</h2><ul className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2"><li><a href={`${ERROR_SOURCE}BellHook.sol`} target="_blank" rel="noreferrer"><code>TradeCapExceeded</code> · per-trade input exceeds its remaining cap</a></li><li><a href={`${ERROR_SOURCE}BellPolicyOracle.sol`} target="_blank" rel="noreferrer"><code>PolicyBlocked</code> · policy/dependency state blocks the swap</a></li><li><a href={`${ERROR_SOURCE}BellHookV2.sol`} target="_blank" rel="noreferrer"><code>AuctionActive</code> · the bound auction window blocks AMM swaps</a></li><li><a href={`${ERROR_SOURCE}libraries/FlowBudget.sol`} target="_blank" rel="noreferrer"><code>WindowCapExceeded</code> · rolling gross flow limit is spent</a></li></ul></section>
    </>}
  </div>;
}
