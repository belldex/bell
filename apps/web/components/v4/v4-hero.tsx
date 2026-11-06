"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { FORM_TIMELINE, GlyphField } from "@/components/landing/gyevo/glyph-field";
import { StatusBadge } from "./status-badge";

/* The /v4 hero is the landing hero's own engine: about thirteen hundred letters that turn from one form into
   the next as the page scrolls, and here they end as a bell. The scroll position becomes three numbers written
   on the stage (--h, --k, --q, see glyph-field.tsx) and the sculpture is a pure function of them, so it runs in
   reverse too. The four lines of the claim follow the same numbers, so each one lands with its form. */

const BEATS = [
  { role: "The stadium", line: "Robinhood Chain has the stock tokens." },
  { role: "The engine", line: "Uniswap has the engine." },
  { role: "The scoreboard", line: "Hyperliquid has the 24/7 price." },
  { role: "The bell", line: "BELL holds the bell." },
] as const;

const TICKER = ["Session-aware fees", "Flow caps", "Fail-closed swaps", "Unblockable exits", "One price at the open", "Immutable hooks", "Zero proxies"];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

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
    const f = FORM_TIMELINE;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const r = run.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      const p = travel > 0 ? clamp01(-r.top / travel) : 0;
      const h = clamp01(p / 0.3);
      const k = clamp01((p - 0.3) / 0.62);
      stage.style.setProperty("--h", h.toFixed(4));
      stage.style.setProperty("--k", k.toFixed(4));
      stage.style.setProperty("--p", p.toFixed(4));
      const s = clamp01((h - f.hFrom) / (f.hTo - f.hFrom)) + clamp01((k - f.bcFrom) / (f.bcTo - f.bcFrom)) + clamp01((k - f.cdFrom) / (f.cdTo - f.cdFrom));
      const beat = String(Math.round(s));
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
      <div
        className="v4-stage"
        ref={stageRef}
        data-lp-box
        data-live="1"
        data-beat="0"
        style={{ ["--h" as string]: 0, ["--k" as string]: 0, ["--q" as string]: 0, ["--e" as string]: 1 }}
      >
        <GlyphField final="bell" />
        <div className="lp-glow" aria-hidden="true" />
        <div className="v4-shade" aria-hidden="true" />

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

/* The same bell, resting: the closing image of the page. The numbers are fixed at the last form. */
export function BellSculpture() {
  return (
    <div
      className="v4-sculpt"
      data-lp-box
      data-live="1"
      style={{ ["--h" as string]: 1, ["--k" as string]: 1, ["--q" as string]: 0, ["--e" as string]: 1 }}
      aria-hidden="true"
    >
      <GlyphField final="bell" />
    </div>
  );
}
