import { formatRaw, ratio, remaining, cn } from '@/lib/format';

export function BudgetBar({
  label,
  symbol,
  decimals,
  used,
  total,
  tone = 'ion',
  note,
}: {
  label: string;
  symbol: string;
  decimals: number;
  used: string;
  total: string;
  tone?: 'ion' | 'closed';
  note?: string;
}) {
  const r = ratio(used, total);
  const left = remaining(used, total);
  const danger = r >= 0.9;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="uppercase tracking-[0.14em] text-dim">{label}</span>
        <span className="num text-muted">
          <span className={cn(danger ? 'text-down' : 'text-ink')}>{formatRaw(left, decimals)}</span>
          <span className="text-dim"> left of {formatRaw(total, decimals)} {symbol}</span>
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label={`${label} used, ${symbol}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(r * 100)}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-700', danger ? 'bg-down' : tone === 'closed' ? 'bg-phase-closed' : 'bg-gradient-to-r from-ion-deep to-ion')}
          style={{ width: `${Math.max(r * 100, r > 0 ? 2 : 0)}%` }}
        />
      </div>
      {note && <p className="mt-1.5 text-[0.7rem] text-dim">{note}</p>}
    </div>
  );
}
