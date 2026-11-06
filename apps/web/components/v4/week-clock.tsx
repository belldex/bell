"use client";

import { useEffect, useMemo, useState } from "react";
import { BASE_FEE_UNITS, PHASE_META, WEEK_MINUTES, feePercent, formatWeekMinute, nowWeekMinuteET, phaseAtWeekMinute, type MarketPhase } from "@/lib/policy";

/* The week as BELL sees it: one bar from Monday 00:00 ET, coloured by session, with a needle at now.
   Both the session and the fee are computed from the same schedule the hook enforces. */

type Phase = Exclude<MarketPhase, "UNKNOWN">;
const STEP = 15;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function WeekClock() {
  const [minute, setMinute] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setMinute(nowWeekMinuteET());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const segments = useMemo(() => {
    const out: { phase: Phase; from: number; to: number }[] = [];
    for (let m = 0; m < WEEK_MINUTES; m += STEP) {
      const phase = phaseAtWeekMinute(m);
      const last = out[out.length - 1];
      if (last && last.phase === phase) last.to = m + STEP;
      else out.push({ phase, from: m, to: m + STEP });
    }
    return out;
  }, []);

  const phase = minute === null ? null : phaseAtWeekMinute(minute);
  const now = minute === null ? null : formatWeekMinute(minute);

  return (
    <div className="v4-clock" aria-label="The current BELL session">
      <p className="v4-clock__label">Right now · America/New_York</p>
      <p className="v4-clock__phase" data-phase={phase ?? "none"} aria-live="polite">
        {phase === null ? "Reading the clock" : PHASE_META[phase].label}
      </p>
      <dl className="v4-clock__facts">
        <div><dt>Base LP fee</dt><dd>{phase === null ? "—" : feePercent(BASE_FEE_UNITS[phase])}</dd></div>
        <div><dt>Window</dt><dd>{phase === null ? "—" : PHASE_META[phase].window}</dd></div>
        <div><dt>ET</dt><dd>{now === null ? "—" : `${now.day} ${now.time}`}</dd></div>
      </dl>

      <div className="v4-clock__bar" role="img" aria-label="Sessions across the week, with the current time marked">
        {segments.map((s) => (
          <i
            key={s.from}
            style={{ width: `${((s.to - s.from) / WEEK_MINUTES) * 100}%`, background: PHASE_META[s.phase].css }}
            data-phase={s.phase}
            title={`${PHASE_META[s.phase].label} ${formatWeekMinute(s.from).day} ${formatWeekMinute(s.from).time}`}
          />
        ))}
        {minute !== null && <span className="v4-clock__needle" style={{ left: `${(minute / WEEK_MINUTES) * 100}%` }} />}
      </div>
      <ol className="v4-clock__days" aria-hidden="true">
        {DAYS.map((d) => <li key={d}>{d}</li>)}
      </ol>
      <ul className="v4-clock__key" aria-label="Session colours">
        {(["OVERNIGHT", "PRE", "REGULAR", "POST", "CLOSED"] as Phase[]).map((p) => (
          <li key={p}><i style={{ background: PHASE_META[p].css }} />{PHASE_META[p].label}</li>
        ))}
      </ul>
    </div>
  );
}
