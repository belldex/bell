'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Droplets, Layers, PlusCircle, WifiOff } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { WalletButton } from '@/components/wallet/WalletButton';
import { PhaseBadge } from '@/components/ui/primitives';
import { TestnetBanner } from '@/components/app/TestnetBanner';
import { WalletProvider, useWallet } from '@/lib/wallet';
import { SmoothScroll } from '@/lib/motion';
import { cn } from '@/lib/format';
import { nowWeekMinuteET, phaseAtWeekMinute, formatWeekMinute } from '@/lib/policy';

const NAV = [
  { href: '/pools', label: 'Pools', icon: Droplets },
  { href: '/swap', label: 'Swap', icon: ArrowLeftRight },
  { href: '/create', label: 'Create', icon: PlusCircle },
  { href: '/positions', label: 'Positions', icon: Layers },
] as const;

function CalendarChip() {
  const [m, setM] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setM(nowWeekMinuteET());
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);
  if (m === null) return <span className="h-8 w-40" aria-hidden="true" />;
  const f = formatWeekMinute(m);
  return (
    <span className="hidden items-center gap-2 rounded-full border border-line bg-bg-1/70 py-1 pl-3 pr-1.5 text-xs text-muted lg:inline-flex" title="Scheduled phase from a calendar preview (no holidays). Onchain state is authoritative.">
      <span className="num">{f.day} {f.time} ET</span>
      <PhaseBadge phase={phaseAtWeekMinute(m)} />
    </span>
  );
}

function ChainGuard() {
  const w = useWallet();
  if (!w.wrongChain && !w.error) return null;
  return (
    <div role="alert" className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-sm text-warn">
      <AlertTriangle className="mr-2 inline h-4 w-4 -translate-y-px" aria-hidden="true" />
      {w.wrongChain ? 'Wrong network. Transactions are disabled until you switch to Robinhood Chain (4663) or Testnet (46630).' : w.error}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <WalletProvider>
      <SmoothScroll enabled={false}>
        <div className="relative min-h-dvh bg-bg-0 pb-24 md:pb-0">
          <div className="pointer-events-none fixed inset-0 -z-0 bg-[radial-gradient(60%_40%_at_70%_-10%,color-mix(in_oklab,var(--color-ion)_12%,transparent),transparent_70%)]" aria-hidden="true" />
          <div className="pointer-events-none fixed inset-0 -z-0 opacity-[0.35] [background-image:linear-gradient(var(--color-line)_1px,transparent_1px),linear-gradient(90deg,var(--color-line)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(70%_60%_at_50%_0%,#000,transparent)]" aria-hidden="true" />

          <TestnetBanner />
          <ChainGuard />

          <header className="sticky top-0 z-40 border-b border-line/80 bg-bg-0/85 backdrop-blur-xl">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
              <div className="flex items-center gap-8">
                <Link href="/" aria-label="BELL home" className="rounded-full"><Logo /></Link>
                <nav aria-label="App" className="hidden items-center gap-1 md:flex">
                  {NAV.map(({ href, label }) => {
                    const active = path === href || path === `${href}/` || (href === '/pools' && path.startsWith('/pool'));
                    return (
                      <Link
                        key={href}
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'rounded-full px-4 py-1.5 text-sm font-medium transition-all',
                          active
                            ? 'bg-ion/10 text-ion border border-ion/30'
                            : 'text-muted hover:bg-white/5 hover:text-ink'
                        )}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </nav>
              </div>
              <div className="flex items-center gap-3">
                <CalendarChip />
                <WalletButton />
              </div>
            </div>
          </header>

          <main id="main" className="relative z-10 mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>

          <footer className="relative z-10 mx-auto max-w-6xl px-4 pb-10 sm:px-6">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-6 text-xs text-dim">
              <span className="inline-flex items-center gap-1.5"><WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> Indexed through: <span className="num">n/a (preview)</span></span>
              <span>Quotes expire in ≤ 30 s · transaction deadline ≤ 120 s</span>
              <span className="sm:ml-auto">Fees and caps are not a guarantee of fills or of returns.</span>
            </div>
          </footer>

          {/* mobile bottom nav */}
          <nav aria-label="App (mobile)" className="glass fixed inset-x-3 bottom-3 z-50 flex items-center justify-around rounded-full px-2 py-1.5 md:hidden">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = path === href || path === `${href}/` || (href === '/pools' && path.startsWith('/pool'));
              return (
                <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-12 min-w-16 flex-col items-center justify-center gap-0.5 rounded-full px-3 text-[0.65rem]', active ? 'bg-ion/15 text-ion' : 'text-muted')}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </SmoothScroll>
    </WalletProvider>
  );
}
