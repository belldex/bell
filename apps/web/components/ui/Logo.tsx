import { cn } from '@/lib/format';

/** BELL mark: a bell dome built from concentric arcs + a clapper dot. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="bell-mark" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#dce5e4" />
          <stop offset="0.55" stopColor="#a4b6b2" />
          <stop offset="1" stopColor="#718582" />
        </linearGradient>
      </defs>
      <path d="M16 3.2c-5.4 0-9.2 4-9.2 9.4V19l-2.4 4.2h23.2L25.2 19v-6.4C25.2 7.2 21.4 3.2 16 3.2Z" stroke="url(#bell-mark)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M11.2 13.2c.4-2.6 2.2-4.4 4.8-4.4" stroke="url(#bell-mark)" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
      <circle cx="16" cy="27.4" r="2" fill="url(#bell-mark)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className="h-7 w-7" />
      <span className="font-display text-[1.65rem] leading-none tracking-wide text-ink">BELL</span>
    </span>
  );
}
