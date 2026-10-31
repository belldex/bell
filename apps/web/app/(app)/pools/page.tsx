'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, RefreshCw } from 'lucide-react';
import { readLivePools, type LivePool } from '@/lib/mainnet-live';

export default function PoolsPage() {
  const [pools, setPools] = useState<LivePool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    readLivePools().then((items) => { if (active) { setPools(items); setError(null); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Could not read Mainnet pools'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  return <div className="app-pools-page mx-auto max-w-[1200px]">
    <header className="app-pools-heading">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Markets / Robinhood Chain Mainnet</p>
        <h1 className="mt-3 font-display text-[36px] font-bold leading-[1.06] tracking-[-0.04em] text-ink sm:text-[48px]">Live pool directory</h1>
        <p className="mt-3 text-base text-muted">Markets listed here are read directly from the deployed BELL factory.</p>
      </div>
      <button type="button" onClick={() => setRevision((v) => v + 1)} className="inline-flex min-h-10 shrink-0 items-center gap-2 border border-line px-3 font-mono text-xs uppercase text-muted transition-colors hover:border-line-strong hover:text-ink"><RefreshCw size={14} /> Refresh</button>
    </header>
    {loading && <p className="mt-8 text-sm text-muted" role="status">Reading Robinhood Chain…</p>}
    {error && <div className="mt-8 border border-down/40 bg-down/5 p-5 text-sm text-down" role="alert">Could not read live pools: {error}</div>}
    {!loading && !error && pools.length === 0 && <section className="app-pools-empty" aria-labelledby="pools-empty-title">
      <div className="app-pools-empty__copy">
        <p className="app-pools-empty__eyebrow">LIVE FACTORY DIRECTORY</p>
        <h2 id="pools-empty-title">No pools created yet.</h2>
        <p>This directory reads live events from the deployed factory. A pool’s pair and trading policy will appear here after it is created. Preview markets stay separate from Mainnet data.</p>
        <div className="app-pools-empty__actions">
          <Link href="/create">Create a pool <ArrowRight size={15} aria-hidden="true" /></Link>
          <Link href="/protocol">Review protocol rules <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </div>
      </div>
      <div className="app-pools-empty__source">
        <span>Directory source</span>
        <strong>BELL factory</strong>
        <span>Robinhood Chain · 4663</span>
        <span className="app-pools-empty__source-state">Awaiting first PoolCreated event</span>
      </div>
    </section>}
    <ul className="mt-7 grid gap-4 md:grid-cols-2">
      {pools.map((pool) => <li key={pool.hook} className="border border-line bg-surface/60 p-5">
        <div className="flex items-start justify-between gap-3"><div><p className="font-display text-2xl text-ink">{pool.legs[0].symbol} / {pool.legs[1].symbol}</p><p className="mt-1 font-mono text-[10px] text-dim">Hook {pool.hook}</p></div><span className={`border px-2 py-1 font-mono text-[10px] uppercase ${pool.policy.canSwap ? 'border-ion/40 text-ion' : 'border-warn/40 text-warn'}`}>{pool.policy.canSwap ? 'Tradable' : 'Blocked by policy'}</span></div>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm"><div><dt className="text-xs text-dim">Mode · phase</dt><dd className="mt-1 text-ink">{['Halted', 'Active', 'Closed', 'Recovering', 'Setup'][pool.policy.mode] ?? `Mode ${pool.policy.mode}`} · {['Unknown', 'Pre-market', 'Regular', 'Post-market', 'Overnight', 'Closed'][pool.policy.phase] ?? `Phase ${pool.policy.phase}`}</dd></div><div><dt className="text-xs text-dim">Fee · directory block</dt><dd className="mt-1 text-ink">{(pool.policy.lpFeeUnits / 10_000).toFixed(3)}% · {pool.directoryBlockNumber?.toString() ?? 'wallet RPC'}</dd></div></dl>
        <Link href={`/pool?hook=${pool.hook}`} className="mt-5 inline-flex min-h-10 items-center gap-2 border border-line px-3 font-mono text-xs uppercase text-muted hover:text-ink">Pool details</Link><Link href={`/swap?hook=${pool.hook}`} className="ml-2 inline-flex min-h-10 items-center gap-2 border border-ion/40 px-3 font-mono text-xs uppercase text-ion hover:bg-ion/10">Open live swap <ArrowUpRight size={14} /></Link>
      </li>)}
    </ul>
  </div>;
}
