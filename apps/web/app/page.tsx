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

export default function LandingPage() {
  return (
    <div className="bell-scene-root relative">
      <Scene />
      <SiteNav />

      <main className="relative z-10">
        {/* Pose 0 — hero */}
        <section data-pose="0" className="hero relative flex min-h-[100vh] flex-col justify-center px-6">
          <div className="mx-auto w-full max-w-6xl">
            <KineticTitle words={['Liquidity', 'that knows', 'the', 'bell']} />
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              BELL applies session-aware fees, bounded gross flow and planned-close controls to
              tokenized-stock pools.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/pools"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-ion px-7 font-semibold text-bg-0 transition-colors hover:bg-ion-soft"
              >
                Explore pools <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/protocol"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-line-strong px-7 text-ink transition-colors hover:border-ion/60 hover:text-ion"
              >
                Read the policy
              </Link>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs text-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-ion" aria-hidden="true" />
              Testnet rehearsal · Production swaps are not enabled · Mainnet release has not been approved
            </p>
          </div>
        </section>

        {/* Pose 1 — one immutable policy */}
        <section data-pose="1" className="flex min-h-screen items-center px-6">
          <Reveal className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              One immutable policy per pool
            </h2>
            <p className="mx-auto mt-5 max-w-2xl leading-relaxed text-muted">
              The hook address and risk profile are fixed when a pool is created. Each pool binds
              its session, reference and flow-budget policy onchain — nothing can be swapped in
              later.
            </p>
            <Link
              href="/pools"
              className="mt-8 inline-flex h-11 items-center gap-2 rounded-xl bg-ion px-6 font-semibold text-bg-0 transition-colors hover:bg-ion-soft"
            >
              Review pools <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Reveal>
        </section>

        {/* Pose 2 — every swap follows policy */}
        <section data-pose="2" className="flex min-h-screen items-center px-6">
          <Reveal className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              Every swap follows the policy
            </h2>
            <p className="mx-auto mt-5 max-w-2xl leading-relaxed text-muted">
              Session fee, per-trade cap, rolling budget and closure episode are evaluated onchain
              before a swap proceeds. If a dependency is stale or missing, the pool halts — it does
              not guess.
            </p>
          </Reveal>
        </section>

        {/* Pose 3 — classes */}
        <section data-pose="3" className="flex min-h-screen items-center px-6">
          <Reveal className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
                Two pool classes. Explicit risk.
              </h2>
              <p className="mt-5 max-w-xl leading-relaxed text-muted">
                PRICE_GUARDED requires reviewed independent references for both assets.
                SESSION_ONLY provides session controls and raw-unit limits without independent
                counterasset price protection.
              </p>
              <Link
                href="/pools"
                className="mt-7 inline-flex items-center gap-1.5 border-b border-current pb-0.5 font-mono text-sm text-ion transition-colors hover:text-ion-soft"
              >
                Explore pool classes <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            <div className="grid gap-4">
              {[
                { name: 'PRICE_GUARDED', desc: 'Independent references for both assets, band-protected.' },
                { name: 'SESSION_ONLY', desc: 'Session controls and raw-unit limits, no counterasset price guard.' },
              ].map((c) => (
                <div key={c.name} className="glass rounded-2xl border border-line bg-surface/75 p-6">
                  <p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">{c.name}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{c.desc}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* Pose 4 — weekend / closure */}
        <section data-pose="4" className="flex min-h-screen items-center px-6">
          <Reveal className="mx-auto grid w-full max-w-6xl items-center gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
                Weekend-safe by construction
              </h2>
              <p className="mt-5 max-w-xl leading-relaxed text-muted">
                A closed stock uses a historical close anchor captured before market close. Anchor
                age, provenance and one non-refilling closure-episode budget remain binding for the
                whole weekend.
              </p>
            </div>
            <div className="glass rounded-2xl border border-line bg-surface/75 p-7 font-mono text-sm text-muted">
              <p className="text-ion">CLOSED state · binding rules</p>
              <ul className="mt-4 space-y-2.5">
                <li>· close anchor ≤ 96 h old</li>
                <li>· one episode budget, non-refilling</li>
                <li>· price band around the last valid close</li>
                <li>· recovery gate before re-open</li>
              </ul>
            </div>
          </Reveal>
        </section>

        {/* Pose 5 — attribute wall */}
        <section data-pose="5" className="wall min-h-[120vh] overflow-hidden py-24">
          <Reveal className="mx-auto max-w-3xl px-6 text-center">
            <h2 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              A policy for every pool
            </h2>
            <p className="mx-auto mt-5 max-w-2xl leading-relaxed text-muted">
              Every pool shows its class, session, effective fee, data freshness, anchor
              provenance, flow budget and halt reason before you sign.
            </p>
          </Reveal>
          <AnimatedRows rows={ROWS} />
        </section>

        {/* Pose 6 — CTA */}
        <section data-pose="6" className="flex min-h-[90vh] items-center px-6">
          <Reveal className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              Explore the pools
            </h2>
            <p className="mx-auto mt-5 max-w-2xl leading-relaxed text-muted">
              Browse the pool preview, compare immutable risk classes, or inspect the rehearsal
              interface. Current sample data is not an executable quote.
            </p>
            <Link
              href="/pools"
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-ion px-7 font-semibold text-bg-0 transition-colors hover:bg-ion-soft"
            >
              Open pools <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Reveal>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
