'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Clock3, Gauge, Layers3, Radio } from 'lucide-react';
import { Eyebrow } from '@/components/ui/primitives';
import { registerGsap, useReducedMotion } from '@/lib/motion';
import { clamp, lerp } from '@/lib/format';
import {
  BASE_FEE_UNITS,
  PHASE_META,
  bellFeeUnits,
  bellElapsedSeconds,
  effectiveFeeUnits,
  feePercent,
  formatWeekMinute,
  phaseAtWeekMinute,
  sessionDivisors,
  wm,
  WEEK_MINUTES,
  type MarketPhase,
} from '@/lib/policy';

/** scroll progress → minutes since Monday 00:00 ET (piecewise linear, stretched around the bell). */
const KEYS: Array<[number, number]> = [
  [0.0, wm(0, 3, 0)],
  [0.1, wm(0, 4, 5)],
  [0.22, wm(0, 9, 25)],
  [0.26, wm(0, 9, 30)],
  [0.36, wm(0, 9, 36)],
  [0.48, wm(0, 16, 5)],
  [0.58, wm(0, 20, 30)],
  [0.7, wm(4, 16, 55)],
  [0.74, wm(4, 17, 5)],
  [0.88, wm(6, 19, 55)],
  [0.94, wm(6, 20, 0)],
  [1.0, wm(6, 20, 10)],
];

function weekMinuteAt(p: number): number {
  for (let i = 1; i < KEYS.length; i++) {
    const [p1, m1] = KEYS[i];
    if (p <= p1) {
      const [p0, m0] = KEYS[i - 1];
      return lerp(m0, m1, (p - p0) / (p1 - p0 || 1));
    }
  }
  return KEYS[KEYS.length - 1][1];
}

const CAPTIONS: Array<[number, string]> = [
  [0.0, 'Overnight. Thin books, so the pool charges 0.50% and allows a quarter of its normal trade size.'],
  [0.1, 'Pre-market opens. The onchain Chainlink feed must be fresh; fee 0.30%, half-size limits.'],
  [0.22, 'Nine-thirty approaches. The pool is about to reopen into the regular session.'],
  [0.26, 'The bell. Fee jumps to 1.00% and decays in a straight line over 300 seconds.'],
  [0.36, 'Regular session. 0.05% and the full per-trade and rolling limits.'],
  [0.48, 'Post-market. 0.30%, half-size limits, fresh onchain Chainlink feed required.'],
  [0.58, 'Overnight again. 0.50%, back to a quarter of the limits and never back to 0.05%.'],
  [0.7, 'Friday 17:00 ET: BELL closes when the Chainlink feed window ends. Tuesday to Thursday repeat the same day.'],
  [0.74, 'Weekend. Closed state: 1.00%, one-fifth trade size and one fixed budget for the whole episode.'],
  [0.88, 'Nothing here invents a stock price. Trading is bounded around the last valid close anchor.'],
  [0.94, 'Sunday 20:00 ET. A fresh bell, but the episode only ends after verified recovery.'],
];

const REQUIREMENT: Record<Exclude<MarketPhase, 'UNKNOWN'>, string> = {
  REGULAR: 'Onchain Chainlink round fresh · < 120 s old',
  PRE: 'Onchain Chainlink round fresh · < 120 s old',
  POST: 'Onchain Chainlink round fresh · < 120 s old',
  OVERNIGHT: 'Onchain Chainlink round fresh · < 120 s old',
  CLOSED: 'Committed closure context · close anchor ≤ 96 h old · episode budget',
};

const TICK_HOURS = Array.from({ length: 24 }, (_, i) => i);
const CX = 300;
const CY = 300;

const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)] as const;
};
function arc(h0: number, h1: number, r: number) {
  const a0 = h0 * 15;
  const a1 = h1 * 15;
  const [x0, y0] = polar(a0, r);
  const [x1, y1] = polar(a1, r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const SEGMENTS: Array<{ phase: Exclude<MarketPhase, 'UNKNOWN' | 'CLOSED'>; from: number; to: number }> = [
  { phase: 'OVERNIGHT', from: 20, to: 24 },
  { phase: 'OVERNIGHT', from: 0, to: 4 },
  { phase: 'PRE', from: 4, to: 9.5 },
  { phase: 'REGULAR', from: 9.5, to: 16 },
  { phase: 'POST', from: 16, to: 20 },
];

const SESSION_PRESETS = [
  { label: 'Overnight', progress: 0.0, time: '02:00 ET' },
  { label: 'Pre-Market', progress: 0.12, time: '06:00 ET' },
  { label: 'Opening Bell', progress: 0.26, time: '09:30 ET' },
  { label: 'Regular', progress: 0.38, time: '13:00 ET' },
  { label: 'Post-Market', progress: 0.50, time: '17:00 ET' },
  { label: 'Weekend Freeze', progress: 0.78, time: 'Sat Closed' },
];

export function BellClock() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(0.38);

  useLayoutEffect(() => {
    if (reduced || !root.current) return;
    const { gsap, ScrollTrigger } = registerGsap();
    const ctx = gsap.context(() => {
      const state = { p: 0.26 };
      gsap.to(state, {
        p: 1,
        ease: 'none',
        onUpdate: () => setProgress(state.p),
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: '+=160%',
          scrub: 0.8,
          pin: true,
          anticipatePin: 1,
        },
      });
      gsap.to('[data-clock="orb"]', {
        rotate: 180,
        ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top top', end: '+=160%', scrub: 1 },
      });
      ScrollTrigger.refresh();
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  const minute = weekMinuteAt(progress);
  const view = useMemo(() => {
    const phase = phaseAtWeekMinute(minute);
    const elapsed = bellElapsedSeconds(minute);
    const base = BASE_FEE_UNITS[phase];
    const bell = elapsed === null ? undefined : bellFeeUnits(base, elapsed);
    const fee = effectiveFeeUnits({ base, bell });
    const div = sessionDivisors(phase)!;
    const tod = ((minute % 1440) / 60) % 24;
    const caption = [...CAPTIONS].reverse().find(([p]) => progress >= p)?.[1] ?? CAPTIONS[0][1];
    return { phase, elapsed, base, fee, div, tod, caption, label: formatWeekMinute(minute) };
  }, [minute, progress]);

  const meta = PHASE_META[view.phase];
  const weekend = view.phase === 'CLOSED';
  const [hx, hy] = polar(view.tod * 15, 214);
  const [hx2, hy2] = polar(view.tod * 15, 120);
  const weekPct = clamp((minute / WEEK_MINUTES) * 100, 0, 100);
  const bellActive = view.elapsed !== null;

  return (
    <section
      ref={root}
      id="clock"
      aria-labelledby="clock-title"
      className="relative flex min-h-[90vh] items-center overflow-hidden bg-bg-0 py-20 lg:py-24"
    >
      <img
        data-clock="orb"
        src="/assets/session-orb.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute right-[-10%] top-1/2 w-[min(100vh,800px)] -translate-y-1/2 opacity-35 mix-blend-screen"
      />
      <div
        className="pointer-events-none absolute inset-0 transition-colors duration-700"
        style={{
          background: `radial-gradient(60% 50% at 72% 50%, color-mix(in oklab, ${meta.css} 14%, transparent), transparent 70%)`,
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
        {/* Copy + readouts */}
        <div className="order-2 lg:order-1">
          <Eyebrow>The Bell Clock</Eyebrow>
          <h2
            id="clock-title"
            className="mt-4 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl lg:text-6xl"
          >
            One week, five states,
            <span className="text-ion-gradient block">one rule set per state.</span>
          </h2>
          <p
            className="mt-4 min-h-[4rem] max-w-xl text-base leading-relaxed text-muted sm:text-lg"
            aria-live="polite"
          >
            {view.caption}
          </p>

          {/* Quick jump session selectors */}
          <div className="mt-5 flex flex-wrap gap-2">
            {SESSION_PRESETS.map((preset) => {
              const active = Math.abs(progress - preset.progress) < 0.08;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setProgress(preset.progress)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                    active
                      ? 'border-ion bg-ion/15 text-ion shadow-[0_0_15px_-4px_var(--color-ion)]'
                      : 'border-line bg-surface/60 text-muted hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {preset.label} <span className="num ml-1 opacity-60">({preset.time})</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
            <Readout icon={Radio} label="State" value={meta.label} color={meta.css} />
            <Readout icon={Gauge} label="LP fee" value={feePercent(view.fee)} color={bellActive ? 'var(--color-ion)' : undefined} mono />
            <Readout icon={Layers3} label="Per trade" value={view.div[0] === 1 ? 'T' : `T/${view.div[0]}`} mono />
            <Readout icon={Clock3} label="Rolling" value={view.div[1] === 1 ? 'W' : `W/${view.div[1]}`} mono />
          </div>

          <div className="glass mt-4 max-w-xl rounded-2xl border border-line bg-surface/60 px-4 py-3 text-sm text-muted">
            <span className="text-dim">Requires · </span>
            {REQUIREMENT[view.phase as Exclude<MarketPhase, 'UNKNOWN'>]}
          </div>
          {bellActive && (
            <p className="num mt-3 text-sm text-ion" role="status">
              Bell fee decay · {Math.round(view.elapsed ?? 0)} s / 300 s · {feePercent(view.fee)} → {feePercent(view.base)}
            </p>
          )}
        </div>

        {/* Dial */}
        <div className="order-1 mx-auto w-full max-w-[min(78vw,52vh,520px)] lg:order-2 lg:max-w-[min(44vw,70vh,600px)]">
          <svg viewBox="0 0 600 600" role="img" aria-label={`Trading-day dial. ${view.label.day} ${view.label.time} ET, ${meta.label} session, LP fee ${feePercent(view.fee)}.`} className="h-auto w-full overflow-visible">
            <defs>
              <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="6" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <circle cx={CX} cy={CY} r="276" fill="none" stroke="var(--color-line)" strokeWidth="1" />
            <circle cx={CX} cy={CY} r="168" fill="rgb(23 23 23 / 0.7)" stroke="var(--color-line)" />
            {SEGMENTS.map((s) => (
              <path key={`${s.phase}-${s.from}`} d={arc(s.from, s.to, 232)} fill="none" strokeWidth="30" strokeLinecap="butt"
                stroke={PHASE_META[s.phase].css} opacity={!weekend && view.phase === s.phase ? 1 : 0.28}
                filter={!weekend && view.phase === s.phase ? 'url(#glow)' : undefined} style={{ transition: 'opacity .4s' }} />
            ))}
            {weekend && <circle cx={CX} cy={CY} r="232" fill="none" stroke="var(--color-phase-closed)" strokeWidth="30" strokeDasharray="3 9" opacity="0.9" filter="url(#glow)" />}
            {TICK_HOURS.map((h) => {
              const [x0, y0] = polar(h * 15, 256);
              const [x1, y1] = polar(h * 15, h % 6 === 0 ? 244 : 250);
              return <line key={h} x1={x0} y1={y0} x2={x1} y2={y1} stroke={h % 6 === 0 ? 'var(--color-muted)' : 'var(--color-dim)'} strokeWidth={h % 6 === 0 ? 2 : 1} />;
            })}
            {[0, 6, 12, 18].map((h) => {
              const [x, y] = polar(h * 15, 288);
              return <text key={h} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="num" fill="var(--color-dim)" fontSize="13">{String(h).padStart(2, '0')}</text>;
            })}
            {/* hand */}
            <g style={{ transition: 'none' }}>
              <line x1={hx2} y1={hy2} x2={hx} y2={hy} stroke={meta.css} strokeWidth="3" strokeLinecap="round" filter="url(#glow)" />
              <circle cx={hx} cy={hy} r="9" fill="var(--color-bg-0)" stroke={meta.css} strokeWidth="3" />
            </g>
            {bellActive && <circle cx={hx} cy={hy} r="9" fill="none" stroke="var(--color-ion)" className="animate-pulse-ring" style={{ transformOrigin: `${hx}px ${hy}px` }} />}
            {/* center readout */}
            <text x={CX} y={CY - 52} textAnchor="middle" className="num" fill="var(--color-dim)" fontSize="15" letterSpacing="3">{view.label.day.toUpperCase()} · ET</text>
            <text x={CX} y={CY + 8} textAnchor="middle" className="num" fill="var(--color-ink)" fontSize="64" fontWeight="500">{view.label.time}</text>
            <text x={CX} y={CY + 52} textAnchor="middle" fill={meta.css} fontSize="17" letterSpacing="4" style={{ textTransform: 'uppercase' }}>{meta.label}</text>
            <text x={CX} y={CY + 84} textAnchor="middle" className="num" fill="var(--color-muted)" fontSize="19">{feePercent(view.fee)} fee</text>
          </svg>

          {/* week strip */}
          <div className="mt-5" aria-hidden="true">
            <div className="relative h-2 overflow-hidden rounded-full bg-line">
              <WeekBar />
              <div className="absolute inset-y-[-4px] w-[3px] -translate-x-1/2 rounded bg-white shadow-[0_0_14px_2px_rgb(255_255_255/0.6)]" style={{ left: `${weekPct}%` }} />
            </div>
            <div className="num mt-2 flex justify-between text-[0.68rem] uppercase tracking-[0.18em] text-dim">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WeekBar() {
  const segs = useMemo(() => {
    const out: Array<{ left: number; width: number; phase: Exclude<MarketPhase, 'UNKNOWN'> }> = [];
    let start = 0;
    let cur = phaseAtWeekMinute(0);
    for (let m = 1; m <= WEEK_MINUTES; m += 10) {
      const p = m === WEEK_MINUTES ? ('__end' as never) : phaseAtWeekMinute(m);
      if (p !== cur) {
        out.push({ left: (start / WEEK_MINUTES) * 100, width: ((m - start) / WEEK_MINUTES) * 100, phase: cur });
        start = m;
        cur = p;
      }
    }
    return out;
  }, []);
  return (
    <>
      {segs.map((s, i) => (
        <span key={i} className="absolute inset-y-0" style={{ left: `${s.left}%`, width: `${s.width}%`, background: PHASE_META[s.phase].css, opacity: s.phase === 'CLOSED' ? 0.35 : 0.8 }} />
      ))}
    </>
  );
}

function Readout({ icon: Icon, label, value, color, mono }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="glass rounded-2xl px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[0.66rem] uppercase tracking-[0.16em] text-dim">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className={`mt-1.5 text-xl leading-none ${mono ? 'num' : ''}`} style={{ color: color ?? 'var(--color-ink)' }}>
        {value}
      </div>
    </div>
  );
}
