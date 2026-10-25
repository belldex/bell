import { Check, Minus, ShieldCheck, Timer } from 'lucide-react';
import { Eyebrow } from '@/components/ui/primitives';
import { Parallax, Reveal } from './motion-kit';

const GUARDED = [
  'Independent approved price source on both assets',
  'Reference band ±2% live · ±5% around a frozen close',
  'Corrective repricing that can only move toward the reference',
  'Session fee, rolling budget and closure budget',
];
const SESSION = [
  'Stock-side identity and session data verified',
  'Raw-unit rolling and closure budgets on both currencies',
  'Corporate-action guard on the stock token',
  'Any ordinary ERC-20 counterasset, e.g. MEME / NVDA',
];

export function Classes() {
  return (
    <section id="classes" aria-labelledby="classes-title" className="relative overflow-hidden bg-bg-0 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="max-w-3xl">
          <Eyebrow>Two classes · locked at deployment</Eyebrow>
          <h2
            id="classes-title"
            className="mt-4 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl lg:text-6xl"
          >
            Say exactly what <span className="text-ion-gradient">is protected.</span>
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            The class is chosen once, shown before every signature, and can never be promoted by an admin toggle. A pool is only as protected as its class says.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 lg:grid-cols-2 lg:gap-8">
          <Parallax speed={4}>
            <Reveal className="h-full">
              <article className="glass glass-hover relative h-full overflow-hidden rounded-3xl border border-line bg-surface/70 p-7 sm:p-9">
                <img src="/assets/emblem-guarded.jpg" alt="" aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 w-80 opacity-75 mix-blend-screen" />
                <div className="relative">
                  <span className="inline-flex items-center gap-2 rounded-full border border-ion/40 bg-ion/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-ion">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Price guarded
                  </span>
                  <h3 className="mt-5 font-display text-2xl font-bold text-ink sm:text-3xl">USDG/AAPL · WETH/TSLA · NVDA/AMZN</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">Both assets have an independent, approved price reference. The pool trades only inside a reference band.</p>
                  <ul className="mt-6 space-y-3">
                    {GUARDED.map((t) => (
                      <li key={t} className="flex items-start gap-3 text-sm text-ink/90">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-ion" aria-hidden="true" /> {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            </Reveal>
          </Parallax>

          <Parallax speed={-4}>
            <Reveal className="h-full">
              <article className="glass glass-hover relative h-full overflow-hidden rounded-3xl border border-line bg-surface/70 p-7 sm:p-9">
                <img src="/assets/emblem-session.jpg" alt="" aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 w-80 opacity-75 mix-blend-screen" />
                <div className="relative">
                  <span className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-white/[0.04] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                    <Timer className="h-4 w-4" aria-hidden="true" /> Session only
                  </span>
                  <h3 className="mt-5 font-display text-2xl font-bold text-ink sm:text-3xl">MEME/NVDA · any ERC-20 / stock</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">At least one verified Stock Token. The counterasset is an ordinary token with no independent price.</p>
                  <ul className="mt-6 space-y-3">
                    {SESSION.map((t) => (
                      <li key={t} className="flex items-start gap-3 text-sm text-ink/90">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" /> {t}
                      </li>
                    ))}
                    <li className="flex items-start gap-3 text-sm text-warn">
                      <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> No fair-price claim, no USD NAV for the counterasset
                    </li>
                  </ul>
                  <p className="mt-6 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-xs leading-relaxed font-medium text-warn">
                    Session controls only; no independent price protection for the counterasset.
                  </p>
                </div>
              </article>
            </Reveal>
          </Parallax>
        </div>
      </div>
    </section>
  );
}
