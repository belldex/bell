"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { StatusBadge } from "./status-badge";

/* The /v4 hero is its own thing: a poppy field and one bell drawn as a stack of horizontal bars. When the bell
   is struck every bar shudders a little out of line, one after another from the top, and then settles, while
   lines of sound leave on both sides. The bell rises a few percent as the page scrolls and the four lines of the
   claim follow the scroll, so each one lands in turn. All motion is transform and opacity only. */

const BEATS = [
  { role: "The stadium", line: "Robinhood Chain has the stock tokens." },
  { role: "The engine", line: "Uniswap has the engine." },
  { role: "The scoreboard", line: "Hyperliquid has the 24/7 price." },
  { role: "The bell", line: "BELL holds the bell." },
] as const;

const TICKER = ["Session-aware fees", "Flow caps", "Fail-closed swaps", "Unblockable exits", "One price at the open", "Immutable hooks", "Zero proxies"];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* the bell silhouette: dome, waist, flared lip, in a 400 x 480 box */
const BODY = "M200 52C152 52 122 98 120 170C118 244 102 300 62 348L62 374L338 374L338 348C298 300 282 244 280 170C278 98 248 52 200 52Z";
const BARS = Array.from({ length: 40 }, (_, i) => i);
const WAVES = [150, 190, 230, 270, 310];

export function BellBars() {
  const id = `bb${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg className="v4-bell" viewBox="0 0 400 480" role="img" aria-label="A bell being struck">
      <defs>
        <clipPath id={id}><path d={BODY} /><rect x="46" y="372" width="308" height="24" /></clipPath>
      </defs>
      <g aria-hidden="true">
        {WAVES.map((y, i) => (
          <g key={y}>
            <rect className="v4-wave v4-wave--l" x={32 - (i % 2) * 16} y={y} width={54 + (i % 2) * 16} height="3" style={{ ["--d" as string]: `${i * 90}ms` }} />
            <rect className="v4-wave v4-wave--r" x="314" y={y} width={54 + (i % 2) * 16} height="3" style={{ ["--d" as string]: `${i * 90}ms` }} />
          </g>
        ))}
      </g>
      <g className="v4-bell__swing">
        <rect className="v4-bell__hanger" x="190" y="22" width="20" height="34" />
        <g clipPath={`url(#${id})`}>
          {BARS.map((i) => (
            <rect
              key={i}
              className="v4-stripe"
              x="40"
              y={44 + i * 9.1}
              width="320"
              height={i > 33 ? 6.5 : 5.2}
              style={{ ["--d" as string]: `${i * 38}ms`, ["--a" as string]: `${(i % 2 ? 1 : -1) * (7 - (i % 5))}px` }}
            />
          ))}
        </g>
        <rect className="v4-bell__lip" x="46" y="396" width="308" height="5" />
        <rect className="v4-bell__clapper" x="188" y="410" width="24" height="46" />
      </g>
    </svg>
  );
}

export function V4Hero() {
  const runRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const run = runRef.current;
    const stage = stageRef.current;
    if (!run || !stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stage.dataset.beat = "all";
      return;
    }
    let raf = 0;
    const apply = () => {
      raf = 0;
      const r = run.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      const p = travel > 0 ? clamp01(-r.top / travel) : 0;
      stage.style.setProperty("--p", p.toFixed(4));
      const beat = String(Math.min(3, Math.floor(p * 4)));
      if (stage.dataset.beat !== beat) stage.dataset.beat = beat;
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <section className="v4-run" id="top" ref={runRef} aria-labelledby="v4-title">
      <div className="v4-stage" ref={stageRef} data-beat="0" style={{ ["--p" as string]: 0 }}>
        <div className="v4-art"><BellBars /></div>

        <div className="v4-hero">
          <p className="v4-label">BELL v4 / LIVE + ROADMAP</p>
          <h1 className="v4-h1" id="v4-title">
            The market finally has <em>a bell.</em>
          </h1>
          <div className="v4-beats">
            {BEATS.map((b, i) => (
              <p className="v4-beat" data-i={i} key={b.role}>
                <span className="v4-role">{b.role}</span>
                <strong>{b.line}</strong>
              </p>
            ))}
          </div>
          <div className="v4-cta">
            <Link className="lp-btn lp-btn--primary" href="/swap/">Swap <StatusBadge status="LIVE" /></Link>
            <a className="lp-btn lp-btn--ghost" href="#contracts">See contracts</a>
          </div>
        </div>

        <p className="v4-hint" aria-hidden="true"><span>Scroll</span><i /></p>

        <div className="v4-ticker" aria-label="What the BELL hook enforces">
          <div className="v4-ticker__track">
            {[0, 1].map((copy) => (
              <ul key={copy} aria-hidden={copy === 1}>
                {TICKER.map((t) => <li key={t}>{t}</li>)}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* The same bell for the closing section, on the dark page. */
export function BellSculpture() {
  return (
    <div className="v4-sculpt" aria-hidden="true">
      <BellBars />
    </div>
  );
}
