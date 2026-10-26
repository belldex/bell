import Link from 'next/link';
import { ArrowRight, BookOpenText } from 'lucide-react';
import { FaGithub } from 'react-icons/fa6';
import { Logo } from '@/components/ui/Logo';
import { ButtonLink } from '@/components/ui/primitives';
import { Parallax, Reveal } from './motion-kit';

export function Cta() {
  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden bg-bg-0 py-24 sm:py-36">
      <Parallax speed={8} className="pointer-events-none absolute inset-x-0 top-0 h-full">
        <img
          src="/assets/pool-glass.jpg"
          alt=""
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 w-[min(100vw,900px)] -translate-x-1/2 -translate-y-1/2 opacity-60 mix-blend-screen"
        />
      </Parallax>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_50%,transparent,var(--color-bg-0)_85%)]" aria-hidden="true" />
      <Reveal className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8" stagger={0.1}>
        <h2
          id="cta-title"
          data-stagger
          className="font-display text-4xl font-bold tracking-tight text-ink sm:text-6xl lg:text-7xl"
        >
          Trade the session.{' '}
          <span className="text-ion-gradient block">Respect the close.</span>
        </h2>
        <p data-stagger className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
          Browse sample pools, run the swap flow, and walk through pool creation. Contracts are deployed on Robinhood Testnet (Chain 46630) for rehearsal.
        </p>
        <div data-stagger className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
          <ButtonLink href="/pools" size="lg">
            Open the app <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
          <ButtonLink href="/create" variant="outline" size="lg">
            Create a pool
          </ButtonLink>
        </div>
      </Reveal>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line bg-bg-0">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Bourse-Event Liquidity Layer. A Uniswap v4 hook protocol for tokenized-stock liquidity on Robinhood Chain.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-14 gap-y-3 text-sm">
          <Link href="/pools" className="text-muted hover:text-ink transition-colors">Pools</Link>
          <Link href="/swap" className="text-muted hover:text-ink transition-colors">Swap</Link>
          <Link href="/create" className="text-muted hover:text-ink transition-colors">Create pool</Link>
          <Link href="/positions" className="text-muted hover:text-ink transition-colors">Positions</Link>
          <a href="#clock" className="inline-flex items-center gap-2 text-muted hover:text-ink transition-colors">
            <BookOpenText className="h-4 w-4" aria-hidden="true" />Bell Clock
          </a>
          <a href="https://github.com" rel="noreferrer noopener" target="_blank" className="inline-flex items-center gap-2 text-muted hover:text-ink transition-colors">
            <FaGithub className="h-4 w-4" aria-hidden="true" />Source
          </a>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-dim sm:px-6">
          Rehearsal build. Robinhood Testnet (Chain 46630) protocol suite is deployed; mainnet approval has not been given. Sample pools demonstrate interface behavior. Stock Token availability may be restricted by jurisdiction; nothing here is financial advice or a promise of profit. Liquidity provision carries risk, including loss of principal.
        </p>
      </div>
    </footer>
  );
}
