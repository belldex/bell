'use client';

import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { PoolCard } from '@/components/policy/PoolCard';
import { RehearsalPoolCard } from '@/components/policy/RehearsalPoolCard';
import { POOLS } from '@/lib/fixtures';
import { cn } from '@/lib/format';

type ClassFilter = 'ALL' | 'PRICE_GUARDED' | 'SESSION_ONLY';
type StateFilter = 'ALL' | 'OPEN' | 'CLOSED' | 'HALTED';

function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ v: T; l: string }> }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-none border border-line bg-surface/70 p-1">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            'min-h-10 rounded-none px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-all',
            value === o.v
              ? 'bg-ion/15 text-ion shadow-[0_0_12px_-3px_var(--color-ion)]'
              : 'text-muted hover:text-ink'
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

export default function PoolsPage() {
  const [q, setQ] = useState('');
  const [cls, setCls] = useState<ClassFilter>('ALL');
  const [state, setState] = useState<StateFilter>('ALL');

  const list = useMemo(
    () =>
      POOLS.filter((p) => {
        if (cls !== 'ALL' && p.poolClass !== cls) return false;
        if (state === 'HALTED' && p.canSwap) return false;
        if (state === 'CLOSED' && p.poolPhase !== 'CLOSED') return false;
        if (state === 'OPEN' && (!p.canSwap || p.poolPhase === 'CLOSED')) return false;
        if (q && !p.pair.join(' ').toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [q, cls, state],
  );

  return (
    <div>
      <header className="max-w-3xl border-b border-line pb-7">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Pool directory · Testnet</p>
        <h1 className="mt-3 max-w-[720px] font-display text-[36px] font-bold leading-[1.06] tracking-[-0.04em] text-ink sm:text-[48px]">
          Every pool, its state, and its limits.
        </h1>
        <p className="mt-3 text-base text-muted">
          Class, session, fee, source and budgets are shown before you sign. The {POOLS.length} cards below are preview fixtures; the deployed testnet protocol status is shown above, but fixture rows are not pool records and are never executable.
        </p>
      </header>

      <RehearsalPoolCard />

      <div className="mt-8 flex flex-wrap items-center gap-3 border-b border-line pb-6">
        <label className="glass flex h-11 min-w-[14rem] flex-1 items-center gap-2.5 rounded-none border border-line bg-surface/70 px-3.5 sm:max-w-xs">
          <Search className="h-4 w-4 text-dim" aria-hidden="true" />
          <span className="sr-only">Search pairs</span>
           <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pair or symbol" className="w-full bg-transparent font-mono text-xs text-ink outline-none placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion" />
        </label>
        <SlidersHorizontal className="hidden h-4 w-4 text-dim sm:block" aria-hidden="true" />
        <Segmented<ClassFilter> label="Class" value={cls} onChange={setCls} options={[{ v: 'ALL', l: 'All' }, { v: 'PRICE_GUARDED', l: 'Price guarded' }, { v: 'SESSION_ONLY', l: 'Session only' }]} />
        <Segmented<StateFilter> label="State" value={state} onChange={setState} options={[{ v: 'ALL', l: 'Any state' }, { v: 'OPEN', l: 'Open' }, { v: 'CLOSED', l: 'Closed' }, { v: 'HALTED', l: 'Halted' }]} />
      </div>

      {list.length === 0 ? (
        <div className="glass mt-10 rounded-none border border-line p-10 text-center font-mono text-xs uppercase tracking-[0.08em] text-muted" role="status">No fixture pools match these filters.</div>
      ) : (
        <ul className="mt-8 grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <li key={p.id} className="bg-bg-0"><PoolCard pool={p} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}
