'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertOctagon, ArrowLeft, ArrowLeftRight, Clock, Hash, Info, Layers, Snowflake, Radio, ShieldCheck } from 'lucide-react';
import { BudgetBar } from '@/components/policy/BudgetBar';
import { ButtonLink, ClassBadge, HaltBadge, PhaseBadge } from '@/components/ui/primitives';
import { getPool, type PoolPolicy } from '@/lib/fixtures';
import { cn, formatDuration, formatRaw } from '@/lib/format';
import { effectiveLimits, feePercent, PHASE_META, sessionDivisors, type MarketPhase } from '@/lib/policy';

function Card({ title, icon: Icon, children, className }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('glass rounded-3xl p-5 sm:p-6', className)}>
      <h2 className="flex items-center gap-2 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-dim">
        <Icon className="h-4 w-4 text-ion" aria-hidden="true" /> {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <dt className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">{label}</dt>
      <dd className="num mt-1 text-lg text-ink">{value}</dd>
      {sub && <p className="text-[0.7rem] text-dim">{sub}</p>}
    </div>
  );
}

function Detail({ pool }: { pool: PoolPolicy }) {
  const phase: MarketPhase | null = pool.poolPhase === 'HALTED' ? null : pool.poolPhase;
  const div = phase ? sessionDivisors(phase) : null;
  const closed = pool.poolPhase === 'CLOSED';
  const guarded = pool.poolClass === 'PRICE_GUARDED';

  return (
    <div>
      <Link href="/pools" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> All pools</Link>

      <header className="mt-5 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ClassBadge poolClass={pool.poolClass} />
            {pool.canSwap ? <PhaseBadge phase={pool.poolPhase} /> : <HaltBadge />}
            <span className="rounded-md border border-line px-2 py-1 text-[0.68rem] uppercase tracking-[0.1em] text-dim">{pool.liquidityMode === 'PUBLIC' ? 'Public LP' : 'Treasury only'}</span>
          </div>
          <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">{pool.pair[0]}<span className="text-dim font-normal"> / </span>{pool.pair[1]}</h1>
        </div>
        <div className="flex gap-2.5">
          <ButtonLink href={`/swap/?pool=${pool.id}`} className={cn(!pool.canSwap && 'pointer-events-none opacity-45')} aria-disabled={!pool.canSwap} tabIndex={pool.canSwap ? 0 : -1}>
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" /> Swap
          </ButtonLink>
          <ButtonLink href="/positions" variant="outline">Add / exit liquidity</ButtonLink>
        </div>
      </header>

      {!pool.canSwap && (
        <div role="alert" className="mt-6 rounded-2xl border border-down/30 bg-down/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-down"><AlertOctagon className="h-4 w-4" aria-hidden="true" /> Swaps are halted for this pool</p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-ink/80">{pool.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <p className="mt-2 text-muted">Liquidity providers can still remove and collect in-kind. That path never depends on BELL guards.</p>
        </div>
      )}

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {/* Fee */}
        <Card title="Effective fee" icon={Info}>
          <p className="num text-5xl text-ion">{feePercent(pool.effectiveFeeUnits)}</p>
          <p className="mt-1 text-xs text-dim">{pool.effectiveFeeUnits.toLocaleString('en-US')} v4 units · max(session, bell, corporate, repricing)</p>
          <dl className="mt-5 grid grid-cols-2 gap-4">
            <Stat label="Session base" value={feePercent(pool.baseFeeUnits)} />
            <Stat label="Flags" value={pool.flags.length ? pool.flags.join(' · ') : 'None'} />
            <Stat label="Bell decay" value={pool.bellRemainingSec === null ? '—' : formatDuration(pool.bellRemainingSec)} />
            <Stat label="Corporate" value={pool.corporateRemainingSec === null ? '—' : formatDuration(pool.corporateRemainingSec)} />
          </dl>
        </Card>

        {/* Legs */}
        <Card title="Stock legs & sources" icon={Radio} className="lg:col-span-2">
          <ul className="divide-y divide-line">
            {pool.legs.map((l) => (
              <li key={l.symbol} className="flex flex-wrap items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <span className="font-display text-2xl text-ink">{l.symbol}</span>
                  <PhaseBadge phase={l.phase} />
                </div>
                <dl className="flex gap-8">
                  <Stat label="Source" value={<span className="inline-flex items-center gap-1.5">{l.source === 'FROZEN' ? <><Snowflake className="h-4 w-4 text-phase-closed" aria-hidden="true" />Frozen close</> : l.source === 'LIVE' ? <><Radio className="h-4 w-4 text-ion" aria-hidden="true" />Live</> : 'Unavailable'}</span>} />
                  <Stat label={l.source === 'FROZEN' ? 'Anchor age' : 'Input age'} value={l.anchorAgeSec !== null ? formatDuration(l.anchorAgeSec) : l.ageSec !== null ? formatDuration(l.ageSec) : '—'} sub={l.source === 'FROZEN' ? 'max 96 h' : undefined} />
                  <Stat label="Window" value={<span className="text-sm">{PHASE_META[l.phase].window}</span>} />
                </dl>
              </li>
            ))}
          </ul>
          <p className="mt-4 rounded-xl border border-line bg-bg-1/60 px-4 py-3 text-sm text-muted">
            {guarded ? pool.referenceNote : 'Session controls only; no independent price protection for the counterasset.'}
          </p>
        </Card>

        {/* Budgets */}
        <Card title="Flow budgets" icon={Layers} className="lg:col-span-2">
          <div className="grid gap-6 sm:grid-cols-2">
            {pool.budgets.map((b) => {
              const lim = phase ? effectiveLimits(phase, BigInt(b.perTrade), BigInt(b.rolling)) : null;
              return (
                <div key={b.symbol} className="space-y-4">
                  <p className="flex items-center justify-between text-sm font-medium text-ink">{b.symbol}<span className="num text-xs text-dim">{b.decimals} decimals</span></p>
                  <BudgetBar label="Rolling 300 s" symbol={b.symbol} decimals={b.decimals} used={b.rollingUsed} total={lim ? String(lim.rolling) : b.rolling} />
                  <BudgetBar label="Closure episode" symbol={b.symbol} decimals={b.decimals} used={b.closureUsed} total={b.closure} tone="closed" note={closed ? 'Gross both directions · never refills this episode' : 'Applies only while closed'} />
                  <p className="num text-xs text-dim">Per-trade now: {lim ? formatRaw(String(lim.perTrade), b.decimals) : 'halted'} {b.symbol}{div && div[0] > 1 ? ` (T/${div[0]})` : ''}</p>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Timers + valuation */}
        <Card title="Timers & lifecycle" icon={Clock}>
          <dl className="grid grid-cols-2 gap-4">
            <Stat label="Lifecycle" value={pool.lifecycle} />
            <Stat label="Closure nonce" value={pool.closureNonce ?? '—'} />
            <Stat label="Recovery" value={pool.recoveryRemainingSec === null ? '—' : formatDuration(pool.recoveryRemainingSec)} sub="2 fresh checkpoints ≥ 60 s" />
            <Stat label="Band" value={pool.bandBps ? `±${pool.bandBps / 100}%` : 'None'} sub={pool.bandBps ? 'from reference' : 'no reference'} />
          </dl>
          <div className="mt-5 rounded-xl border border-line bg-bg-1/60 p-4">
            {pool.referenceValuationUsd ? (
              <>
                <p className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">Reference valuation · {pool.referenceValuationLabel}</p>
                <p className="num mt-1 text-xl text-ink">${pool.referenceValuationUsd}</p>
                {pool.referenceValuationLabel === 'frozen close' && <p className="mt-1 text-xs text-dim">Historical close anchor, not a live stock price.</p>}
              </>
            ) : pool.sessionOnlyInventory ? (
              <>
                <p className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">Raw inventory</p>
                <p className="num mt-1 text-base text-ink">{pool.sessionOnlyInventory}</p>
                <p className="mt-1 text-xs text-dim">No USD NAV is shown: the counterasset has no independent price.</p>
              </>
            ) : (
              <p className="text-sm text-muted">Valuation unavailable while the reference is not healthy.</p>
            )}
          </div>
        </Card>

        <Card title="Pool identity" icon={Hash} className="lg:col-span-3">
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Hook / PoolId" value={<span className="text-sm text-dim">Assigned at deployment</span>} />
            <Stat label="Config hash" value={<span className="text-sm text-dim">Assigned at deployment</span>} />
            <Stat label="Observed block" value={<span className="text-sm text-dim">n/a — preview</span>} />
            <Stat label="Indexed through" value={<span className="text-sm text-dim">n/a — preview</span>} />
          </dl>
          <p className="mt-4 flex items-start gap-2 text-xs text-dim"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ion" aria-hidden="true" /> No addresses or hashes are invented. After deployment these come from the policy endpoint and are verified against onchain state.</p>
        </Card>
      </div>
    </div>
  );
}

function PoolPageInner() {
  const id = useSearchParams().get('id');
  const pool = getPool(id);
  if (!pool) {
    return (
      <div className="glass mx-auto max-w-lg rounded-3xl p-10 text-center">
        <h1 className="font-display text-4xl text-ink">Pool not found</h1>
        <p className="mt-3 text-muted">No sample pool matches “{id ?? ''}”.</p>
        <div className="mt-6 flex justify-center"><ButtonLink href="/pools">Back to pools</ButtonLink></div>
      </div>
    );
  }
  return <Detail pool={pool} />;
}

export default function PoolPage() {
  return (
    <Suspense fallback={<div className="glass h-64 animate-pulse rounded-3xl" aria-busy="true" />}>
      <PoolPageInner />
    </Suspense>
  );
}
