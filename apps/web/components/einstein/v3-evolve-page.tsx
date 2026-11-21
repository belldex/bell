import { ArrowUpRight } from "lucide-react";
import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { LandingNav } from "@/components/landing/gyevo/landing-nav";
import { EinsteinMotion } from "./einstein-motion";
import { CopyCommand } from "./copy-command";
import proof from "./v3-evolve-proof.json";

const SECTIONS = [
  { id: "verdict", label: "Verdict", desc: "The gap between the two pools." },
  { id: "pools", label: "The two pools", desc: "BELL against a plain v4 pool." },
  { id: "chart", label: "Over time", desc: "Net LP result across the weekend." },
  { id: "sessions", label: "By session", desc: "Fees against LVR, per session." },
  { id: "blocked", label: "Refused flow", desc: "Swaps BELL turned away." },
  { id: "setup", label: "Setup", desc: "Pools, capital, range and bot." },
  { id: "check", label: "Check it yourself", desc: "Replay every number." },
  { id: "limits", label: "Honest limits", desc: "What this does not show." },
  { id: "history", label: "Runs", desc: "Every run, none deleted." },
] as const;

type Verdict = "PASS" | "PARTIAL" | "PENDING" | "FAIL";
type Row = { tx: string; session: string; feePips: number; kind: string; in: number; inToken: string; lvr: number; fee: number };
type Pool = {
  role: string; poolId: string; startCapital: number; feesEarned: number; lvr: number; valueVsHold: number; netBps: number;
  swaps: number; volume: number; organicSwaps: number; botSwaps: number;
  sessions: Record<string, { swaps: number; fees: number; lvr: number; volume: number }>;
  series: { ts: number; net: number }[]; rows: Row[];
};
type Result = {
  blocks: { start: number; end: number; head: number };
  reference: { rule: string; start: { price: number; roundId: string; block: number }; end: { price: number; roundId: string; block: number; fresh: boolean } };
  pendingReferences: number; bell: Pool; control: Pool; verdict: { gapBps: number; winner: string };
  bands: { phase: string; start: number; end: number }[];
};
type PoolCfg = { poolId: string; hook: string; positionId: string; tickLower: number; tickUpper: number; seedTx: string; seedBlock: number; seed: { usdg: string; nvda: string } };
type Run = {
  id: number; label: string; postponed?: boolean; status: "scheduled" | "live" | "final"; window: { startTs: number; endTs: number }; note: string | null;
  generatedAt?: string; result?: Result;
  config?: { pools: { bell: PoolCfg; control: PoolCfg }; bot: { addresses: string[]; sourceFile: string; sourceUrl?: string; sourceSha256: string; maxUsdg: number }; blocked?: { tx: string; error: string }[] };
  replay?: Record<string, { verdict: Verdict; note: string }>;
};

const runs = proof.runs as unknown as Run[];
const explorer = proof.chain.explorer;
const current = [...runs].reverse().find((r) => r.status !== "scheduled") ?? runs[0];
const short = (h: string, a = 8, b = 6) => `${h.slice(0, a)}…${h.slice(-b)}`;
const bps = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)} bps`;
const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(Math.abs(n) < 1 ? 4 : 2)}`;
const day = (ts: number) => new Date(ts * 1000).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false });
const link = (path: string, text: string) => <a href={`${explorer}/${path}`} target="_blank" rel="noopener noreferrer">{text}</a>;

function verdictLine(run: Run) {
  if (run.postponed && !run.result) return <>Run {run.id} did not start on {day(run.window.startTs)} ET. The pools were not funded in time, so nothing was seeded or measured. New dates are set before any pool is seeded.</>;
  if (run.status === "scheduled" || !run.result) return <>Run {run.id} starts {day(run.window.startTs)} ET. Nothing is measured yet, so there is no result to show.</>;
  const g = run.result.verdict.gapBps;
  const live = run.status === "live";
  if (g === 0) return <>{live ? "Run in progress: " : ""}the BELL LP and the plain v4 LP are level.</>;
  return <>{live ? "Run in progress: so far, the" : `Over ${run.label.toLowerCase()}, the`} BELL LP {live ? "is" : "ended"} <b>{Math.abs(g).toFixed(1)} bps of capital {g > 0 ? "ahead of" : "behind"}</b> a plain v4 LP.</>;
}

function PoolCard({ pool, title, hook }: { pool: Pool; title: string; hook: string }) {
  return (
    <article className="ve-card" data-role={pool.role}>
      <h3>{title}</h3>
      <p className="ve-card__hook">{hook}</p>
      <p className="ve-card__net" data-sign={pool.netBps >= 0 ? "up" : "down"}>{bps(pool.netBps)}<span>net LP result</span></p>
      <dl>
        <div><dt>Fees earned</dt><dd>{usd(pool.feesEarned)}</dd></div>
        <div><dt>LVR</dt><dd>{usd(pool.lvr)}</dd></div>
        <div><dt>Value vs hold</dt><dd>{usd(pool.valueVsHold)}</dd></div>
        <div><dt>Swaps</dt><dd>{pool.swaps} <small>({pool.organicSwaps} organic, {pool.botSwaps} bot)</small></dd></div>
      </dl>
      <p className="ve-card__src">Every number is recomputed by <code>verify-v3-evolve.mjs</code> from the pool&apos;s Swap events.</p>
    </article>
  );
}

function LineChart({ run }: { run: Run }) {
  const r = run.result!;
  const t0 = run.window.startTs; const t1 = Math.max(run.window.endTs, ...r.bell.series.map((s) => s.ts));
  const all = [...r.bell.series, ...r.control.series].map((s) => s.net);
  const min = Math.min(0, ...all); const max = Math.max(0, ...all); const span = max - min || 1;
  const W = 760; const H = 260; const pad = 36;
  const x = (ts: number) => pad + ((ts - t0) / (t1 - t0 || 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const path = (s: { ts: number; net: number }[]) => s.length ? `M${x(t0)},${y(0)} ` + s.map((p) => `L${x(p.ts).toFixed(1)},${y(p.net).toFixed(1)}`).join(" ") : "";
  return (
    <figure className="ve-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Net LP result over time for the BELL pool and the control pool, with trading sessions shaded behind">
        {r.bands.map((b, i) => (
          <g key={i}>
            <rect className="ve-band" data-phase={b.phase.toLowerCase()} x={x(b.start)} y={pad / 2} width={Math.max(0, x(b.end) - x(b.start))} height={H - pad * 1.5} />
            {x(b.end) - x(b.start) > 46 && <text className="ve-band__label" x={x(b.start) + 6} y={pad / 2 + 13}>{b.phase.toLowerCase()}</text>}
          </g>
        ))}
        <line className="ve-zero" x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} />
        <path className="ve-line ve-line--control" d={path(r.control.series)} />
        <path className="ve-line ve-line--bell" d={path(r.bell.series)} />
      </svg>
      <figcaption><i data-role="bell" /> BELL pool <i data-role="control" /> Control pool. Net LP result in USDG, marked at each swap&apos;s reference price. The zero line is holding the starting tokens.</figcaption>
    </figure>
  );
}

function SessionBars({ run }: { run: Run }) {
  const r = run.result!;
  const names = ["POST", "CLOSED", "OVERNIGHT", "PRE", "REGULAR"];
  const peak = Math.max(1e-9, ...names.flatMap((n) => [r.bell, r.control].flatMap((p) => [Math.abs(p.sessions[n]?.fees ?? 0), Math.abs(p.sessions[n]?.lvr ?? 0)])));
  return (
    <div className="ve-sessions">
      {names.map((n) => (
        <div key={n} className="ve-sessions__col">
          <h4>{n.toLowerCase()}</h4>
          {([["bell", r.bell], ["control", r.control]] as const).map(([role, p]) => (
            <div key={role} className="ve-pair" data-role={role}>
              <span className="ve-bar ve-bar--fee" style={{ height: `${Math.round(((p.sessions[n]?.fees ?? 0) / peak) * 100)}%` }} title={`fees ${usd(p.sessions[n]?.fees ?? 0)}`} />
              <span className="ve-bar ve-bar--lvr" style={{ height: `${Math.round((Math.abs(p.sessions[n]?.lvr ?? 0) / peak) * 100)}%` }} title={`LVR ${usd(p.sessions[n]?.lvr ?? 0)}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function V3EvolvePage() {
  const r = current.result;
  const blocked = current.config?.blocked ?? [];
  const live = current.status !== "scheduled" && r;
  return (
    <div className="lp lp--bell legal ein pp ve" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={SECTIONS} />
      <EinsteinMotion />
      <main id="main" className="legal__main ein__main">
        <header className="ein-hero pp-hero">
          <div className="ein-hero__copy">
            <p className="ein-tag"><span>Einstein Hooks v3 Evolve</span><b>LP economics, tested on mainnet</b></p>
            <h1>Does the LP end up <em>better off?</em></h1>
            <p className="ein-lede">{proof.question}</p>
          </div>
        </header>

        <section id="verdict" className="ein-section ve-verdict" data-reveal data-status={current.status}>
          <p className="ve-verdict__status">{current.postponed && current.status === "scheduled" ? "Postponed" : current.status === "scheduled" ? "Scheduled" : current.status === "live" ? "Run in progress" : "Result"}</p>
          <p className="ve-verdict__line">{verdictLine(current)}</p>
          {r && r.pendingReferences > 0 && <p className="ein-fine">{r.pendingReferences} swap(s) are left out of LVR until the feed publishes its next round.</p>}
        </section>

        {live && r && (
          <>
            <section id="pools" className="ein-section" data-reveal>
              <h2>The two pools</h2>
              <div className="ve-cards">
                <PoolCard pool={r.bell} title="BELL pool" hook="Einstein hook: session fees, caps, auction" />
                <PoolCard pool={r.control} title="Control pool" hook="No hook: plain Uniswap v4, fixed 0.30% fee" />
              </div>
            </section>
            <section id="chart" className="ein-section" data-reveal>
              <h2>Net LP result over time</h2>
              <LineChart run={current} />
            </section>
            <section id="sessions" className="ein-section" data-reveal>
              <h2>Fees against LVR, per session</h2>
              <SessionBars run={current} />
              <p className="ein-fine">For each session and pool, the left bar is fees earned and the right bar is LVR, the value traders took by trading at stale prices. Negative LVR is drawn as its size.</p>
            </section>
          </>
        )}

        {!live && (
          <section id="pools" className="ein-section" data-reveal>
            <h2>What will be measured</h2>
            <dl className="pp-facts">
              <div><dt>BELL pool</dt><dd>NVDA/USDG, Einstein hook, session fees 0.05 to 1%</dd></div>
              <div><dt>Control pool</dt><dd>NVDA/USDG, no hook, fixed 0.30%</dd></div>
              <div><dt>Window</dt><dd>{current.postponed ? "New dates, set before the seed" : <>{day(current.window.startTs)} to {day(current.window.endTs)} ET</>}</dd></div>
              <div><dt>Reference price</dt><dd>Chainlink NVDA feed, rule fixed in advance</dd></div>
            </dl>
            <p className="ein-fine">The charts and cards fill in when a run starts. They read one file, and no number on this page is typed by hand.</p>
          </section>
        )}

        <section id="blocked" className="ein-section" data-reveal>
          <h2>Flow the BELL pool refused</h2>
          {blocked.length ? (
            <ul className="pp-links">{blocked.map((b) => <li key={b.tx}>{link(`tx/${b.tx}`, `${b.error} ${short(b.tx)}`)}</li>)}</ul>
          ) : <p className="ein-ledger__lede">No refused swap is on record yet. Each one will be listed here with its reverted transaction and error name.</p>}
        </section>

        <section id="setup" className="ein-section" data-reveal>
          <h2>Setup</h2>
          {current.config ? (
            <dl className="pp-facts">
              <div><dt>BELL pool</dt><dd>{link(`address/${current.config.pools.bell.hook}`, short(current.config.pools.bell.hook, 10, 8))}</dd></div>
              <div><dt>Hook contract</dt><dd>Einstein v2, as deployed. This is not a new hook contract.</dd></div>
              <div><dt>Control pool hook</dt><dd>None (zero address)</dd></div>
              <div><dt>Range</dt><dd>ticks {current.config.pools.bell.tickLower} to {current.config.pools.bell.tickUpper}, both pools</dd></div>
              <div><dt>Seed transactions</dt><dd>{link(`tx/${current.config.pools.bell.seedTx}`, "BELL")} and {link(`tx/${current.config.pools.control.seedTx}`, "control")}</dd></div>
              <div><dt>Bot</dt><dd>{current.config.bot.addresses.map((a) => <span key={a}>{link(`address/${a}`, short(a, 8, 6))} </span>)}source <code>{current.config.bot.sourceFile}</code> (sha256 {current.config.bot.sourceSha256.slice(0, 12)}…)</dd></div>
              <div><dt>Bot maximum size</dt><dd>{current.config.bot.maxUsdg} USDG per swap, the same on both pools</dd></div>
            </dl>
          ) : (
            <dl className="pp-facts">
              <div><dt>Hook contract</dt><dd>Einstein v2, as deployed. It is called a v3 contract only if new hook contracts are deployed.</dd></div>
              <div><dt>Pools</dt><dd>Not seeded yet. Pool ids, capital, range, seed transactions and the bot address appear here when they are.</dd></div>
              <div><dt>Method</dt><dd>Formulas, reference-price rule, window and bot code are committed before the seed{proof.methodCommit ? <>: <a href={`https://github.com/belldex/bell/commit/${proof.methodCommit}`} target="_blank" rel="noopener noreferrer">{String(proof.methodCommit).slice(0, 8)}</a></> : ", and linked here"}.</dd></div>
            </dl>
          )}
        </section>

        <section id="check" className="ein-section" data-reveal>
          <h2>Check it yourself</h2>
          <p className="ein-ledger__lede">Every number comes from Swap events. One script rebuilds the run from a public RPC and compares it with this page. Claims E1 to E9:</p>
          <CopyCommand command={`git clone https://github.com/belldex/bell && cd bell\nnode scripts/einstein/verify-v3-evolve.mjs --rpc https://rpc.mainnet.chain.robinhood.com --run ${current.id}`} />
          <ol className="pp-ledger">
            {proof.claims.map((c) => {
              const v = (current.replay?.[c.id]?.verdict ?? "PENDING") as Verdict;
              return (
                <li key={c.id} data-v={v.toLowerCase()}>
                  <div className="pp-ledger__id"><b>{c.id}</b><span>{v === "PASS" ? "Proven" : v === "FAIL" ? "Failed" : v === "PARTIAL" ? "Partly proven" : "Pending"}</span></div>
                  <div className="pp-ledger__body"><h3>{c.title}</h3><p>{current.replay?.[c.id]?.note ?? c.proof}</p><p className="pp-ledger__bar"><span>Proven when</span> {c.passes}</p></div>
                </li>
              );
            })}
          </ol>
          <p className="ein-fine">
            <a href="https://github.com/belldex/bell/blob/main/scripts/einstein/verify-v3-evolve.mjs" target="_blank" rel="noopener noreferrer">Read the script <ArrowUpRight size={14} aria-hidden="true" /></a>
            {" "}and{" "}
            <a href="https://github.com/belldex/bell/blob/main/evidence/einstein/v3-evolve/proof.json" target="_blank" rel="noopener noreferrer">proof.json <ArrowUpRight size={14} aria-hidden="true" /></a>
          </p>
        </section>

        <section id="limits" className="ein-section" data-reveal>
          <h2>Honest limits</h2>
          <ul className="pp-limits">{proof.limits.map((l) => <li key={l}>{l}</li>)}</ul>
        </section>

        <section id="history" className="ein-section" data-reveal>
          <h2>Runs</h2>
          <ol className="ve-history">
            {runs.map((run) => (
              <li key={run.id} data-status={run.status}>
                <b>Run {run.id}</b><span>{run.label}</span>
                <span>{run.postponed && run.status === "scheduled" ? "postponed, not started" : run.status === "scheduled" ? "scheduled" : run.result ? `${run.status}, gap ${bps(run.result.verdict.gapBps)}` : run.status}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="legal__foot">
        <div className="lp-wrap">
          <p>BELL is an independent protocol. This page reports what can be checked on chain. It is not an audit and not financial advice.</p>
          <nav aria-label="Related">
            <a href="/einstein/pool/">First pool proof</a>
            <a href="/einstein/">Einstein Hooks v2</a>
            <a href="/">Home</a>
          </nav>
        </div>
      </footer>
      <LandingEffects />
    </div>
  );
}
