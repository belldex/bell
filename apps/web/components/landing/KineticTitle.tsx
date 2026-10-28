'use client';

import { useEffect, useRef } from 'react';

const OFFSETS = [66, 132, -66, -132];

/**
 * Kinetic headline: each word flies in from an alternating offset with the
 * reference's stagger and easing. Runs once on mount.
 */
export default function KineticTitle({ words }: { words: string[] }) {
  const ref = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    const nodes = Array.from(host.querySelectorAll<HTMLElement>('.w'));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((n) => {
        n.style.opacity = '1';
      });
      return;
    }

    const plan = nodes.map((_, i) => ({
      x: OFFSETS[(3 * i + 1) % 4],
      y: OFFSETS[(5 * i + 2) % 4],
      xFirst: i % 2 === 0,
    }));

    nodes.forEach((node, i) => {
      node.style.transform = `translate(${plan[i].x}px, ${plan[i].y}px)`;
      node.style.opacity = '0';
    });

    const start = performance.now() + 450;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      let done = true;

      nodes.forEach((node, i) => {
        const local = elapsed - (i % 3) * 0.08;
        if (local < 0) {
          done = false;
          return;
        }
        node.style.opacity = '1';

        const first = easeOutCubic(Math.min(1, Math.max(0, local / 0.4)));
        const second = easeOutCubic(Math.min(1, Math.max(0, (local - 0.42) / 0.4)));
        const dx = plan[i].xFirst ? plan[i].x * (1 - first) : plan[i].x * (1 - second);
        const dy = plan[i].xFirst ? plan[i].y * (1 - second) : plan[i].y * (1 - first);

        node.style.transform = dx === 0 && dy === 0 ? 'none' : `translate(${dx}px, ${dy}px)`;
        if (second < 1) done = false;
      });

      if (!done) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <h1 className="h1" ref={ref}>
      {words.map((word, i) => (
        <span className="w" key={`${word}-${i}`}>
          {word}
        </span>
      ))}
    </h1>
  );
}
