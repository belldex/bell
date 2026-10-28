import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import SiteNav from '@/components/landing/SiteNav';
import LandingFooter from '@/components/landing/Footer';
import Scene from '@/components/landing/Scene';
import KineticTitle from '@/components/landing/KineticTitle';
import AnimatedRows from '@/components/landing/AnimatedRows';
import Reveal from '@/components/landing/Reveal';

const ROWS: string[][] = [
  ['Regular session', '*Opening bell', 'Post-market', 'Overnight', 'Fee decay'],
  ['Close anchor', 'Episode budget', '*Price band', 'Provenance', 'Recovery gate'],
  ['Session fee', 'Per-trade cap', '*Rolling budget', 'Halt reason', 'Anchor age'],
  ['PRICE_GUARDED', 'SESSION_ONLY', '*Two classes', 'No surprises', 'Onchain policy'],
  ['Weekend freeze', '*One budget', 'Fresh checkpoint', 'Recovery window', 'No phantom price'],
];

/** Reference h2: 36px/39.6px, -0.72px tracking, max-width 486px. */
const H2 = 'text-[30px] font-bold leading-[33px] tracking-[-0.6px] text-ink md:text-[36px] md:leading-[39.6px] md:tracking-[-0.72px]';
/** Reference tp: 16px/20.8px, max-width 384px. */
const TP = 'mt-10 max-w-[384px] text-base leading-[1.3] text-muted md:mx-auto';
/** Reference ulink: mono 12px with arrow after. */
const ULINK = 'inline-flex items-center gap-1 border-b border-current pb-0.5 font-mono text-xs text-ion transition-colors hover:text-ion-soft';
/** Reference btn: mono 12px, accent bg, square corners. */
const BTN = 'inline-flex h-10 items-center gap-2 bg-ion px-3 font-mono text-xs text-bg-0 transition-colors hover:bg-ion/85';
const BTN_GHOST = 'inline-flex h-10 items-center gap-2 bg-black px-3 font-mono text-xs text-ink shadow-[inset_0_0_0_1px] transition-colors hover:text-ion';

export default function LandingPage() {
  return (
    <div className="bell-scene-root relative">
      <Scene />
      <SiteNav />

      <main className="relative z-10">
        {/* Pose 0 — hero: reference layout — 100vh content pinned at 301px, 100vh runway below */}
        <section
          data-pose="0"
          className="relative flex min-h-[200vh] justify-center overflow-x-clip"
        >
          <div className="relative z-10 flex h-screen w-full max-w-[1034px] flex-col items-center px-6 pt-[301px] text-center [text-shadow:0_0_24px_rgba(0,0,0,0.55)] max-md:pt-[212px]">
            <KineticTitle words={['Liquidity', 'that knows', 'the', 'bell']} />
            <p className="mt-[49px] max-w-[620px] bg-bg-0/90 px-4 py-2.5 text-2xl leading-[1.3] text-ink ring-1 ring-line/70 backdrop-blur-sm max-md:mt-10 max-md:text-xl">
              BELL applies session-aware fees, bounded gross flow and planned-close controls to
              tokenized-stock pools.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link href="/pools" className={BTN}>
                Explore pools
              </Link>
              <Link href="/protocol" className={BTN_GHOST}>
                Read the policy
              </Link>
            </div>
            <p className="mt-[22px] flex items-center gap-3 bg-surface/80 px-3 py-1.5 font-mono text-xs text-muted backdrop-blur-xl">
              <b className="font-normal text-ion">BELL</b>
              <span>TESTNET REHEARSAL</span>
              <Link href="/pools" className="border-b border-current pb-px hover:text-ion">
                Pool preview
              </Link>
            </p>
          </div>
        </section>

        {/* Pose 1 — one immutable policy (reference tcard) */}
        <section data-pose="1" className="flex min-h-screen items-center justify-center px-6 pb-20">
          <Reveal className="flex flex-col items-center gap-10 text-center">
            <h2 className={H2}>One immutable policy per pool</h2>
            <p className={TP}>
              The hook address and risk profile are fixed when a pool is created. Each pool binds
              its session, reference and flow-budget policy onchain — nothing can be swapped in
              later.
            </p>
            <Link href="/pools" className={BTN}>
              Review pools
            </Link>
          </Reveal>
        </section>

        {/* Pose 2 — every swap follows policy (reference tcard) */}
        <section data-pose="2" className="flex min-h-screen items-center justify-center px-6 pb-20">
          <Reveal className="flex flex-col items-center gap-10 text-center">
            <h2 className={H2}>Every swap follows the policy</h2>
            <p className={TP}>
              Session fee, per-trade cap, rolling budget and closure episode are evaluated onchain
              before a swap proceeds. If a dependency is stale or missing, the pool halts — it does
              not guess.
            </p>
          </Reveal>
        </section>

        {/* Pose 3 — classes (reference side / is-left) */}
        <section data-pose="3" className="flex min-h-screen items-center justify-start px-10 md:px-16">
          <Reveal className="w-[240px]">
            <h2 className="text-xl font-bold leading-[30px] text-ink">BELL pool classes</h2>
            <p className="mt-5 font-mono text-xs leading-[18px] text-muted">
              PRICE_GUARDED requires reviewed independent references for both assets.
              SESSION_ONLY provides session controls and raw-unit limits without independent
              counterasset price protection.
            </p>
            <Link href="/pools" className={`${ULINK} mt-5`}>
              Explore pool classes
            </Link>
          </Reveal>
        </section>

        {/* Pose 4 — pool classes (reference side / is-right) */}
        <section data-pose="4" className="flex min-h-screen items-center justify-end px-10 text-right md:px-16">
          <Reveal className="w-[240px]">
            <h2 className="text-xl font-bold leading-[30px] text-ink">Pool classes</h2>
            <p className="mt-5 font-mono text-xs leading-[18px] text-muted">
              PRICE_GUARDED uses independent references for both assets. SESSION_ONLY applies
              session and raw-unit budgets without independent counterasset protection.
            </p>
            <Link href="/pools" className={`${ULINK} mt-5`}>
              Compare pool classes
            </Link>
          </Reveal>
        </section>

        {/* Pose 5 — planned close (reference side / is-left) */}
        <section data-pose="5" className="flex min-h-screen items-center justify-start px-10 md:px-16">
          <Reveal className="w-[240px]">
            <h2 className="text-xl font-bold leading-[30px] text-ink">Weekend-safe by construction</h2>
            <p className="mt-5 font-mono text-xs leading-[18px] text-muted">
              A closed stock uses a historical close anchor captured before market close. Anchor
              age, provenance and one non-refilling closure-episode budget remain binding.
            </p>
            <Link href="/protocol#closure" className={`${ULINK} mt-5`}>
              Read the closure rules
            </Link>
          </Reveal>
        </section>

        {/* Pose 6 — recovery (reference side / is-right) */}
        <section data-pose="6" className="flex min-h-screen items-center justify-end px-10 text-right md:px-16">
          <Reveal className="w-[240px]">
            <h2 className="text-xl font-bold leading-[30px] text-ink">Recovery and exit</h2>
            <p className="mt-5 font-mono text-xs leading-[18px] text-muted">
              Trading resumes only after fresh checkpoints and recovery delay. In-kind exits are
              independent from swap guards; wallet position reads are not wired yet.
            </p>
            <Link href="/positions" className={`${ULINK} mt-5`}>
              Review exit policy
            </Link>
          </Reveal>
        </section>

        {/* Pose 7 — fee cards (reference cases + cards4) */}
        <section data-pose="7" className="flex min-h-screen flex-col items-center px-6 pt-[150px]">
          <Reveal>
            <h2 className={`${H2} max-w-[560px] text-center`}>Session fees by market state</h2>
            <p className={`${TP} max-w-[560px] text-center`}>
              The configured fee follows the verified stock session. Session, corporate-action and
              repricing guards can raise it; invalid or unexpected state halts swaps.
            </p>
          </Reveal>
          <div className="mt-[60px] grid w-full grid-cols-1 gap-5 px-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { n: '01', t: 'Regular session', d: 'Base LP fee 0.05%. Healthy active market inputs required; stale or unknown inputs halt swaps.' },
              { n: '02', t: 'Opening bell fee', d: 'Decays over 300 seconds after supported market open, never undercuts the session fee.' },
              { n: '03', t: 'Corporate-action guard', d: 'A stock-token pause or multiplier change invalidates trading until post-boundary data is consistent.' },
              { n: '04', t: 'Planned-close guard', d: 'Provenance-bound close anchor; the closed band and non-refilling episode budget stay binding.' },
            ].map((c) => (
              <article
                key={c.n}
                className="flex h-[402px] flex-col rounded-xl border border-line bg-white/[0.06] p-6 backdrop-blur-2xl"
              >
                <span className="font-mono text-xs text-muted">{c.n}</span>
                <h3 className="mt-0.5 text-xl font-bold leading-[30px] text-ink">{c.t}</h3>
                <p className="mt-5 max-w-[240px] font-mono text-xs leading-[18px] text-muted">{c.d}</p>
                <Link href="/protocol" className={`${ULINK} mt-auto self-start`}>
                  Read the formula
                </Link>
              </article>
            ))}
          </div>
        </section>

        {/* Pose 8 — attribute wall (reference wall) */}
        <section data-pose="8" className="min-h-screen overflow-hidden pt-[150px]">
          <Reveal className="px-6 text-center">
            <h2 className={`${H2} mx-auto text-center`}>A policy for every pool</h2>
            <p className={`${TP} mx-auto max-w-[560px] text-center`}>
              Every pool shows its class, session, effective fee, data freshness, anchor
              provenance, flow budget and halt reason before you sign.
            </p>
          </Reveal>
          <AnimatedRows rows={ROWS} />
        </section>

        {/* Pose 8 — CTA (reference build: statement + image-card row) */}
        <section data-pose="8" className="flex min-h-screen flex-col items-center px-10 pt-[150px] max-md:px-[30px]">
          <Reveal className="flex flex-col items-center text-center">
            <h2 className={H2}>Explore BELL by design.</h2>
            <p className={`${TP} max-w-[560px]`}>
              Inspect the pool directory, read how session controls behave, and review the rehearsal
              interface before connecting a wallet. Fixture data is not an executable quote.
            </p>
            <Link href="/pools" className={`${BTN} mt-10`}>
              Open pool directory
            </Link>
          </Reveal>
          <div className="mt-[60px] grid w-full max-w-[1600px] items-start gap-5 md:grid-cols-[435fr_321fr_549fr]">
            {[
              { src: '/assets/bell-v4-valley.webp', title: 'Pool directory', href: '/pools', action: 'Browse preview pools', alt: 'BELL monochrome pixel artwork of a block valley' },
              { src: '/assets/bell-v4-canyon.webp', title: 'Session and risk policy', href: '/protocol', action: 'Read BELL policy', alt: 'BELL monochrome pixel artwork of a canyon at night' },
              { src: '/assets/bell-v4-beaver-bank.webp', title: 'Weekend controls', href: '/protocol#closure', action: 'Review close rules', alt: 'BELL monochrome pixel artwork of a block structure in a frozen landscape' },
            ].map((item, index) => (
              <article key={item.title} className={`group ${index === 1 ? 'md:mt-[150px]' : ''}`}>
                <Link href={item.href} className="block border border-line bg-surface/60 p-2 transition-colors hover:border-ion/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion">
                  <img src={item.src} alt={item.alt} loading="lazy" className={`w-full object-cover opacity-75 transition-opacity group-hover:opacity-100 ${index === 0 ? 'h-[320px] md:h-[420px]' : index === 1 ? 'h-[240px] md:h-[290px]' : 'h-[280px] md:h-[360px]'}`} />
                </Link>
                <h3 className="mt-6 text-xl font-bold leading-[30px] text-ink">{item.title}</h3>
                <Link href={item.href} className={`${ULINK} mt-5`}>
                  {item.action} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
