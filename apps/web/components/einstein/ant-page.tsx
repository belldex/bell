import { ArrowUpRight } from "lucide-react";
import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { LandingNav } from "@/components/landing/gyevo/landing-nav";
import { EinsteinMotion } from "./einstein-motion";
import { CopyCommand } from "./copy-command";
import { TokenLogo } from "@/components/ui/TokenLogo";
import proof from "./ant-proof.json";

const SECTIONS = [
  { id: "status", label: "Status", desc: "Where ANT stands." },
  { id: "mainnet", label: "On mainnet", desc: "What is on chain." },
  { id: "token", label: "The token", desc: "Which contract is Robinhood's ANT." },
  { id: "blocker", label: "What blocks it", desc: "Why ANT is not live." },
  { id: "rehearsal", label: "Testnet rehearsal", desc: "The path, run end to end." },
  { id: "claims", label: "Claims", desc: "A1 to A7." },
  { id: "check", label: "Check it yourself", desc: "Replay the checks." },
  { id: "limits", label: "Honest limits", desc: "What this does not show." },
] as const;

type Verdict = "PASS" | "PENDING" | "FAIL";
type Rehearsal = { key: string; title: string; note: string; token: string; feed: string; hook: string; network: { id: number; explorer: string }; steps: { id: string; title: string; note: string; verdict: string; txs: { tx: string; url: string }[] }[] };
const rehearsals = ((proof as { rehearsals?: Rehearsal[] }).rehearsals ?? []);
type Mainnet = { calendar?: { root: string; leafCount: number; txs: { tx: string; url: string }[] }; title: string; note: string; assetRegistry: string; token: string; descriptorId: string; governance: { tx: string; url: string }[]; adapters: { name: string; address: string; deployTx: { tx: string; url: string } }[] };
const mainnet = (proof as { mainnet?: Mainnet }).mainnet;
type Solution = { title: string; points: string[]; contract: string; tests: string };
const solution = (proof.blocker as { solution?: Solution }).solution;
const replay = (proof as { replay?: string[] }).replay ?? [];
const verdictOf = (id: string): Verdict => {
  const line = replay.find((l) => l.startsWith(`${id} `));
  if (!line) return "PENDING";
  return /\sPASS\s/.test(line) ? "PASS" : /\sFAIL\s/.test(line) ? "FAIL" : "PENDING";
};
const short = (h: string, a = 8, b = 6) => `${h.slice(0, a)}…${h.slice(-b)}`;
const explorer = proof.chain.explorer;
const addr = (a: string, text?: string) => <a href={`${explorer}/address/${a}`} target="_blank" rel="noopener noreferrer">{text ?? short(a, 10, 8)}</a>;

export function AntPage() {
  const a1 = proof.a1;
  return (
    <div className="lp lp--bell legal ein pp ve" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={SECTIONS} />
      <EinsteinMotion />
      <main id="main" className="legal__main ein__main">
        <header className="ein-hero pp-hero">
          <div className="ein-hero__copy">
            <p className="ein-tag"><span>Einstein Hooks</span><b><TokenLogo symbol="ANT" size={20} /> ANT, Robinhood&apos;s Anthropic stock token</b></p>
            <h1>ANT is <em>live</em> on BELL.</h1>
            <p className="ein-lede">{proof.subtitle}</p>
          </div>
        </header>

        <section id="status" className="ein-section ve-verdict" data-reveal data-status="scheduled">
          <p className="ve-verdict__status">{proof.status === "live" ? "Live, small seed" : proof.status === "admitted" ? "Admitted, no pool yet" : "Blocked"}</p>
          <p className="ve-verdict__line">{proof.statusNote}</p>
        </section>

        {mainnet && (
          <section id="mainnet" className="ein-section" data-reveal>
            <h2>{mainnet.title}</h2>
            <p className="ein-ledger__lede">{mainnet.note}</p>
            <dl className="pp-facts">
              <div><dt>Check M1</dt><dd>{(replay.find((l) => l.startsWith("M1 ")) ?? "").includes(" PASS ") ? "Proven: the registry names the descriptor, the adapters have code and every transaction succeeded" : "Not replayed yet"}</dd></div>
              <div><dt>Asset descriptor</dt><dd><code>{short(mainnet.descriptorId, 12, 8)}</code> in {addr(mainnet.assetRegistry)}</dd></div>
              <div><dt>Governance</dt><dd>{mainnet.governance.map((t) => <a key={t.tx} href={t.url} target="_blank" rel="noopener noreferrer">{short(t.tx, 10, 6)} </a>)}</dd></div>
              {mainnet.calendar && <div><dt>Check M2</dt><dd>{(replay.find((l) => l.startsWith("M2 ")) ?? "").includes(" PASS ") ? "Proven: " : "Not replayed yet: "}the calendar root {short(mainnet.calendar.root, 10, 6)} ({mainnet.calendar.leafCount} intervals) was signed post-quantum and activated {mainnet.calendar.txs.map((t) => <a key={t.tx} href={t.url} target="_blank" rel="noopener noreferrer">{short(t.tx, 10, 6)} </a>)}</dd></div>}
              <div><dt>Adapters</dt><dd>{mainnet.adapters.map((a) => <span key={a.address}>{a.name}: {addr(a.address)} (<a href={a.deployTx.url} target="_blank" rel="noopener noreferrer">deploy</a>); </span>)}</dd></div>
            </dl>
          </section>
        )}

        <section id="token" className="ein-section" data-reveal>
          <h2>Which contract is ANT</h2>
          <p className="ein-ledger__lede">Look-alike Anthropic tokens already exist on Robinhood Chain. Robinhood says a token with a matching name or ticker but a different address is not a Robinhood Stock Token. This one is.</p>
          <dl className="pp-facts">
            <div><dt>ANT</dt><dd>{addr(a1.address)}</dd></div>
            <div><dt>Name</dt><dd>Anthropic, PBC Class A Common Stock • Robinhood Token</dd></div>
            <div><dt>Same code as</dt><dd>{a1.referenceTokens.map((t) => <span key={t.symbol}>{addr(t.address, t.symbol)} </span>)}</dd></div>
            <div><dt>Not Robinhood&apos;s</dt><dd>{a1.lookalikes.map((l) => <span key={l.address}>{addr(l.address, l.name)}; </span>)}</dd></div>
          </dl>
          <ul className="pp-links">
            {a1.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.label} <ArrowUpRight size={14} aria-hidden="true" /></a> <span className="ein-fine">read {s.retrievedAt}: {s.says}</span></li>)}
          </ul>
        </section>

        <section id="blocker" className="ein-section" data-reveal>
          <h2>{proof.blocker.title}</h2>
          <p className="ein-ledger__lede">{proof.blocker.what}</p>
          <ul className="pp-limits">{proof.blocker.why.map((w) => <li key={w}>{w}</li>)}</ul>
          <p className="ein-ledger__lede"><b>What unblocks it.</b> {proof.blocker.unblocks}</p>
          {solution && (
            <>
              <h3>{solution.title}</h3>
              <ul className="pp-limits">{solution.points.map((w) => <li key={w}>{w}</li>)}</ul>
              <p className="ein-fine">Contract <code>{solution.contract}</code>. {solution.tests}</p>
            </>
          )}
          <ul className="pp-links">
            {proof.blocker.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.label} <ArrowUpRight size={14} aria-hidden="true" /></a> <span className="ein-fine">read {s.retrievedAt}</span></li>)}
          </ul>
        </section>

        {rehearsals.map((rehearsal) => (
          <section key={rehearsal.key} id={rehearsal.key === "delegated" ? "rehearsal" : `rehearsal-${rehearsal.key}`} className="ein-section" data-reveal>
            <h2>{rehearsal.title}</h2>
            <p className="ein-ledger__lede">{rehearsal.note}</p>
            <ol className="pp-ledger">
              {rehearsal.steps.map((st) => {
                const v = (replay.find((l) => l.startsWith(`R:${rehearsal.key}:${st.id} `)) ?? "").includes(" PASS ") ? "PASS" : st.verdict === "PASS" ? "PENDING" : (st.verdict as Verdict);
                return (
                  <li key={st.id} data-v={v.toLowerCase()}>
                    <div className="pp-ledger__id"><b>{st.id}</b><span>{v === "PASS" ? "Proven on testnet" : v === "FAIL" ? "Failed" : "Pending"}</span></div>
                    <div className="pp-ledger__body"><h3>{st.title}</h3><p>{st.note}</p>
                      {st.txs.length > 0 && <p className="pp-ledger__bar">{st.txs.map((t) => <a key={t.tx} href={t.url} target="_blank" rel="noopener noreferrer">{short(t.tx, 10, 6)} </a>)}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="ein-fine">Test token <a href={`${rehearsal.network.explorer}/address/${rehearsal.token}`} target="_blank" rel="noopener noreferrer">{short(rehearsal.token, 10, 8)}</a>{rehearsal.feed ? <>, fixture feed <a href={`${rehearsal.network.explorer}/address/${rehearsal.feed}`} target="_blank" rel="noopener noreferrer">{short(rehearsal.feed, 10, 8)}</a></> : null}, hook <a href={`${rehearsal.network.explorer}/address/${rehearsal.hook}`} target="_blank" rel="noopener noreferrer">{short(rehearsal.hook, 10, 8)}</a>.</p>
          </section>
        ))}

        <section id="claims" className="ein-section" data-reveal>
          <h2>Claims</h2>
          <ol className="pp-ledger">
            {proof.claims.map((c) => {
              const v = verdictOf(c.id);
              const blockedBy = (c as { blockedBy?: string }).blockedBy;
              return (
                <li key={c.id} data-v={v.toLowerCase()}>
                  <div className="pp-ledger__id"><b>{c.id}</b><span>{v === "PASS" ? "Proven" : v === "FAIL" ? "Failed" : "Pending"}</span></div>
                  <div className="pp-ledger__body"><h3>{c.title}</h3><p>{v === "PENDING" && blockedBy ? blockedBy : c.proof}</p><p className="pp-ledger__bar"><span>Proven when</span> {c.passes}</p></div>
                </li>
              );
            })}
          </ol>
        </section>

        <section id="check" className="ein-section" data-reveal>
          <h2>Check it yourself</h2>
          <p className="ein-ledger__lede">One script reads the token from a public RPC, compares its code with the tokens BELL already lists, and with <code>--online</code> reads Robinhood&apos;s asset list and Chainlink&apos;s feed directory.</p>
          <CopyCommand command={"git clone https://github.com/belldex/bell && cd bell\nnode scripts/einstein/verify-einstein-ant.mjs --rpc https://rpc.mainnet.chain.robinhood.com --online"} />
          <p className="ein-fine">
            <a href="https://github.com/belldex/bell/blob/main/scripts/einstein/verify-einstein-ant.mjs" target="_blank" rel="noopener noreferrer">Read the script <ArrowUpRight size={14} aria-hidden="true" /></a>
            {" "}and{" "}
            <a href="https://github.com/belldex/bell/blob/main/evidence/einstein/ant/proof.json" target="_blank" rel="noopener noreferrer">proof.json <ArrowUpRight size={14} aria-hidden="true" /></a>
          </p>
        </section>

        <section id="limits" className="ein-section" data-reveal>
          <h2>Honest limits</h2>
          <ul className="pp-limits">{proof.limits.map((l) => <li key={l}>{l}</li>)}</ul>
          <h2>Read this before anything else</h2>
          <ul className="pp-limits">{proof.compliance.map((l) => <li key={l}>{l}</li>)}</ul>
        </section>
      </main>
      <footer className="legal__foot">
        <div className="lp-wrap">
          <p>BELL is an independent protocol. This page reports what can be checked on chain. It is not an audit and not financial advice.</p>
          <nav aria-label="Related">
            <a href="/einstein/pool/">First pool proof</a>
            <a href="/einstein/v3-evolve/">v3 Evolve</a>
            <a href="/einstein/">Einstein Hooks v2</a>
            <a href="/">Home</a>
          </nav>
        </div>
      </footer>
      <LandingEffects />
    </div>
  );
}
