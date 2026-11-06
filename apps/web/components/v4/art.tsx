/* Looping artwork for /v4. Pure SVG and CSS: no scripts, no images to download. Every loop stops under
   prefers-reduced-motion and leaves a finished still frame behind. */

/* The bell, struck: rings leave a point and fade. Five rings, staggered, so the loop never visibly restarts. */
export function BellRings({ className = "" }: { className?: string }) {
  return (
    <svg className={`v4-rings ${className}`} viewBox="0 0 640 640" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3, 4].map((i) => (
        <circle key={i} className="v4-rings__ring" cx="320" cy="320" r="150" style={{ animationDelay: `${i * 1.7}s` }} />
      ))}
      <circle className="v4-rings__halo" cx="320" cy="320" r="16" />
      <circle className="v4-rings__core" cx="320" cy="320" r="5" />
    </svg>
  );
}

/* 01 · orders gather in escrow */
const DOTS: [number, number][] = [[-86, -34], [-96, 8], [-78, 40], [84, -38], [96, 4], [80, 38]];
export function OrdersVignette() {
  return (
    <svg className="v4-vig" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
      <rect className="v4-vig__box" x="92" y="36" width="56" height="48" rx="3" />
      <path className="v4-vig__lid" d="M92 36H148" />
      {DOTS.map(([dx, dy], i) => (
        <circle key={i} className="v4-vig__dot" cx="120" cy="60" r="4" style={{ ["--dx" as string]: `${dx}px`, ["--dy" as string]: `${dy}px`, animationDelay: `${i * 0.38}s` }} />
      ))}
    </svg>
  );
}

/* 02 · the book locks at the bell */
export function LockVignette() {
  return (
    <svg className="v4-vig" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
      <path className="v4-vig__rail" d="M16 60H224" />
      <rect className="v4-vig__bar v4-vig__bar--l" x="16" y="48" width="104" height="24" rx="2" />
      <rect className="v4-vig__bar v4-vig__bar--r" x="120" y="48" width="104" height="24" rx="2" />
      <circle className="v4-vig__strike" cx="120" cy="60" r="10" />
      <circle className="v4-vig__pin" cx="120" cy="60" r="4" />
    </svg>
  );
}

/* 03 · one clearing price across the book */
export function ClearVignette() {
  return (
    <svg className="v4-vig" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
      <path className="v4-vig__axis" d="M20 100H224M20 100V14" />
      <path className="v4-vig__buy" pathLength="1" d="M24 26H70V44H116V58H150" />
      <path className="v4-vig__sell" pathLength="1" d="M24 88H64V74H112V60H150" />
      <path className="v4-vig__out" pathLength="1" d="M150 58H180V70H214M150 60H178V46H212" />
      <path className="v4-vig__price" pathLength="1" d="M20 59H224" />
      <circle className="v4-vig__hit" cx="150" cy="59" r="4.5" />
    </svg>
  );
}
