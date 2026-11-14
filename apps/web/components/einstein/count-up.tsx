"use client";

import { useEffect, useRef, useState } from "react";

/* The final number is what the server renders, so it is right without JavaScript and for reduced motion. In a browser that allows
   motion the figure counts up once, the first time it scrolls into view. */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const seen = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      seen.disconnect();
      const start = performance.now();
      const run = (now: number) => {
        const t = Math.min(1, (now - start) / 1100);
        setShown(Math.round(value * (1 - Math.pow(1 - t, 4))));
        if (t < 1) frame = requestAnimationFrame(run);
      };
      setShown(0);
      frame = requestAnimationFrame(run);
    }, { threshold: 0.6 });
    seen.observe(el);
    return () => { seen.disconnect(); cancelAnimationFrame(frame); };
  }, [value]);

  return <span ref={ref}>{shown.toLocaleString("en-US")}</span>;
}
