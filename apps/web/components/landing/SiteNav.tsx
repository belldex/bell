'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { ButtonLink } from '@/components/ui/primitives';
import { cn } from '@/lib/format';

const LINKS = [
  { href: '#clock', label: 'Bell Clock' },
  { href: '#bell-fee', label: 'Bell fee' },
  { href: '#weekend', label: 'Weekend' },
  { href: '#classes', label: 'Pool classes' },
  { href: '#safety', label: 'Safety' },
];

export default function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-6">
      <nav
        aria-label="Primary"
        className={cn(
          'mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full border px-4 transition-all duration-300 sm:px-6 backdrop-blur-md',
          scrolled ? 'glass border-line bg-surface/80 shadow-[0_10px_30px_rgba(0,0,0,0.5)]' : 'border-transparent bg-transparent',
        )}
      >
        <Link href="/" aria-label="BELL home" className="rounded-full">
          <Logo />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="rounded-full px-3.5 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-white/5 hover:text-ink">
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <ButtonLink href="/pools" size="sm" className="hidden sm:inline-flex">
            Launch app <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="mobile-menu" className="glass mx-auto mt-2 max-w-6xl rounded-3xl p-3 md:hidden">
          <ul className="flex flex-col">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-sm font-medium text-ink hover:bg-white/5">
                  {l.label}
                </a>
              </li>
            ))}
            <li className="p-2">
              <ButtonLink href="/pools" className="w-full">
                Launch app <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </ButtonLink>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
