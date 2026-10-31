'use client';

import { useLayoutEffect, useRef } from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { ButtonLink, Eyebrow } from '@/components/ui/primitives';
import { registerGsap, useReducedMotion } from '@/lib/motion';

const FACTS = [
  { k: '5', v: 'session states' },
  { k: '0.05–1.00%', v: 'dynamic LP fee' },
  { k: '300 s', v: 'bell fee decay' },
  { k: '49 USDG', v: 'pool setup' },
];

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    if (reduced || !root.current) return;
    const { gsap, ScrollTrigger } = registerGsap();
    const ctx = gsap.context(() => {
      // Natural, silky parallax without hijacking scroll or pinning the screen
      gsap.to('[data-hero="bell"]', {
        yPercent: 18,
        scale: 1.08,
        rotate: -2,
        ease: 'none',
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1,
        },
      });

      gsap.to('[data-hero="grid"]', {
        yPercent: 12,
        opacity: 0.35,
        ease: 'none',
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1,
        },
      });

      gsap.to('[data-hero="copy"]', {
        yPercent: -10,
        opacity: 0.85,
        ease: 'none',
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1,
        },
      });

      // Smooth elegant entrance
      gsap.from('[data-reveal]', {
        y: 28,
        opacity: 0,
        duration: 1.0,
        ease: 'power3.out',
        stagger: 0.08,
        delay: 0.1,
      });

      gsap.from('[data-hero="bell"]', {
        opacity: 0,
        scale: 0.92,
        y: 20,
        duration: 1.4,
        ease: 'power3.out',
      });

      ScrollTrigger.refresh();
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  return (
    <section
      ref={root}
      id="top"
      aria-labelledby="hero-title"
      className="relative flex min-h-[92vh] flex-col justify-between overflow-hidden bg-bg-0 pt-28 sm:pt-32"
    >
      {/* backdrop grid horizon */}
      <img
        data-hero="grid"
        src="/assets/grid-horizon.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[75%] w-full object-cover object-top mix-blend-screen opacity-70"
      />
      {/* ambient glow */}
      <div
        className="pointer-events-none absolute -right-[5%] top-[10%] h-[70vw] max-h-[700px] w-[70vw] max-w-[700px] rounded-full bg-ion/10 blur-[130px]"
        aria-hidden="true"
      />

      {/* bell sculpture + pulses */}
      <div
        className="pointer-events-none absolute right-[-6%] top-1/2 w-[min(80vw,900px)] -translate-y-[45%] opacity-90 sm:right-[-2%] lg:right-[2%]"
        aria-hidden="true"
      >
        <div data-hero="halo" className="absolute left-[66%] top-[62%] aspect-[3.2/1] w-[50%] -translate-x-1/2 -translate-y-1/2">
          <span className="absolute inset-0 animate-pulse-ring rounded-full border border-ion/40" />
          <span className="absolute inset-0 animate-pulse-ring rounded-full border border-ion/25 [animation-delay:0.8s]" />
          <span className="absolute inset-0 animate-pulse-ring rounded-full border border-ion/15 [animation-delay:1.6s]" />
        </div>
        <img
          data-hero="bell"
          src="/assets/hero-bell.jpg"
          alt=""
          className="relative w-full select-none mix-blend-screen animate-float"
          draggable={false}
        />
      </div>

      {/* copy */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 sm:px-6">
        <div data-hero="copy" className="max-w-2xl py-8 lg:py-16">
          <div data-reveal>
            <Eyebrow>Uniswap v4 · Robinhood Chain</Eyebrow>
          </div>
          <h1
            id="hero-title"
            data-reveal
            className="mt-6 font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl lg:text-6xl xl:text-7xl"
          >
            Liquidity that{' '}
            <span className="text-ion-gradient block">knows the bell.</span>
          </h1>
          <p
            data-reveal
            className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg"
          >
            A Uniswap v4 hook layer for pools that include Robinhood Stock Tokens. Session-specific fees and flow budgets apply, while swaps stop whenever the onchain Chainlink round is 120 seconds old or older.
          </p>
          <div data-reveal className="mt-8 flex flex-wrap items-center gap-3.5">
            <ButtonLink href="/pools" size="lg">
              Explore pools <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="#clock" variant="outline" size="lg">
              Watch the Bell Clock
            </ButtonLink>
          </div>
          <div data-reveal className="mt-6 flex items-center gap-2 text-xs text-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-ion" />
            <span>Mainnet contracts deployed · No live pool · Freshness can be intermittent</span>
          </div>
        </div>
      </div>

      {/* facts strip */}
      <div
        data-hero="facts"
        className="relative z-10 border-t border-line/70 bg-bg-1/70 backdrop-blur-xl"
      >
        <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-y-4 px-4 py-5 sm:grid-cols-4 sm:px-6">
          {FACTS.map((f) => (
            <div key={f.v} className="flex flex-col">
              <dt className="order-2 text-[0.7rem] uppercase tracking-[0.16em] text-dim">{f.v}</dt>
              <dd className="num order-1 text-2xl font-semibold text-ink sm:text-3xl">{f.k}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
