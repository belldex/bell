'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

let registered = false;
export function registerGsap() {
  if (!registered && typeof window !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
    registered = true;
  }
  return { gsap, ScrollTrigger };
}

/** True when the user prefers reduced motion (reactive). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

const LenisContext = createContext<Lenis | null>(null);
export const useLenis = () => useContext(LenisContext);

/** Lenis smooth scroll wired to ScrollTrigger. Disabled under reduced motion. */
export function SmoothScroll({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const { gsap: g, ScrollTrigger: st } = registerGsap();
    if (!enabled || reduced) {
      setLenis(null);
      return;
    }
    const instance = new Lenis({
      duration: 0.68,
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.15,
    });
    setLenis(instance);
    instance.on('scroll', st.update);
    const tick = (time: number) => instance.raf(time * 1000);
    g.ticker.add(tick);
    g.ticker.lagSmoothing(0);
    return () => {
      g.ticker.remove(tick);
      instance.destroy();
      setLenis(null);
    };
  }, [enabled, reduced]);

  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>;
}
