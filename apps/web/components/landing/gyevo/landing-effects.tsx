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
    const roadMap = root.querySelector<HTMLElement>(".lp-road__map");
    const roadSignal = root.querySelector<SVGPathElement>(".lp-road__svg--signal path");
    const roadCursor = root.querySelector<SVGRectElement>(".lp-road__cursor");
    const roadNodes = Array.from(root.querySelectorAll<HTMLElement>(".lp-road__node"));
    const roadLabels = Array.from(root.querySelectorAll<HTMLElement>(".lp-road__label"));
    const roadPhases = Array.from(root.querySelectorAll<HTMLElement>(".lp-phase"));
    const lastVerified = Math.max(0, roadPhases.reduce((last, phase, i) => phase.dataset.status === "done" || phase.dataset.status === "live" ? i : last, 0));

    /* Scrub the roadmap highlight against the map's viewport travel, so it can
       move forward and backward with the user's scroll and finish at the last node. */
    let roadRaf = 0;
    const updateRoadProgress = () => {
      roadRaf = 0;
      if (!roadMap || !roadSignal || reduced) return;

      const { top } = roadMap.getBoundingClientRect();
      const start = window.innerHeight * 0.84;
      const end = window.innerHeight * 0.16;
      const progress = Math.max(0, Math.min(1, (start - top) / (start - end)));
      roadSignal.style.strokeDashoffset = String(1000 * (1 - progress));
      roadSignal.style.opacity = progress === 0 ? "0" : String(Math.min(0.95, progress * 5));
      if (roadCursor) {
        const point = roadSignal.getPointAtLength(roadSignal.getTotalLength() * progress);
        roadCursor.setAttribute("x", (point.x - 5.5).toFixed(2));
        roadCursor.setAttribute("y", (point.y - 5.5).toFixed(2));
        roadCursor.style.opacity = progress === 0 ? "0" : "1";
      }
      const active = Math.round(lastVerified + (roadPhases.length - lastVerified - 1) * progress);
      roadMap.dataset.activePhase = String(active);
      roadNodes.forEach((node, i) => { node.dataset.current = i === active ? "true" : "false"; });
      roadLabels.forEach((label, i) => { label.dataset.current = i === active ? "true" : "false"; });
      roadPhases.forEach((phase, i) => { phase.dataset.current = i === active ? "true" : "false"; });
    };
    const scheduleRoadProgress = () => {
      if (!roadRaf) roadRaf = requestAnimationFrame(updateRoadProgress);
    };
    if (!reduced && roadMap && roadSignal) {
      scheduleRoadProgress();
      window.addEventListener("scroll", scheduleRoadProgress, { passive: true });
      window.addEventListener("resize", scheduleRoadProgress, { passive: true });
    }

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
      if (roadRaf) cancelAnimationFrame(roadRaf);
      io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerout", onOut);
      window.removeEventListener("scroll", scheduleRoadProgress);
      window.removeEventListener("resize", scheduleRoadProgress);
      delete root.dataset.js;
    };
  }, []);

  return null;
}
