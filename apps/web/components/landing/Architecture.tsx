'use client';

import { useLayoutEffect, useRef } from 'react';
import { Blocks, CalendarClock, Factory, LifeBuoy, Lock, Route } from 'lucide-react';
import { Eyebrow } from '@/components/ui/primitives';
import { registerGsap, useReducedMotion } from '@/lib/motion';

const PANELS = [
  {
    icon: CalendarClock,
    kicker: 'Inputs',
    title: 'Verified reports, committed calendar',
    body: 'Signed reports go through the official verifier and are decoded against bound feed, schema, units and identity. A committed UTC calendar of sessions, holidays and early closes decides what “closed” means — not a weekday guess.',
    tags: ['AssetRegistry', 'SessionRegistry', 'CalendarRegistry', 'Stale ≠ weekend'],
  },
  {
    icon: Blocks,
    kicker: 'Hook',
    title: 'One immutable hook per pool',
    body: 'A single audited template, deployed as a separate instance for every pool. PoolKey, policy hash, sources and budgets are locked at creation — no proxy, no delegatecall, no cross-pool accounting.',
    tags: ['mask 0x2cc0', 'beforeSwap · afterSwap', 'dynamic fee 0x800000', 'tick spacing 60'],
  },
  {
    icon: Factory,
    kicker: 'Factory',
    title: 'Atomic pool creation',
    body: 'Fee transfer, CREATE2 deploy, initialize and seed happen in one transaction — or none of it does. The salt is namespaced to the creator and the config hash, and the position NFT goes to you.',
    tags: ['49 USDG setup', 'predicted PoolId', 'seed ≥ cap × 10', 'NFT to creator'],
  },
  {
    icon: Route,
    kicker: 'Execution',
    title: 'Router and noncustodial LPs',
    body: 'Exact-input and exact-output swaps settle inside one unlock with a request hash, payer, deadline and max input. Liquidity lives in user-owned PositionManager positions — never a managed vault.',
    tags: ['exact in / out', 'deadline ≤ 120 s', 'PositionManager', 'no vault'],
  },
  {
    icon: LifeBuoy,
    kicker: 'Safety',
    title: 'A guardian that can only slow things down',
    body: 'The guardian can pause and schedule a 48-hour delayed resume. It cannot sweep funds, reset budgets, force a price valid, or block your exit — removal and collect are never gated by BELL guards.',
    tags: ['pause only', '48 h delayed resume', 'no sweep', 'exit in-kind'],
  },
] as const;

export function Architecture() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    if (reduced || !root.current || !track.current) return;
    const { gsap, ScrollTrigger } = registerGsap();
    const mm = gsap.matchMedia();
    mm.add('(min-width: 900px)', () => {
      const distance = () => Math.max(0, track.current!.scrollWidth - window.innerWidth + 64);
      gsap.to(track.current, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: () => `+=${distance() + window.innerHeight * 0.4}`,
          pin: true,
          scrub: 0.7,
          invalidateOnRefresh: true,
          anticipatePin: 1,
          onUpdate: (self) => {
            const bar = root.current?.querySelector<HTMLElement>('[data-arch="bar"]');
            if (bar) bar.style.transform = `scaleX(${self.progress})`;
          },
        },
      });
      gsap.to('[data-arch="glow"]', {
        xPercent: 120,
        ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top top', end: () => `+=${distance()}`, scrub: true },
      });
    });
    ScrollTrigger.refresh();
    return () => mm.revert();
  }, [reduced]);

  return (
    <section
      ref={root}
      id="safety"
      aria-labelledby="arch-title"
      className="relative overflow-hidden bg-bg-0 py-20 lg:py-24 md:flex md:min-h-[85vh] md:flex-col md:justify-center"
    >
      <div
        data-arch="glow"
        className="pointer-events-none absolute -left-1/4 top-1/3 h-[60vh] w-[60vh] rounded-full bg-ion/10 blur-[130px]"
        aria-hidden="true"
      />
      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        <Eyebrow>Architecture</Eyebrow>
        <h2
          id="arch-title"
          className="mt-4 max-w-3xl font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl lg:text-6xl"
        >
          Small surface. <span className="text-ion-gradient">Hard edges.</span>
        </h2>
      </div>

      <div className="relative mt-8 w-full md:mt-10">
        <div
          ref={track}
          className="flex flex-col gap-5 px-4 sm:px-6 md:w-max md:flex-row md:gap-6 md:pl-[max(1rem,calc((100vw-72rem)/2+1rem))] md:pr-16"
        >
          {PANELS.map((p, i) => {
            const Icon = p.icon;
            return (
              <article
                key={p.title}
                className="glass glass-hover relative flex w-full shrink-0 flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface/70 p-6 md:h-[22rem] md:w-[26rem]"
              >
                <span
                  className="num pointer-events-none absolute -right-2 -top-6 select-none text-[8rem] font-bold leading-none text-white/[0.03]"
                  aria-hidden="true"
                >
                  0{i + 1}
                </span>
                <div className="relative">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl border border-ion/30 bg-ion/10 text-ion">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="text-[0.7rem] uppercase tracking-[0.2em] text-dim">{p.kicker}</span>
                  </div>
                  <h3 className="mt-4 font-display text-2xl font-bold text-ink">{p.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted">{p.body}</p>
                </div>
                <ul className="relative mt-5 flex flex-wrap gap-1.5">
                  {p.tags.map((t) => (
                    <li
                      key={t}
                      className="num rounded-md border border-line bg-bg-1/70 px-2.5 py-1 text-[0.7rem] text-ion-soft font-medium"
                    >
                      {t}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
          <div className="hidden w-[14rem] shrink-0 items-center md:flex" aria-hidden="true">
            <Lock className="h-10 w-10 text-ion/40" />
          </div>
        </div>
        <div className="mx-auto mt-8 hidden h-1 max-w-6xl overflow-hidden rounded-full bg-line md:block" aria-hidden="true">
          <div data-arch="bar" className="h-full origin-left scale-x-0 bg-ion transition-transform duration-100" />
        </div>
      </div>
    </section>
  );
}
