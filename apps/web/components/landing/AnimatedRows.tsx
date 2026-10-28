'use client';

import { useEffect, useRef } from 'react';

type Props = { rows: string[][] };

/**
 * Marquee rows of pool-attribute chips. Each row drifts at its own speed and
 * direction, wrapping seamlessly. `*` prefixes the highlighted chips.
 */
export default function AnimatedRows({ rows }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    const rowNodes = Array.from(host.querySelectorAll<HTMLElement>('.row'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const reveal = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) host.classList.add('in');
      },
      { threshold: 0.1 },
    );
    reveal.observe(host);

    let onScreen = true;
    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
    });
    visibility.observe(host);

    const offsets = rowNodes.map((_, i) => -(137 * i) % 400);
    let raf = 0;

    const tick = () => {
      if (onScreen && !reduced) {
        rowNodes.forEach((node, i) => {
          offsets[i] += (i % 2 ? 1 : -1) * (0.12 + (i % 5) * 0.05);
          const half = node.scrollWidth / 2;
          if (offsets[i] < -half) offsets[i] += half;
          if (offsets[i] > 0) offsets[i] -= half;
          node.style.transform = `translateX(${offsets[i]}px)`;
        });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      reveal.disconnect();
      visibility.disconnect();
    };
  }, []);

  return (
    <div className="rows" ref={ref}>
      {rows.map((cells, rowIndex) => (
        <div
          className="row"
          key={`row-${rowIndex}`}
          style={{ transitionDelay: `${0.24 + 0.03 * rowIndex}s` }}
        >
          {[...cells, ...cells].map((cell, cellIndex) => (
            <span
              className={cell.startsWith('*') ? 'lit' : ''}
              key={`cell-${rowIndex}-${cellIndex}`}
              style={{ marginRight: 32 + (((7 * rowIndex + 13 * cellIndex) % 5) * 26) }}
            >
              {cell.replace(/^\*/, '')}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
