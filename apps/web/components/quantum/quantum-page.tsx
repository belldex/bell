import { ArrowDown, ArrowRight, ArrowUpRight, Check, LockKeyhole, Shield, Waves } from 'lucide-react';
import { LandingEffects } from '@/components/landing/gyevo/landing-effects';
import { LandingNav } from '@/components/landing/gyevo/landing-nav';

const protections = [
  { input: 'Calendar roots', purpose: 'Authorize market-session schedules', status: 'Planned' },
  { input: 'Close anchors', purpose: 'Authorize session close observations', status: 'Planned' },
  { input: 'Price attestations', purpose: 'Authenticate reporter updates', status: 'Planned' },
  { input: 'Keeper & governance actions', purpose: 'Require both transition and PQ authorization', status: 'Planned' },
];

const phases = [
  { number: '01', title: 'Hybrid trust inputs', network: 'Elysium testnet', status: 'PLANNED', detail: 'Select a reviewed hash-based verifier, bind role keys, test rotation and replay rejection, then publish measured gas and transaction evidence.' },
  { number: '02', title: 'New hook template', network: 'Robinhood Chain Mainnet', status: 'GATED', detail: 'Only after testnet evidence and independent cryptographic review: deploy the v2 trust layer and a new hook/factory for new pools.' },
  { number: '03', title: 'Optional PQ accounts', network: 'Research', status: 'RESEARCH', detail: 'Explore opt-in smart accounts separately. Existing wallet signatures and PositionManager exits are not changed by this work.' },
];

const QUANTUM_SECTIONS = [
  { id: 'why', label: 'Why', desc: 'Why BELL is preparing its trust inputs.' },
  { id: 'scope', label: 'Scope', desc: 'What this work protects, and what it does not.' },
  { id: 'flow', label: 'Flow', desc: 'How hybrid authorization is planned to work.' },
  { id: 'roadmap', label: 'Roadmap', desc: 'The testnet and Mainnet gates.' },
  { id: 'evidence', label: 'Evidence', desc: 'What is deployed and verified today.' },
  { id: 'name', label: 'Name', desc: 'Why this research is called Bell State Hooks.' },
] as const;

function SectionHeading({ index, label, title }: { index: string; label: string; title: string }) {
  return (
    <div className="quantum-section-heading">
      <span className="quantum-section-heading__index">{index}</span>
      <div><p>{label}</p><h2>{title}</h2></div>
    </div>
  );
}

export function QuantumPage() {
  return (
    <div className="lp lp--bell legal proof quantum-public" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={QUANTUM_SECTIONS} />
      <main id="main" className="legal__main quantum-public__main">
      <div className="quantum-page">
      <header className="quantum-hero">
        <div className="quantum-hero__topline"><span className="quantum-mark"><Waves size={15} aria-hidden="true" /> BELL STATE HOOKS</span><span className="quantum-status"><i /> RESEARCH · PLANNED</span></div>
        <p className="quantum-kicker">PROTOCOL SECURITY / RESEARCH TRACK</p>
        <h1>Quantum-safe<br /><em>market structure.</em></h1>
        <p className="quantum-hero__lead">BELL’s trust inputs, signed for a post-quantum world.<br className="quantum-desktop-break" /> LP exits stay unconditional.</p>
        <div className="quantum-hero__rule"><span>01 — TRUST INPUTS</span><span>02 — HYBRID AUTH</span><span>03 — EXIT ALWAYS OPEN</span></div>
      </header>

      <section className="quantum-principle" aria-label="Security principle">
        <span className="quantum-principle__icon"><LockKeyhole size={18} aria-hidden="true" /></span>
        <p>Post-quantum signatures protect <strong>who can change market rules.</strong><br />They never decide whether you can withdraw liquidity.</p>
        <span className="quantum-principle__tag">EXIT INDEPENDENCE / INVARIANT</span>
      </section>

      <section id="why" className="quantum-section" aria-labelledby="quantum-why">
        <SectionHeading index="01" label="WHY PREPARE" title="Harvest now. Forge later." />
        <div className="quantum-why-grid">
          <p id="quantum-why" className="quantum-why-grid__lead">A sufficiently capable quantum computer could undermine today’s elliptic-curve signatures. Market infrastructure can start protecting its own trusted updates before that day.</p>
          <p className="quantum-copy">BELL can change how its contracts authorize calendars, price reports and privileged actions. It cannot change the signature scheme used by an ordinary user wallet or by the chain itself.</p>
        </div>
      </section>

      <section id="scope" className="quantum-section" aria-labelledby="quantum-scope">
        <SectionHeading index="02" label="PROTECTION BOUNDARY" title="What this can—and cannot—protect." />
        <div className="quantum-scope-grid">
          <div className="quantum-scope-list">
            <div className="quantum-table-head"><span>TRUST INPUT</span><span>WHY IT MATTERS</span><span>STATUS</span></div>
            {protections.map((item) => <div className="quantum-table-row" key={item.input}><strong>{item.input}</strong><span>{item.purpose}</span><b>{item.status}</b></div>)}
          </div>
          <aside className="quantum-wallet-limit">
            <div className="quantum-limit-icon"><Shield size={20} aria-hidden="true" /></div>
            <p className="quantum-label">OUTSIDE THIS UPGRADE</p>
            <h3>Your wallet keys.</h3>
            <p>User EOA signatures still depend on the chain’s account cryptography. A future PQ smart account would be optional and separate.</p>
            <div className="quantum-limit-note"><Check size={14} aria-hidden="true" /> LP withdrawal does not call PQ verification</div>
          </aside>
        </div>
      </section>

      <section id="flow" className="quantum-section" aria-labelledby="quantum-flow">
        <SectionHeading index="03" label="PLANNED AUTHORIZATION FLOW" title="Two signatures. One accepted update." />
        <p className="quantum-section-intro">During the transition, a privileged update must pass the existing ECDSA check <em>and</em> a post-quantum signature check. Either failure rejects the update.</p>
        <div className="quantum-flow" role="img" aria-label="Planned flow: ECDSA and post-quantum signatures go through HybridAuth to v2 registries, a v3 hook, and PoolManager. LP exit bypasses PQ authorization.">
          <div className="quantum-flow__signers"><span>KEEPER / REPORTER / GOVERNANCE</span><div><b>ECDSA</b><b>POST-QUANTUM</b></div></div>
          <ArrowRight className="quantum-flow__arrow" size={18} aria-hidden="true" />
          <div className="quantum-flow__node quantum-flow__node--accent"><span>AUTHORIZATION</span><strong>HybridAuth</strong><small>both required</small></div>
          <ArrowRight className="quantum-flow__arrow" size={18} aria-hidden="true" />
          <div className="quantum-flow__stack"><div className="quantum-flow__node"><span>TRUST REGISTRIES</span><strong>Calendar · Session · Price</strong></div><ArrowDown size={15} aria-hidden="true" /><div className="quantum-flow__node"><span>MARKET LOGIC</span><strong>BellHookV3 → PoolManager</strong></div></div>
        </div>
        <div className="quantum-exit-line"><span className="quantum-exit-line__dash" /><span>LP REMOVE</span><ArrowRight size={15} aria-hidden="true" /><strong>PositionManager</strong><span className="quantum-exit-line__open">NO PQ GATE</span></div>
      </section>

      <section className="quantum-section" aria-labelledby="quantum-roadmap">
        <SectionHeading index="04" label="DELIVERY" title="Evidence before deployment." />
        <div id="roadmap" className="quantum-roadmap">
          {phases.map((phase) => <article className="quantum-phase" key={phase.number}>
            <div className="quantum-phase__top"><span>{phase.number}</span><b>{phase.status}</b></div>
            <p className="quantum-label">{phase.network}</p><h3>{phase.title}</h3><p>{phase.detail}</p>
          </article>)}
        </div>
      </section>

      <section id="evidence" className="quantum-evidence" aria-labelledby="quantum-evidence-heading">
        <div><p className="quantum-label">ONCHAIN EVIDENCE</p><h2 id="quantum-evidence-heading">Nothing PQ is live yet.</h2><p>No PQ verifier, key registry, HybridAuth, or BellHookV3 has been deployed. Testnet receipts and gas figures will appear here only after they exist and are independently checked.</p></div>
        <span className="quantum-evidence__empty">NO DEPLOYMENT<br />NO TX HASHES</span>
      </section>

      <section id="name" className="quantum-section quantum-section--name" aria-labelledby="quantum-name">
        <SectionHeading index="05" label="THE NAME" title="Bell State Hooks." />
        <p id="quantum-name" className="quantum-copy quantum-name-copy">“Bell State” nods to John Stewart Bell’s work on quantum theory and fits the BELL name. It is a project name, not a claim that BELL changes quantum mechanics or protects user wallets.</p>
      </section>

      <section className="quantum-disclaimer" aria-label="Research disclaimer"><span>RESEARCH STATUS / PLANNED</span><p>This work is experimental and unaudited. It does not make user wallets post-quantum secure, does not alter chain cryptography, and is not financial advice.</p><a href="https://csrc.nist.gov/pubs/fips/205/final" target="_blank" rel="noopener noreferrer">NIST FIPS 205: SLH-DSA <ArrowUpRight size={14} aria-hidden="true" /></a></section>
    </div>
      </main>
      <footer className="legal__foot"><div className="lp-wrap"><p>BELL is an independent protocol. Quantum-safe signing for protocol inputs remains planned research; it does not change the cryptography of Robinhood Chain or user wallets.</p><nav aria-label="Related"><a href="/proof/">Exit proof</a><a href="/v4/">Protocol</a><a href="/">Home</a></nav></div></footer>
      <LandingEffects />
    </div>
  );
}
