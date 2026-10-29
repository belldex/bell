import "./landing.css";
import { CoverReveal } from "./cover-reveal";
import { FinalReveal } from "./final-reveal";
import { LandingEffects } from "./landing-effects";
import { LandingNav } from "./landing-nav";
import { IdeaScene } from "./idea-scene";
import { SmoothScroll } from "./smooth-scroll";
import { FeatureStory } from "./feature-story";
import { FactsSection, PathSection, RoadmapSection, SessionSection } from "./sections";

/* The landing page. Presentation only: wallet, chain, credential and proof logic
   stay in the hooks and protocol modules, untouched. */
export function LandingPage() {
  return (
    <div className="lp" data-phase="light">
      <noscript>
        {/* Without JavaScript the opening can never animate, so show both phases stacked */}
        <style>{`.lp-cover{height:auto}.lp-stage{--e:1;--c:1;--q:0;position:relative;height:auto;overflow:visible}.lp-p1{position:relative;min-height:100svh}.lp-box{position:relative;clip-path:none;min-height:100svh}.lp-veil-cover,.lp-dot,.lp-outline,.lp-sparks{display:none}.lp-word,.lp-sub{transform:none;opacity:1}.lp-hero{min-height:100svh;height:auto}.lp-marq{position:relative}.lp-spacer{display:none}.lp-final{position:relative;height:auto}.lp-nav{position:absolute}.lp .lp-marq{background:var(--lp-bg);color:var(--lp-muted)}.lp-stage{background:var(--lp-bg)}.lp-p1{background:#fff}.lp-idea-run{height:auto;margin-top:0}.lp-idea-pin{position:static;height:auto}.lp-vcard,.lp-idea__steps{display:none}.lp-ledger--static{display:block}.lp-idea__copy,.lp-idea__stage{opacity:1!important;scale:none!important}`}</style>
      </noscript>
      <a className="lp-skip" href="#lp-content">Skip to content</a>
      <LandingNav appName="BELL" />

      <main className="lp-curtain" id="lp-content">
        <CoverReveal tagline="Know the bell. Bound flow." />
        <IdeaScene />
        <PathSection />
        <FeatureStory />
        <SessionSection />
        <RoadmapSection />
        <FactsSection />
      </main>

      <FinalReveal appName="BELL" />
      <LandingEffects />
      <SmoothScroll />
    </div>
  );
}
