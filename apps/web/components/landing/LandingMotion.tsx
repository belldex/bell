'use client';

import { useEffect } from 'react';
import type Lenis from 'lenis';

let lenis: Lenis | null = null;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

export function scrollLandingTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return false;
  if (lenis) lenis.scrollTo(target, { duration: 1.35, easing: easeOutQuart });
  else target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

/** One scroll reader publishes cover and pinned-story progress; all motion reverses with scroll. */
export default function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.bell-landing');
    const cover = root?.querySelector<HTMLElement>('[data-cover-runway]');
    const runway = root?.querySelector<HTMLElement>('[data-feature-runway]');
    const idea = root?.querySelector<HTMLElement>('[data-idea-runway]');
    const footer = root?.querySelector<HTMLElement>('.bell-footer-curtain');
    const finalSpacer = root?.querySelector<HTMLElement>('[data-final-spacer]');
    if (!root || !cover || !runway || !idea || !footer || !finalSpacer) return;

    const ideaMedia = window.matchMedia('(min-width: 1024px) and (min-height: 680px) and (prefers-reduced-motion: no-preference)');
    const storyMedia = window.matchMedia('(min-width: 900px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)');
    const features = Array.from(runway.querySelectorAll<HTMLElement>('[data-feature-scene]'));
    const anchors = Array.from(runway.querySelectorAll<HTMLElement>('[data-feature-anchor]'));
    const featureIds = ['market-rhythm', 'risk-policy', 'planned-close'];
    let raf = 0;
    let lastCover = -1;
    let lastStory = -10;
    let lastFeature: string | null = null;

    const publishFeature = (id: string | null) => {
      if (lastFeature === id) return;
      lastFeature = id;
      window.dispatchEvent(new CustomEvent('bell:feature', { detail: id }));
      root.querySelectorAll<HTMLElement>('[data-feature-link]').forEach((link) => {
        link.dataset.active = link.dataset.featureLink === id ? 'true' : 'false';
      });
      if (id) {
        if (window.location.hash !== `#${id}`) window.history.replaceState(null, '', `#${id}`);
      } else if (featureIds.includes(window.location.hash.slice(1))) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };

    const update = () => {
      raf = 0;
      const coverRect = cover.getBoundingClientRect();
      const coverRun = Math.max(1, coverRect.height - window.innerHeight);
      const coverProgress = clamp(-coverRect.top / coverRun, 0, 1);
      if (Math.abs(coverProgress - lastCover) > 0.001) {
        lastCover = coverProgress;
        cover.style.setProperty('--cover-progress', coverProgress.toFixed(4));
      }

      const footerProgress = clamp((window.innerHeight - finalSpacer.getBoundingClientRect().top) / (window.innerHeight * 0.65), 0, 1);
      root.style.setProperty('--footer-progress', footerProgress.toFixed(4));
      const footerShown = footerProgress > 0.04;
      footer.inert = !footerShown;
      footer.setAttribute('aria-hidden', String(!footerShown));
      footer.style.pointerEvents = footerShown ? 'auto' : 'none';

      const ideaRect = idea.getBoundingClientRect();
      const overlap = window.innerHeight * 0.62;
      const ideaTravel = Math.max(1, ideaRect.height - window.innerHeight - overlap);
      const ideaProgress = ideaMedia.matches ? clamp((-ideaRect.top - overlap) / ideaTravel, 0, 1) : 0;
      const ideaZoom = ideaMedia.matches ? clamp(-ideaRect.top / overlap, 0, 1) : 1;
      idea.dataset.ready = 'true';
      idea.style.setProperty('--idea-progress', ideaProgress.toFixed(4));
      idea.style.setProperty('--idea-zoom', ideaZoom.toFixed(4));
      idea.dataset.state = ideaProgress < 0.32 ? '0' : ideaProgress < 0.67 ? '1' : '2';

      if (!storyMedia.matches) {
        runway.dataset.mode = 'stacked';
        delete runway.dataset.ready;
        features.forEach((item) => {
          item.id = item.dataset.feature ?? '';
          item.style.removeProperty('--v');
          item.style.removeProperty('--d');
          item.inert = false;
          item.dataset.on = 'true';
        });
        anchors.forEach((anchor) => anchor.removeAttribute('id'));
        publishFeature(null);
        return;
      }

      runway.dataset.mode = 'pinned';
      runway.dataset.ready = 'true';
      features.forEach((item) => item.removeAttribute('id'));
      anchors.forEach((anchor) => { anchor.id = anchor.dataset.featureAnchor ?? ''; });
      const vh = window.innerHeight;
      const u = -runway.getBoundingClientRect().top / (vh * 0.85);
      const smooth = (x: number) => x * x * (3 - 2 * x);
      const scene = u <= 0.82 ? 0 : u < 1.18 ? smooth(clamp((u - 0.82) / 0.36, 0, 1)) : u <= 1.82 ? 1 : u < 2.18 ? 1 + smooth(clamp((u - 1.82) / 0.36, 0, 1)) : 2;
      if (Math.abs(scene - lastStory) > 0.002) {
        lastStory = scene;
        runway.style.setProperty('--story-progress', scene.toFixed(4));
      }

      features.forEach((item, index) => {
        const distance = scene - index;
        const visibility = clamp(1.25 - Math.abs(distance) * 1.8, 0, 1);
        item.style.setProperty('--v', visibility.toFixed(3));
        item.style.setProperty('--d', distance.toFixed(3));
        item.dataset.on = visibility > 0.5 ? 'true' : 'false';
        item.inert = visibility <= 0.5;
      });

      publishFeature(u > -0.25 && u < 3.25 ? featureIds[clamp(Math.round(scene), 0, 2)] : null);
    };

    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    ideaMedia.addEventListener('change', schedule);
    storyMedia.addEventListener('change', schedule);
    update();
    const initialFeature = window.location.hash.slice(1);
    if (featureIds.includes(initialFeature)) requestAnimationFrame(() => scrollLandingTo(initialFeature));

    let alive = true;
    let smoothRaf = 0;
    let lastWake = 0;
    let teardownLenis = () => {};
    const startLenis = async () => {
      const { default: LenisClass } = await import('lenis');
      if (!alive || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      const instance = new LenisClass({
        lerp: 0.11,
        smoothWheel: true,
        syncTouch: false,
        autoRaf: false,
        anchors: false,
        prevent: (node) => !!node.closest('[role="dialog"], [data-rk], [data-lenis-prevent]'),
      });
      lenis = instance;
      const tick = (time: number) => {
        smoothRaf = 0;
        instance.raf(time);
        if (instance.isScrolling || performance.now() - lastWake < 220) smoothRaf = requestAnimationFrame(tick);
      };
      const wake = () => {
        lastWake = performance.now();
        if (!smoothRaf) smoothRaf = requestAnimationFrame(tick);
      };
      window.addEventListener('wheel', wake, { passive: true });
      window.addEventListener('keydown', wake, { passive: true });
      teardownLenis = () => {
        window.removeEventListener('wheel', wake);
        window.removeEventListener('keydown', wake);
        if (smoothRaf) cancelAnimationFrame(smoothRaf);
        smoothRaf = 0;
        instance.destroy();
        if (lenis === instance) lenis = null;
      };
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    let timer = 0;
    if (idle) idle(() => { void startLenis(); }, { timeout: 1200 });
    else timer = window.setTimeout(() => { void startLenis(); }, 200);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      teardownLenis();
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ideaMedia.removeEventListener('change', schedule);
      storyMedia.removeEventListener('change', schedule);
      publishFeature(null);
    };
  }, []);

  return null;
}
