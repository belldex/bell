"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Activity, CalendarClock } from "lucide-react";
import { Arrow } from "./arrow";
import { setFeature, type FeatureId } from "./feature-state";
import { scrollToId } from "./smooth-scroll";

/* BELL's three operating controls as one pinned composition.

   Desktop: a tall runway holds a sticky stage; scrolling does not move the stage, it moves a single number,
   s (0 -> 2), and the scene whose index is nearest s is the one shown. Each scene has a slot of STEP of a
   screen; its anchor sits at the middle of that slot, where s is exactly its index. Between two slots the scenes cross
   over in a short window (WINDOW of a step), and nowhere else does anything move: no dead scroll.

   Phones, short windows and reduced motion: the same three scenes, stacked as ordinary blocks.

   The writer of "which feature is on screen" is this file and only this file (feature-state.ts); the bar
   reads it. The URL hash follows it, so the hash, the scene and the highlighted link are one fact. */

const WINDOW = 0.36;

type Scene = {
  id: FeatureId;
  n: string;
  name: string;
  sub: string;
  kicker: string;
  headline: string;
  text: string;
  use: string;
  chips: string[];
  href: string;
  cta: string;
};

const SCENES: Scene[] = [
  {
    id: "market-rhythm",
    n: "REG",
    name: "Market rhythm",
    sub: "Session-aware fees",
    kicker: "Uniswap v4 hook · verified market state",
    headline: "Fees and limits follow the exchange session.",
    text: "BELL verifies the exchange calendar and safety state before each swap. The session sets fees and flow limits. PRICE_GUARDED switches to a flagged AMM fallback if price inputs fail; SESSION_ONLY always uses the AMM price.",
    use: "Regular: 0.05%; pre-market and after-hours: 0.30%; overnight: 0.50% with a healthy, supported feed.",
    chips: ["Regular · 0.05%", "Extended · 0.30%", "Overnight · 0.50%"],
    href: "/pools",
    cta: "Explore pools",
  },
  {
    id: "risk-policy",
    n: "CAP",
    name: "Risk policy",
    sub: "Bounded gross flow",
    kicker: "Per-trade · rolling limits",
    headline: "Every swap faces two independent limits.",
    text: "The hook checks trade size and cumulative gross flow together. Less liquid sessions tighten both; reopening, corporate-action and repricing guards can tighten them further.",
    use: "Capacity returns only as older swaps leave the rolling window. Deposits and midnight do not reset it. SESSION_ONLY does not independently protect the counterasset price.",
    chips: ["SESSION_ONLY · AMM-only", "PRICE_GUARDED · protected or fallback"],
    href: "/protocol",
    cta: "Read risk policy",
  },
  {
    id: "planned-close",
    n: "CLOSE",
    name: "Planned close",
    sub: "Finite closure budget",
    kicker: "Scheduled closure · bounded exception",
    headline: "A planned close uses one bounded historical anchor.",
    text: "Only a committed calendar can authorize the close anchor captured while stock data was valid, and only while its context remains valid.",
    use: "The episode budget never refills before a verified reopen. A scheduled close can use a valid anchor or the explicit AMM-only fallback; unknown calendar states still block swaps.",
    chips: ["CLOSED · 1.00% max fee", "Unknown state · halt"],
    href: "/protocol",
    cta: "See closure rules",
  },
];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (x: number) => x * x * (3 - 2 * x);

/* the position of the stage among the scenes, as a function of how far into the runway the page is (u = scenes scrolled) */
function sceneAt(u: number): number {
  if (u <= 1 - WINDOW / 2) return 0;
  if (u < 1 + WINDOW / 2) return smooth(clamp01((u - (1 - WINDOW / 2)) / WINDOW));
  if (u <= 2 - WINDOW / 2) return 1;
  if (u < 2 + WINDOW / 2) return 1 + smooth(clamp01((u - (2 - WINDOW / 2)) / WINDOW));
  return 2;
}

/* ---- Three policy instruments. Illustrations, never live pool state. ---- */
function CredentialVisual() {
  return (
    <div className="fxv fxv--clock" aria-hidden="true">
      <div className="fxv-clock__top"><span>EXCHANGE SESSION MAP</span><span><i /> POLICY MODEL</span></div>
      <div className="fxv-clock__body">
        <div className="fxv-clock__dial">
          <svg className="fxv-clock__arcs" viewBox="0 0 320 320" fill="none">
            <circle className="fxv-clock__track" cx="160" cy="160" r="132" />
            <circle className="fxv-clock__arc fxv-clock__arc--day" cx="160" cy="160" r="132" />
            <circle className="fxv-clock__arc fxv-clock__arc--extended" cx="160" cy="160" r="132" />
            <circle className="fxv-clock__arc fxv-clock__arc--close" cx="160" cy="160" r="132" />
            <circle className="fxv-clock__inner" cx="160" cy="160" r="98" />
            <path className="fxv-clock__hand" d="M160 160 218 111" />
            <circle cx="160" cy="160" r="5" fill="currentColor" />
          </svg>
          <span className="fxv-clock__time">09:30<small>NEW YORK · ET</small></span>
          <span className="fxv-clock__tick fxv-clock__tick--open">OPEN</span>
          <span className="fxv-clock__tick fxv-clock__tick--extended">EXTENDED</span>
          <span className="fxv-clock__tick fxv-clock__tick--close">CLOSE</span>
        </div>
        <div className="fxv-clock__readout">
          <p className="fxv-clock__readout-label"><CalendarClock size={15} /> VERIFIED PHASE</p>
          <strong>Regular session</strong>
          <div className="fxv-clock__fee"><span>BASE LP FEE</span><b>0.05%</b></div>
          <div className="fxv-clock__feed"><span className="fxv-clock__spark"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></span><small>STOCK FEED <b>FRESH</b></small></div>
        </div>
      </div>
      <div className="fxv-clock__foot"><span>SESSION + FEED</span><i /><b>SELECT FEE & FLOW LIMITS</b><Activity size={14} /></div>
    </div>
  );
}

function ProofVisual() {
  return (
    <div className="fxv fxv--gates" aria-hidden="true">
      <div className="fxv-gates__head"><span>SWAP FLOW · POLICY SIMULATION</span><span>ATOMIC POLICY CHECK</span></div>
      <div className="fxv-gates__scene">
        <div className="fxv-gates__thresholds">
          <div className="fxv-gates__gate"><span>TRADE SIZE</span><b>Per swap</b><small>One trade at a time</small><i><u /></i></div>
          <div className="fxv-gates__gate"><span>GROSS FLOW</span><b>Rolling window</b><small>Recent swaps together</small><i><u /></i></div>
        </div>
        <div className="fxv-gates__lanes">
          <div className="fxv-gates__lane"><span>TRADE REQUEST</span><i><u /><u /><u /><u /><u /></i><b>CHECK</b></div>
          <div className="fxv-gates__lane"><span>FLOW HISTORY</span><i><u /><u /><u /><u /><u /><u /><u /><u /></i><b>WINDOW</b></div>
        </div>
        <div className="fxv-gates__meter"><span>CAPACITY</span><b><i /></b><small>RELEASES AS OLD SWAPS AGE OUT</small></div>
      </div>
      <div className="fxv-gates__result"><span><i /> POLICY CHECK</span><b><Activity size={15} /> ALLOW WITHIN BOTH LIMITS</b></div>
      <p className="fxv-gates__note">Liquidity added · new day · larger trade <strong>≠</strong> reset</p>
    </div>
  );
}

function BallotVisual() {
  return (
    <div className="fxv fxv--closure" aria-hidden="true">
      <div className="fxv-close__top"><span>PLANNED MARKET CLOSURE</span><span>ONE FINITE EPISODE</span></div>
      <div className="fxv-close__timeline">
        <div className="fxv-close__event fxv-close__event--proof"><i><CalendarClock size={17} /></i><span>EXCHANGE CALENDAR</span><b>Closure verified</b></div>
        <div className="fxv-close__track"><i /><i /><i /><i /><i /><span className="fxv-close__anchor">ANCHOR<br />CAPTURED</span></div>
        <div className="fxv-close__event fxv-close__event--halt"><i><span>×</span></i><span>REOPEN VERIFIED</span><b>Normal policy resumes</b></div>
      </div>
      <div className="fxv-close__budget">
        <div className="fxv-close__budget-title"><span>BOUNDED CLOSE BUDGET</span><b>DOES NOT REFILL</b></div>
        <div className="fxv-close__reservoir"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><span /></div>
        <div className="fxv-close__budget-foot"><span>Captured while feed was valid</span><span>Consumed across this closure</span></div>
      </div>
      <div className="fxv-close__guard"><span><i /> PROVEN CALENDAR + VALID ANCHOR</span><b>BOUNDED EXCEPTION</b><span className="fxv-close__guard-stop">UNEXPECTED OUTAGE / INVALID CONTEXT <b>→ HALT</b></span></div>
    </div>
  );
}

const VISUALS: Record<FeatureId, () => React.ReactElement> = {
  "market-rhythm": CredentialVisual,
  "risk-policy": ProofVisual,
  "planned-close": BallotVisual,
};

export function FeatureStory() {
  const [mode, setMode] = useState<"pinned" | "stacked">("pinned");
  const [active, setActive] = useState<FeatureId | null>(null);
  const runwayRef = useRef<HTMLDivElement>(null);
  const sceneRefs = useRef<(HTMLElement | null)[]>([]);
  const lastFeature = useRef<FeatureId | null>(null);

  /* pinned only where there is room for it and the visitor has not asked for less motion */
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)");
    const apply = () => setMode(mq.matches ? "pinned" : "stacked");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const runway = runwayRef.current;
    if (!runway) return;
    let raf = 0;

    const publish = (feature: FeatureId | null) => {
      setFeature(feature);
      setActive(feature);
      /* the URL follows the scene; leaving the section clears it, but only if it was ours */
      if (feature) {
        if (window.location.hash !== `#${feature}`) window.history.replaceState(null, "", `#${feature}`);
      } else if (lastFeature.current && SCENES.some((s) => `#${s.id}` === window.location.hash)) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      lastFeature.current = feature;
    };

    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      if (mode === "pinned") {
        const step = vh * 0.85;
        const u = -runway.getBoundingClientRect().top / step;
        const s = sceneAt(u);
        SCENES.forEach((scene, k) => {
          const el = sceneRefs.current[k];
          if (!el) return;
          const d = s - k;
          const v = clamp01(1.25 - Math.abs(d) * 1.8); /* whole for most of its slot, about a third at the seam */
          el.style.setProperty("--v", v.toFixed(3));
          el.style.setProperty("--d", d.toFixed(3));
          const on = v > 0.5;
          (el as HTMLElement & { inert: boolean }).inert = !on;
          el.dataset.on = on ? "true" : "false";
        });
        const inRange = u > -0.25 && u < 3.25;
        publish(inRange ? SCENES[Math.round(s)].id : null);
      } else {
        let best: FeatureId | null = null;
        let bestDist = Infinity;
        SCENES.forEach((scene, k) => {
          const el = sceneRefs.current[k];
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (r.bottom < vh * 0.15 || r.top > vh * 0.85) return;
          const dist = Math.abs(r.top + r.height / 2 - vh / 2);
          if (dist < bestDist) { bestDist = dist; best = scene.id; }
        });
        publish(best);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      setFeature(null);
    };
  }, [mode]);

  const go = (id: FeatureId) => (event: React.MouseEvent) => {
    if (scrollToId(id)) event.preventDefault();
  };

  return (
    <>
      <section className="lp-sec lp-fx-intro" id="policy-overview" aria-labelledby="trust-title">
        <div className="lp-wrap">
          <div className="lp-fx-intro__copy">
            <p className="lp-eyebrow" data-lp-reveal>
              <i aria-hidden="true" />
              Designed for changing market hours
            </p>
            <h2 className="lp-h2" id="trust-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
              A market clock. <em className="o">A different rule at every hour.</em>
            </h2>
            <p className="lp-lead" data-lp-reveal style={{ ["--i" as string]: 2 }}>
              The exchange session sets the base fee and flow limits. PRICE_GUARDED switches to an explicit AMM fallback when references fail; SESSION_ONLY always uses the AMM price.
            </p>
          </div>

          <figure className="lp-cycle" data-lp-reveal="right" style={{ ["--i" as string]: 2 }}>
            <figcaption className="lp-cycle__head">
              <span>SESSION → FEE → FLOW</span>
              <span>ILLUSTRATIVE POLICY · NOT LIVE DATA</span>
            </figcaption>
            <div className="lp-cycle__dial" aria-hidden="true">
              <div className="lp-cycle__orbit">
                <div className="lp-cycle__ring" />
                <span className="lp-cycle__signal"><i /></span>
                <div className="lp-cycle__core">
                  <CalendarClock size={25} strokeWidth={1.5} />
                  <b>MARKET<br />CLOCK</b>
                  <span><i /> STATE VERIFIED</span>
                </div>
                <div className="lp-cycle__phase lp-cycle__phase--regular"><span>REGULAR</span><b>0.05%</b></div>
                <div className="lp-cycle__phase lp-cycle__phase--extended"><span>PRE / POST</span><b>0.30%</b></div>
                <div className="lp-cycle__phase lp-cycle__phase--overnight"><span>OVERNIGHT</span><b>0.50%</b></div>
                <div className="lp-cycle__phase lp-cycle__phase--close"><span>SCHEDULED CLOSE</span><b>1.00%</b></div>
              </div>
            </div>
            <div className="lp-cycle__output">
              <span>VERIFIED SESSION</span>
              <i aria-hidden="true" />
              <Activity size={15} strokeWidth={1.7} aria-hidden="true" />
              <b>BASE FEE + FLOW LIMITS</b>
              <span>RECOMPUTED AT SWAP</span>
            </div>
            <p className="lp-sr">Illustrative market-session cycle. Regular session base fee 0.05%, pre-market and after-hours 0.30%, overnight 0.50%, and scheduled close 1.00%. These are policy examples, not live market data.</p>
          </figure>
        </div>
      </section>

      <section className="lp-fx" id="operating-policy" data-mode={mode} aria-label="BELL operating policy">
        <div className="lp-fx__runway" ref={runwayRef}>
          <div className="lp-fx__stage">
            <div className="lp-fx__top">
              <p className="lp-fx__eyebrow"><i aria-hidden="true" />BELL operating policy</p>
              <p className="lp-fx__count" aria-hidden="true">
                <b>{active ? SCENES.find((s) => s.id === active)?.n : "REG"}</b>
              </p>
            </div>

            <div className="lp-fx__scenes">
              {SCENES.map((scene, k) => {
                const Visual = VISUALS[scene.id];
                return (
                  <article
                    key={scene.id}
                    className="lp-fx__scene"
                    data-feature={scene.id}
                    data-on={mode === "pinned" ? (k === 0 ? "true" : "false") : "true"}
                    ref={(el) => { sceneRefs.current[k] = el; }}
                    id={mode === "stacked" ? scene.id : undefined}
                    aria-labelledby={`fx-${scene.id}-name`}
                  >
                    <div className="lp-fx__copy">
                      <p className="lp-fx__kicker"><span>{scene.n}</span>{scene.kicker}</p>
                      <h3 className="lp-fx__name" id={`fx-${scene.id}-name`}>
                        {scene.name}
                        <small>{scene.sub}</small>
                      </h3>
                      <p className="lp-fx__headline">{scene.headline}</p>
                      <p className="lp-fx__text">{scene.text}</p>
                      <ul className="lp-fx__chips">
                        {scene.chips.map((chip) => <li key={chip}>{chip}</li>)}
                      </ul>
                      <p className="lp-fx__use"><b>In practice</b>{scene.use}</p>
                      <Link className="lp-fx__link" href={scene.href}>{scene.cta} <Arrow /></Link>
                    </div>
                    <div className="lp-fx__visual">
                      <Visual />
                    </div>
                  </article>
                );
              })}
            </div>

            <ol className="lp-fx__rail" aria-label="Feature introductions">
              {SCENES.map((scene) => (
                <li key={scene.id}>
                  <a href={`#${scene.id}`} data-active={active === scene.id ? "true" : "false"} onClick={go(scene.id)}>
                    <span>{scene.n}</span>{scene.name}
                  </a>
                </li>
              ))}
            </ol>
          </div>

          {mode === "pinned" ? (
            <div className="lp-fx__slots" aria-hidden="true">
              {SCENES.map((scene) => (
                <div className="lp-fx__slot" key={scene.id}><span className="lp-fx__mark" id={scene.id} /></div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
