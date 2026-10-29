"use client";

import { useEffect } from "react";
import type Lenis from "lenis";

/* Smooth wheel scrolling for the landing, and only for the landing.

   The landing is driven by scroll position (the opening, the zoom, the sticky scene), and a mouse
   wheel moves the page in 100px steps, which makes anything driven by it look steppy. Lenis eases
   those steps, so every effect on the page follows an eased position instead.

   It is kept light on purpose:
   - the library is loaded after first paint (dynamic import), so it is not part of the first load;
   - its frame loop only runs while the page is moving, and stops when it is not;
   - it is off for reduced motion and for touch devices (phones and tablets keep their native
     momentum), and it leaves dialogs, such as the wallet modal, alone;
   - the page is a static prerender: nothing on the server changes.

   One switch: set SMOOTH to false and the landing scrolls natively, exactly as the other pages do. */
const SMOOTH = true;

let lenis: Lenis | null = null;
let wake: () => void = () => {};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

/* Scrolls to an element by id. Returns true when it was handled, so the caller can cancel the native jump. */
export function scrollToId(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  if (lenis) {
    lenis.scrollTo(el, { duration: 1.5, easing: easeOutQuart });
    wake();
    return true;
  }
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  return true;
}

/* Scrolls to a document position. */
export function scrollToY(y: number) {
  if (lenis) {
    lenis.scrollTo(y, { duration: 1.2, easing: easeOutQuart });
    wake();
    return;
  }
  window.scrollTo({ top: y, behavior: reducedMotion() ? "auto" : "smooth" });
}

export function SmoothScroll() {
  useEffect(() => {
    if (!SMOOTH || reducedMotion()) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let alive = true;
    let raf = 0;
    let lastWake = 0;
    let teardown = () => {};

    const boot = async () => {
      const { default: LenisClass } = await import("lenis");
      if (!alive) return;
      const l = new LenisClass({
        lerp: 0.11,
        smoothWheel: true,
        wheelMultiplier: 1,
        syncTouch: false,
        autoRaf: false,
        anchors: false,
        /* the wallet modal and anything marked for it scrolls on its own */
        prevent: (node) => !!node.closest('[role="dialog"], [data-rk], [data-lenis-prevent]'),
      });
      lenis = l;

      const tick = (time: number) => {
        raf = 0;
        l.raf(time);
        if (l.isScrolling || performance.now() - lastWake < 220) raf = requestAnimationFrame(tick);
      };
      wake = () => {
        lastWake = performance.now();
        if (!raf) raf = requestAnimationFrame(tick);
      };
      window.addEventListener("wheel", wake, { passive: true });
      window.addEventListener("keydown", wake, { passive: true });

      teardown = () => {
        window.removeEventListener("wheel", wake);
        window.removeEventListener("keydown", wake);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        l.destroy();
        if (lenis === l) lenis = null;
        wake = () => {};
      };
    };

    /* after first paint, and when the browser has nothing better to do */
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    let timer = 0;
    if (typeof idle === "function") idle(boot, { timeout: 1200 });
    else timer = window.setTimeout(boot, 200);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      teardown();
    };
  }, []);

  return null;
}
