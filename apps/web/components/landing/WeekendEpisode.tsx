'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Anchor, Ban, ShieldAlert, Snowflake, TimerReset } from 'lucide-react';
import { Eyebrow } from '@/components/ui/primitives';
import { registerGsap, useReducedMotion } from '@/lib/motion';
import { clamp } from '@/lib/format';

const STEPS = [
  { at: 0.0, icon: Anchor, title: 'Capture the close', body: 'In the last five minutes of a supported session anyone can call captureClose. The last valid multiplier-adjusted reference is stored — labelled historical, never “live”.' },
  { at: 0.25, icon: Snowflake, title: 'Freeze the stock side', body: 'While the stock is closed its USD reference stays on the anchor. The counterasset keeps its live price: WETH/TSLA = frozen TSLA/USD ÷ live WETH/USD. Band widens from ±2% to ±5%.' },
  { at: 0.5, icon: Ban, title: 'One budget for the whole episode', body: 'Every swap counts gross, in both directions. The closure budget C never refills at midnight, on Monday, on pause/resume or when LPs add capital. When it is spent, swaps stop.' },
  { at: 0.85, icon: TimerReset, title: 'Reopen has to be proven', body: 'A single “open” report is not enough. All stocks must be healthy and a second fresh checkpoint ≥ 60 s later must arrive before the episode ends and a new bell begins.' },
] as const;

const W = 720;
const H = 300;
const PAD = 18;
const CLOSE_X = 0.25;
const X = (u: number) => PAD + u * (W - PAD * 2);
const Y = (v: number) => H - 40 - v * (H - 90);

/** deterministic pseudo-random in [-1,1] */
const noise = (i: number) => Math.sin(i * 12.9898) * Math.cos(i * 4.1414) * 0.9 + Math.sin(i * 1.7) * 0.1;
const live = (u: number) => 0.52 + 0.1 * Math.sin(u * 22) + 0.035 * noise(Math.floor(u * 160));

const ANCHOR = live(CLOSE_X);
const BAND = 0.09;

/** simulated swaps after close: [progress, share of budget C] */
const SWAPS: Array<[number, number]> = [
  [0.52, 0.06], [0.56, 0.1], [0.6, 0.07], [0.64, 0.12], [0.69, 0.09], [0.72, 0.14], [0.76, 0.1], [0.79, 0.13], [0.82, 0.19],
];

export function WeekendEpisode() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [p, setP] = useState(0.62);

  useLayoutEffect(() => {
    if (reduced || !root.current) return;
    const { gsap, ScrollTrigger } = registerGsap();
    const ctx = gsap.context(() => {
      const s = { p: 0.1 };
      gsap.to(s, {
        p: 1,
        ease: 'none',
        onUpdate: () => setP(s.p),
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: '+=150%',
          scrub: 0.8,
          pin: true,
          anticipatePin: 1,
        },
      });
      gsap.fromTo(
        '[data-wk="bg"]',
        { yPercent: -4, scale: 1.02 },
        { yPercent: 6, scale: 1.1, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top top', end: '+=150%', scrub: 1 } }
      );
      ScrollTrigger.refresh();
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  const stepIndex = STEPS.reduce((acc, s, i) => (p >= s.at ? i : acc), 0);
  const used = SWAPS.filter(([at]) => p >= at).reduce((a, [, s]) => a + s, 0);
  const exhausted = used >= 0.98;
  const reopened = p >= 0.93;
  const recovery = clamp((p - 0.85) / 0.08, 0, 1); // 0..1 → 0..60s
  const budget = reopened ? 0 : used;

  const liveLine = useMemo(() => {
    const pts: string[] = [];
    for (let u = 0; u <= CLOSE_X + 0.0001; u += 0.004) pts.push(`${pts.length ? 'L' : 'M'} ${X(u).toFixed(1)} ${Y(live(u)).toFixed(1)}`);
    return pts.join(' ');
  }, []);

  const frozen = p >= CLOSE_X;
  const frozenLen = clamp((p - CLOSE_X) / 0.12, 0, 1);

  return (
    <section
      ref={root}
      id="weekend"
      aria-labelledby="weekend-title"
      className="relative flex min-h-[90vh] items-center overflow-hidden bg-bg-0 py-20 lg:py-24"
    >
      <img
        data-wk="bg"
        src="/assets/weekend-anchor.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50 mix-blend-screen"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-bg-0 via-bg-0/75 to-bg-0/30" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-bg-0 to-transparent" aria-hidden="true" />

      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14">
        <div>
          <Eyebrow>Weekends &amp; holidays</Eyebrow>
          <h2
            id="weekend-title"
            className="mt-4 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl lg:text-6xl"
          >
            The stock sleeps.
            <span className="text-ion-gradient block">The pool stays bounded.</span>
          </h2>

          <ol className="mt-7 space-y-3">
            {STEPS.map((s, i) => {
              const active = i === stepIndex;
              const Icon = s.icon;
              return (
                <li
                  key={s.title}
                  onClick={() => setP(s.at + 0.02)}
                  className={`glass cursor-pointer rounded-2xl p-4 transition-all duration-300 border ${
                    active
                      ? 'border-ion/60 bg-surface/90 shadow-[0_0_35px_-15px_var(--color-ion)]'
                      : 'border-line bg-surface/50 opacity-60 hover:opacity-90 hover:border-line-strong'
                  }`}
                  aria-current={active ? 'step' : undefined}
                >
                  <div className="flex items-start gap-3.5">
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition-colors ${
                        active ? 'border-ion/50 bg-ion/10 text-ion' : 'border-line text-dim'
                      }`}
                    >
                      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-[0.98rem] font-semibold text-ink">
                        <span className="num mr-2 text-dim font-normal">0{i + 1}</span>
                        {s.title}
                      </h3>
                      <p
                        className={`overflow-hidden text-sm leading-relaxed text-muted transition-all duration-300 ${
                          active ? 'mt-1.5 max-h-40 opacity-100' : 'max-h-0 opacity-0'
                        }`}
                      >
                        {s.body}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Visual */}
        <div className="glass rounded-3xl p-4 sm:p-6">
          <div className="mb-2 flex items-center justify-between text-[0.68rem] uppercase tracking-[0.16em] text-dim">
            <span>Stock / USD reference</span>
            <span className={`flex items-center gap-1.5 ${frozen ? 'text-phase-closed' : 'text-ion'}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              {reopened ? 'Reopened' : frozen ? 'Frozen close anchor' : 'Live stream'}
            </span>
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Stock reference is live until the close, then frozen at an anchor with a widened band while swaps spend a fixed budget.">
            <defs>
              <linearGradient id="bandfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#9FB0C7" stopOpacity="0.16" />
                <stop offset="1" stopColor="#9FB0C7" stopOpacity="0.04" />
              </linearGradient>
            </defs>
            <rect x={X(CLOSE_X)} y="10" width={W - PAD - X(CLOSE_X)} height={H - 60} fill="rgb(159 176 199 / 0.04)" />
            <line x1={X(CLOSE_X)} x2={X(CLOSE_X)} y1="10" y2={H - 50} stroke="var(--color-line-strong)" strokeDasharray="3 5" />
            <text x={X(CLOSE_X) + 8} y="26" className="num" fontSize="11" fill="var(--color-dim)">FRI 16:00 ET · CLOSE</text>

            {/* live */}
            <path d={liveLine} fill="none" stroke="var(--color-ion)" strokeWidth="2.5" strokeLinejoin="round" />
            {/* band + anchor */}
            {frozen && (
              <g opacity={frozenLen}>
                <rect x={X(CLOSE_X)} y={Y(ANCHOR + BAND)} width={(W - PAD - X(CLOSE_X)) * frozenLen} height={Y(ANCHOR - BAND) - Y(ANCHOR + BAND)} fill="url(#bandfill)" stroke="rgb(159 176 199 / .35)" strokeDasharray="4 5" />
                <line x1={X(CLOSE_X)} x2={X(CLOSE_X) + (W - PAD - X(CLOSE_X)) * frozenLen} y1={Y(ANCHOR)} y2={Y(ANCHOR)} stroke="var(--color-phase-closed)" strokeWidth="2.5" strokeDasharray="1 7" strokeLinecap="round" />
              </g>
            )}
            <circle cx={X(CLOSE_X)} cy={Y(ANCHOR)} r="6" fill="var(--color-bg-0)" stroke="var(--color-phase-closed)" strokeWidth="2.5" />

            {/* swap dots */}
            {SWAPS.filter(([at]) => p >= at && !reopened).map(([at, share], i) => {
              const px = X(CLOSE_X + (1 - CLOSE_X) * ((at - 0.5) / 0.45) * 0.78);
              const py = Y(ANCHOR + Math.sin(i * 2.3) * BAND * 0.7);
              return <circle key={at} cx={px} cy={py} r={3 + share * 22} fill="var(--color-ion)" opacity="0.8" />;
            })}

            {/* reopen marker */}
            {p >= 0.85 && (
              <g>
                <line x1={X(0.93)} x2={X(0.93)} y1="10" y2={H - 50} stroke="var(--color-ion)" strokeDasharray="3 5" />
                <text x={X(0.93) - 8} y="26" textAnchor="end" className="num" fontSize="11" fill="var(--color-ion)">SUN 20:00 · REOPEN</text>
              </g>
            )}
          </svg>

          {/* budget */}
          <div className="mt-3 rounded-2xl border border-line bg-bg-1/70 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-dim">Closure budget C · gross flow</p>
              <p className="num text-sm text-ink">{(budget * 100).toFixed(0)}% <span className="text-dim">used</span></p>
            </div>
            <div className="relative mt-2.5 h-3 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(budget * 100)} aria-label="Closure budget used">
              <div className="h-full rounded-full bg-gradient-to-r from-ion-deep via-ion to-ion-soft transition-[width] duration-200" style={{ width: `${budget * 100}%` }} />
              {SWAPS.map(([at], i) => <span key={at} className="absolute inset-y-0 w-px bg-bg-0/70" style={{ left: `${SWAPS.slice(0, i + 1).reduce((a, [, s]) => a + s, 0) * 100}%` }} />)}
            </div>
            <p className="mt-3 flex items-start gap-2 text-sm text-muted" role="status">
              {exhausted && !reopened ? (
                <><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-down" aria-hidden="true" /> Budget spent — swaps stop. It does not refill until a confirmed reopen. LPs can still exit in-kind.</>
              ) : reopened ? (
                <><TimerReset className="mt-0.5 h-4 w-4 shrink-0 text-ion" aria-hidden="true" /> Recovery verified. A new episode and a fresh bell begin.</>
              ) : recovery > 0 ? (
                <><TimerReset className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" /> Waiting for a second fresh checkpoint · {Math.round(recovery * 60)} / 60 s</>
              ) : frozen ? (
                <>Spending the budget. Swap back and forth — both directions count, nothing is refunded.</>
              ) : (
                <>Trading normally against the rolling budget W.</>
              )}
            </p>
          </div>
          <p className="mt-3 text-[0.7rem] leading-relaxed text-dim">Illustration with example parameters. The cap bounds flow during a closure; it is not insurance for stock value or a USD loss guarantee.</p>
        </div>
      </div>
    </section>
  );
}
