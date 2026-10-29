import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ClassBadge, HaltBadge, PhaseBadge } from '@/components/ui/primitives';
import { TokenPair } from '@/components/ui/TokenLogo';
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
      className="app-pool-card group flex flex-col border border-line bg-surface p-5 sm:p-6 transition-colors hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion"
      aria-label={`${pool.pair.join(' / ')} pool, ${pool.poolClass === 'PRICE_GUARDED' ? 'price guarded' : 'session only'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenPair symbols={pool.pair} size={32} />
          <div className="min-w-0">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.12em] text-dim">Example pool · Chain 46630</p>
            <h3 className="truncate font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">{pool.pair[0]}<span className="px-1.5 font-normal text-dim">/</span>{pool.pair[1]}</h3>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
            <ClassBadge poolClass={pool.poolClass} />
            {pool.canSwap ? <PhaseBadge phase={pool.poolPhase} /> : <HaltBadge />}
      </div>

      <dl className="mt-5 grid grid-cols-3 border-y border-line">
        <div>
          <dt className="pt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-dim">LP fee</dt>
          <dd className="num pb-3 pt-1 text-base text-ink">{feePercent(pool.effectiveFeeUnits)}</dd>
        </div>
        <div>
          <dt className="pt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-dim">Source</dt>
          <dd className="pb-3 pt-1 text-sm text-ink">{frozen ? 'Frozen' : pool.legs[0].source === 'LIVE' ? 'Live' : 'None'}</dd>
        </div>
        <div>
          <dt className="pt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-dim">Reference value</dt>
          <dd className="num truncate pb-3 pt-1 text-sm text-ink">
            {pool.referenceValuationUsd ? <>${pool.referenceValuationUsd}</> : <span className="text-dim" title="No independent price reference for this pool class or state">n/a</span>}
          </dd>
          {pool.referenceValuationLabel && <p className="pb-3 text-[0.62rem] uppercase tracking-wider text-dim">{pool.referenceValuationLabel}</p>}
        </div>
      </dl>

      <div className="mt-4">
        <BudgetBar label={`${budget.label} · ${stock.symbol}`} symbol={stock.symbol} decimals={stock.decimals} used={stock[budget.usedField]} total={stock[budget.field]} tone={closed ? 'closed' : 'ion'} />
      </div>
      <p className="mt-4 border-t border-line pt-3 text-[10px] text-dim">Preview data · not an onchain pool · {pool.liquidityMode === 'PUBLIC' ? 'Public LP' : 'Treasury only'} · {a.symbol}/{b.symbol}</p>
      <span className="app-pool-card__action">View pool policy <ArrowRight size={13} aria-hidden="true" /></span>
    </Link>
  );
}
