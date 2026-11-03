'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, RefreshCw } from 'lucide-react';
import { readLivePools, type LivePool } from '@/lib/mainnet-live';
import { AppLoadingState } from '@/components/app/AppLoadingState';
import { TokenPair } from '@/components/ui/TokenLogo';
import { Button } from '@/components/ui/primitives';

const MODE_LABEL = ['Halted', 'Active', 'Closed', 'Recovering', 'Setup'] as const;
const PHASE_LABEL = ['Unknown', 'Pre-market', 'Regular', 'Post-market', 'Overnight', 'Closed'] as const;

function statusFor(pool: LivePool) {
  if (pool.lifecycle === 3) return { label: 'Staged · swaps locked', tone: 'warn' as const };
  // A drained pool still has a PoolCreated event and a clean policy, but nobody can swap against
  // it. Say so instead of advertising it as tradable.
  if (pool.funded === false) return { label: 'No liquidity', tone: 'warn' as const };
  if (pool.policy.canSwap) return { label: 'Tradable', tone: 'ion' as const };
  return { label: 'Blocked by policy', tone: 'warn' as const };
}

function PoolCard({ pool }: { pool: LivePool }) {
  const status = statusFor(pool);
  const [left, right] = pool.legs;
  const mode = MODE_LABEL[pool.policy.mode] ?? `Mode ${pool.policy.mode}`;
  const phase = PHASE_LABEL[pool.policy.phase] ?? `Phase ${pool.policy.phase}`;
  const fee = `${(pool.policy.lpFeeUnits / 10_000).toFixed(3)}%`;
  return (
    <li className="glass border border-line bg-surface/75 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Link href={`/pool/?hook=${pool.hook}`} className="inline-flex min-w-0 items-center gap-3">
          <TokenPair symbols={[left.symbol, right.symbol]} size={34} />
          <span className="min-w-0">
            <span className="block truncate font-display text-2xl leading-tight text-ink">
              {left.symbol} / {right.symbol}
            </span>
            <span className="mt-1 block font-mono text-[10px] text-dim">
              {pool.poolClass === 0 ? 'Price guarded' : 'Market price'} · hook {pool.hook.slice(0, 8)}…{pool.hook.slice(-6)}
            </span>
          </span>
        </Link>
        <span
          className={`shrink-0 border px-2 py-1 font-mono text-[10px] uppercase ${
            status.tone === 'ion' ? 'border-ion/40 text-ion' : 'border-warn/40 text-warn'
          }`}
        >
          {status.label}
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-line pt-4">
        <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Mode · phase</dt>
          <dd className="mt-1 text-sm text-ink">{mode} · {phase}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Fee</dt>
          <dd className="mt-1 text-sm text-ink">{fee}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Liquidity</dt>
          <dd className={`mt-1 truncate text-sm ${pool.funded === false ? 'text-warn' : 'text-ink'}`}>
            {pool.funded === null || pool.funded === undefined
              ? 'Not reported'
              : pool.funded
                ? `${Number(pool.poolLiquidity ?? 0n).toLocaleString('en-US')} units`
                : 'Empty · add liquidity to trade'}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Per trade cap</dt>
          <dd className="app-pool-card__cap mt-1 text-sm text-ink">{formatCap(pool.policy.effectiveTradeCap, pool)}</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          href={`/pool/?hook=${pool.hook}`}
          className="inline-flex min-h-10 flex-1 sm:flex-none justify-center items-center gap-2 border border-line px-3 font-mono text-[11px] uppercase text-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          Pool details
        </Link>
        {pool.lifecycle !== 3 && (
          <Link
            href={`/swap?hook=${pool.hook}`}
            className="inline-flex min-h-10 flex-1 sm:flex-none justify-center items-center gap-2 border border-ion/40 px-3 font-mono text-[11px] uppercase text-ion transition-colors hover:bg-ion/10"
          >
            Open swap <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
    </li>
  );
}

function formatCap(caps: readonly bigint[], pool: LivePool) {
  return pool.legs
    .map((leg, i) => {
      const raw = caps[i];
      if (raw === undefined) return null;
      const value = Number(raw) / 10 ** leg.decimals;
      const text = value === 0 ? '0' : value.toPrecision(4);
      return `${text} ${leg.symbol}`;
    })
    .filter(Boolean)
    .join(' / ');
}

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

  return <div className="app-content-frame space-y-7">
    <header>
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Markets · BELL Mainnet</p>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-ink">Live pool directory</h1>
      <p className="mt-3 max-w-3xl text-base text-muted">Markets listed here are read directly from the deployed BELL factory.</p>
    </header>

    <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface p-4 text-sm text-muted" role="status" aria-live="polite">
      <span>{loading ? 'Reading the live pool directory' : `${pools.length} live pool${pools.length === 1 ? '' : 's'} on Robinhood Chain`}</span>
      <Button variant="outline" size="sm" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
        <RefreshCw className={`h-4 w-4${loading ? ' animate-spin' : ''}`} /> Refresh
      </Button>
    </div>

    {loading && pools.length === 0 && <AppLoadingState label="Reading the live pool directory" variant="cards" />}
    {error && <div className="border border-down/40 bg-down/5 p-5 text-sm text-down" role="alert">Could not read live pools: {error}</div>}

    {!loading && !error && pools.length === 0 && <section className="app-pools-empty" aria-labelledby="pools-empty-title">
      <div className="app-pools-empty__copy">
        <p className="app-pools-empty__eyebrow">LIVE FACTORY DIRECTORY</p>
        <h2 id="pools-empty-title">Your pool will appear here.</h2>
        <p>This directory reads live events from the deployed factory. Create a pool and its pair, seed and trading policy are listed here automatically.</p>
        <div className="app-pools-empty__actions">
          <Link href="/create">Create a pool <ArrowRight size={15} aria-hidden="true" /></Link>
          <Link href="/protocol">Review protocol rules <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </div>
      </div>
      <div className="app-pools-empty__source">
        <span>Directory source</span>
        <strong>BELL factory</strong>
        <span>Robinhood Chain · 4663</span>
        <span className="app-pools-empty__source-state">Live onchain events</span>
      </div>
    </section>}

    {pools.length > 0 && <ul className="grid gap-4 md:grid-cols-2">
      {pools.map((pool) => <PoolCard key={pool.hook} pool={pool} />)}
    </ul>}
  </div>;
}
