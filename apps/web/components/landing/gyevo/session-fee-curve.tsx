"use client";

import { useEffect, useRef } from "react";

export function SessionFeeCurve() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const board = svg?.closest<HTMLElement>(".lp-lend__board");
    const curve = svg?.querySelector<SVGPathElement>(".lp-lend__curve");
    const halo = svg?.querySelector<SVGCircleElement>(".lp-lend__scrubber-halo");
    const dot = svg?.querySelector<SVGCircleElement>(".lp-lend__scrubber-dot");
    if (!svg || !board || !curve || !halo || !dot) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    const update = () => {
      raf = 0;
      if (reduced.matches) {
        svg.style.setProperty("--fee-progress", "1");
        board.dataset.activeSession = "4";
        return;
      }

      const top = board.getBoundingClientRect().top;
      const start = window.innerHeight * 0.86;
      const end = window.innerHeight * 0.14;
      const progress = Math.max(0, Math.min(1, (start - top) / (start - end)));
      svg.style.setProperty("--fee-progress", progress.toFixed(4));
      board.dataset.activeSession = String(Math.min(4, Math.floor(progress * 5)));

      const point = curve.getPointAtLength(curve.getTotalLength() * progress);
      halo.setAttribute("cx", point.x.toFixed(2));
      halo.setAttribute("cy", point.y.toFixed(2));
      dot.setAttribute("cx", point.x.toFixed(2));
      dot.setAttribute("cy", point.y.toFixed(2));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    reduced.addEventListener("change", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      reduced.removeEventListener("change", schedule);
    };
  }, []);

  return (
    <svg ref={svgRef} className="lp-lend__chart" viewBox="0 0 1000 350" role="img" aria-labelledby="fee-chart-title fee-chart-desc">
      <title id="fee-chart-title">Illustrative BELL base fees through a market day</title>
      <desc id="fee-chart-desc">The base fee changes by session: pre-market 0.30 percent, regular 0.05 percent, after-hours 0.30 percent, overnight 0.50 percent, and scheduled close 1.00 percent.</desc>
      <defs>
        <linearGradient id="fee-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#EEECE5" stopOpacity=".2" />
          <stop offset="1" stopColor="#EEECE5" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="lp-lend__grid" aria-hidden="true">
        <path d="M70 64H950 M70 132H950 M70 200H950 M70 268H950" />
        <text x="8" y="68">1.00</text><text x="8" y="136">0.75</text><text x="8" y="204">0.50</text><text x="8" y="272">0.25</text>
      </g>
      <path className="lp-lend__area" d="M90 238H224 Q242 238 242 256V305H398Q416 305 416 256V238H572Q590 238 590 205V184H746Q764 184 764 126V64H930V320H90Z" />
      <path className="lp-lend__curve-glow" d="M90 238H224 Q242 238 242 256V305H398Q416 305 416 256V238H572Q590 238 590 205V184H746Q764 184 764 126V64H930" />
      <path className="lp-lend__curve" pathLength="1000" d="M90 238H224 Q242 238 242 256V305H398Q416 305 416 256V238H572Q590 238 590 205V184H746Q764 184 764 126V64H930" />
      <g className="lp-lend__points" aria-hidden="true">
        <g style={{ ["--fee-step" as string]: 0.1 }}><circle cx="155" cy="238" r="7" /><text x="155" y="216">0.30%</text></g>
        <g style={{ ["--fee-step" as string]: 0.3 }}><circle cx="320" cy="305" r="7" /><text x="320" y="283">0.05%</text></g>
        <g style={{ ["--fee-step" as string]: 0.5 }}><circle cx="495" cy="238" r="7" /><text x="495" y="216">0.30%</text></g>
        <g style={{ ["--fee-step" as string]: 0.7 }}><circle cx="670" cy="184" r="7" /><text x="670" y="162">0.50%</text></g>
        <g className="lp-lend__point--close" style={{ ["--fee-step" as string]: 0.9 }}><circle cx="850" cy="64" r="8" /><text x="850" y="42">1.00%</text></g>
      </g>
      <circle className="lp-lend__scrubber-halo" cx="90" cy="238" r="13" aria-hidden="true" />
      <circle className="lp-lend__scrubber-dot" cx="90" cy="238" r="4" aria-hidden="true" />
    </svg>
  );
}
