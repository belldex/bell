'use client';

import Link from 'next/link';
import { ArrowRight, ArrowUpRight, BookOpenText, CircleDot, ShieldCheck } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { registerGsap, useReducedMotion, SmoothScroll } from '@/lib/motion';
import { Logo } from '@/components/ui/Logo';

const STORIES = [
  {
    number: '01',
    tag: 'SESSION POLICY',
    title: 'A stock pool has market hours. Its risk should too.',
    copy: 'BELL changes fee and flow limits across regular, extended, overnight and planned closed sessions. When the calendar, source or health is unclear, swaps stop instead of guessing.',
    mark: 'CLOCK / SESSION / STATE',
  },
  {
    number: '02',
    tag: 'BOUNDED FLOW',
    title: 'Every swap has a limit. A weekend has one budget.',
    copy: 'Per-trade and rolling gross-flow caps apply to both pool currencies. A planned close also has an episode budget that does not refill at midnight, after a pause, or when liquidity changes.',
    mark: 'TWO CURRENCIES / GROSS / NO REFILL',
  },
  {
    number: '03',
    tag: 'PRICE-GUARDED',
    title: 'A frozen stock close is not a live weekend price.',
    copy: 'PRICE_GUARDED pools require approved independent references. A valid close anchor may be paired with a live counterasset quote; the displayed reference stays labelled historical.',
    mark: 'REFERENCE / PROVENANCE / BAND',
  },
  {
    number: '04',
    tag: 'SESSION-ONLY',
    title: 'No oracle for the counterasset? No fair-price claim.',
    copy: 'SESSION_ONLY pools retain verified stock-session controls and raw-unit flow limits, without pretending an unpriced counterasset has independent price protection or a trustworthy USD NAV.',
    mark: 'SESSION / RAW UNITS / NO FAIR VALUE',
  },
];

const MARQUEE = [
  'REGULAR · 0.05%', 'PRE / POST · 0.30%', 'OVERNIGHT · 0.50%', 'CLOSED · 1.00%',
  'PLANNED CLOSURE', 'FROZEN CLOSE', 'ROLLING FLOW CAP', 'FAIL CLOSED',
];

function AnnouncementBar() {
  return (
    <div className="bell-topline">
      <span className="bell-topline-dot" aria-hidden="true" />
      <span>BELL · BOURSE-EVENT LIQUIDITY LAYER</span>
      <span className="bell-topline-divider" aria-hidden="true">/</span>
      <span>ROBINHOOD CHAIN · TESTNET REHEARSAL</span>
    </div>
  );
}

function Header() {
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <header className="bell-hdr">
      <nav className="bell-nav" aria-label="Primary">
        <Link href="/" className="bell-brand" aria-label="BELL home"><Logo /></Link>
        <div className="bell-nav-links">
          <a href="#protocol">Protocol</a>
          <a href="#sessions">Sessions</a>
          <a href="#pool-classes">Pool classes</a>
          <a href="#status">Status</a>
        </div>
        <Link className="bell-nav-cta" href="/pools">Explore pools <ArrowUpRight size={14} aria-hidden="true" /></Link>
        <details className="bell-mobile-menu" ref={menu}>
          <summary aria-label="Open menu"><span /><span /></summary>
          <div className="bell-mobile-panel">
            <a href="#protocol" onClick={() => menu.current?.removeAttribute('open')}>Protocol</a>
            <a href="#sessions" onClick={() => menu.current?.removeAttribute('open')}>Sessions</a>
            <a href="#pool-classes" onClick={() => menu.current?.removeAttribute('open')}>Pool classes</a>
            <a href="#status" onClick={() => menu.current?.removeAttribute('open')}>Status</a>
            <Link href="/pools">Explore pools <ArrowUpRight size={14} aria-hidden="true" /></Link>
          </div>
        </details>
      </nav>
    </header>
  );
}

function Hero() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    if (reduced || !root.current) return;
    const { gsap, ScrollTrigger } = registerGsap();
    const ctx = gsap.context(() => {
      gsap.from('[data-bell-hero-reveal]', {
        y: 50, opacity: 0, duration: 0.9, stagger: 0.09, ease: 'power3.out', delay: 0.12,
      });
      gsap.to('[data-bell-hero-art]', {
        yPercent: 12, scale: 1.04, ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: 1 },
      });
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  return (
    <section ref={root} className="bell-hero" aria-labelledby="bell-hero-title">
      <div className="bell-hero-copy">
        <p className="bell-eyebrow" data-bell-hero-reveal><span /> A SESSION-AWARE HOOK LAYER FOR UNISWAP V4</p>
        <h1 id="bell-hero-title" data-bell-hero-reveal>Liquidity that<br /><span>knows the bell.</span></h1>
        <p className="bell-hero-lede" data-bell-hero-reveal>
          Stock markets close. BELL brings session-aware fees, bounded flow and explicit weekend controls to tokenized-stock pools.
        </p>
        <div className="bell-hero-actions" data-bell-hero-reveal>
          <Link className="bell-button bell-button-primary" href="/pools">Explore pools <ArrowRight size={15} aria-hidden="true" /></Link>
          <a className="bell-button bell-button-quiet" href="#protocol">Read the protocol <ArrowUpRight size={14} aria-hidden="true" /></a>
        </div>
        <p className="bell-preview-note" data-bell-hero-reveal><CircleDot size={12} aria-hidden="true" /> Rehearsal build · Production swaps are not enabled</p>
      </div>
      <div className="bell-hero-art-wrap" aria-hidden="true">
        <div className="bell-hero-orbit bell-hero-orbit-one" />
        <div className="bell-hero-orbit bell-hero-orbit-two" />
        <img data-bell-hero-art className="bell-hero-art" src="/assets/hero-bell.jpg" alt="" />
        <div className="bell-art-label">MARKET STATE <b>→</b> POOL POLICY</div>
      </div>
      <div className="bell-hero-index" aria-hidden="true"><span>01</span><span>SESSION / RISK / LIQUIDITY</span></div>
    </section>
  );
}

function TrustStrip() {
  return (
    <section className="bell-trust-strip" aria-label="Protocol properties">
      <span>IMMUTABLE PER-POOL CONFIG</span><i />
      <span>GROSS FLOW LIMITS</span><i />
      <span>PLANNED-CLOSE PROVENANCE</span><i />
      <span>FAIL-CLOSED POLICY</span>
    </section>
  );
}

function StorySections() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    if (reduced || !root.current) return;
    const { gsap, ScrollTrigger } = registerGsap();
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-bell-story]').forEach((item) => {
        gsap.from(item, {
          y: 50, opacity: 0, duration: 0.9, ease: 'power3.out',
          scrollTrigger: { trigger: item, start: 'top 84%', once: true },
        });
      });
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  return (
    <section id="protocol" className="bell-stories" ref={root} aria-label="How BELL works">
      <div className="bell-section-heading" data-bell-story>
        <p className="bell-eyebrow"><span /> THE POLICY LAYER</p>
        <h2>Built for markets<br />that <em>close.</em></h2>
        <p>One immutable hook instance per pool. Session, price provenance and gross-flow policy are shown before a user signs.</p>
      </div>
      <article className="bell-story-card bell-story-wide" data-bell-story>
        <div className="bell-story-copy">
          <p className="bell-story-number">{STORIES[0].number} <span>· {STORIES[0].tag}</span></p>
          <h3>{STORIES[0].title}</h3>
          <p>{STORIES[0].copy}</p>
          <a href="#sessions">See session policy <ArrowUpRight size={13} aria-hidden="true" /></a>
        </div>
        <div className="bell-clock-art" aria-label="BELL session schedule, shown as a preview illustration">
          <div className="bell-clock-ring"><div className="bell-clock-hand" /><span className="bell-clock-center">BELL</span><i className="bell-clock-tick tick-a" /><i className="bell-clock-tick tick-b" /><i className="bell-clock-tick tick-c" /><i className="bell-clock-tick tick-d" /></div>
          <div className="bell-clock-caption"><span>SESSION STATE</span><b>REGULAR / SAMPLE</b></div>
        </div>
      </article>
      <article className="bell-story-card bell-story-tall bell-story-reverse" data-bell-story>
        <div className="bell-story-copy">
          <p className="bell-story-number">{STORIES[1].number} <span>· {STORIES[1].tag}</span></p>
          <h3>{STORIES[1].title}</h3>
          <p>{STORIES[1].copy}</p>
          <a href="/pools">Explore sample pool budgets <ArrowUpRight size={13} aria-hidden="true" /></a>
        </div>
        <div className="bell-budget-art" aria-label="Illustrative two-currency budget bars">
          <div className="bell-art-topline"><span>POOL BUDGET</span><b>PREVIEW / RAW UNITS</b></div>
          <div className="bell-budget-row"><span>USDG</span><div><i style={{ width: '68%' }} /></div><b>68%</b></div>
          <div className="bell-budget-row"><span>AAPL</span><div><i style={{ width: '42%' }} /></div><b>42%</b></div>
          <div className="bell-budget-footer"><span>ROLLING · 300 S</span><span>CLOSED · EPISODE</span></div>
        </div>
      </article>
      <article id="sessions" className="bell-story-card bell-story-tall" data-bell-story>
        <div className="bell-story-copy">
          <p className="bell-story-number">{STORIES[2].number} <span>· {STORIES[2].tag}</span></p>
          <h3>{STORIES[2].title}</h3>
          <p>{STORIES[2].copy}</p>
          <a href="/pools">View pool classes <ArrowUpRight size={13} aria-hidden="true" /></a>
        </div>
        <div className="bell-reference-art" aria-label="Reference provenance diagram">
          <div className="bell-reference-node"><span>STOCK / CLOSED</span><b>FROZEN CLOSE</b><small>HISTORICAL · NOT LIVE</small></div>
          <div className="bell-reference-connector"><span>÷</span><i /></div>
          <div className="bell-reference-node"><span>COUNTERASSET</span><b>LIVE QUOTE</b><small>FRESHNESS BOUND</small></div>
        </div>
      </article>
      <article className="bell-story-card bell-story-wide bell-story-last" data-bell-story>
        <div className="bell-story-copy">
          <p className="bell-story-number">{STORIES[3].number} <span>· {STORIES[3].tag}</span></p>
          <h3>{STORIES[3].title}</h3>
          <p>{STORIES[3].copy}</p>
          <a href="/pools">Compare pool classes <ArrowUpRight size={13} aria-hidden="true" /></a>
        </div>
        <div className="bell-session-only-art"><span>NO REFERENCE</span><b>SESSION</b><b>CONTROLS</b><span>RAW-UNIT LIMITS · NO USD NAV</span></div>
      </article>
    </section>
  );
}

function HookMarquee() {
  const items = [...MARQUEE, ...MARQUEE];
  return (
    <div className="bell-marquee" aria-label="BELL policy facts">
      <div className="bell-marquee-track" aria-hidden="true">
        {items.map((item, index) => <span key={`${item}-${index}`}>{item}<i>✳</i></span>)}
      </div>
    </div>
  );
}

function WallSection() {
  const rows = [
    ['REGULAR', '0.05%', 'ACTIVE INPUTS REQUIRED'],
    ['PRE / POST', '0.30%', 'SUPPORTED FEED + CAPABILITY'],
    ['OVERNIGHT', '0.50%', 'SUPPORTED FEED + CAPABILITY'],
    ['CLOSED', '1.00%', 'PLANNED CONTEXT + VALID ANCHOR'],
  ];
  return (
    <section id="pool-classes" className="bell-wall">
      <div className="bell-wall-heading">
        <p className="bell-eyebrow"><span /> DESIGNED TO FAIL CLOSED</p>
        <h2>Two classes.<br /><em>Different promises.</em></h2>
        <p>Pool class is immutable. BELL never upgrades an unpriced counterasset into a price-protected pool by UI toggle.</p>
      </div>
      <div className="bell-wall-content">
        <div className="bell-session-table">
          <div className="bell-table-head"><span>SESSION</span><span>BASE LP FEE</span><span>REQUIREMENT</span></div>
          {rows.map(([session, fee, note]) => <div className="bell-table-row" key={session}><b>{session}</b><strong>{fee}</strong><span>{note}</span></div>)}
        </div>
        <div className="bell-class-grid">
          <article className="bell-class-panel">
            <span className="bell-class-tag">CLASS / 01</span><h3>PRICE_<br />GUARDED</h3>
            <p>Both assets need reviewed independent references. Price bands constrain execution; they do not guarantee fair value.</p>
            <span className="bell-class-band">ACTIVE ±2% <i>·</i> FROZEN STOCK ±5%</span>
          </article>
          <article className="bell-class-panel bell-class-session">
            <span className="bell-class-tag">CLASS / 02</span><h3>SESSION_<br />ONLY</h3>
            <p>Session controls and raw-unit limits for a pool whose counterasset has no independent price protection.</p>
            <span className="bell-class-band">NO COUNTERASSET PRICE CLAIM</span>
          </article>
        </div>
        <div className="bell-proof-note"><ShieldCheck size={15} aria-hidden="true" /><span>Unknown, stale, conflicting or unexpectedly closed data halts swaps. LP removal and collection remain separate from BELL swap guards.</span></div>
      </div>
    </section>
  );
}

function BuildSection() {
  return (
    <section id="status" className="bell-build">
      <div className="bell-build-art" aria-hidden="true">
        <div className="bell-build-orbit orbit-a" /><div className="bell-build-orbit orbit-b" />
        <div className="bell-build-mark">B<span>E</span>LL</div>
        <div className="bell-build-coordinate">BELL / POOL POLICY / 01</div>
      </div>
      <div className="bell-build-copy">
        <p className="bell-eyebrow"><span /> TESTNET REHEARSAL</p>
        <h2>Inspect the product.<br /><em>Know what is live.</em></h2>
        <p>BELL's contracts are deployed on Robinhood Chain Testnet for rehearsal. This homepage is explanatory: sample pools and dashboard values are previews; production swaps are not enabled and mainnet has not been approved.</p>
        <div className="bell-build-actions">
          <Link className="bell-button bell-button-primary" href="/pools">Open pool preview <ArrowRight size={15} aria-hidden="true" /></Link>
          <Link className="bell-button bell-button-quiet" href="/create">Create pool preview <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </div>
        <div className="bell-build-status"><span><i /> POLICY PREVIEW</span><span>LIVE SWAPS / DISABLED</span></div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bell-footer">
      <div className="bell-footer-main">
        <Link href="/" className="bell-footer-brand" aria-label="BELL home"><Logo /></Link>
        <p>Bourse-Event Liquidity Layer.<br />Session-aware liquidity for tokenized-stock pools.</p>
        <div className="bell-footer-groups">
          <div><b>PRODUCT</b><Link href="/pools">Pool directory</Link><Link href="/swap">Swap preview</Link><Link href="/create">Create pool</Link><Link href="/positions">LP positions</Link></div>
          <div><b>PROTOCOL</b><a href="#sessions">Sessions</a><a href="#pool-classes">Pool classes</a><a href="#protocol">Policy</a><Link href="/pools">Explore pools</Link></div>
          <div><b>MORE</b><a href="#top">Back to top</a><a href="https://github.com" target="_blank" rel="noreferrer noopener"><span aria-hidden="true">GH</span> Source</a><a href="#status"><BookOpenText size={13} aria-hidden="true" /> Rehearsal status</a></div>
        </div>
      </div>
      <div className="bell-footer-bottom"><span>© 2026 BELL · BOURSE-EVENT LIQUIDITY LAYER</span><span>DESIGN / RISK / POLICY · TESTNET REHEARSAL</span></div>
      <p className="bell-footer-disclaimer">Sample data is illustrative. Production swaps are not enabled. Mainnet release has not been approved. Liquidity provision carries risk, including loss of principal. Nothing here is a promise of profit or financial advice.</p>
    </footer>
  );
}

function LandingPageContent() {
  return (
    <div className="bell-home" id="top">
      <AnnouncementBar />
      <Header />
      <main id="main">
        <Hero />
        <TrustStrip />
        <StorySections />
        <HookMarquee />
        <WallSection />
        <BuildSection />
      </main>
      <Footer />
    </div>
  );
}

export default function LandingPage() {
  return <SmoothScroll><LandingPageContent /></SmoothScroll>;
}
