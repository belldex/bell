'use client';

import { useEffect, useRef } from 'react';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Reference reveal: starts translated 50px down at opacity 0, then fades and
 * slides up over 0.9s once the element's parent scrolls past the viewport
 * midpoint. Honors prefers-reduced-motion by showing immediately.
 */
export default function Reveal({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      el.style.opacity = '1';
      el.style.transform = 'none';
      return;
    }

    el.style.opacity = '0';
    el.style.transform = 'translateY(50px)';
    el.style.transition = `opacity 0.9s ${EASE}, transform 0.9s ${EASE}`;

    const target = el.parentElement ?? el;
    const check = () => {
      if (target.getBoundingClientRect().top < 0.5 * window.innerHeight + 25) {
        el.classList.add('in');
        el.style.opacity = '1';
        el.style.transform = 'none';
        window.removeEventListener('scroll', check);
      }
    };

    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, []);

  return (
    <Tag ref={ref as never} className={`reveal ${className}`}>
      {children}
    </Tag>
  );
}
