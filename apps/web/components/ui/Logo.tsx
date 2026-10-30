import Image from 'next/image';
import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

/** The official BELL brand mark used throughout the site and app. */
export function LogoMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <Image src="/assets/bell-logo-transparent.png" alt="" aria-hidden="true" width={size} height={size} className={cn('block shrink-0 object-contain', className)} />
  );
}

export function BellWordmark({ children = 'BELL', className }: { children?: ReactNode; className?: string }) {
  return <span className={cn('bell-wordmark', className)}>{children}</span>;
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={36} className="h-9 w-9" />
      <BellWordmark className="text-[1.65rem] text-ink" />
    </span>
  );
}
