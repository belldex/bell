'use client';

import { useLayoutEffect, useRef, type ElementType, type ReactNode } from 'react';
import { registerGsap, useReducedMotion } from '@/lib/motion';

/** Scroll-triggered fade/translate reveal; children can opt in to stagger via [data-stagger]. */
export function Reveal({ children, as, className, y = 40, stagger = 0.1 }: { children: ReactNode; as?: ElementType; className?: string; y?: number; stagger?: number }) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const Tag = (as ?? 'div') as ElementType;

  useLayoutEffect(() => {
    if (reduced || !ref.current) return;
    const { gsap } = registerGsap();
    const ctx = gsap.context(() => {
      const items = ref.current!.querySelectorAll('[data-stagger]');
      const targets = items.length ? items : [ref.current!];
      gsap.from(targets, {
        y,
        opacity: 0,
        duration: 1.1,
        ease: 'expo.out',
        stagger,
        scrollTrigger: { trigger: ref.current, start: 'top 82%', once: true },
      });
    }, ref);
    return () => ctx.revert();
  }, [reduced, y, stagger]);

  return <Tag ref={ref} className={className}>{children}</Tag>;
}

/** Vertical scroll-scrubbed parallax for any element. */
export function Parallax({ children, speed = 12, className }: { children: ReactNode; speed?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    if (reduced || !ref.current) return;
    const { gsap } = registerGsap();
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ref.current,
        { yPercent: speed },
        { yPercent: -speed, ease: 'none', scrollTrigger: { trigger: ref.current, start: 'top bottom', end: 'bottom top', scrub: true } },
      );
    }, ref);
    return () => ctx.revert();
  }, [reduced, speed]);

  return <div ref={ref} className={className}>{children}</div>;
}
