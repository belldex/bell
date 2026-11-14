import { ArrowDown, ArrowRight, ArrowUpRight, Check, LockKeyhole, Shield, Waves } from 'lucide-react';
import { LandingEffects } from '@/components/landing/gyevo/landing-effects';
import { LandingNav } from '@/components/landing/gyevo/landing-nav';

const protections = [
  { input: 'Calendar roots', purpose: 'Hybrid-signed market-session schedule update', status: 'TESTNET' },
  { input: 'Close anchors', purpose: 'Hybrid-signed close observation, monotonic by pool cycle', status: 'TESTNET' },
  { input: 'Price attestations', purpose: 'Hybrid-signed reporter update; test value is synthetic', status: 'TESTNET' },
  { input: 'Keeper & governance actions', purpose: 'ECDSA and stateful SHRINCS must both authorize', status: 'TESTNET' },
];

const phases = [
  { number: '01', title: 'Hybrid trust inputs', network: 'Elysium testnet · 99801', status: 'TESTNET LIVE', detail: 'Calendar, close-anchor and price updates accepted with hybrid signatures; invalid ECDSA, invalid PQ and reused leaves were rejected.' },
  { number: '02', title: 'PQ Hooks v2 template', network: 'Robinhood Chain Mainnet · 4663', status: 'GATED', detail: 'No Mainnet hook, oracle, factory or governance deployment yet. Requires independent cryptographic review, exact-match source publication and release checks.' },
  { number: '03', title: 'Optional PQ accounts', network: 'Research', status: 'RESEARCH', detail: 'Explore opt-in smart accounts separately. Existing wallet signatures and PositionManager exits are not changed by this work.' },
];

const QUANTUM_SECTIONS = [
  { id: 'why', label: 'Why', desc: 'Why BELL is preparing its trust inputs.' },
  { id: 'scope', label: 'Scope', desc: 'What this work protects, and what it does not.' },
  { id: 'flow', label: 'Flow', desc: 'How hybrid authorization works on testnet.' },
  { id: 'roadmap', label: 'Roadmap', desc: 'The testnet and Mainnet gates.' },
  { id: 'evidence', label: 'Evidence', desc: 'Elysium testnet contracts, transactions and measured gas.' },
  { id: 'name', label: 'Name', desc: 'Why this research is called Einstein Hooks v2.' },
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
        <div className="quantum-hero__topline"><span className="quantum-mark"><Waves size={15} aria-hidden="true" /> EINSTEIN HOOKS V2</span><span className="quantum-status"><i /> TESTNET · PHASE 1</span></div>
        <p className="quantum-kicker">PROTOCOL SECURITY / TESTNET PHASE 1</p>
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
        <SectionHeading index="03" label="TESTNET AUTHORIZATION FLOW" title="Two signatures. One accepted update." />
        <p className="quantum-section-intro">On Elysium testnet, each privileged update passes both the existing ECDSA check <em>and</em> a stateful SHRINCS signature check. Either failure rejects the update.</p>
        <div className="quantum-flow" role="img" aria-label="Testnet flow: ECDSA and stateful SHRINCS signatures go through HybridAuth to v2 trust-input registries. Mainnet hook integration is gated. LP exit bypasses PQ authorization.">
          <div className="quantum-flow__signers"><span>KEEPER / REPORTER / GOVERNANCE</span><div><b>ECDSA</b><b>POST-QUANTUM</b></div></div>
          <ArrowRight className="quantum-flow__arrow" size={18} aria-hidden="true" />
          <div className="quantum-flow__node quantum-flow__node--accent"><span>AUTHORIZATION</span><strong>HybridAuth</strong><small>both required</small></div>
          <ArrowRight className="quantum-flow__arrow" size={18} aria-hidden="true" />
          <div className="quantum-flow__stack"><div className="quantum-flow__node"><span>TESTNET TRUST REGISTRIES</span><strong>Calendar · Session · Price</strong></div><ArrowDown size={15} aria-hidden="true" /><div className="quantum-flow__node"><span>MAINNET / NOT DEPLOYED</span><strong>Future BellHookV3 → PoolManager</strong></div></div>
        </div>
        <div className="quantum-exit-line"><span className="quantum-exit-line__dash" /><span>LP REMOVE</span><ArrowRight size={15} aria-hidden="true" /><strong>PositionManager</strong><span className="quantum-exit-line__open">NO PQ GATE</span></div>
      </section>

      <section className="quantum-section" aria-labelledby="quantum-roadmap">
        <SectionHeading index="04" label="DELIVERY" title="Proof, scope, next gate." />
        <div id="roadmap" className="quantum-roadmap">
          {phases.map((phase) => <article className="quantum-phase" key={phase.number}>
            <div className="quantum-phase__top"><span>{phase.number}</span><b>{phase.status}</b></div>
            <p className="quantum-label">{phase.network}</p><h3>{phase.title}</h3><p>{phase.detail}</p>
          </article>)}
        </div>
      </section>

      <section id="evidence" className="quantum-evidence" aria-labelledby="quantum-evidence-heading">
        <div className="quantum-evidence__body">
          <p className="quantum-label">ELYSIUM TESTNET · CHAIN 99801</p>
          <h2 id="quantum-evidence-heading">Phase 1 is deployed and exercised.</h2>
          <p>These contracts protect test trust inputs only. The implementation uses the stateful-only <strong>SHRINCS-256s-keccak</strong> profile from Quip Network's AGPL-3.0-or-later implementation. BELL's integration has not had an independent cryptographic audit. No Mainnet hook or pool uses this system.</p>
          <div className="quantum-contracts" aria-label="Testnet contract addresses">
            {[
              ['BellSHRINCSStatefulVerifier', '0x158895a1fBabfA91Cae1264f1D959cBe6b7A4101'],
              ['HashSigVerifier', '0x52f8e77aaDFd1561fDa0Bc362805245ed57d7242'],
              ['PQKeyRegistry', '0xb4C7cFb2F1b58AfE602249E24Ec0476e4F984A14'],
              ['HybridAuth', '0xBc81138DfC3285287Fa15745524ef2f5A9192dC6'],
              ['CalendarRegistryV2', '0x03C8354AAf83b394Fa39aC74Bf3340Ed1C4cFBD4'],
              ['SessionRegistryV2', '0x0f6573348C8Ae4fF07542568E765d2e0DcF405bF'],
              ['PriceAttestationAdapter', '0x25FA61A31893C82b5a21BD70d3b2480133F2b019'],
            ].map(([name, address]) => <a key={name} href={'https://explorer-elysium-testnet.t.conduit.xyz/address/' + address} target="_blank" rel="noopener noreferrer"><span>{name}</span><code>{address}</code><ArrowUpRight size={13} aria-hidden="true" /></a>)}
          </div>
          <h3>Hybrid update gas measured on testnet</h3>
          <div className="quantum-gas-table" role="table" aria-label="Measured hybrid update gas">
            <div role="row"><strong>Accepted update</strong><span>Calendar root</span><b>324,563 gas</b><a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0xed149c5f89abf0f96bb25e85a15197a94e067a469638d631e09cf22bd1ae3361" target="_blank" rel="noopener noreferrer">tx ↗</a></div>
            <div role="row"><strong>Accepted update</strong><span>Close anchor</span><b>324,662 gas</b><a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0xfbd50be04b372be6e2962c4719f2d499aeb24ba0589d7a683795a99866bc6ad1" target="_blank" rel="noopener noreferrer">tx ↗</a></div>
            <div role="row"><strong>Accepted update</strong><span>Price attestation</span><b>302,554 gas</b><a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0xe773b0a95ae0eb14fcbe655afb484777f0fc583ecfda1bf7e7fe4c43318671a8" target="_blank" rel="noopener noreferrer">tx ↗</a></div>
          </div>
          <h3>Rejection proofs</h3>
          <ul className="quantum-proof-links">
            <li>Invalid ECDSA rejects otherwise valid PQ signatures: <a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0x935e123e249fe60d62fa3094de9e1a8fc2bdce099453d69a062b05fc16353ece" target="_blank" rel="noopener noreferrer">calendar</a> · <a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0xad07b25e7eb5baec78a25e2e2355478a3d9fbe424e285021a9b7d0515798d7e2" target="_blank" rel="noopener noreferrer">session</a> · <a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0xa944ea905c840826dae7b58cc0ccbaca4df10d111eb14d45a81b4af2d5f7a0bd" target="_blank" rel="noopener noreferrer">price</a>.</li>
            <li>Reused one-time leaves reject: <a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0x3bcf5a7d9f0ef7b54ce3fba9efd26bde1d72a97fcc27fb55a5ea8e6d0f0ef30f" target="_blank" rel="noopener noreferrer">calendar</a> · <a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0xcf52f775c230cacbd9090273bbc98671a0e20ced34f9dc21c2ca0ec38c072efd" target="_blank" rel="noopener noreferrer">session</a> · <a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0xf987fdd5f63c263c2e47094cbe014d7fc97ac8b18c443df7d0f82c7a1bdf2d0b" target="_blank" rel="noopener noreferrer">price</a>.</li>
            <li>Invalid PQ signatures reject: <a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0x6b4696d282be4ceb4e5597de7792808ea4bd84285d21f6c5a6890e41d0d75032" target="_blank" rel="noopener noreferrer">calendar</a> · <a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0x9d779f13e686df89c34627000f05c84962246f7d44de95dc3c6ecc5d6d2c0405" target="_blank" rel="noopener noreferrer">session</a> · <a href="https://explorer-elysium-testnet.t.conduit.xyz/tx/0x1400b25d3b65cf24cbadd0b2931b052a30e110c8393f487fb8106e7b7a3f43e0" target="_blank" rel="noopener noreferrer">price</a>.</li>
          </ul>
          <p className="quantum-evidence__note">The AAPL price input is deterministic test data, not a live quote. Explorer source verification is not confirmed. Mainnet deployment, Sourcify exact match, an independent audit, BellHookV3/Factory integration and exit-invariant fuzzing remain gated.</p>
        </div>
        <a className="quantum-evidence__explorer" href="https://explorer-elysium-testnet.t.conduit.xyz/address/0xBc81138DfC3285287Fa15745524ef2f5A9192dC6" target="_blank" rel="noopener noreferrer">OPEN TESTNET EXPLORER <ArrowUpRight size={14} aria-hidden="true" /></a>
      </section>

      <section id="name" className="quantum-section quantum-section--name" aria-labelledby="quantum-name">
        <SectionHeading index="05" label="THE NAME" title="Einstein Hooks v2." />
        <p id="quantum-name" className="quantum-copy quantum-name-copy">The name nods to Albert Einstein’s 1905 proposal that light comes in quanta. It is a project name. BELL is not affiliated with or endorsed by Albert Einstein’s estate, and the name is not a claim that BELL changes quantum mechanics or protects user wallets.</p>
      </section>

      <section className="quantum-disclaimer" aria-label="Research disclaimer"><span>TESTNET / UNAUDITED</span><p>This experiment does not make user wallets post-quantum secure, does not alter chain cryptography, and does not gate LP exits. It is not financial advice.</p><a href="https://csrc.nist.gov/pubs/fips/205/final" target="_blank" rel="noopener noreferrer">NIST FIPS 205: SLH-DSA <ArrowUpRight size={14} aria-hidden="true" /></a></section>
    </div>
      </main>
      <footer className="legal__foot"><div className="lp-wrap"><p>BELL is an independent protocol. Hybrid post-quantum trust-input signing is deployed on Elysium testnet only; Mainnet hook integration remains gated. It does not change Robinhood Chain or user-wallet cryptography.</p><nav aria-label="Related"><a href="/proof/">Exit proof</a><a href="/v4/">Protocol</a><a href="/">Home</a></nav></div></footer>
      <LandingEffects />
    </div>
  );
}
