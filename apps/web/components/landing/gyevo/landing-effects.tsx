"use client";

import { useEffect } from "react";

/* Progressive enhancement for the landing. Marks the page as script-driven, then:

   - reveals [data-lp-reveal] and [data-lp-rail] blocks in and out as they cross the viewport.
     data-rs is "below" (not reached yet), "in", or "above" (left through the top); the stylesheet
     animates the three states, and the exit is quicker than the entrance;
   - lets cards [data-spot] light up where the pointer is (--sx, --sy);
   - makes buttons lean a little toward the pointer (--tx, --ty).

   Without JS, or with reduced motion, everything is simply visible and still. */
export function LandingEffects() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lp");
    if (!root) return;
    root.dataset.js = "1";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(pointer: fine)").matches;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) {
            el.dataset.rs = "in";
          } else {
            const above = e.boundingClientRect.top < (e.rootBounds?.top ?? 0);
            el.dataset.rs = above ? "above" : "below";
          }
        }
      },
      { rootMargin: "-10% 0px -6% 0px", threshold: 0 },
    );
    root.querySelectorAll<HTMLElement>("[data-lp-reveal], [data-lp-rail]").forEach((el) => io.observe(el));

    /* pointer moves are handled once per frame, so no layout is read more often than it is painted */
    let pending: PointerEvent | null = null;
    let raf = 0;
    const process = () => {
      raf = 0;
      const ev = pending;
      pending = null;
      if (!ev) return;
      const target = ev.target as Element | null;
      const card = target?.closest<HTMLElement>("[data-spot]");
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--sx", `${ev.clientX - r.left}px`);
        card.style.setProperty("--sy", `${ev.clientY - r.top}px`);
      }
      if (reduced || !fine) return;
      const btn = target?.closest<HTMLElement>(".lp-btn, .lp-nav .lp-pill");
      if (btn) {
        const r = btn.getBoundingClientRect();
        const dx = (ev.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (ev.clientY - (r.top + r.height / 2)) / r.height;
        btn.style.setProperty("--tx", `${(dx * 10).toFixed(1)}px`);
        btn.style.setProperty("--ty", `${(dy * 7).toFixed(1)}px`);
      }
    };
    const onMove = (ev: PointerEvent) => {
      pending = ev;
      if (!raf) raf = requestAnimationFrame(process);
    };
    const onOut = (ev: PointerEvent) => {
      const btn = (ev.target as Element | null)?.closest<HTMLElement>(".lp-btn, .lp-nav .lp-pill");
      if (!btn || (ev.relatedTarget instanceof Node && btn.contains(ev.relatedTarget))) return;
      btn.style.removeProperty("--tx");
      btn.style.removeProperty("--ty");
    };
    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerout", onOut, { passive: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerout", onOut);
      delete root.dataset.js;
    };
  }, []);

  return null;
}
