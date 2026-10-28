'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Item = { label: string; href: string; text?: string; ext?: boolean };
type Menu = { label: string; items: Item[] };

const MENUS: Menu[] = [
  {
    label: 'Product',
    items: [
      { label: 'Pool preview', href: '/pools', text: 'Browse BELL testnet pools, session status and policy bounds.' },
      { label: 'Explore pools', href: '/create', text: 'Review a pool configuration. Mainnet creation is not enabled.' },
      { label: 'BELL pool classes', href: '/pools', text: 'Inspect BELL pool classes and their explicit risk disclosures.' },
      { label: 'Risk policy', href: '/protocol', text: 'Check immutable session, reference and budget policy.' },
    ],
  },
  {
    label: 'Developers',
    items: [
      { label: 'Protocol', href: '/protocol' },
      { label: 'Positions', href: '/positions' },
      { label: 'Swap', href: '/swap' },
    ],
  },
  {
    label: 'Protocol',
    items: [
      { label: 'Formulas and parameters', href: '/protocol' },
      { label: 'Session policy', href: '/protocol#sessions' },
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
      { label: 'X', href: 'https://x.com/bell_exchange', ext: true },
    ],
  },
];

const Chevron = () => (
  <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1" />
  </svg>
);

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileLevel, setMobileLevel] = useState<number | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`hdr${scrolled ? ' scrolled' : ''}${mobileLevel !== null ? ' lvl2' : ''}`}
      onMouseLeave={() => setOpenMenu(null)}
    >
      <div className="bar">
        <div className="bar-track">
          <span>
            BELL testnet rehearsal · Production swaps are not enabled. Mainnet release has not been
            approved.
            <Link href="/protocol">Read BELL policy.</Link>
          </span>
          <span>
            BELL testnet rehearsal · Production swaps are not enabled. Mainnet release has not been
            approved.
            <Link href="/protocol">Read BELL policy.</Link>
          </span>
        </div>
      </div>

      <div className={`slab${openMenu !== null ? ' open' : ''}`}>
        {MENUS.map((menu, index) => (
          <div
            key={menu.label}
            className={`submenu${openMenu === index ? ' open' : ''}`}
            style={{ left: 'calc(100% - 40px - 490px)' }}
          >
            {menu.items.map((item) => (
              <div key={item.label}>
                {item.ext ? (
                  <a className="ulink" href={item.href} target="_blank" rel="noreferrer">
                    {item.label}
                  </a>
                ) : (
                  <Link className="ulink" href={item.href}>
                    {item.label}
                  </Link>
                )}
                {item.text ? <p className="mono">{item.text}</p> : null}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="hrow">
        <Link href="/" className="logo" aria-label="BELL home">
          <img src="/assets/bell-mark.png" alt="" width={24} height={24} />
          <b>
            <span className="logo-v">B</span>ELL
          </b>
          <span className="logo-sub">BOURSE-EVENT LIQUIDITY LAYER</span>
        </Link>

        <ul className={`nav${openMenu !== null ? ' has-open' : ''}`}>
          {MENUS.map((menu, index) => (
            <li key={menu.label} onMouseEnter={() => setOpenMenu(index)}>
              <button
                className={openMenu === index ? 'open' : ''}
                onClick={() => setOpenMenu(openMenu === index ? null : index)}
                aria-expanded={openMenu === index}
              >
                {menu.label} <Chevron />
              </button>
            </li>
          ))}
        </ul>

        <button
          className={`burger${mobileOpen ? ' x' : ''}`}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          onClick={() => {
            setMobileOpen(!mobileOpen);
            setMobileLevel(null);
          }}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <div className={`mpanel${mobileOpen && mobileLevel === null ? ' open' : ''}`}>
        {MENUS.map((menu, index) => (
          <button key={menu.label} onClick={() => setMobileLevel(index)}>
            {menu.label}
          </button>
        ))}
      </div>

      {mobileOpen && mobileLevel !== null ? (
        <>
          <button className="mback" onClick={() => setMobileLevel(null)}>
            ← {MENUS[mobileLevel].label}
          </button>
          <div className="mpanel lvl2 open">
            {MENUS[mobileLevel].items.map((item) => (
              <div key={item.label}>
                {item.ext ? (
                  <a className="ulink" href={item.href} target="_blank" rel="noreferrer">
                    {item.label}
                  </a>
                ) : (
                  <Link className="ulink" href={item.href}>
                    {item.label}
                  </Link>
                )}
                {item.text ? (
                  <p className="mono" style={{ marginTop: 6, maxWidth: 290 }}>
                    {item.text}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </header>
  );
}
