'use client';

import Link from 'next/link';
import { ArrowUpRight, BellRing, Gauge, ShieldCheck } from 'lucide-react';

const FEATURES = [
  {
    id: 'market-rhythm',
    name: 'Market rhythm',
    label: 'Session-aware liquidity',
    title: 'A pool should know what time it is.',
    description: 'Opening, regular, post-market and overnight sessions each bring their own verified fee and flow limits. When the market feed cannot be trusted, the pool does not guess.',
    action: 'Explore pools',
    href: '/pools',
    Visual: MarketVisual,
  },
  {
    id: 'risk-policy',
    name: 'Risk policy',
    label: 'Rules before swaps',
    title: 'Every swap meets its limits first.',
    description: 'A pool checks session state, reference freshness and rolling flow budgets before execution. PRICE_GUARDED adds reviewed independent references; SESSION_ONLY keeps session controls and raw-unit bounds.',
    action: 'Read the policy',
    href: '/protocol',
    Visual: RiskVisual,
  },
  {
    id: 'planned-close',
    name: 'Planned close',
    label: 'One bounded episode',
    title: 'Closed markets still need a safe boundary.',
    description: 'A verified historical close anchor bounds trading after the bell. Its source, age and one non-refilling episode budget stay visible; recovery waits for fresh checkpoints.',
    action: 'Review close rules',
    href: '/protocol#closure',
    Visual: CloseVisual,
  },
] as const;

export default function PinnedFeatures() {
  return (
    <section className="bell-features" aria-label="BELL policy stories">
      <div className="bell-feature-runway" data-feature-runway data-mode="pinned">
        <div className="bell-feature-stage">
          <div className="bell-feature-topline">
            <span>Built around the trading day</span>
            <span className="bell-feature-live"><i />Policy in view</span>
          </div>
          <div className="bell-feature-scenes">
            {FEATURES.map(({ Visual, ...feature }) => (
              <article key={feature.id} id={feature.id} className="bell-feature-scene" data-feature-scene data-feature={feature.id} data-on="false" aria-labelledby={`${feature.id}-title`}>
                <div className="bell-feature-copy">
                  <p className="bell-feature-kicker">{feature.label}</p>
                  <h2 id={`${feature.id}-title`}>{feature.title}</h2>
                  <p className="bell-feature-description">{feature.description}</p>
                  <Link className="bell-feature-link" href={feature.href}>
                    {feature.action}<ArrowUpRight size={16} aria-hidden="true" />
                  </Link>
                </div>
                <div className="bell-feature-art" aria-hidden="true"><Visual /></div>
              </article>
            ))}
          </div>
          <nav className="bell-feature-rail" aria-label="BELL landing sections">
            {FEATURES.map((feature) => <a key={feature.id} href={`#${feature.id}`} data-feature-link={feature.id}>{feature.name}</a>)}
          </nav>
        </div>
        <div className="bell-feature-slots" aria-hidden="true">
          {FEATURES.map((feature) => <div className="bell-feature-slot" key={feature.id}><span data-feature-anchor={feature.id} /></div>)}
        </div>
      </div>
    </section>
  );
}

function MarketVisual() {
  return (
    <div className="bell-visual bell-visual-market">
      <div className="bell-visual-caption"><span>Verified session</span><b>MON · ET</b></div>
      <div className="bell-session-line"><span className="bell-session-night" /><span className="bell-session-pre" /><span className="bell-session-regular" /><span className="bell-session-post" /><span className="bell-session-night" /></div>
      <div className="bell-session-labels"><span>Overnight</span><span>Pre-market</span><span>Regular</span><span>Post-market</span><span>Overnight</span></div>
      <div className="bell-clock-reading"><BellRing size={22} strokeWidth={1.4} /><div><small>SESSION NOW</small><strong>Regular</strong></div><b>09:42</b></div>
      <div className="bell-visual-foot"><span>Session controls active</span><span>Source: verified feed</span></div>
    </div>
  );
}

function RiskVisual() {
  return (
    <div className="bell-visual bell-visual-risk">
      <div className="bell-visual-caption"><span>Before a swap</span><b>POLICY CHECK</b></div>
      <div className="bell-risk-flow"><div><span>Market state</span><b>Verified</b></div><i /><div><span>Pool policy</span><b>In bounds</b></div><i /><div className="bell-risk-allow"><ShieldCheck size={18} /><b>Allow swap</b></div></div>
      <div className="bell-risk-meters"><div><span>Per-trade cap</span><i><b style={{ width: '58%' }} /></i><strong>58%</strong></div><div><span>Rolling budget</span><i><b style={{ width: '34%' }} /></i><strong>34%</strong></div></div>
      <div className="bell-visual-foot"><span><Gauge size={14} /> Stale input → halt</span><span>Illustrative policy view</span></div>
    </div>
  );
}

function CloseVisual() {
  return (
    <div className="bell-visual bell-visual-close">
      <div className="bell-visual-caption"><span>Planned close</span><b>BOUNDARY CHECK</b></div>
      <div className="bell-anchor-card"><span className="bell-anchor-mark"><ShieldCheck size={19} /></span><div><small>LAST VALID CLOSE</small><strong>Anchor confirmed</strong></div><b>VERIFIED</b></div>
      <div className="bell-close-band"><div className="bell-close-band-label"><span>Allowed price band</span><b>Bounded</b></div><div className="bell-band-track"><i /><b /></div><div className="bell-band-labels"><span>Lower bound</span><span>Close anchor</span><span>Upper bound</span></div></div>
      <div className="bell-episode"><div><span>Episode budget</span><b>Single · non-refilling</b></div><i><b style={{ width: '42%' }} /></i></div>
      <div className="bell-visual-foot"><span>Recovery requires fresh checkpoints</span><span>Illustrative policy view</span></div>
    </div>
  );
}
