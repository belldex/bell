import { ArrowUpRight } from "lucide-react";
import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { LandingNav } from "@/components/landing/gyevo/landing-nav";
import { EinsteinMotion } from "./einstein-motion";
import proof from "./proof.json";

const POOL_SECTIONS = [
  { id: "claims", label: "Claims", desc: "Each claim, its check and its verdict." },
  { id: "fail", label: "What must fail", desc: "Attempts that have to revert." },
  { id: "check", label: "Check it yourself", desc: "Replay every claim from a public RPC." },
  { id: "limits", label: "Honest limits", desc: "What this does not show." },
] as const;

type Verdict = "PASS" | "PARTIAL" | "PENDING" | "FAIL";
type Claim = {
  id: string; title: string; question: string; passes: string; pending?: string; partial?: string;
  result?: { verdict: Verdict; note: string; gas?: { label: string; gasUsed: number }[] };
};

const claims = proof.claims as unknown as Claim[];
const verdictOf = (c: Claim): Verdict => c.result?.verdict ?? "PENDING";
const count = (v: Verdict) => claims.filter((c) => verdictOf(c) === v).length;
const lastRun = (proof as { lastRun?: string }).lastRun;

export function PoolProofPage() {
  const gas = claims.find((c) => c.id === "P10")?.result?.gas ?? [];
  return (
    <div className="lp lp--bell legal ein" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={POOL_SECTIONS} />
      <EinsteinMotion />
      <main id="main" className="legal__main ein__main">
        <header className="ein-hero ein-hero--plain">
          <div className="ein-hero__copy">
            <p className="ein-tag"><span>Einstein Hooks v2</span><b>First pool proof</b></p>
            <h1>
              Every claim has a link. <em>Or it is marked pending.</em>
            </h1>
            <p className="ein-lede">
              The first pool on an Einstein hook has not been created yet. This page lists what will be proven, checks what already can
              be checked on Robinhood Chain, and says plainly what is still pending. Nothing here is typed by hand: it is generated from
              one file, <a href="https://github.com/belldex/bell/blob/main/evidence/einstein/proof.json">proof.json</a>.
            </p>
            <p className="ein-fine">
              {count("PASS")} pass, {count("PARTIAL")} partial, {count("PENDING")} pending, {count("FAIL")} fail.
              {lastRun ? ` Last replayed ${lastRun.slice(0, 10)} against mainnet.` : ""}
            </p>
          </div>
        </header>

        <section id="claims" className="ein-section" data-reveal>
          <h2>Claims</h2>
          <p className="ein-ledger__lede">A claim passes only when every one of its checks holds on chain. Partial means true but short of the bar. Pending means there is nothing on chain to check yet.</p>
          <ul className="ein-status ein-claims">
            {claims.map((c) => {
              const v = verdictOf(c);
              return (
                <li key={c.id} data-verdict={v.toLowerCase()}>
                  <b>{c.id} {v}</b>
                  <div>
                    <strong>{c.title}</strong>
                    <p>{c.result?.note ?? c.pending}</p>
                    <p className="ein-claims__bar">Passes when: {c.passes}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          {gas.length > 0 && (
            <>
              <h3 className="ein-claims__h">Mainnet gas, hybrid-signed calendar queue</h3>
              <ul className="ein-claims__gas">
                {gas.map((g) => (
                  <li key={g.label}><span>{g.label}</span><b>{g.gasUsed.toLocaleString("en-US")} gas</b></li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section id="fail" className="ein-section" data-reveal>
          <h2>What must fail</h2>
          <p className="ein-ledger__lede">Each attempt has to revert with the named error. A reverted mainnet transaction is kept as the proof. None has been sent on mainnet yet.</p>
          <ul className="ein-status">
            {proof.negatives.map((n) => (
              <li key={n.id} data-state="not-yet">
                <b>{n.id} {n.status}</b>
                <div>
                  <strong>{n.attempt}</strong>
                  <p>Must revert with {n.mustRevertWith}. {n.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section id="check" className="ein-section" data-reveal>
          <h2>Check it yourself</h2>
          <p className="ein-ledger__lede">
            The replay script needs only Node 20 and a public RPC. No keys, no team API. It reads every address and transaction from
            proof.json and prints one line per claim. It exits with an error if any check fails.
          </p>
          <pre className="ein-cmd"><code>{`git clone https://github.com/belldex/bell && cd bell
node scripts/einstein/verify-einstein-pool.mjs --rpc https://rpc.mainnet.chain.robinhood.com`}</code></pre>
          <p className="ein-fine">
            <a href="https://github.com/belldex/bell/blob/main/scripts/einstein/verify-einstein-pool.mjs" target="_blank" rel="noopener noreferrer">
              Read the script <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </p>
        </section>

        <section id="limits" className="ein-section" data-reveal>
          <h2>Honest limits</h2>
          <ul className="ein-claims__limits">
            {proof.honestLimits.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      </main>
      <footer className="legal__foot">
        <div className="lp-wrap">
          <p>
            BELL is an independent protocol. This page reports what can be checked on chain today. It is not an audit and not financial advice.
          </p>
          <nav aria-label="Related">
            <a href="/einstein/">Einstein Hooks v2</a>
            <a href="/proof/">Exit proof</a>
            <a href="/">Home</a>
          </nav>
        </div>
      </footer>
      <LandingEffects />
    </div>
  );
}
