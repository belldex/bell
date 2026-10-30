import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/format';
import { PHASE_META, type MarketPhase, type PoolClass } from '@/lib/policy';

type Variant = 'primary' | 'ghost' | 'outline';

const base =
  'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-45 active:scale-[0.98] select-none whitespace-nowrap';
const sizes = {
  sm: 'h-8 px-3 text-xs rounded-lg',
  md: 'h-10 px-5 text-sm rounded-xl',
  lg: 'h-12 px-7 text-base rounded-xl font-semibold',
} as const;
const variants: Record<Variant, string> = {
  primary: 'border border-ion-soft bg-ion-soft text-bg-0 hover:bg-[#EEECE5] font-semibold',
  ghost: 'text-muted hover:text-ink hover:bg-white/5',
  outline: 'border border-line-strong text-ink hover:border-ion/60 hover:bg-ion/5 hover:text-ion',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <button className={cn(base, sizes[size], variants[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  href,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href'> & { href: string; variant?: Variant; size?: keyof typeof sizes; children: ReactNode }) {
  return (
    <Link href={href} className={cn(base, sizes[size], variants[variant], className)} {...props}>
      {children}
    </Link>
  );
}

export function PhaseBadge({ phase, className }: { phase: MarketPhase | 'HALTED'; className?: string }) {
  const key = (phase === 'HALTED' ? 'UNKNOWN' : phase) as MarketPhase;
  const meta = PHASE_META[key];
  const label = phase === 'HALTED' ? 'Halted' : meta.label;
  return (
    <span className={cn('app-badge app-badge--phase', className)} data-phase={phase}>
      {label}
    </span>
  );
}

export function ClassBadge({ poolClass, className }: { poolClass: PoolClass; className?: string }) {
  const guarded = poolClass === 'PRICE_GUARDED';
  return (
    <span
      className={cn(
        'app-badge app-badge--class',
        className,
      )}
      data-guarded={guarded}
      title={guarded ? 'Independent price reference with band protection' : 'Session controls only; no independent price protection for the counterasset.'}
    >
      {guarded ? 'Price guarded' : 'Session only'}
    </span>
  );
}

export function HaltBadge({ className }: { className?: string }) {
  return (
    <span className={cn('app-badge app-badge--halt', className)}>
      Swaps halted
    </span>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-center gap-3 text-[0.72rem] font-medium uppercase tracking-[0.22em] text-ion', className)}>
      <span className="h-px w-8 bg-ion/60" aria-hidden="true" />
      {children}
    </p>
  );
}
