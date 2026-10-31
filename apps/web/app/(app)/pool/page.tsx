'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { displayAmount, readLivePools, type LivePool } from '@/lib/mainnet-live';

function PoolDetails() {
  const params = useSearchParams();
  const hook = params.get('hook')?.toLowerCase();
  const [pool, setPool] = useState<LivePool | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    readLivePools().then((items) => {
      if (active) { setPool(items.find((item) => item.hook.toLowerCase() === hook) ?? null); setError(''); }
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Could not read pool state'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [hook, revision]);
  return <div className="mx-auto max-w-[1100px]">
    <Link href="/pools" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={16}/> All live pools</Link>
    {loading && <p className="mt-8 text-sm text-muted" role="status">Reading pool configuration and policy from Mainnet…</p>}
    {error && <p role="alert" className="mt-8 border border-down/30 p-4 text-sm text-down">Could not read pool: {error}</p>}
    {!loading && !error && !pool && <section className="mt-8 border border-line p-7"><h1 className="font-display text-2xl text-ink">Pool not found on Mainnet</h1><p className="mt-2 text-sm text-muted">This address has no PoolCreated event in the BELL factory.</p><Link href="/pools" className="mt-5 inline-flex border border-line px-4 py-3 font-mono text-xs uppercase text-muted">Browse live pools</Link></section>}
    {pool && <><header className="mt-6 flex flex-wrap items-end justify-between gap-5 border-b border-line pb-6"><div><p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">{pool.lifecycle === 3 ? 'Staged pool · Robinhood Chain' : 'Live pool · Robinhood Chain'}</p><h1 className="mt-3 font-display text-4xl text-ink">{pool.legs[0].symbol} / {pool.legs[1].symbol}</h1><p className="mt-2 break-all font-mono text-xs text-dim">Hook {pool.hook}</p></div><div className="flex gap-2"><button type="button" onClick={() => setRevision((v) => v + 1)} className="inline-flex min-h-10 items-center gap-2 border border-line px-3 font-mono text-xs uppercase text-muted"><RefreshCw size={14}/> Refresh</button>{pool.lifecycle !== 3 && <Link href={`/swap?hook=${pool.hook}`} className="inline-flex min-h-10 items-center border border-ion/40 px-4 font-mono text-xs uppercase text-ion">Open swap</Link>}</div></header>
      {pool.lifecycle === 3 && <p className="mt-5 border border-warn/40 bg-warn/5 p-4 text-sm text-warn">Liquidity is seeded. Swaps stay locked until the registry verifies a fresh live price or a valid stored close reference. Refresh after the price source is available; the hook can then activate permissionlessly.</p>}
      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
        ['Lifecycle', pool.lifecycle === 3 ? 'Staged · swaps locked' : 'Live'],
        ['Trading policy', pool.policy.canSwap ? 'Tradable' : 'Blocked'],
        ['Mode', ['Halted', 'Active', 'Closed', 'Recovering', 'Setup'][pool.policy.mode] ?? `Mode ${pool.policy.mode}`],
        ['Pool class', pool.poolClass === 0 ? 'Price guarded' : 'Session only'],
        ['Fee', `${(pool.policy.lpFeeUnits / 10_000).toFixed(3)}%`],
        ['Market phase', ['Unknown', 'Pre-market', 'Regular', 'Post-market', 'Overnight', 'Closed'][pool.policy.phase] ?? `Phase ${pool.policy.phase}`],
        ['Policy valid until', pool.policy.validUntil ? new Date(Number(pool.policy.validUntil) * 1000).toLocaleString() : 'Not reported'],
      ].map(([label, value]) => <div key={label} className="border border-line bg-surface/50 p-5"><p className="font-mono text-[10px] uppercase text-dim">{label}</p><p className="mt-2 text-xl text-ink">{value}</p></div>)}</section>
      <section className="mt-5 border border-line p-5"><h2 className="font-mono text-xs uppercase tracking-[0.12em] text-muted">Onchain limits · raw token values shown in token units</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">{pool.legs.map((leg, index) => <div key={leg.address}><p className="text-sm text-ink">{leg.symbol}</p><p className="mt-1 text-xs text-dim">Per trade cap {displayAmount(pool.policy.effectiveTradeCap[index], leg.decimals)} · rolling cap {displayAmount(pool.policy.effectiveWindowCap[index], leg.decimals)}</p><p className="mt-1 text-xs text-dim">Rolling remaining {displayAmount(pool.policy.rollingRemaining[index], leg.decimals)} · closure remaining {displayAmount(pool.policy.closureRemaining[index], leg.decimals)}</p></div>)}</div><p className="mt-4 break-all font-mono text-[10px] text-dim">Pool ID {pool.poolId}</p><p className="mt-2 font-mono text-[10px] text-dim">Created at block {pool.createdAtBlock?.toString?.() ?? 'unknown'} · directory indexed through {pool.directoryBlockNumber?.toString() ?? 'wallet RPC'}</p><a className="mt-4 inline-flex items-center gap-2 text-xs text-ion underline" href={`https://robinhoodchain.blockscout.com/address/${pool.hook}`} target="_blank" rel="noreferrer">View contract <ExternalLink size={13}/></a></section>
    </>}
  </div>;
}

export default function PoolPage() { return <Suspense fallback={<div className="h-64 animate-pulse border border-line bg-surface/50" aria-busy="true"/>}><PoolDetails/></Suspense>; }
