import { SmoothScroll } from '@/lib/motion';
import { SiteNav } from '@/components/landing/SiteNav';
import { Hero } from '@/components/landing/Hero';
import { BellClock } from '@/components/landing/BellClock';
import { FeeDecay } from '@/components/landing/FeeDecay';
import { WeekendEpisode } from '@/components/landing/WeekendEpisode';
import { Classes } from '@/components/landing/Classes';
import { Architecture } from '@/components/landing/Architecture';
import { Promises } from '@/components/landing/Promises';
import { Cta, Footer } from '@/components/landing/Cta';

export default function LandingPage() {
  return (
    <SmoothScroll>
      <SiteNav />
      <main id="main">
        <Hero />
        <BellClock />
        <FeeDecay />
        <WeekendEpisode />
        <Classes />
        <Architecture />
        <Promises />
        <Cta />
      </main>
      <Footer />
    </SmoothScroll>
  );
}
