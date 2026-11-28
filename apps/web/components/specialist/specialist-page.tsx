import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { LandingNav } from "@/components/landing/gyevo/landing-nav";
import { CopyCommand } from "@/components/einstein/copy-command";
import proof from "./specialist-proof.json";
import "../upstairs/upstairs.css";
import "./specialist.css";

const EXPLORER = "https://robinhoodchain.blockscout.com";
const REPO = "https://github.com/belldex/bell/blob/main";

const SECTIONS = [
  { id: "top", label: "Specialist", desc: "One bonded market maker per stock." },
  { id: "how", label: "How it works", desc: "Bond, serve, score." },
  { id: "duties", label: "Duties", desc: "What must show up, and how it is measured." },
  { id: "scorecard", label: "Scorecard", desc: "Epoch by epoch, from the chain." },
  { id: "claims", label: "Claims", desc: "Nine claims, replayed from the chain." },
  { id: "limits", label: "Honest limits", desc: "What v1 does not do." },
] as const;

type Verdict = "PASS" | "PARTIAL" | "PENDING" | "FAIL";
type Epoch = { epoch: number; start: number; cycles: number; cyclesPassed: number; checkpoints: number; checkpointsPassed: number; outcome: number; tx: string };
type Proof = {
  label: string;
  deployment: { contract: string; deployTx: string; block: number; constructor: { params: Record<string, string> } } | null;
  claims: { id: string; title: string; proof: string; passes: string }[];
  replay: Record<string, { verdict: Verdict; note: string }>;
  epochs: Epoch[];
  specialist: string | null;
  lastBuild: string;
};
const p = proof as unknown as Proof;
const OUTCOME = ["Void", "Passed", "One duty missed", "Removed"];

const short = (v: string, a = 8, b = 6) => `${v.slice(0, a)}…${v.slice(-b)}`;
const day = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const A = ({ path, children }: { path: string; children: React.ReactNode }) => <a href={`${EXPLORER}/${path}`} target="_blank" rel="noreferrer">{children}</a>;
const linkify = (text: string) => text.split(/(0x[0-9a-fA-F]{64}|0x[0-9a-fA-F]{40})/g).map((part, i) =>
  /^0x[0-9a-fA-F]{64}$/.test(part) ? <A key={i} path={`tx/${part}`}>{short(part, 10, 8)}</A>
  : /^0x[0-9a-fA-F]{40}$/.test(part) ? <A key={i} path={`address/${part}`}>{short(part, 8, 6)}</A>
  : part);

const CLAIM_TITLES: Record<string, string> = {
  S1: "The registry is what we say", S2: "A Specialist is bonded and assigned", S3: "The auction duty is measured", S4: "The floor duty is measured", S5: "Scoring follows the rules",
  S6: "Rewards are paid", S7: "Slashing works", S8: "Leaving cannot dodge a bad epoch", S9: "Exits stay open",
};

/** The lifecycle as a loop: bond, assign, serve, score, then reward or slash, then unbond after a delay. */
function Lifecycle() {
  const nodes: [string, string, number, number][] = [
    ["BOND", "BELL and USDG locked", 120, 90], ["ASSIGN", "HybridAuth, both signatures", 440, 90], ["SERVE", "orders at the open, depth on the floor", 760, 90],
    ["SCORE", "anyone closes the epoch", 760, 270], ["PAID or SLASHED", "reward, or part of the bond", 440, 270], ["UNBOND", "14 days, duties still apply", 120, 270],
  ];
  return (
    <svg viewBox="0 0 1000 380" role="img" aria-label="Specialist lifecycle: bond, assign, serve, score, paid or slashed, unbond">
      <defs>
        <marker id="sp-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#E27478" /></marker>
        <filter id="sp-glow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <path d="M232,110 L328,110 M552,110 L648,110 M810,160 L810,222 M648,290 L552,290 M328,290 L232,290" stroke="#E27478" strokeWidth="3" fill="none" markerEnd="url(#sp-arrow)" filter="url(#sp-glow)" />
      {nodes.map(([t, s, x, y], i) => (
        <g key={t}>
          <rect x={x - 100} y={y - 38} width="200" height="96" rx="14" fill={i === 4 ? "#9D3039" : "#1b1b1b"} fillOpacity={i === 4 ? 0.34 : 1} stroke={i === 4 ? "#E0434F" : "#4a4a4a"} strokeWidth="2.5" />
          <text x={x} y={y - 2} textAnchor="middle" fontSize="21" fontWeight="700" letterSpacing="1.5" fill="#F2EFE8">{t}</text>
          <text x={x} y={y + 26} textAnchor="middle" fontSize="12.5" fill="#a8a399">{s}</text>
        </g>
      ))}
      <text x="500" y="352" textAnchor="middle" fontSize="13" letterSpacing="2" fill="#8d887e">A SLASHED BELL IS BURNED · A SLASHED USDG PAYS THE NEXT SPECIALIST</text>
    </svg>
  );
}

export function SpecialistPage() {
  const dep = p.deployment;
  const passes = Object.values(p.replay).filter((r) => r.verdict === "PASS").length;
  const total = p.claims.length;
  const prm = dep?.constructor.params;
  const epochDays = prm ? Number(prm.epochSeconds) / 86400 : 7;
  const unbondDays = prm ? Number(prm.unbondDelay) / 86400 : 14;
  const isTest = p.label === "test";
  const slashes = p.epochs.filter((e) => e.outcome >= 2).length;
  return (
    <div className="lp lp--bell up sp" id="top" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={SECTIONS} />
      <LandingEffects />
      <main id="main">
        <section className="up-hero">
          <div className="up-wrap up-hero__grid">
            <div>
              <p className="up-tag"><b>The Specialist</b><span>Bonded market makers for BELL</span></p>
              <h1>Every stock gets someone <em>who has to show up.</em></h1>
              <p className="up-lede">One market maker per stock puts up a $BELL and USDG bond. They place orders in every Opening Bell auction and keep depth on the floor. Meet the duties and earn from protocol fees. Miss them and part of the bond is slashed by the contract, with the BELL burned.</p>
              <div className="up-actions">
                <a className="up-btn up-btn--solid" href="#claims">See the {total} claims</a>
                {dep && <a className="up-btn" href={`${EXPLORER}/address/${dep.contract}`} target="_blank" rel="noreferrer">The contract</a>}
              </div>
              <div className="up-chips">
                {dep ? <span className="up-chip"><i />LIVE ON MAINNET</span> : <span className="up-chip"><i />BUILT AND TESTED, NOT DEPLOYED</span>}
                {isTest && dep && <span className="up-chip"><i />TEST INSTANCE, TEAM WALLET</span>}
                <span className="up-chip"><i />NO OWNER, NO PROXY</span>
              </div>
            </div>
            <figure className="up-art sp-art" style={{ margin: 0 }}>
              <span className="up-art__badge">THE SPECIALIST · NVDA</span>
              <div className="sp-badge">
                <small>ONE NAME PER STOCK</small>
                <b>NVDA</b>
                <dl>
                  <div><dt>SPECIALIST</dt><dd>{p.specialist ? <A path={`address/${p.specialist}`}>{short(p.specialist, 8, 6)}</A> : "none assigned yet"}</dd></div>
                  <div><dt>EPOCHS SCORED</dt><dd>{p.epochs.length}</dd></div>
                  <div><dt>SLASHES</dt><dd>{slashes}</dd></div>
                </dl>
              </div>
            </figure>
          </div>
        </section>

        <section className="up-stats">
          <div className="up-wrap up-stats__grid">
            <div className="up-stat"><b>{passes}<span>/{total}</span></b><small>claims replayed from the chain</small></div>
            <div className="up-stat"><b>2</b><small>duties, both read from onchain state</small></div>
            <div className="up-stat"><b>{epochDays}<span> {epochDays === 1 ? "day" : "days"}</span></b><small>per scoring epoch{isTest ? " on the test instance" : ""}</small></div>
            <div className="up-stat"><b>{unbondDays}<span> {unbondDays === 1 ? "day" : "days"}</span></b><small>unbond delay, duties still apply</small></div>
          </div>
        </section>

        <section className="up-sec" id="how">
          <div className="up-wrap">
            <div className="up-sec__head"><h2>Bond, serve, score</h2></div>
            <p className="up-sec__lede">For most of the 20th century, every NYSE stock had a specialist: one firm responsible for that stock, answerable to the exchange when it failed. Onchain markets lost that. Liquidity shows up when it pays and leaves when it does not. The Specialist brings the accountability back, enforced by a contract instead of a floor governor.</p>
            <figure className="up-chart" style={{ margin: 0 }}>
              <Lifecycle />
              <figcaption>THE CONTRACT: SpecialistRegistry · NO OWNER · THE ONLY PRIVILEGED ACTION IS ASSIGN, WHICH NEEDS A HYBRIDAUTH SIGNATURE FROM THE GOVERNANCE ROLE</figcaption>
            </figure>
          </div>
        </section>

        <section className="up-sec" id="duties">
          <div className="up-wrap">
            <div className="up-sec__head"><h2>Two duties, both checkable by anyone</h2></div>
            <p className="up-sec__lede">A duty counts only if a contract can check it from onchain state. A duty with too little data in an epoch is not measured, so a missing caller never costs the Specialist a slash.</p>
            <div className="up-claims sp-duties">
              <article className="up-claim" data-v="PASS"><span className="up-claim__id">D1</span><h3>Show up at the open</h3><p>A buy and a sell order in every Opening Bell cycle for the stock, each above a minimum size and inside a 1.5% band of the clearing price. The registry reads the auction&apos;s own orders. Pass line: 80% of the cycles in the epoch.</p></article>
              <article className="up-claim" data-v="PASS"><span className="up-claim__id">D2</span><h3>Hold the floor</h3><p>A live v4 position in the stock&apos;s BELL pool with a minimum depth and a range that covers the current price. Anyone calls <code>checkpoint</code> once per 15 minutes in open sessions and earns a small USDG tip. Pass line: 90% of the checkpoints.</p></article>
              <article className="up-claim" data-v="PENDING"><span className="up-claim__id">D3</span><h3>Answer upstairs</h3><p>Answer block quote requests within a set time. It needs an onchain request and response flow, so it is not in v1.</p><span className="up-v">V2</span></article>
              <article className="up-claim" data-v="PASS"><span className="up-claim__id">±</span><h3>No privileges</h3><p>No priority in the auction, no fee discount, no way to block anyone else from trading or providing liquidity. Accountability without anything that would break BELL&apos;s fairness.</p></article>
            </div>
            <div className="up-bands sp-slash">
              <div className="up-band up-band--r"><small>PASS BOTH</small><b>Reward</b><span>a share of the stock&apos;s reward pool</span></div>
              <div className="up-band up-band--p"><small>MISS ONE</small><b>− 5%</b><span>of the bond, BELL part burned</span></div>
              <div className="up-band up-band--o"><small>MISS BOTH OR TWICE IN A ROW</small><b>− 25%</b><span>and removed from the role</span></div>
              <div className="up-band up-band--c"><small>NOTHING MEASURED</small><b>Void</b><span>no reward, no slash</span></div>
            </div>
          </div>
        </section>

        <section className="up-sec" id="scorecard">
          <div className="up-wrap">
            <div className="up-sec__head"><h2>NVDA scorecard</h2></div>
            {p.epochs.length === 0 ? (
              <p className="up-sec__lede">{dep ? "No epoch has been scored yet. Each row below is written by the contract when anyone closes a finished epoch." : "The registry is not deployed yet. Each epoch the contract scores will appear here, straight from its EpochScored events."}</p>
            ) : (
              <div className="up-table"><table>
                <thead><tr><th>EPOCH (UTC)</th><th>OPENING BELL</th><th>FLOOR CHECKPOINTS</th><th>RESULT</th><th>TX</th></tr></thead>
                <tbody>{p.epochs.map((e) => (
                  <tr key={e.epoch}><td>{day(e.start)}</td><td>{e.cycles ? `${e.cyclesPassed} of ${e.cycles}` : "not measured"}</td><td>{e.checkpoints ? `${e.checkpointsPassed} of ${e.checkpoints}` : "none"}</td><td>{OUTCOME[e.outcome]}</td><td><A path={`tx/${e.tx}`}>{short(e.tx)}</A></td></tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </section>

        <section className="up-sec" id="claims">
          <div className="up-wrap">
            <div className="up-sec__head"><h2>{passes} of {total} claims, replayed from the chain</h2></div>
            <p className="up-sec__lede">Every claim links to a transaction. Nothing here is typed by hand: one script rebuilds each verdict from the chain, and pending is never a pass.</p>
            <div className="up-claims">
              {p.claims.map((c) => {
                const r = p.replay[c.id];
                const v = r?.verdict ?? "PENDING";
                return (
                  <article key={c.id} className="up-claim" data-v={v}>
                    <span className="up-claim__id">{c.id}</span>
                    {v === "PASS" && <span className="up-claim__ok" aria-label="Proven">&#10003;</span>}
                    <h3>{CLAIM_TITLES[c.id] ?? c.title}</h3>
                    <p>{linkify(r?.note ?? c.passes)}</p>
                    <span className="up-v">{v === "PASS" ? "PROVEN" : v}</span>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="up-sec" id="limits">
          <div className="up-wrap">
            <div className="up-sec__head"><h2>Honest limits</h2></div>
            <div className="up-limits">
              {isTest && <div className="up-limit"><i>!</i><div><h3>This is a test instance</h3><p>Epochs last {epochDays} {epochDays === 1 ? "day" : "days"} and the unbond delay {unbondDays} {unbondDays === 1 ? "day" : "days"}, so a full lifecycle fits in days. The Specialist is a team wallet and is labelled as one. The production registry uses one-week epochs and a 14-day delay, and will be a new deployment with an outside market maker.</p></div></div>}
              <div className="up-limit"><i>1</i><div><h3>Not independently audited</h3><p>No external audit exists yet. The contract is tested with 40 Foundry tests including a fuzz run, and every claim above is replayable.</p></div></div>
              <div className="up-limit"><i>2</i><div><h3>Approved, not open</h3><p>In v1 only known counterparties can be assigned, because a designated market maker for securities-like tokens may need regulatory review in its own jurisdiction. This page is not legal advice.</p></div></div>
              <div className="up-limit"><i>3</i><div><h3>Rewards are small, and not a yield</h3><p>They come from protocol revenue for a duty performed: a share of Upstairs fees and pool service fees, plus slashed USDG. They are not a yield to $BELL holders, and they grow only with real usage.</p></div></div>
              <div className="up-limit"><i>4</i><div><h3>The auction duty can be self-matched</h3><p>A Specialist&apos;s own buy and sell can cross each other. v1 measures that orders were placed inside the band, not that a third party traded against them.</p></div></div>
              <div className="up-limit"><i>5</i><div><h3>Answering upstairs is v2</h3><p>The third duty needs an onchain request and response flow that does not exist yet.</p></div></div>
            </div>
          </div>
        </section>

        <section className="up-cta">
          <div className="up-wrap">
            <h2>Check it yourself.</h2>
            <p>One script rebuilds all nine verdicts from a public archive RPC. The registry has no owner and no proxy.</p>
            <CopyCommand command={"git clone https://github.com/belldex/bell && cd bell\nnode scripts/specialist/build-specialist-proof.mjs --rpc https://rpc.mainnet.chain.robinhood.com"} />
            <div className="up-actions" style={{ marginTop: 26, marginBottom: 0 }}>
              <a className="up-btn" href={`${REPO}/contracts/src/specialist/SpecialistRegistry.sol`} target="_blank" rel="noreferrer">Source</a>
              <a className="up-btn" href={`${REPO}/contracts/test/SpecialistRegistry.t.sol`} target="_blank" rel="noreferrer">40 tests</a>
              <a className="up-btn" href={`${REPO}/evidence/specialist/proof.json`} target="_blank" rel="noreferrer">proof.json</a>
            </div>
            <p className="up-fine">BELL is an independent protocol. This page is not an audit and not financial advice. Last replay {new Date(p.lastBuild).toISOString().slice(0, 16).replace("T", " ")} UTC.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
