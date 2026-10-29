'use client';

import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { scrollLandingTo } from './LandingMotion';

const ITEMS = [
  { id: 'market-rhythm', label: 'Market rhythm' },
  { id: 'risk-policy', label: 'Risk policy' },
  { id: 'planned-close', label: 'Planned close' },
];

export default function SiteNav() {
  const [active, setActive] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onFeature = (event: Event) => setActive((event as CustomEvent<string | null>).detail);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('bell:feature', onFeature);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('bell:feature', onFeature);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const go = (id: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    setMobileOpen(false);
    if (scrollLandingTo(id)) {
      event.preventDefault();
      window.history.replaceState(null, '', `#${id}`);
    }
  };

  return (
    <header className="bell-story-nav">
      <Link href="/" className="bell-story-brand" aria-label="BELL home">
        <span className="bell-story-mark" aria-hidden="true">B</span>
        <b>BELL</b>
        <i />
        <small>Session-aware liquidity</small>
      </Link>
      <nav className="bell-story-links" aria-label="Landing sections">
        {ITEMS.map((item) => <a key={item.id} href={`#${item.id}`} data-active={active === item.id} aria-current={active === item.id ? 'location' : undefined} onClick={go(item.id)}>{item.label}</a>)}
      </nav>
      <div className="bell-story-actions">
        <Link href="/pools" className="bell-story-open">Open app <ArrowUpRight size={15} aria-hidden="true" /></Link>
        <button className="bell-story-menu-toggle" type="button" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileOpen} aria-controls="bell-story-mobile" onClick={() => setMobileOpen((value) => !value)}>
          {mobileOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
      {mobileOpen ? <nav className="bell-story-mobile" id="bell-story-mobile" aria-label="Mobile landing sections">
        <p>Explore BELL</p>
        {ITEMS.map((item) => <a key={item.id} href={`#${item.id}`} data-active={active === item.id} onClick={go(item.id)}>{item.label}<ArrowUpRight size={15} aria-hidden="true" /></a>)}
        <Link href="/pools" className="bell-story-mobile-open" onClick={() => setMobileOpen(false)}>Open app <ArrowUpRight size={15} /></Link>
      </nav> : null}
    </header>
  );
}
