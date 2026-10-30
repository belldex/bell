'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Eyebrow } from '@/components/ui/primitives';
import { registerGsap, useReducedMotion } from '@/lib/motion';
import { BASE_FEE_UNITS, bellFeeUnits, effectiveFeeUnits, feePercent, PHASE_META } from '@/lib/policy';

const W = 760;
const H = 360;
const M = { l: 64, r: 24, t: 24, b: 48 };
const T_MAX = 360;
const Y_MAX = 10000;

const x = (t: number) => M.l + (t / T_MAX) * (W - M.l - M.r);
const y = (u: number) => M.t + (1 - u / Y_MAX) * (H - M.t - M.b);

const CURVES = [
  { key: 'REGULAR', base: BASE_FEE_UNITS.REGULAR, label: 'Regular open' },
  { key: 'PRE', base: BASE_FEE_UNITS.PRE, label: 'Extended' },
  { key: 'OVERNIGHT', base: BASE_FEE_UNITS.OVERNIGHT, label: 'Overnight reopen' },
] as const;

const path = (base: number) => `M ${x(0)} ${y(10000)} L ${x(300)} ${y(base)} L ${x(T_MAX)} ${y(base)}`;

const CHIPS = [
  { k: 'session', label: 'Session fee', active: true },
  { k: 'bell', label: 'Bell decay', active: true },
  { k: 'corporate', label: 'Corporate 1.00% · 30 min', active: false },
  { k: 'repricing', label: 'Repricing ≥ 1.00%', active: false },
];

export function FeeDecay() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [p, setP] = useState(0.45);

  useLayoutEffect(() => {
    if (reduced || !root.current) return;
    const { gsap, ScrollTrigger } = registerGsap();
    const ctx = gsap.context(() => {
      const s = { p: 0.1 };
      gsap.to(s, {
        p: 1,
        ease: 'power1.inOut',
        onUpdate: () => setP(s.p),
        scrollTrigger: {
          trigger: root.current,
          start: 'top 75%',
          end: 'bottom 25%',
          scrub: 1.2,
        },
      });
      ScrollTrigger.refresh();
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  const t = p * T_MAX;
  const live = CURVES.map((c) => ({ ...c, fee: effectiveFeeUnits({ base: c.base, bell: bellFeeUnits(c.base, t) }) }));
  const regular = live[0];
  const clipW = x(t) - 0;

  return (
    <section
      ref={root}
      id="bell-fee"
      aria-labelledby="fee-title"
      className="relative flex min-h-[85vh] items-center overflow-hidden bg-bg-0 py-20 lg:py-24"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_80%_55%,color-mix(in_oklab,var(--color-ion)_10%,transparent),transparent_70%)]"
        aria-hidden="true"
      />
      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
        <div>
          <Eyebrow>The bell fee</Eyebrow>
          <h2
            id="fee-title"
            className="mt-4 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl lg:text-6xl"
          >
            Open at the top.
            <span className="text-ion-gradient block">Earn your way down.</span>
          </h2>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
            After every open and every recovery, the pool starts at 1.00% and decays in a straight line to the session’s base fee over 300 seconds. Repeated or duplicate reports never restart the clock.
          </p>

          <div className="glass num mt-6 max-w-lg rounded-2xl border border-line bg-surface/60 p-4 text-[0.85rem] leading-relaxed text-ion-soft">
            bellFee = base + ⌈(10 000 − base) × max(0, 300 − t) / 300⌉
          </div>

          <ul className="mt-5 flex max-w-lg flex-wrap gap-2" aria-label="Components of the effective fee">
            {CHIPS.map((c) => (
              <li
                key={c.k}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  c.active ? 'border-ion/40 bg-ion/10 text-ion' : 'border-line text-dim'
                }`}
              >
                {c.label}
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-lg text-xs text-dim">
            effective LP fee = max(session, bell, corporate, repricing). No BELL token fee, no hook fee taken from LPs.
          </p>
        </div>

        <div className="glass relative rounded-3xl border border-line bg-surface/70 p-5 sm:p-7 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.18em] text-dim">
                Regular open · t = <span className="num font-semibold text-ink">{Math.round(Math.min(t, 300))} s</span>
              </p>
              <p
                className="num mt-1 text-5xl font-bold text-ink sm:text-6xl"
                style={{ color: regular.fee > 500 ? 'var(--color-ion)' : 'var(--color-ink)' }}
                aria-live="off"
              >
                {feePercent(regular.fee)}
              </p>
            </div>
            <div className="text-right">
              <span className="num text-sm font-medium text-dim">
                {regular.fee.toLocaleString('en-US')} <span className="text-dim/70">v4 units</span>
              </span>
            </div>
          </div>

          {/* Interactive scrubber */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-dim mb-1.5">
              <span>Drag to simulate elapsed time:</span>
              <span className="num text-ion font-medium">{Math.round(t)} s</span>
            </div>
            <input
              type="range"
              min={0}
              max={360}
              value={Math.round(t)}
              onChange={(e) => setP(Number(e.target.value) / T_MAX)}
              className="w-full accent-ion cursor-pointer h-1.5 bg-line rounded-lg"
              aria-label="Simulate elapsed seconds since bell"
            />
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Bell fee decay curves from 1.00% to each session base fee over 300 seconds.">
            <defs>
              <clipPath id="reveal"><rect x="0" y="0" width={clipW} height={H} /></clipPath>
              <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#C7444F" stopOpacity="0.35" />
                <stop offset="1" stopColor="#C7444F" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 2500, 5000, 7500, 10000].map((u) => (
              <g key={u}>
                <line x1={M.l} x2={W - M.r} y1={y(u)} y2={y(u)} stroke="var(--color-line)" strokeDasharray="2 6" />
                <text x={M.l - 10} y={y(u)} textAnchor="end" dominantBaseline="middle" className="num" fontSize="11" fill="var(--color-dim)">{(u / 10000 * 100).toFixed(u === 0 ? 0 : 2)}%</text>
              </g>
            ))}
            {[0, 60, 120, 180, 240, 300, 360].map((s) => (
              <text key={s} x={x(s)} y={H - 22} textAnchor="middle" className="num" fontSize="11" fill="var(--color-dim)">{s}s</text>
            ))}
            <line x1={x(300)} x2={x(300)} y1={M.t} y2={H - M.b} stroke="var(--color-line-strong)" strokeDasharray="3 5" />

            {/* ghost curves */}
            {CURVES.map((c) => <path key={c.key} d={path(c.base)} fill="none" stroke="var(--color-line-strong)" strokeWidth="1.5" />)}
            {/* revealed */}
            <g clipPath="url(#reveal)">
              <path d={`${path(500)} L ${x(T_MAX)} ${y(0)} L ${x(0)} ${y(0)} Z`} fill="url(#area)" />
              {CURVES.map((c, i) => (
                <path key={c.key} d={path(c.base)} fill="none" stroke={i === 0 ? 'var(--color-ion)' : PHASE_META[c.key].css} strokeWidth={i === 0 ? 3 : 2} opacity={i === 0 ? 1 : 0.75} strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </g>
            {live.map((c, i) => (
              <g key={c.key}>
                <circle cx={x(t)} cy={y(c.fee)} r={i === 0 ? 7 : 5} fill="var(--color-bg-0)" stroke={i === 0 ? 'var(--color-ion)' : PHASE_META[c.key].css} strokeWidth="2.5" />
              </g>
            ))}
          </svg>

          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {live.map((c, i) => (
              <li key={c.key} className="rounded-xl border border-line bg-bg-1/60 px-3 py-2.5">
                <p className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.12em] text-dim">
                  <span className="h-2 w-2 rounded-full" style={{ background: i === 0 ? 'var(--color-ion)' : PHASE_META[c.key].css }} aria-hidden="true" />
                  {c.label}
                </p>
                <p className="num mt-1 text-lg text-ink">{feePercent(c.fee)}<span className="ml-2 text-xs text-dim">→ {feePercent(c.base)}</span></p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
