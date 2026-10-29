'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeftRight, BriefcaseBusiness, ChartNoAxesColumnIncreasing, Plus, Menu, ShieldCheck, X } from 'lucide-react';
import { WalletButton } from '@/components/wallet/WalletButton';
import { PhaseBadge } from '@/components/ui/primitives';
import { MainnetStatusBanner } from '@/components/app/MainnetStatusBanner';
import { WalletProvider, useWallet } from '@/lib/wallet';
import { SmoothScroll } from '@/lib/motion';
import { cn } from '@/lib/format';
import { nowWeekMinuteET, phaseAtWeekMinute, formatWeekMinute } from '@/lib/policy';

const NAV_GROUPS = [
  { label: 'Markets', items: [
    { href: '/pools', label: 'Pools', detail: 'Browse pool policies', icon: ChartNoAxesColumnIncreasing },
    { href: '/swap', label: 'Swap', detail: 'Mainnet readiness + preview', icon: ArrowLeftRight },
  ] },
  { label: 'Liquidity', items: [
    { href: '/create', label: 'Create pool', detail: 'Preview pool settings', icon: Plus },
    { href: '/positions', label: 'Positions', detail: 'Sample LP positions', icon: BriefcaseBusiness },
  ] },
  { label: 'Reference', items: [
    { href: '/protocol', label: 'Protocol', detail: 'Rules and contracts', icon: ShieldCheck },
  ] },
] as const;

const PAGE_NAMES: Record<string, string> = {
  '/pools': 'Pools',
  '/pool': 'Pool',
  '/swap': 'Swap',
  '/create': 'Create',
  '/positions': 'Positions',
  '/protocol': 'Protocol',
  '/privacy': 'Privacy',
  '/terms': 'Terms',
  '/cookies': 'Cookies',
};

function MarketClock({ minute }: { minute: number | null }) {
  if (minute === null) return <span className="app-market-time" aria-hidden="true" />;
  const formatted = formatWeekMinute(minute);
  return (
    <span className="app-market-time" title="Scheduled market phase preview; onchain state is authoritative.">
      <span>{formatted.day} {formatted.time} ET</span>
      <PhaseBadge phase={phaseAtWeekMinute(minute)} />
    </span>
  );
}

function SidebarSession({ minute }: { minute: number | null }) {
  if (minute === null) return <div className="app-sidebar__session" aria-hidden="true" />;
  const formatted = formatWeekMinute(minute);
  const phase = phaseAtWeekMinute(minute);
  return (
    <section className="app-sidebar__session" aria-label="Scheduled market session preview">
      <div className="app-sidebar__session-heading">
        <span className="app-sidebar__section-label">Market session</span>
        <span className="app-sidebar__session-note">Schedule</span>
      </div>
      <div className="app-sidebar__session-state">
        <PhaseBadge phase={phase} />
        <span>{formatted.day} · {formatted.time} ET</span>
      </div>
      <p>Scheduled preview. Pool policy onchain controls swaps.</p>
    </section>
  );
}

function ChainGuard() {
  const wallet = useWallet();
  if (!wallet.wrongChain && !wallet.error) return null;
  return (
    <div role="alert" className="app-chain-guard">
      {wallet.wrongChain
        ? 'Wrong network. Switch to Robinhood Chain Mainnet (4663) before continuing.'
        : wallet.error}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [minute, setMinute] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setMinute(nowWeekMinuteET());
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => setMobileOpen(false), [path]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const pageName = PAGE_NAMES[path] ?? PAGE_NAMES[path.replace(/\/$/, '')] ?? 'Markets';
  const isActive = (href: string) =>
    path === href || path === `${href}/` ||
    (href === '/pools' && (path.startsWith('/pool') || path.startsWith('/pools'))) ||
    (href === '/protocol' && ['/privacy', '/terms', '/cookies'].some((legal) => path === legal || path === `${legal}/`));

  return (
    <WalletProvider>
      <SmoothScroll enabled>
        <div className="app-shell">
          <a className="app-skip-link" href="#main">Skip to content</a>

          <aside className={cn('app-sidebar', mobileOpen && 'app-sidebar--open')} aria-label="BELL terminal navigation">
            <div className="app-sidebar__brand-row">
              <Link href="/" aria-label="BELL home" className="app-brand">
                <span className="app-brand__mark" aria-hidden="true">B</span>
                <span><b className="app-brand__name">BELL</b><small className="app-brand__descriptor">MARKET TERMINAL</small></span>
              </Link>
              <button type="button" className="app-menu-toggle app-menu-toggle--close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
                <X aria-hidden="true" />
              </button>
            </div>

            <div className="app-sidebar__navigation">
              {NAV_GROUPS.map((group) => (
                <section key={group.label} className="app-sidebar__nav-group" aria-label={group.label}>
                  <p className="app-sidebar__section-label">{group.label}</p>
                  <nav className="app-sidebar__nav" aria-label={`${group.label} navigation`}>
                    {group.items.map(({ href, label, detail, icon: Icon }) => (
                      <Link key={href} href={href} aria-current={isActive(href) ? 'page' : undefined}>
                        <Icon className="app-sidebar__nav-icon" size={17} strokeWidth={1.6} aria-hidden="true" />
                        <span className="app-sidebar__nav-copy"><b>{label}</b><small>{detail}</small></span>
                      </Link>
                    ))}
                  </nav>
                </section>
              ))}
            </div>

            <SidebarSession minute={minute} />

            <div className="app-sidebar__bottom">
              <p className="app-sidebar__section-label">Network</p>
              <div className="app-sidebar__network-card">
                <span className="app-sidebar__network-label">Workspace target</span>
                <b>Robinhood Chain</b>
                <span>Mainnet · Chain 4663</span>
              </div>
              <a className="app-sidebar__reference" href="https://robinhoodchain.blockscout.com/" target="_blank" rel="noreferrer noopener">Block explorer <span aria-hidden="true">↗</span></a>
            </div>
          </aside>

          {mobileOpen && <button type="button" aria-label="Close navigation overlay" className="app-sidebar-overlay" onClick={() => setMobileOpen(false)} />}

          <div className="app-workspace">
            <header className="app-terminal-bar">
              <div className="app-terminal-bar__left">
                <button
                  type="button"
                  className="app-menu-toggle app-menu-toggle--open"
                  aria-label="Open navigation"
                  aria-expanded={mobileOpen}
                  onClick={() => setMobileOpen(true)}
                ><Menu aria-hidden="true" /></button>
                <p><span>Markets</span><span aria-hidden="true">/</span><b>{pageName}</b></p>
              </div>
              <div className="app-terminal-bar__right"><MarketClock minute={minute} /><WalletButton /></div>
            </header>

            <div className="app-status-wrap">
              <MainnetStatusBanner />
              <ChainGuard />
            </div>

            <main id="main" className={cn('app-page', path === '/swap' && 'app-page--swap')}>
              <div key={path} className="app-route-enter">
                {children}
              </div>
            </main>

            <footer className="app-footer">
              <div className="app-footer__inner">
                <span>Robinhood Chain Mainnet · 4663</span>
                <span>Fixture data is illustrative and does not represent live pool state.</span>
                <span>Fees and caps do not guarantee fills or returns.</span>
              </div>
            </footer>
          </div>
        </div>
      </SmoothScroll>
    </WalletProvider>
  );
}
