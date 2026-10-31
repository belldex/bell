"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { scrollToY } from "./smooth-scroll";

/* BELL's operating idea: one pool moves through three market conditions.

   On big screens this is a sticky scene: the section is a tall runway, the content is
   pinned, and scrolling moves one card through its three states. Everywhere else (phones,
   short windows, reduced motion) the three states are plain rows, from the same copy.

   It comes in behind the hero. On the pinned layout the scene is already in its final place while the
   hero's camera finishes pushing in, and it grows from small to full size (and fades in) over the last
   ZIN screens of that push: --zk, scrubbed by scroll position, so it reverses too. Everywhere else the
   blocks marked .lp-ie fade in and rise (64px) as they travel up from the bottom of the screen. */

const RISE = 64; /* px; keep in sync with .lp-ie in landing.css */
const ZIN = 0.62; /* screens of scroll the scene takes to grow in; keep in sync with --lp-zin in landing.css */
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const STATES = [
  { name: "Regular session", note: "Verified regular-hours data. Standard session limits.", tone: "valid", chip: "0.05% base LP fee" },
  { name: "Extended session", note: "Supported PRE/POST data. Higher fee, tighter limits.", tone: "warn", chip: "0.30% base LP fee" },
  { name: "Scheduled close", note: "Calendar-proven only. Historical anchor, finite budget.", tone: "neutral", chip: "1.00% base LP fee" },
] as const;

const CAPTION = "Session policy · illustrative, not live data.";
const SESSION_ART = [
  { src: "/landing/market-orbit.webp", label: "Interlocking digital market signals for the regular session." },
  { src: "/landing/session-limits.webp", label: "Layered digital flow limits for the extended session." },
  { src: "/landing/market-close-floating.webp", label: "A sealed digital market record for the scheduled close." },
] as const;
const ART_LABEL = [
  "Regular market session with fresh stock data and standard limits.",
  "Extended session with a higher base fee and smaller trading limits.",
  "Scheduled market closure using a historical close anchor and finite budget.",
] as const;
const PIN_QUERY = "(min-width: 1024px) and (min-height: 680px)"; /* keep in sync with landing.css */
const BANDS = [0.33, 0.66];
const HYSTERESIS = 0.025;

export function IdeaScene() {
  const runRef = useRef<HTMLElement>(null);
  const [state, setState] = useState(0);
  const [live, setLive] = useState(true);

  useEffect(() => {
    const run = runRef.current;
    if (!run) return;
    const pinned = window.matchMedia(PIN_QUERY);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const items = Array.from(run.querySelectorAll<HTMLElement>(".lp-ie"));
    const lastK = items.map(() => -1);
    const lift = items.map(() => 0); /* the translate each block has now, so its layout position can be read without it */
    let raf = 0;
    let lastP = -1;

    /* Each block's progress comes from where it is on screen: 0 while it is below the fold, 1 once
       it has climbed to 55% of the screen height. Reads first, writes after, so layout runs once. */
    const scrub = () => {
      if (reduced) return;
      const vh = window.innerHeight;
      const r = run.getBoundingClientRect();
      if (r.bottom < -vh * 0.5 || r.top > vh * 2.2) return;
      const tops = items.map((el, i) => el.getBoundingClientRect().top - lift[i]);
      for (let i = 0; i < items.length; i++) {
        const k = clamp01((vh * 0.985 - tops[i]) / (vh * 0.43));
        if (Math.abs(k - lastK[i]) < 0.004) continue;
        lastK[i] = k;
        lift[i] = (1 - k) * RISE;
        items[i].style.setProperty("--k", k.toFixed(3));
      }
    };

    let lastZ = -1;
    let liveNow = true;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      const r = run.getBoundingClientRect();
      if (!pinned.matches) {
        scrub();
        run.style.setProperty("--ip", "0");
        if (lastZ !== 1) { lastZ = 1; run.style.setProperty("--zk", "1"); }
        if (!liveNow) { liveNow = true; setLive(true); }
        return;
      }
      /* pinned: the scene sits in its final place from the moment the run reaches the top, and grows in over ZIN screens */
      const zin = reduced ? 0 : vh * ZIN;
      const z = zin > 0 ? clamp01(-r.top / zin) : 1;
      const zk = z;
      if (Math.abs(zk - lastZ) > 0.002 || (zk === 1) !== (lastZ === 1)) {
        lastZ = zk;
        run.style.setProperty("--zk", zk.toFixed(3));
      }
      const interactive = z > 0.92;
      if (interactive !== liveNow) { liveNow = interactive; setLive(interactive); }

      const travel = r.height - vh - zin;
      const p = travel > 0 ? Math.min(1, Math.max(0, (-r.top - zin) / travel)) : 0;
      if (Math.abs(p - lastP) > 0.002) {
        lastP = p;
        run.style.setProperty("--ip", p.toFixed(3));
      }
      /* hysteresis, so the card does not flicker when the scroll rests on a boundary */
      setState((prev) => {
        let s = prev;
        while (s < 2 && p > BANDS[s] + HYSTERESIS) s++;
        while (s > 0 && p < BANDS[s - 1] - HYSTERESIS) s--;
        return s;
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    pinned.addEventListener("change", schedule);
    update();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      pinned.removeEventListener("change", schedule);
    };
  }, []);

  /* a click on a step scrolls to the middle of its slice of the runway, so scroll stays the one source of truth */
  const goTo = (i: number) => {
    const run = runRef.current;
    if (!run) return;
    const zin = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : window.innerHeight * ZIN;
    const travel = run.offsetHeight - window.innerHeight - zin;
    const centre = i === 0 ? 0.12 : i === 1 ? 0.5 : 0.88;
    const top = run.getBoundingClientRect().top + window.scrollY + zin + travel * centre;
    scrollToY(top);
  };

  return (
    <section className="lp-idea-run" id="idea" ref={runRef} aria-labelledby="idea-title">
      <div className="lp-idea-pin">
        <div className="lp-wrap lp-idea" data-live={live ? "1" : "0"} inert={!live}>
          <div className="lp-idea__copy">
            <p className="lp-eyebrow lp-ie">
              <i aria-hidden="true" />
              A MARKET WITH A CLOCK
            </p>
            <h2 className="lp-h2 lp-ie" id="idea-title">
              Market hours change. <em className="o">Pool rules adapt.</em>
            </h2>
            <p className="lp-lead lp-ie">
              BELL provides liquidity pools that can include Robinhood Stock Tokens. Regular, extended and overnight sessions carry different data and liquidity conditions.
            </p>
            <p className="lp-body lp-ie">
              BELL applies session fees and bounded flow limits around the clock. PRICE_GUARDED pools use independent references while valid and switch to an explicit AMM-only fallback if they fail; SESSION_ONLY always uses the AMM price.
            </p>

            {/* sticky mode only: where you are in the scene */}
            <ol className="lp-idea__steps lp-ie" aria-label="Three market conditions">
              {STATES.map((s, i) => (
                <li key={s.name}>
                  <button type="button" className="lp-istep" data-on={state === i} onClick={() => goTo(i)}>
                    <span className="lp-istep__n" aria-hidden="true">{["REG", "EXT", "CLOSE"][i]}</span>
                    <b>{s.name}</b>
                    <span className="lp-istep__note">{s.note}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="lp-idea__stage lp-ie">
            {/* sticky mode: one card, three states */}
            <div className="lp-vcard" data-s={state} data-spot>
              <div className="lp-vcard__top">
                <p className="lp-vcard__cap">{CAPTION}</p>
                <span className="lp-vcard__eye"><i aria-hidden="true" />Session state</span>
              </div>
              <div className="lp-vcard__body" aria-live="polite">
                <div className="lp-vtitles">
                  {STATES.map((s, i) => (
                    <h3 key={s.name} data-on={state === i} data-past={state > i}>{s.name}</h3>
                  ))}
                </div>
                <div className="lp-session-art" role="img" aria-label={ART_LABEL[state]}>
                  {SESSION_ART.map((art, i) => (
                    <Image
                      key={art.src}
                      src={art.src}
                      alt=""
                      aria-hidden="true"
                      fill
                      sizes="(min-width: 1024px) 42vw, 100vw"
                      className="lp-session-art__image"
                      data-on={state === i}
                    />
                  ))}
                </div>
                <div className="lp-vrule">
                  <span>{["Verified regular feed · standard limits", "Supported PRE/POST feed · tighter limits", "Committed closure · finite episode budget"][state]}</span>
                  <span className="lp-yes">{state === 2 ? "CLOSED" : "VERIFIED"}</span>
                </div>
                <div className="lp-vchips">
                  {STATES.map((s, i) => (
                    <span className="lp-chip" data-tone={s.tone} data-on={state === i} key={s.chip}><i aria-hidden="true" />{s.chip}</span>
                  ))}
                </div>
                <p className="lp-vcard__note">{STATES[state].note}</p>
              </div>
            </div>

            {/* everywhere else: the three states as rows */}
            <div className="lp-ledger lp-ledger--static" data-spot>
              <p className="lp-ledger__cap">{CAPTION}</p>
              <div className="lp-lrow">
                <h3>Regular session</h3>
                <Image src={SESSION_ART[0].src} alt="" aria-hidden="true" width={320} height={220} sizes="(max-width: 640px) 80vw, 320px" className="lp-session-art__row" />
                <span className="lp-chip" data-tone="valid"><i aria-hidden="true" />0.05% base LP fee · standard limits</span>
              </div>
              <div className="lp-lrow">
                <h3>Extended session</h3>
                <Image src={SESSION_ART[1].src} alt="" aria-hidden="true" width={320} height={220} sizes="(max-width: 640px) 80vw, 320px" className="lp-session-art__row" />
                <span className="lp-chip" data-tone="warn"><i aria-hidden="true" />0.30% base LP fee · tighter limits</span>
              </div>
              <div className="lp-lrow lp-lrow--proof">
                <h3>Scheduled close</h3>
                <Image src={SESSION_ART[2].src} alt="" aria-hidden="true" width={320} height={220} sizes="(max-width: 640px) 80vw, 320px" className="lp-session-art__row" />
                <div className="lp-lrow__view"><u>Historical anchor · budget lasts for the closure episode</u><span className="lp-yes">CLOSED</span></div>
                <span className="lp-chip" data-tone="neutral"><i aria-hidden="true" />1.00% base LP fee · bounded exception</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
