"use client";

import { useEffect } from "react";

/* Arms the scroll reveals. Nothing is hidden until this runs, so the page is complete without JavaScript, and with reduced motion
   it never arms at all. */
export function EinsteinMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".ein");
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.classList.add("ein-armed");
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        seen.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
    root.querySelectorAll<HTMLElement>("[data-reveal]").forEach((item) => seen.observe(item));
    return () => { seen.disconnect(); root.classList.remove("ein-armed"); };
  }, []);
  return null;
}
