"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Activity, ArrowDown, CalendarClock, CalendarDays, Gauge, MousePointer2, Percent } from "lucide-react";
import { Arrow } from "./arrow";
import { createCipherSculpture } from "./cipher-sculpture";
import { createGlobeSculpture } from "./globe-sculpture";
import { FORM_TIMELINE, GlyphField } from "./glyph-field";
import { scrollToId } from "./smooth-scroll";

/* Phase 1 is the claim on white. The full stop after "move" is a black dot;
   scrolling cuts it into a row of slabs that turn, fly and settle as the strips of the screen (see
   cipher-sculpture.ts), and phase 2, the hero, was behind them all along. After a short hold the camera
   pushes into the headline: it zooms in until the hero is gone, and the next section rises in behind it.

   Behind the claim, three market-session lanes turn around a timing signal (globe-sculpture.ts); the
   same scroll that opens the claim carries the camera through that policy sculpture, so the white and hero are one
   space, not two screens.

   The cover is a tall runway with a sticky stage. Scroll position becomes a handful of
   numbers written on the stage (see the header of landing.css), and every animated value
   in the stylesheet reads them. Nothing here animates by itself, so it runs in reverse. */

const STACK = [
  { label: "Market sessions", icon: CalendarDays },
  { label: "Dynamic LP fees", icon: Percent },
  { label: "Gross-flow limits", icon: Gauge },
  { label: "Bounded closure", icon: CalendarClock },
  { label: "Robinhood Chain", logo: "/landing/partners/robinhood.svg" },
  { label: "Uniswap v4", logo: "/landing/partners/uniswap.svg" },
  { label: "BELL protocol", brand: true, icon: Activity },
];

/* "Prove more. Reveal less." -> ["Prove more", "Reveal less."]; the stop after "more" becomes the dot */
function splitTagline(tagline: string): [string, string] {
  const m = tagline.trim().match(/^(.+?)[.!?]\s+(.+)$/);
  return m ? [m[1], m[2]] : [tagline.trim(), ""];
}

/* The runway, as fractions of its length: the opening grows, the hero holds while its picture turns from
   its first form into its second, the picture goes on through two more forms (SHOW), then the camera pushes in.
   The opening, the first hold and the zoom each take the same distance as they always did (237svh of runway:
   about a screen to open, half a screen to hold, nine tenths to zoom); only SHOW is new, and it sits between
   the hold and the zoom, so adding forms never moves what was already approved. */
const BASE_RUN = 237; /* svh the opening + first hold + zoom have always taken */
const SHOW_RUN = 100; /* svh for the third and fourth forms; keep in step with --lp-run in landing.css */
const RUN = BASE_RUN + SHOW_RUN;
const OPEN = (0.4165 * BASE_RUN) / RUN;
const HOLD = (0.211 * BASE_RUN) / RUN;
const SHOW = SHOW_RUN / RUN;
const NAV_H = 76;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/* How far the opening has grown. Geometric at first, so the dot visibly swells from the very
   first scroll, then eased so it lands softly on the full screen. */
function openness(p: number) {
  const R = 36;
  const geo = (Math.pow(R, p) - 1) / (R - 1);
  return 0.7 * geo + 0.3 * (p * p * (3 - 2 * p));
}

/* How far the picture has come through its four forms, 0 (the knot) to 3 (the pathways): each change of form
   adds one. The words of the hero follow it in CSS (--s, see .lp-story__t in landing.css), so they change
   when the picture does and the same numbers drive both; nothing here scrolls by itself. */
function storyProgress(h: number, ex: number) {
  const f = FORM_TIMELINE;
  return (
    clamp01((h - f.hFrom) / (f.hTo - f.hFrom)) +
    clamp01((ex - f.bcFrom) / (f.bcTo - f.bcFrom)) +
    clamp01((ex - f.cdFrom) / (f.cdTo - f.cdFrom))
  );
}

const motionQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");

/* ------------------------------------------------------------- component */
type Props = {
  tagline: string;
};

export function CoverReveal({ tagline }: Props) {
  const coverRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const cipherRef = useRef<HTMLCanvasElement>(null);
  const globeRef = useRef<HTMLCanvasElement>(null);
  const [wordA, wordB] = splitTagline(tagline);

  useEffect(() => {
    const cover = coverRef.current;
    const stage = stageRef.current;
    const slot = slotRef.current;
    const box = boxRef.current;
    const hero = heroRef.current;
    const cipherCanvas = cipherRef.current;
    if (!cover || !stage || !slot || !box || !hero || !cipherCanvas) return;
    const root = cover.closest<HTMLElement>(".lp");
    const motion = motionQuery();
    const cipher = createCipherSculpture(cipherCanvas);
    const globeCanvas = globeRef.current;
    const globe = globeCanvas ? createGlobeSculpture(globeCanvas) : null;
    globe?.setReduced(motion.matches);

    let geo = { sw: 0, sh: 0, x: 0, y: 0, w: 0, h: 0 };
    let raf = 0;
    let last = -1;
    let heroOn: boolean | null = null;
    let storyOn = -1;
    const storyEls = Array.from(
      hero.querySelectorAll<HTMLElement>("[data-story-i]"),
    );

    const setPhase = (dark: boolean) => {
      const next = dark ? "dark" : "light";
      if (root && root.dataset.phase !== next) root.dataset.phase = next;
    };
    const setHero = (on: boolean) => {
      if (heroOn === on) return;
      heroOn = on;
      (hero as HTMLElement & { inert: boolean }).inert =
        !on; /* hero links stay out of the tab order until visible */
    };

    /* offsetLeft/offsetTop are layout values, so the transforms on the
       neighbouring words can never skew the measurement */
    const measure = () => {
      geo = {
        sw: stage.clientWidth,
        sh: stage.clientHeight,
        x: slot.offsetLeft,
        y: slot.offsetTop,
        w: slot.offsetWidth,
        h: slot.offsetHeight,
      };
      /* the dot never moves, so its centre is written once, not on every frame */
      stage.style.setProperty("--ox", `${(geo.x + geo.w / 2).toFixed(1)}px`);
      stage.style.setProperty("--oy", `${(geo.y + geo.h / 2).toFixed(1)}px`);
      cipher.resize(geo.sw, geo.sh);
      globe?.resize(slot);
      last = -1;
    };

    const paint = () => {
      raf = 0;

      globe?.setReduced(motion.matches);
      if (motion.matches) {
        /* stacked layout: the nav turns dark once the hero reaches it */
        setHero(true);
        setPhase(box.getBoundingClientRect().top <= NAV_H * 0.6);
        return;
      }

      if (!geo.sw || !geo.sh) measure();
      if (!geo.sh) return;

      const r = cover.getBoundingClientRect();
      const run = r.height - geo.sh;
      const scrolled = -r.top;
      const p = clamp01(scrolled / (run * OPEN));
      const h = clamp01(
        (scrolled - run * OPEN) / (run * HOLD),
      ); /* how far through the hold: the picture changes form now */
      const ex = clamp01(
        (scrolled - run * (OPEN + HOLD)) / (run * SHOW),
      ); /* how far through the extra forms */
      const q = clamp01(
        (scrolled - run * (OPEN + HOLD + SHOW)) /
          (run * (1 - OPEN - HOLD - SHOW)),
      );
      const key = p + h + ex + q * 2;
      if (Math.abs(key - last) < 0.0005) return;
      last = key;

      globe?.setProgress(p);

      const e = openness(p);
      const k = 1 - e;
      const l = geo.x * k;
      const t = geo.y * k;
      const ri = (geo.sw - geo.x - geo.w) * k;
      const b = (geo.sh - geo.y - geo.h) * k;
      const bw = geo.sw - l - ri;
      const bh = geo.sh - t - b;

      /* the dot has the soft corners of the typeface's own full stop, becomes a rounded square,
         and is square-cornered once it fills the screen */
      const half = Math.min(bw, bh) / 2;
      const toSquare = smooth(0, 0.12, e);
      const dotRadius = Math.min(bw, bh) * 0.2;
      const radius = Math.min(
        half,
        (dotRadius * (1 - toSquare) + 26 * toSquare) * (1 - smooth(0.5, 1, e)),
      );

      /* the window onto the hero is the union of the slabs' faces; at rest it is still the dot's own rectangle */
      const windowPath = cipher.draw(e, {
        x: geo.x,
        y: geo.y,
        w: geo.w,
        h: geo.h,
      });

      const s = stage.style;
      s.setProperty("--e", e.toFixed(4));
      s.setProperty("--c", clamp01((e - 0.6) / 0.34).toFixed(4));
      s.setProperty("--h", h.toFixed(4));
      s.setProperty("--k", ex.toFixed(4));
      s.setProperty("--q", q.toFixed(4));
      const story = storyProgress(h, ex);
      s.setProperty("--s", story.toFixed(3));
      const storyNow = Math.min(3, Math.round(story));
      if (storyNow !== storyOn) {
        /* only the words that are showing are exposed to assistive technology */
        storyOn = storyNow;
        for (const el of storyEls) {
          if (el.dataset.storyI === String(storyNow))
            el.removeAttribute("aria-hidden");
          else el.setAttribute("aria-hidden", "true");
        }
      }
      s.setProperty(
        "--clip",
        windowPath ??
          `inset(${t.toFixed(1)}px ${ri.toFixed(1)}px ${b.toFixed(1)}px ${l.toFixed(1)}px round ${radius.toFixed(1)}px)`,
      );

      /* the glyph field only works while the hero is mostly open and not yet zoomed away */
      const live = e > 0.45 && q < 0.85 ? "1" : "0";
      if (box.dataset.live !== live) {
        box.dataset.live = live;
        box.dispatchEvent(new Event("lp-live"));
      }

      /* the buttons are gone by q = .28, so from then on nothing in the hero can be clicked or tabbed to by mistake */
      setHero(e > 0.6 && q < 0.22);
      setPhase(t < NAV_H * 0.8 && b < 96);
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const remeasure = () => {
      measure();
      schedule();
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure);
    const ro = new ResizeObserver(remeasure);
    ro.observe(stage);
    motion.addEventListener("change", remeasure);
    /* fonts change the width of the words, and so where the dot sits */
    document.fonts?.ready.then(remeasure, () => {});
    measure();
    paint();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
      ro.disconnect();
      motion.removeEventListener("change", remeasure);
      cipher.clear();
      globe?.destroy();
    };
  }, []);

  return (
    <section className="lp-cover" id="overview" ref={coverRef} aria-label="Introduction">
      <div className="lp-stage" ref={stageRef}>
        {/* ---- Phase 1: the claim ---- */}
        <div className="lp-p1">
          <canvas className="lp-globe" ref={globeRef} aria-hidden="true" />
          <h1 className="lp-words" id="lp-title">
            <span className="lp-word lp-word--a">
              {wordA}
              <span className="lp-sr">.</span>
            </span>
            <span className="lp-slot" ref={slotRef} aria-hidden="true" />
            {wordB ? <span className="lp-word lp-word--b">{wordB}</span> : null}
          </h1>
          <p className="lp-sub">
            BELL is a Uniswap v4 liquidity protocol for tokenized-stock pools. It sets LP fees and swap limits from verified market sessions, then halts swaps when required stock data is stale or uncertain.
          </p>
          <p className="lp-hint" aria-hidden="true">
            <span>Scroll to open</span>
            <i />
          </p>
        </div>

        {/* ---- The opening, and phase 2 inside it ---- */}
        <div className="lp-box" ref={boxRef} data-lp-box data-live="0">
          <GlyphField />
          <div className="lp-glow" aria-hidden="true" />

          <div className="lp-hero" ref={heroRef} inert>
            {/* One left-aligned column, centred as a block. Everything in it zooms together when the camera pushes in. */}
            <div className="lp-hero__col">
              <p className="lp-badge">
                <CalendarClock aria-hidden="true" />
                <span>Session-aware liquidity</span>
                <span className="lp-badge__detail">for tokenized stocks</span>
              </p>
              <h2 className="lp-h">
                {/* Each scroll chapter keeps its headline to two deliberate lines. */}
                <span
                  className="lp-story__t lp-story__g"
                  data-story-i={0}
                  data-story-kind="head"
                >
                  <span className="lp-h__line lp-h__l1"><span className="lp-h__in">Session fees.</span></span>
                  <span className="lp-h__line lp-h__l2"><span className="lp-h__in">Bounded swaps.</span></span>
                </span>
                <span
                  className="lp-story__t lp-story__t--over"
                  data-story-i={1}
                  data-story-kind="head"
                  aria-hidden="true"
                >
                  <span className="lp-h__line lp-h__l1">
                  <span className="lp-h__in">A different session.</span>
                  </span>
                  <span className="lp-h__line lp-h__l2">
                    <span className="lp-h__in">
                      A different <b className="lp-h__private">fee.</b>
                    </span>
                  </span>
                </span>
                <span
                  className="lp-story__t lp-story__t--over"
                  data-story-i={2}
                  data-story-kind="head"
                  aria-hidden="true"
                >
                  <span className="lp-h__line lp-h__l1">
                  <span className="lp-h__in">Flow is capped.</span>
                  </span>
                  <span className="lp-h__line lp-h__l2">
                    <span className="lp-h__in">
                      Limits do not <b className="lp-h__private">refill.</b>
                    </span>
                  </span>
                </span>
                <span
                  className="lp-story__t lp-story__t--over"
                  data-story-i={3}
                  data-story-kind="head"
                  aria-hidden="true"
                >
                  <span className="lp-h__line lp-h__l1">
                  <span className="lp-h__in">Market is closed.</span>
                  </span>
                  <span className="lp-h__line lp-h__l2">
                    <span className="lp-h__in">
                      <b className="lp-h__public">Close stays finite.</b>
                    </span>
                  </span>
                </span>
              </h2>
              <div className="lp-cta">
                <p className="lp-lede">
                  <span
                    className="lp-story__t"
                    data-story-i={0}
                    data-story-kind="lede"
                  >
                    One tokenized-stock pool can face different liquidity and data conditions before, during and after the exchange session.
                  </span>
                  <span
                    className="lp-story__t lp-story__t--over"
                    data-story-i={1}
                    data-story-kind="lede"
                    aria-hidden="true"
                  >
                    Verified calendar and stock data select the session’s base LP fee and flow limits.
                  </span>
                  <span
                    className="lp-story__t lp-story__t--over"
                    data-story-i={2}
                    data-story-kind="lede"
                    aria-hidden="true"
                  >
                    Each swap is checked against per-trade and rolling gross-flow caps before it executes.
                  </span>
                  <span
                    className="lp-story__t lp-story__t--over"
                    data-story-i={3}
                    data-story-kind="lede"
                    aria-hidden="true"
                  >
                    A calendar-proven closure may use a historical close anchor and one finite episode budget.
                  </span>
                </p>
                <div className="lp-actions">
                  <Link className="lp-btn lp-btn--primary" href="/pools">
                    Open app
                    <Arrow />
                  </Link>
                  <a
                    className="lp-btn lp-btn--ghost"
                    href="#how"
                    onClick={(e) => {
                      /* a long way down: glide there (smooth scroll when it is on, native otherwise) */
                      if (scrollToId("how")) e.preventDefault();
                    }}
                  >
                    Trace a swap
                  </a>
                  <span className="lp-ca"><span className="lp-ca__label">BELL</span><span className="lp-ca__address">Testnet preview</span></span>
                </div>
              </div>
            </div>
          </div>

          <p className="lp-drag-hint" aria-hidden="true">
            <span><ArrowDown /> Scroll to follow the session</span>
            <span className="lp-drag-hint__divider" />
            <span><MousePointer2 /> Drag to turn</span>
          </p>
          <div className="lp-dot" aria-hidden="true" />
        </div>
        <canvas className="lp-cipher" ref={cipherRef} aria-hidden="true" />

        {/* ---- Always present, light then dark ---- */}
        <div className="lp-marq">
          <span className="lp-marq__label">Built on</span>
          <div className="lp-marq__view">
            <div className="lp-marq__track" aria-hidden="true">
              <ul className="lp-marq__group">
                {STACK.map((item) => (
                  <li className="lp-marq__item" key={item.label} data-brand={"brand" in item ? "bell" : "logo" in item ? "external" : "feature"}>
                    {"logo" in item ? (
                      <span className="lp-marq__logo lp-marq__logo--wordmark" data-logo={item.label === "Robinhood Chain" ? "robinhood" : "uniswap"} role="img" aria-label={item.label} style={{ ["--logo-src" as string]: `url("${item.logo}")` }} />
                    ) : "brand" in item ? (
                      <><span className="lp-marq__bell-mark" aria-hidden="true">B</span><span>{item.label}</span></>
                    ) : (
                      <><item.icon className="lp-marq__icon" aria-hidden="true" strokeWidth={1.7} /><span>{item.label}</span></>
                    )}
                  </li>
                ))}
              </ul>
              <ul className="lp-marq__group">
                {STACK.map((item) => (
                  <li className="lp-marq__item" key={item.label} data-brand={"brand" in item ? "bell" : "logo" in item ? "external" : "feature"}>
                    {"logo" in item ? (
                      <span className="lp-marq__logo lp-marq__logo--wordmark" data-logo={item.label === "Robinhood Chain" ? "robinhood" : "uniswap"} role="img" aria-label={item.label} style={{ ["--logo-src" as string]: `url("${item.logo}")` }} />
                    ) : "brand" in item ? (
                      <><span className="lp-marq__bell-mark" aria-hidden="true">B</span><span>{item.label}</span></>
                    ) : (
                      <><item.icon className="lp-marq__icon" aria-hidden="true" strokeWidth={1.7} /><span>{item.label}</span></>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="lp-sr">Built on {STACK.map((item) => item.label).join(", ")}.</p>
        </div>
      </div>
    </section>
  );
}
