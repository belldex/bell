import Link from 'next/link';
import { ArrowUpRight, Snowflake, Radio } from 'lucide-react';
import { ClassBadge, HaltBadge, PhaseBadge } from '@/components/ui/primitives';
import { BudgetBar } from './BudgetBar';
import { feePercent } from '@/lib/policy';
import type { PoolPolicy } from '@/lib/fixtures';

export function PoolCard({ pool }: { pool: PoolPolicy }) {
  const closed = pool.poolPhase === 'CLOSED';
  const [a, b] = pool.budgets;
  const budget = closed ? { label: 'Closure budget', field: 'closure' as const, usedField: 'closureUsed' as const } : { label: 'Rolling budget', field: 'rolling' as const, usedField: 'rollingUsed' as const };
  const stock = pool.budgets.find((x) => pool.legs.some((l) => l.symbol === x.symbol)) ?? b;
  const frozen = pool.legs.some((l) => l.source === 'FROZEN');

  return (
    <Link
      href={`/pool/?id=${pool.id}`}
      className="glass glass-hover group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface/75 p-5 sm:p-6 transition-all duration-200 hover:border-ion/40"
      aria-label={`${pool.pair.join(' / ')} pool, ${pool.poolClass === 'PRICE_GUARDED' ? 'price guarded' : 'session only'}`}
    >
      <div className="absolute inset-x-0 top-0 hairline-top opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{pool.pair[0]}<span className="text-dim font-normal"> / </span>{pool.pair[1]}</h3>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <ClassBadge poolClass={pool.poolClass} />
            {pool.canSwap ? <PhaseBadge phase={pool.poolPhase} /> : <HaltBadge />}
          </div>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-bg-1/60 text-dim transition-all group-hover:border-ion/50 group-hover:bg-ion/10 group-hover:text-ion">
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-3">
        <div>
          <dt className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">LP fee</dt>
          <dd className="num mt-1 text-xl text-ink">{feePercent(pool.effectiveFeeUnits)}</dd>
        </div>
        <div>
          <dt className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">Source</dt>
          <dd className="mt-1 flex items-center gap-1.5 text-sm text-ink">
            {frozen ? <><Snowflake className="h-3.5 w-3.5 text-phase-closed" aria-hidden="true" /> Frozen</> : pool.legs[0].source === 'LIVE' ? <><Radio className="h-3.5 w-3.5 text-ion" aria-hidden="true" /> Live</> : 'None'}
          </dd>
        </div>
        <div>
          <dt className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">Value</dt>
          <dd className="num mt-1 truncate text-sm text-ink">
            {pool.referenceValuationUsd ? <>${pool.referenceValuationUsd}</> : <span className="text-dim" title="No independent price reference for this pool class or state">n/a</span>}
          </dd>
          {pool.referenceValuationLabel && <p className="text-[0.62rem] uppercase tracking-wider text-dim">{pool.referenceValuationLabel}</p>}
        </div>
      </dl>

      <div className="mt-6">
        <BudgetBar label={`${budget.label} · ${stock.symbol}`} symbol={stock.symbol} decimals={stock.decimals} used={stock[budget.usedField]} total={stock[budget.field]} tone={closed ? 'closed' : 'ion'} />
      </div>
      <p className="mt-4 text-xs text-dim">{pool.liquidityMode === 'PUBLIC' ? 'Public LP' : 'Treasury only'} · {a.symbol}/{b.symbol} · hook per pool</p>
    </Link>
  );
}
