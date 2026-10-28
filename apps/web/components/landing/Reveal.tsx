'use client';

import { useEffect, useRef } from 'react';

/**
 * Adds the `in` class once the element scrolls past the lower third of the
 * viewport, which is what the reference CSS transitions on.
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

    const target = el.parentElement ?? el;
    const check = () => {
      if (target.getBoundingClientRect().top < 0.5 * window.innerHeight + 25) {
        el.classList.add('in');
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
