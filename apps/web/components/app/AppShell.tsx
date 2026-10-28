'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Droplets, Layers, Menu, PlusCircle, ShieldCheck, WifiOff, X } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { WalletButton } from '@/components/wallet/WalletButton';
import { PhaseBadge } from '@/components/ui/primitives';
import { TestnetBanner } from '@/components/app/TestnetBanner';
import { WalletProvider, useWallet } from '@/lib/wallet';
import { SmoothScroll } from '@/lib/motion';
import { cn } from '@/lib/format';
import { nowWeekMinuteET, phaseAtWeekMinute, formatWeekMinute } from '@/lib/policy';

const NAV = [
  { href: '/pools', label: 'Pool preview', icon: Droplets },
  { href: '/swap', label: 'Swap', icon: ArrowLeftRight },
  { href: '/create', label: 'Create preview', icon: PlusCircle },
  { href: '/positions', label: 'Positions', icon: Layers },
  { href: '/protocol', label: 'Protocol', icon: ShieldCheck },
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

function PhaseTicker() {
  return (
    <div className="overflow-hidden border-b border-line bg-muted text-ink">
      <div className="mx-auto flex min-h-[38px] max-w-[1440px] items-center justify-center gap-6 px-4 font-mono text-[11px] uppercase tracking-[0.12em] max-md:justify-start">
        <span className="text-ion">BELL · Robinhood Chain</span>
        <span>Testnet rehearsal</span>
        <span className="hidden sm:inline">Sample pools are previews · writes require wallet + live policy</span>
        <Link href="/protocol" className="hidden border-b border-current pb-px hover:text-ion md:inline">Policy</Link>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [path]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);
  return (
    <WalletProvider>
      <SmoothScroll enabled={false}>
        <div className="relative min-h-dvh overflow-x-clip bg-bg-0 pb-24 md:pb-0">
          <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(60%_40%_at_70%_-10%,color-mix(in_oklab,var(--color-ion)_10%,transparent),transparent_70%)]" aria-hidden="true" />

          <PhaseTicker />
          <TestnetBanner />
          <ChainGuard />

          <header className="sticky top-0 z-40 border-b border-line/80 bg-bg-0/90 backdrop-blur-xl">
            <div className="mx-auto flex min-h-[76px] max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
              <div className="flex items-center gap-6 lg:gap-10">
                <Link href="/" aria-label="BELL home" className="rounded-full"><Logo /></Link>
                <nav aria-label="App" className="hidden items-center gap-6 lg:flex lg:gap-8">
                   {NAV.map(({ href, label }) => {
                    const active = path === href || path === `${href}/` || (href === '/pools' && (path.startsWith('/pool') || path.startsWith('/pools'))) || (href === '/protocol' && ['/privacy', '/terms', '/cookies'].some((legal) => path === legal || path === `${legal}/`));
                    return (
                      <Link
                        key={href}
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                           'min-h-11 px-1 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] whitespace-nowrap transition-all xl:text-xs xl:tracking-[0.08em]',
                           active
                             ? 'border-b border-ion text-ion'
                             : 'text-muted hover:text-ink'
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
                <button type="button" className="grid h-11 w-11 place-items-center border border-line text-ink hover:border-ion hover:text-ion focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion lg:hidden" aria-label={mobileOpen ? 'Close app navigation' : 'Open app navigation'} aria-expanded={mobileOpen} aria-controls="mobile-app-navigation" onClick={() => setMobileOpen((open) => !open)}>
                  {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
            </div>
            {mobileOpen ? <nav id="mobile-app-navigation" aria-label="App mobile" className="border-t border-line bg-slab px-4 py-3 lg:hidden">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = path === href || path === `${href}/` || (href === '/pools' && (path.startsWith('/pool') || path.startsWith('/pools'))) || (href === '/protocol' && ['/privacy', '/terms', '/cookies'].some((legal) => path === legal || path === `${legal}/`));
                return <Link key={href} href={href} aria-current={active ? 'page' : undefined} onClick={() => setMobileOpen(false)} className={cn('flex min-h-12 items-center gap-3 border-b border-line px-3 font-mono text-xs uppercase tracking-[0.08em]', active ? 'text-ion' : 'text-muted hover:text-ink')}><Icon className="h-4 w-4" aria-hidden="true" />{label}</Link>;
              })}
            </nav> : null}
          </header>

          <main id="main" className="relative z-10 mx-auto min-h-[calc(100vh-260px)] max-w-[1440px] px-4 py-10 sm:px-6 sm:py-12 lg:px-10">{children}</main>

          <footer className="relative z-10 mx-auto max-w-[1440px] px-4 pb-10 sm:px-6 lg:px-10">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-6 font-mono text-[11px] text-dim">
              <span className="inline-flex items-center gap-1.5"><WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> Indexer: <span className="num">not connected</span></span>
              <span>Quotes expire in ≤ 30 s · transaction deadline ≤ 120 s</span>
              <span className="sm:ml-auto">Fees and caps are not a guarantee of fills or of returns.</span>
            </div>
          </footer>

          {/* mobile bottom nav */}
          <nav aria-label="App (mobile)" className="glass fixed inset-x-3 bottom-3 z-50 flex items-center justify-around rounded-none border border-line bg-slab/95 px-2 py-1.5 backdrop-blur-xl lg:hidden">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = path === href || path === `${href}/` || (href === '/pools' && (path.startsWith('/pool') || path.startsWith('/pools'))) || (href === '/protocol' && ['/privacy', '/terms', '/cookies'].includes(path));
              return (
                <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-12 min-w-16 flex-col items-center justify-center gap-0.5 rounded-none px-3 font-mono text-[9px] uppercase tracking-tight', active ? 'bg-ion/15 text-ion' : 'text-muted')}>
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
