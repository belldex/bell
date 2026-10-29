"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
    kicker: "Market clock · verified state",
    headline: "The market sets the starting conditions.",
    text: "BELL distinguishes regular, pre-market, post-market, overnight and scheduled-closure states. Each supported session has a base fee; missing or unexpected data means the pool halts.",
    use: "A regular session starts at 0.05%. PRE and POST use 0.30%; overnight uses 0.50% when its feed is supported and healthy.",
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
    headline: "Fees price conditions. Limits bound exposure.",
    text: "BELL caps cumulative swap flow as well as individual trades. Limits tighten as sessions become less liquid, and they do not refill when liquidity is added or the market clock rolls over.",
    use: "SESSION_ONLY applies session controls without claiming independent price protection for the counterasset. PRICE_GUARDED remains unavailable until a reference is admitted.",
    chips: ["SESSION_ONLY · guarded swaps", "PRICE_GUARDED · blocked"],
    href: "/protocol",
    cta: "Read risk policy",
  },
  {
    id: "planned-close",
    n: "CLOSE",
    name: "Planned close",
    sub: "Finite closure budget",
    kicker: "Scheduled closure · bounded exception",
    headline: "A closed market is not a live quote.",
    text: "When a valid calendar proves a scheduled closure, BELL can use a captured historical close anchor with a single, non-refilling budget. The anchor is clearly historical—not a fresh market price.",
    use: "Unexpected staleness, invalid closure context, an expired anchor or a changed multiplier halts swaps. Exit in-kind stays separate from swap guards.",
    chips: ["CLOSED · 1.00% base fee", "Unknown state · halt"],
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
    <div className="fxv fxv--dojang" aria-hidden="true">
      <div className="fxv__ledger">
        <p>Session feed · verified</p>
        {[0, 1, 2].map((i) => (
          <span key={i}><i /><u /><em /></span>
        ))}
      </div>
      <div className="fxv__card">
        <div className="fxv__card-top"><i /><span>Market session</span><em>Illustration</em></div>
        <dl>
          <div><dt>Session</dt><dd><strong>REGULAR</strong></dd></div>
          <div><dt>Base fee</dt><dd><strong>0.05%</strong></dd></div>
          <div><dt>Stock data</dt><dd><strong>Fresh · example</strong></dd></div>
          <div><dt>Calendar</dt><dd><u className="fxv__short" /></dd></div>
          <div><dt>Flow cap</dt><dd><u /></dd></div>
          <div><dt>Updated</dt><dd><u className="fxv__short" /></dd></div>
          <div><dt>Decision</dt><dd><strong>Swap allowed · example</strong></dd></div>
        </dl>
        <span className="fxv__seal">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
        </span>
      </div>
      <p className="fxv__tag fxv__tag--a">Session sets the base fee</p>
      <p className="fxv__tag fxv__tag--b">Health gates every swap</p>
    </div>
  );
}

function ProofVisual() {
  return (
    <div className="fxv fxv--bojagi" aria-hidden="true">
      <div className="fxv__side fxv__side--device">
        <p className="fxv__label">Gross-flow policy</p>
        <div className="fxv__witness">
          <div><span>Per trade</span><i className="lp-veil" /></div>
          <div><span>Rolling window</span><i className="lp-veil" /></div>
          <div><span>Session mode</span><b>Limits scale by session</b></div>
        </div>
        <div className="fxv__circuit"><span>Current use</span><b>Illustrative</b></div>
        <div className="fxv__gen"><span>Cap does not refill</span><u /></div>
      </div>
      <div className="fxv__bridge">
        <span className="fxv__bridge-line" />
        <span className="fxv__bridge-dot" />
        <p>Policy check</p>
      </div>
      <div className="fxv__side fxv__side--chain">
        <p className="fxv__label">Swap decision</p>
        <div className="fxv__verifier">
          <span>BELL policy</span>
          <strong><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.2 4.2L19 7" /></svg>Within limits</strong>
        </div>
        <ul className="fxv__public">
          <li>Session</li><li>Data age</li><li>Trade size</li><li>Rolling flow</li><li>Close state</li><li>Pool policy</li>
        </ul>
      </div>
    </div>
  );
}

function BallotVisual() {
  const wallets = [1, 1, 1, 1, 0, 1, 1, 2, 0, 1, 2, 1, 0, 1, 3, 1, 1, 0, 2, 1, 1, 0, 1, 1, 3, 1, 2, 1, 0, 1];
  return (
    <div className="fxv fxv--dao" aria-hidden="true">
      <div className="fxv__proposal">
        <div className="fxv__proposal-top"><span>Scheduled closure</span><em>Policy model</em></div>
        <p className="fxv__proposal-title">Historical close anchor · bounded episode</p>
        <ol className="fxv__steps">
          <li data-done="true"><i />Calendar verified</li>
          <li data-done="true"><i />Anchor captured</li>
          <li><i />Finite budget</li>
          <li><i />Halt on mismatch</li>
        </ol>
        <div className="fxv__votes">
          <span>Used<u style={{ ["--w" as string]: "34%" }} /></span>
          <span>Available<u style={{ ["--w" as string]: "56%" }} /></span>
          <span>Reserved<u style={{ ["--w" as string]: "10%" }} /></span>
        </div>
      </div>
      <div className="fxv__wallets">
        <p>Illustrative budget view · no live pool data</p>
        <div>
          {wallets.map((w, i) => <i key={i} data-v={w} />)}
        </div>
      </div>
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
          <p className="lp-eyebrow" data-lp-reveal style={{ ["--ac" as string]: "var(--lp-public)" }}>
            <i aria-hidden="true" />
            Designed for changing market hours
          </p>
          <h2 className="lp-h2" id="trust-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
            Every swap follows the <em>same rules.</em>
          </h2>
          <p className="lp-lead" data-lp-reveal style={{ ["--i" as string]: 2 }}>
            Session, data freshness, trade size and cumulative flow are checked together. If any required input is invalid, BELL stops the swap instead of guessing.
          </p>
        </div>
      </section>

      <section className="lp-fx" data-mode={mode} aria-label="BELL market rhythm, risk policy and planned close">
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
