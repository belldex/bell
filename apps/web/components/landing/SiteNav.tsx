'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Menu = { label: string; items: Array<{ label: string; href: string; text?: string }> };

const MENUS: Menu[] = [
  {
    label: 'Product',
    items: [
      { label: 'Pool preview', href: '/pools', text: 'Browse BELL testnet pools, session status and policy bounds.' },
      { label: 'Explore pools', href: '/create', text: 'Review a pool configuration. Mainnet creation is not enabled.' },
      { label: 'Pool classes', href: '/pools', text: 'Inspect PRICE_GUARDED and SESSION_ONLY risk disclosures.' },
      { label: 'Risk policy', href: '/protocol', text: 'Check immutable session, reference and budget policy.' },
    ],
  },
  {
    label: 'App',
    items: [
      { label: 'Pools', href: '/pools' },
      { label: 'Create', href: '/create' },
      { label: 'Positions', href: '/positions' },
      { label: 'Swap', href: '/swap' },
    ],
  },
  {
    label: 'Protocol',
    items: [
      { label: 'Formulas and parameters', href: '/protocol' },
      { label: 'Sessions', href: '/protocol#sessions' },
      { label: 'Planned closure', href: '/protocol#closure' },
      { label: 'Exit policy', href: '/positions' },
    ],
  },
  {
    label: 'Learn',
    items: [
      { label: 'BELL overview', href: '/protocol' },
      { label: 'Sessions and risk', href: '/protocol#sessions' },
      { label: 'Planned closure', href: '/protocol#closure' },
      { label: 'X', href: 'https://x.com/bell_exchange' },
    ],
  },
];

const Chevron = () => (
  <svg viewBox="0 0 10 10" fill="none" aria-hidden="true" className="h-2.5 w-2.5">
    <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1" />
  </svg>
);

/**
 * Reference header layout: fixed 58px muted ticker bar on top, then the brand
 * row with mono 12px dropdown links; hovering a top-level item opens the slab.
 * All colors follow the BELL tokens (muted bar, slab panel, ion accents).
 */
export default function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50" onMouseLeave={() => setOpen(null)}>
      <div className="pointer-events-auto flex h-[58px] items-center justify-center overflow-hidden bg-muted font-mono text-xs text-ink max-md:h-[54px] max-md:animate-none max-md:justify-start">
        <div className="flex gap-20 whitespace-nowrap max-md:pl-5">
          <span>
            BELL testnet rehearsal · Production swaps are not enabled. Mainnet release has not been approved.
            <Link href="/protocol" className="ml-1.5 border-b border-current pb-px">
              Read BELL policy.
            </Link>
          </span>
          <span className="max-md:inline">
            BELL testnet rehearsal · Production swaps are not enabled. Mainnet release has not been approved.
            <Link href="/protocol" className="ml-1.5 border-b border-current pb-px">
              Read BELL policy.
            </Link>
          </span>
        </div>
      </div>

      {/* Dropdown slab */}
      <div
        className={`pointer-events-auto fixed inset-x-0 top-0 z-[-1] h-[633px] bg-slab transition-[top] duration-300 ${
          open !== null ? '!top-0' : ''
        }`}
      >
        <div className="relative h-full">
          {MENUS.map((menu, index) => (
            <div
              key={menu.label}
              className={`absolute top-[245px] hidden w-[495px] flex-col gap-[60px] ${open === index ? 'flex' : ''}`}
              style={{ left: `calc(100% - 40px - 495px)` }}
            >
              {menu.items.map((item) => (
                <div key={item.label}>
                  <Link className="ulink-ref inline-block border-b border-current pb-0.5 font-mono text-xs" href={item.href}>
                    {item.label}
                  </Link>
                  {item.text ? <p className="mt-2 max-w-[340px] font-mono text-xs leading-[18px] text-muted">{item.text}</p> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Brand row */}
      <div className="pointer-events-auto relative z-[2] flex items-center justify-between px-10 pt-10 max-md:px-[30px] max-md:pt-5">
        <Link href="/" className="inline-flex items-center gap-2.5" aria-label="BELL home">
          {/* Pixel-style BELL mark, pure SVG — no template asset */}
          <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
            <path d="M12 2 3 21h4l5-11 5 11h4L12 2Z" fill="currentColor" className="text-ion" />
          </svg>
          <b className="font-mono text-[22px] font-bold leading-6 tracking-[1px] text-ink">BELL</b>
          <span className="font-mono text-xs text-muted">BOURSE-EVENT LIQUIDITY LAYER</span>
        </Link>

        <ul className="hidden items-center gap-[60px] md:flex">
          {MENUS.map((menu, index) => (
            <li key={menu.label} onMouseEnter={() => setOpen(index)}>
              <button
                className="inline-flex items-center gap-1.5 font-mono text-xs text-ink transition-colors hover:text-ion"
                aria-expanded={open === index}
                onClick={() => setOpen(open === index ? null : index)}
              >
                {menu.label} <Chevron />
              </button>
            </li>
          ))}
        </ul>

        {/* Burger (mobile) */}
        <button
          className="relative hidden h-5 w-7 max-md:block"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          <span className={`absolute left-0 right-0 h-[1.5px] bg-current transition-all ${mobileOpen ? 'top-2 rotate-45' : 'top-0.5'}`} />
          <span className={`absolute left-0 right-0 top-2 h-[1.5px] bg-current transition-all ${mobileOpen ? 'opacity-0' : ''}`} />
          <span className={`absolute left-0 right-0 h-[1.5px] bg-current transition-all ${mobileOpen ? 'top-2 -rotate-45' : 'top-[18px]'}`} />
        </button>
      </div>

      {/* Mobile panel */}
      {mobileOpen ? (
        <div className="pointer-events-auto fixed inset-0 flex flex-col justify-end bg-slab px-[30px] pb-[60px]">
          {MENUS.map((menu, index) => (
            <details key={menu.label} className="border-b border-line py-3">
              <summary className="cursor-pointer font-sans text-2xl tracking-[-2px] text-ink">{menu.label}</summary>
              <div className="mt-3 flex flex-col gap-2 pb-2">
                {menu.items.map((item) => (
                  <Link key={item.label} href={item.href} className="font-mono text-xs text-muted" onClick={() => setMobileOpen(false)}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </header>
  );
}
