'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Clock3, Droplets, Layers, Menu, PlusCircle, ShieldCheck, WifiOff, X } from 'lucide-react';
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

function TerminalClock() {
  const [now, setNow] = useState('');
  useEffect(() => {
    const fmt = () => setNow(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()));
    fmt();
    const id = window.setInterval(fmt, 30_000);
    return () => window.clearInterval(id);
  }, []);
  return <div className="flex items-center justify-between border-y border-line/70 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted"><span className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-ion" /> New York</span><span className="num text-ink">{now || '—'} ET</span></div>;
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
        <div className="relative min-h-dvh overflow-x-clip bg-bg-0">
          <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(60%_40%_at_70%_-10%,color-mix(in_oklab,var(--color-ion)_5%,transparent),transparent_70%)]" aria-hidden="true" />

          <PhaseTicker />
          <TestnetBanner />
          <ChainGuard />

          <aside className={cn('fixed bottom-0 left-0 top-[38px] z-40 flex w-[280px] flex-col border-r border-line bg-[#080b10] px-5 py-6 transition-transform duration-300 max-lg:w-[260px]', mobileOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full')} aria-label="Terminal sidebar">
            <div className="flex items-center justify-between">
              <Link href="/" aria-label="BELL home" className="rounded-none"><Logo /></Link>
              <button type="button" className="grid h-11 w-11 place-items-center border border-line text-ink hover:border-ion hover:text-ion focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion lg:hidden" aria-label="Close sidebar" onClick={() => setMobileOpen(false)}><X className="h-5 w-5" aria-hidden="true" /></button>
            </div>
            <div className="mt-7"><TerminalClock /></div>
            <div className="mb-2 mt-8 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Terminal clock · Workspace</div>
            <nav aria-label="Terminal app navigation" className="flex flex-col gap-1">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = path === href || path === `${href}/` || (href === '/pools' && (path.startsWith('/pool') || path.startsWith('/pools'))) || (href === '/protocol' && ['/privacy', '/terms', '/cookies'].some((legal) => path === legal || path === `${legal}/`));
                return <Link key={href} href={href} aria-current={active ? 'page' : undefined} onClick={() => setMobileOpen(false)} className={cn('flex min-h-12 items-center gap-3 border-l-2 px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-200', active ? 'border-ion bg-ion/10 text-ion' : 'border-transparent text-muted hover:border-line-strong hover:bg-white/[0.03] hover:text-ink')}><Icon className="h-4 w-4" aria-hidden="true" />{label}</Link>;
              })}
            </nav>
            <div className="mt-6 border-t border-line pt-5">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Policy tools</p>
              <Link href="/protocol" onClick={() => setMobileOpen(false)} className="flex min-h-11 items-center gap-3 px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted transition-colors hover:text-ion"><ShieldCheck className="h-4 w-4" /> Protocol reference</Link>
              <Link href="/positions" onClick={() => setMobileOpen(false)} className="flex min-h-11 items-center gap-3 px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted transition-colors hover:text-ion"><Layers className="h-4 w-4" /> Exit policy</Link>
            </div>
            <div className="mt-auto space-y-3 border-t border-line pt-5">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-dim"><span>Market clock</span><CalendarChip /></div>
              <div className="font-mono text-[10px] leading-5 text-muted">Robinhood Chain<br /><span className="text-ion">Testnet rehearsal · 46630</span></div>
              <WalletButton />
            </div>
          </aside>

          {mobileOpen ? <button aria-label="Close sidebar overlay" className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} /> : null}

          <header className="sticky top-0 z-20 ml-0 border-b border-line/80 bg-bg-0/95 lg:ml-[280px]">
            <div className="flex min-h-[62px] items-center justify-between gap-4 px-4 sm:px-6">
              <div className="flex items-center gap-3">
                <button type="button" className="grid h-11 w-11 place-items-center border border-line text-ink hover:border-ion hover:text-ion focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion lg:hidden" aria-label={mobileOpen ? 'Close sidebar' : 'Open sidebar'} aria-expanded={mobileOpen} onClick={() => setMobileOpen((open) => !open)}>
                  {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </button>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">{path === '/' ? 'Overview' : path.replaceAll('/', ' / ').replaceAll('-', ' ').trim()}</span>
              </div>
              <div className="flex items-center gap-3"><CalendarChip /><WalletButton /></div>
            </div>
          </header>

          <main id="main" className="app-page relative z-10 ml-0 min-h-[calc(100vh-150px)] px-4 py-8 sm:px-6 sm:py-10 lg:ml-[280px] lg:px-10 xl:px-12">{children}</main>

          <footer className="relative z-10 ml-0 px-4 pb-10 sm:px-6 lg:ml-[280px] lg:px-10 xl:px-12">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-5 font-mono text-[10px] uppercase tracking-[0.06em] text-dim">
              <span className="inline-flex items-center gap-1.5"><WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> Indexer: <span className="num">not connected</span></span>
              <span>Fixture data ≠ live pool state</span>
              <span className="lg:ml-auto">Fees and caps are not a guarantee of fills or returns.</span>
            </div>
          </footer>
        </div>
      </SmoothScroll>
    </WalletProvider>
  );
}
