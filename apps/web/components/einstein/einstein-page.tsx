import { ArrowUpRight } from "lucide-react";
import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { LandingNav } from "@/components/landing/gyevo/landing-nav";
import { LeafField } from "./leaf-field";
import { SignatureGate } from "./signature-gate";
import { EvidenceLedger } from "./evidence-ledger";
import { EinsteinMotion } from "./einstein-motion";
import { LEAF_BUDGET, SPENT_LEAVES } from "./einstein-data";

const EINSTEIN_SECTIONS = [
  { id: "why", label: "Why hashes", desc: "Why the second signature is built from hashes." },
  { id: "gate", label: "The gate", desc: "Try to push a change through." },
  { id: "scope", label: "What it guards", desc: "What needs both signatures, and what never does." },
  { id: "status", label: "Status", desc: "What is live and what is not." },
  { id: "evidence", label: "Evidence", desc: "Contracts, transactions and gas." },
  { id: "name", label: "The name", desc: "Why Einstein." },
] as const;

const needs = [
  { term: "Calendar roots", text: "The market-session schedule that decides when a pool is open, closed or running its opening auction." },
  { term: "Governance calls", text: "Pausing a pool or an asset, admitting an asset, and every other privileged call, queued through the safety controller." },
  { term: "Key rotation", text: "Replacing a role's keys. The old keys stop working at once and the leaf count starts again." },
];

const never = [
  { term: "Your exit", text: "Removing liquidity goes straight to the PositionManager. The hook has no remove-liquidity callback at all, which anyone can read from its address." },
  { term: "Your wallet", text: "Wallet keys are chain level. BELL cannot make them post-quantum, and this work does not claim to." },
  { term: "Mainnet close anchors and prices", text: "On the mainnet stack these are checked against on-chain Chainlink feeds, not signed with SHRINCS. The testnet version signs them." },
  { term: "Swaps", text: "BELL can still stop swaps in some sessions. Only exits are unconditional." },
];

const status = [
  { state: "Live", title: "Contracts on mainnet", text: "Fifteen contracts since 14 November 2026. The source is verified on Sourcify as a match, not an exact match, because the build embeds no metadata hash." },
  { state: "Live", title: "Calendars for AAPL, NVDA and TSLA", text: "Signed with both keys, queued, executed and active through 31 December 2026. Nothing activates the next interval automatically yet. The current one ends on 16 November at 01:00 UTC." },
  { state: "Not yet", title: "A pool", text: "No pool uses this stack yet." },
  { state: "Not yet", title: "Independent review", text: "No independent cryptographic review has been done. None of this is audited." },
  { state: "Fixed", title: "Governance delay", text: "Zero seconds, set at deployment and impossible to change. Both signatures are still required for every change." },
];

export function EinsteinPage() {
  const left = LEAF_BUDGET - SPENT_LEAVES.length;
  return (
    <div className="lp lp--bell legal ein" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={EINSTEIN_SECTIONS} />
      <EinsteinMotion />
      <main id="main" className="legal__main ein__main">
        <header className="ein-hero">
          <div className="ein-hero__copy">
            <p className="ein-tag"><span>Einstein Hooks v2</span><b>Live on mainnet</b></p>
            <h1>
              Changing the rules takes <em>two signatures.</em> Leaving takes none.
            </h1>
            <p className="ein-lede">
              BELL&apos;s market calendars and governance now accept a change only when it carries an ECDSA signature and a hash-based
              post-quantum one, both valid. Your liquidity exit never asks for either.
            </p>
            <p className="ein-fine">
              Deployed on Robinhood Chain on 14 November 2026. No pool uses it yet, and it has not been independently audited.
            </p>
            <div className="ein-actions">
              <a className="ein-btn ein-btn--solid" href="#gate">Try to break it</a>
              <a className="ein-btn" href="#evidence">See the contracts</a>
            </div>
          </div>
          <figure className="ein-hero__field" aria-label="The governance key's signing budget">
            <LeafField />
          </figure>
        </header>

        <section id="why" className="ein-section ein-section--split" aria-labelledby="why-h">
          <h2 id="why-h" data-reveal>A quantum computer breaks the curve. It does not break a hash.</h2>
          <div className="ein-prose">
            <p data-reveal>
              Every wallet signature today, ECDSA included, rests on an elliptic curve. A large enough quantum computer could forge
              those signatures, and a calendar or a pause that anyone can forge protects nobody.
            </p>
            <p data-reveal style={{ "--d": "70ms" } as React.CSSProperties}>
              Hash-based signatures stand on firmer ground: the best known quantum attack only halves a hash&apos;s strength. BELL&apos;s
              second signature is SHRINCS, built from Keccak hashes alone, using Quip Network&apos;s open implementation.
            </p>
            <p data-reveal style={{ "--d": "140ms" } as React.CSSProperties}>
              There is one catch, and the grid above is it. A leaf of a hash-based key signs exactly once. Sign twice with the same leaf
              and the key leaks. So each role holds a fixed budget of {LEAF_BUDGET.toLocaleString("en-US")} signatures, and the key
              registry refuses any leaf out of order. Three are spent. The governance key has {left.toLocaleString("en-US")} left.
            </p>
          </div>
        </section>

        <section id="gate" className="ein-section" aria-labelledby="gate-h">
          <h2 id="gate-h" data-reveal>Try to push a change through.</h2>
          <p className="ein-intro" data-reveal>
            Every privileged change on the mainnet stack goes through HybridAuth. Break either signature and the change reverts.
            The exit lane below runs the whole time and never meets the gate.
          </p>
          <div data-reveal><SignatureGate /></div>
        </section>

        <section id="scope" className="ein-section" aria-labelledby="scope-h">
          <h2 id="scope-h" data-reveal>What it guards, and what it never touches.</h2>
          <div className="ein-scope">
            <div data-reveal>
              <h3>Needs both signatures</h3>
              <dl>{needs.map((n) => <div key={n.term}><dt>{n.term}</dt><dd>{n.text}</dd></div>)}</dl>
            </div>
            <div data-reveal style={{ "--d": "90ms" } as React.CSSProperties}>
              <h3>Never asks for either</h3>
              <dl>{never.map((n) => <div key={n.term}><dt>{n.term}</dt><dd>{n.text}</dd></div>)}</dl>
            </div>
          </div>
        </section>

        <section id="status" className="ein-section" aria-labelledby="status-h">
          <h2 id="status-h" data-reveal>Where it stands.</h2>
          <ul className="ein-status">
            {status.map((s, i) => (
              <li key={s.title} data-state={s.state.toLowerCase().replace(" ", "-")} data-reveal style={{ "--d": `${i * 55}ms` } as React.CSSProperties}>
                <b>{s.state}</b>
                <div><strong>{s.title}</strong><p>{s.text}</p></div>
              </li>
            ))}
          </ul>
        </section>

        <section id="evidence" className="ein-section" aria-labelledby="evidence-h">
          <h2 id="evidence-h" data-reveal>Check it yourself.</h2>
          <div data-reveal><EvidenceLedger /></div>
        </section>

        <section id="name" className="ein-section ein-section--split" aria-labelledby="name-h">
          <h2 id="name-h" data-reveal>Why Einstein.</h2>
          <p className="ein-prose-one" data-reveal>
            In 1905 Albert Einstein proposed that light comes in quanta, and the name nods to that. It is a project name. BELL is not
            affiliated with or endorsed by Albert Einstein&apos;s estate, and the name is not a claim that BELL changes quantum
            mechanics or protects user wallets.
          </p>
        </section>

        <section className="ein-disclaimer" aria-label="Disclaimer">
          <p>
            Research software, not independently audited. It does not make user wallets post-quantum secure, does not change the chain&apos;s
            cryptography, and does not gate liquidity exits. Not financial advice.
          </p>
          <a href="https://csrc.nist.gov/pubs/fips/205/final" target="_blank" rel="noopener noreferrer">
            Background: NIST FIPS 205 on hash-based signatures <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </section>
      </main>
      <footer className="legal__foot">
        <div className="lp-wrap">
          <p>
            BELL is an independent protocol. The post-quantum hook stack is deployed on Robinhood Chain without any pool yet, and its
            signing path was exercised on Elysium testnet. It has not been independently audited. It does not change Robinhood Chain or
            user-wallet cryptography.
          </p>
          <nav aria-label="Related">
            <a href="/proof/">Exit proof</a>
            <a href="/v4/">Protocol</a>
            <a href="/">Home</a>
          </nav>
        </div>
      </footer>
      <LandingEffects />
    </div>
  );
}
