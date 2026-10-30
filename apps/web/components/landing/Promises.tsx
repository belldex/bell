import { Check, X } from 'lucide-react';
import { Eyebrow } from '@/components/ui/primitives';
import { Reveal } from './motion-kit';

const YES = [
  'Swap requests accepted any time, executed only inside data, band and budget limits',
  'Fee and flow limits that change with the session, shown before you sign',
  'A closure budget that never refills during an episode',
  'Immutable per-pool hook instances; no proxy, no admin price override',
  'Noncustodial LP positions and an exit path that no BELL guard can block',
  'Unexpected closures halt the pool instead of becoming a weekend',
];
const NO = [
  '“24/7” does not mean unlimited liquidity, a live stock oracle, or no reverts',
  'Caps are rate limits, not insurance for stock value or a USD loss guarantee',
  'No profit or APR promise; repricing can create marked LP loss',
  'SESSION_ONLY pools have no independent price for the counterasset',
  'Issuer, token, verifier, chain and multisig risk remain external dependencies',
  'Sample pools on this page are previews, not live pool state. Contracts are deployed on testnet for rehearsal; no pool exists yet and production swaps are not enabled.',
];

export function Promises() {
  return (
    <section aria-labelledby="promise-title" className="relative bg-bg-0 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="max-w-3xl">
          <Eyebrow>Plain language</Eyebrow>
          <h2
            id="promise-title"
            className="mt-4 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl lg:text-6xl"
          >
            What it does. <span className="text-ion-gradient">What it doesn’t.</span>
          </h2>
        </Reveal>

        <Reveal className="mt-12 grid gap-6 lg:grid-cols-2" stagger={0.12}>
          <div data-stagger className="glass rounded-3xl border border-line bg-surface/70 p-7 sm:p-9">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-ion">BELL does</h3>
            <ul className="mt-6 space-y-4">
              {YES.map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm leading-relaxed text-ink/90">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ion/15 text-ion">
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div data-stagger className="glass rounded-3xl border border-line bg-surface/70 p-7 sm:p-9">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">BELL does not</h3>
            <ul className="mt-6 space-y-4">
              {NO.map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm leading-relaxed text-muted">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/[0.06] text-dim">
                    <X className="h-3 w-3" aria-hidden="true" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
