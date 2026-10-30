import { Fragment } from "react";
import Link from "next/link";
import { Activity, ArrowRight, BadgeCheck, CalendarClock, CalendarDays, CircleCheck, CircleX, Gauge, Percent, Radio, ShieldCheck } from "lucide-react";
import { Arrow } from "./arrow";
import { SessionFeeCurve } from "./session-fee-curve";

const ROBINHOOD_TESTNET_CHAIN_ID = 46630;

/* Product sections between the hero and footer. Describes the BELL policy and current rehearsal status. */

function Eyebrow({ children }: { children: string }) {
  return (
    <p className="lp-eyebrow" data-lp-reveal>
      <i aria-hidden="true" />
      {children}
    </p>
  );
}

/* ----------------------------------------------------------------- 02 */
const STEPS = [
  {
    name: "Read the market first",
    node: "MARKET INPUT",
    icon: CalendarClock,
    where: "The session must be knowable",
    text: "BELL checks the exchange calendar, the stock identity and the timestamp on its market feed. All three must describe the same supported session.",
    reads: ["Exchange calendar", "Stock identity", "Feed freshness"],
    stops: "No matching session, unsupported stock, or stale feed.",
  },
  {
    name: "Price for that session",
    node: "SESSION FEE",
    icon: Percent,
    where: "A verified session selects the base fee",
    text: "The pool starts from a session-specific LP fee. Less-supported hours carry a higher base fee and tighter gross-flow limits.",
    reads: ["Base LP fee", "Per-trade cap", "Rolling-flow cap"],
    stops: "PRE, POST and OVERNIGHT need a supported, healthy feed.",
  },
  {
    name: "Bound the flow",
    node: "POOL LIMITS",
    icon: Gauge,
    where: "Checked as the swap executes",
    text: "The hook checks this trade against its per-swap cap, then checks cumulative gross flow against the pool’s rolling limit.",
    reads: ["Trade size", "Effective fee", "Recent gross flow"],
    stops: "A failed check rejects the swap; limits cannot be bypassed.",
  },
  {
    name: "Execute or stop",
    node: "HOOK DECISION",
    icon: ShieldCheck,
    where: "One decision at the contract boundary",
    text: "The hook applies the verified fee and all active guards in the same transaction. A scheduled close is allowed only with proven closure context and a finite episode budget.",
    reads: ["Proven closure", "Historical anchor", "Episode budget"],
    stops: "Unscheduled outages halt swaps. LP exits remain in-kind.",
  },
] as const;

function StepInstrument({ index, reads }: { index: number; reads: readonly string[] }) {
  if (index === 0) {
    return (
      <div className="lp-step__instrument lp-step__instrument--sources" aria-label="Three market inputs BELL verifies">
        <div className="lp-step__source-head"><span>INPUT</span><span>CHECK</span></div>
        {reads.map((read, i) => {
          const SourceIcon = i === 0 ? CalendarDays : i === 1 ? BadgeCheck : Radio;
          return <span className="lp-step__source-row" key={read}><SourceIcon aria-hidden="true" /><b>{read}</b><small>{["MATCH", "SUPPORTED", "FRESH"][i]}</small></span>;
        })}
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className="lp-step__instrument lp-step__instrument--fees" aria-label="Illustrative BELL base LP fee by session">
        <div className="lp-step__fee-row"><span>REGULAR</span><i style={{ ["--fee" as string]: "5%" }} /><b>0.05%</b></div>
        <div className="lp-step__fee-row"><span>PRE / POST</span><i style={{ ["--fee" as string]: "30%" }} /><b>0.30%</b></div>
        <div className="lp-step__fee-row"><span>OVERNIGHT</span><i style={{ ["--fee" as string]: "50%" }} /><b>0.50%</b></div>
        <div className="lp-step__fee-row"><span>SCHEDULED CLOSE</span><i data-fee="close" style={{ ["--fee" as string]: "100%" }} /><b>1.00%</b></div>
        <small className="lp-step__instrument-note">BASE LP FEE · ILLUSTRATIVE POLICY</small>
      </div>
    );
  }

  if (index === 2) {
    return (
      <div className="lp-step__instrument lp-step__instrument--limits" aria-label="Per-swap and rolling-flow limits">
        <div><span>ONE SWAP</span><b>Per-trade cap</b><ArrowRight aria-hidden="true" /><small>SIZE OF THIS TRADE</small></div>
        <div><span>POOL WINDOW</span><b>Rolling gross-flow cap</b><Activity aria-hidden="true" /><small>CUMULATIVE SWAPS</small></div>
      </div>
    );
  }

  return (
    <div className="lp-step__instrument lp-step__instrument--decision" aria-label="Swap outcomes">
      <div data-outcome="allow"><CircleCheck aria-hidden="true" /><span><b>ALLOW</b><small>Every check passes</small></span></div>
      <div data-outcome="halt"><CircleX aria-hidden="true" /><span><b>HALT</b><small>Any check fails</small></span></div>
    </div>
  );
}

export function PathSection() {
  return (
    <section className="lp-sec" id="how" aria-labelledby="how-title">
      <div className="lp-wrap">
          <Eyebrow>Inside one BELL swap</Eyebrow>
        <div className="lp-how-head">
          <h2 className="lp-h2" id="how-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
            From market signal <em className="o">to swap decision.</em>
          </h2>
          <p className="lp-lead" data-lp-reveal style={{ ["--i" as string]: 2 }}>
            BELL is a Uniswap v4 hook for tokenized-stock pools. It checks market conditions, sets the pool’s fee and flow limits, then allows a swap only while the required data stays valid.
          </p>
        </div>

        <div className="lp-how-caption" data-lp-reveal style={{ ["--i" as string]: 3 }}>
          <span>THE ROUTE FROM MARKET INPUT TO CONTRACT</span>
          <span>ONE SWAP · FOUR CHECKS</span>
        </div>
        <ol className="lp-path" data-lp-rail aria-label="How BELL evaluates a swap">
          {STEPS.map((s, i) => {
            const StageIcon = s.icon;
            return (
              <li className="lp-step" data-stage={i} key={s.name} data-spot data-lp-reveal style={{ ["--i" as string]: i + 1 }}>
                <div className="lp-step__intro">
                  <span className="lp-step__node"><StageIcon aria-hidden="true" size={15} strokeWidth={1.7} />{s.node}</span>
                  <p className="lp-step__where">{s.where}</p>
                  <h3>{s.name}</h3>
                </div>
                <div className="lp-step__logic">
                  <p>{s.text}</p>
                  <p className="lp-step__stop"><span>Stops when</span>{s.stops}</p>
                </div>
                <StepInstrument index={i} reads={s.reads} />
              </li>
            );
          })}
        </ol>

        <div className="lp-how-summary" data-lp-reveal style={{ ["--i" as string]: 5 }}>
          <span>At the hook boundary</span>
          <b>All guards pass</b><i aria-hidden="true">→</i><strong>Swap executes</strong>
          <span className="lp-how-summary__halt">One guard fails <i aria-hidden="true">→</i> <b>transaction reverts</b></span>
        </div>
      </div>
    </section>
  );
}

/* Session fees and operating conditions: distinct, documented BELL sessions. */
const SESSIONS = [
  { name: "Pre-market", code: "PRE", rate: "0.30%", note: "Supported extended-hours feed · tighter limits" },
  { name: "Regular", code: "REGULAR", rate: "0.05%", note: "Healthy stock stream · regular session" },
  { name: "After-hours", code: "POST", rate: "0.30%", note: "Supported extended-hours feed · tighter limits" },
  { name: "Overnight", code: "OVERNIGHT", rate: "0.50%", note: "Healthy feed · smallest active-session limits" },
  { name: "Scheduled close", code: "CLOSED", rate: "1.00%", note: "Proven close · historical anchor · finite budget" },
] as const;

export function SessionSection() {
  return (
    <section className="lp-sec lp-lend" id="sessions" aria-labelledby="lending-title">
      <div className="lp-wrap lp-lend__wrap">
        <header className="lp-lend__intro">
          <div className="lp-lend__title">
          <Eyebrow>Fees follow the session</Eyebrow>
          <h2 className="lp-h2" id="lending-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
            One market day. <em className="o">Five fee states.</em>
          </h2>
          </div>
          <p className="lp-lead" data-lp-reveal style={{ ["--i" as string]: 2 }}>
            BELL verifies the exchange session and stock feed before a swap. That state sets the pool&apos;s base LP fee and flow limits; stale or unsupported data stops execution.
          </p>
        </header>

        <figure className="lp-lend__board" data-lp-reveal="up" style={{ ["--i" as string]: 2 }}>
          <figcaption className="lp-lend__cap">
            <span>Base LP fee by verified session</span>
            <span>Illustrative policy · not live pool data</span>
          </figcaption>
          <div className="lp-lend__plot">
            <SessionFeeCurve />
          </div>
          <ol className="lp-lend__acts">
            {SESSIONS.map((s) => (
              <li key={s.code} data-proof={s.code === "CLOSED" ? "true" : "false"}>
                <span className="lp-lend__idx">{s.code}</span>
                <span className="lp-lend__act"><b>{s.name}</b><small>{s.note}</small></span>
                <span className="lp-lend__gate">{s.rate}</span>
              </li>
            ))}
          </ol>
          <p className="lp-lend__foot"><span>UNKNOWN</span><span>Unverified session or stale stock data halts swaps.</span></p>
        </figure>

        <footer className="lp-lend__bottom">
          <p className="lp-lend__fine" data-lp-reveal style={{ ["--i" as string]: 3 }}>
            Base fees are policy examples, not live quotes. Reopen, corporate-action and repricing guards can tighten the effective policy. Rolling limits recover as swaps age out; a scheduled-close budget stays fixed until a verified reopen.
          </p>
          <div className="lp-lend__cta" data-lp-reveal style={{ ["--i" as string]: 4 }}>
            <Link className="lp-btn lp-btn--primary" href="/pools">Explore pools <Arrow /></Link>
            <Link className="lp-btn lp-btn--ghost" href="/protocol">Read protocol policy</Link>
          </div>
        </footer>
      </div>
    </section>
  );
}

/* Current status, clearly separating rehearsal from production readiness. */
type PhaseStatus = "done" | "live" | "wip" | "blocked" | "future";
const STATUS_LABEL: Record<PhaseStatus, string> = { done: "Rehearsed", live: "Testnet", wip: "Rehearsal pending", blocked: "Blocked", future: "Pending" };

const PHASES: readonly { n: string; name: string; status: PhaseStatus; items: readonly string[] }[] = [
  {
    n: "POLICY",
    name: "Policy implementation",
    status: "done",
    items: [
      "Session-specific LP fees and gross-flow limits are implemented in the contracts",
      "Scheduled-close policy requires proven context and one finite episode budget",
      "Unsupported or uncertain market states fail closed",
    ],
  },
  {
    n: "TESTNET",
    name: "Testnet rehearsal",
    status: "done",
    items: [
      "One earlier REGULAR-session pool completed a successful swap on Robinhood Testnet",
      "Historical rehearsal evidence; the current-asset pool and feed are not verified live",
      "Not a live health, uptime or asset-availability guarantee",
    ],
  },
  {
    n: "COVERAGE",
    name: "Broader session rehearsal",
    status: "wip",
    items: [
      "Extended-hours and overnight coverage still need broader rehearsal",
      "The current asset testnet pool has not been verified",
      "Every session requires a healthy supported feed; unexpected states halt",
    ],
  },
  {
    n: "PRICE GUARD",
    name: "PRICE_GUARDED profile",
    status: "blocked",
    items: [
      "Blocked until an independent reference pair is admitted",
      "No price-protection badge or guarantee is currently available",
      "SESSION_ONLY has no independent price protection for its counterasset",
    ],
  },
  {
    n: "PRODUCTION",
    name: "Production readiness",
    status: "future",
    items: [
      "Mainnet has not been touched",
      "Independent security review has not been completed",
      "Data rights, operations and production controls remain prerequisites",
    ],
  },
];

/* Match Gyevo's milestone rail geometry; status controls the completed route length. */
const NODE_X = (i: number) => 100 + i * 200;
const NODE_Y = (i: number) => (i % 2 ? 28 : 92);
const route = (from: number, to: number) => {
  let d = `M${NODE_X(from)} ${NODE_Y(from)}`;
  for (let i = from; i < to; i++) d += ` C${NODE_X(i) + 100} ${NODE_Y(i)} ${NODE_X(i + 1) - 100} ${NODE_Y(i + 1)} ${NODE_X(i + 1)} ${NODE_Y(i + 1)}`;
  return d;
};
const LAST_LIVE = PHASES.reduce((last, p, i) => (p.status === "done" || p.status === "live" ? i : last), 0);
const FUTURE_ROUTE = LAST_LIVE < PHASES.length - 1 ? route(LAST_LIVE, PHASES.length - 1) : "";

export function RoadmapSection() {
  return (
    <section className="lp-sec lp-road" id="roadmap" aria-labelledby="road-title">
      <div className="lp-wrap">
        <Eyebrow>Status, without the gloss</Eyebrow>
        <h2 className="lp-h2" id="road-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
          The rehearsal is evidence, <em className="o">not a release.</em>
        </h2>
        <p className="lp-lead" data-lp-reveal style={{ ["--i" as string]: 2 }}>
          An earlier REGULAR pool completed a swap on Robinhood Chain Testnet ({ROBINHOOD_TESTNET_CHAIN_ID}). That confirms a past rehearsal, not current asset availability, live feeds, or production readiness.
        </p>

        {/* A dim route marks future milestones; the brighter path and moving square stay scrubbed to scroll. */}
        <div className="lp-road__map" data-lp-rail aria-hidden="true">
          <svg className="lp-road__svg lp-road__svg--todo" viewBox="0 0 1000 120" preserveAspectRatio="none" focusable="false">
            <path d={FUTURE_ROUTE} />
          </svg>
          <svg className="lp-road__svg lp-road__svg--signal" viewBox="0 0 1000 120" preserveAspectRatio="none" focusable="false">
            <path d={FUTURE_ROUTE} pathLength="1000" />
            <rect className="lp-road__cursor" x={NODE_X(LAST_LIVE) - 5.5} y={NODE_Y(LAST_LIVE) - 5.5} width="11" height="11" rx="1" />
          </svg>
          <svg className="lp-road__svg lp-road__svg--done" viewBox="0 0 1000 120" preserveAspectRatio="none" focusable="false">
            <path d={`M0 ${NODE_Y(0)} L${NODE_X(0)} ${NODE_Y(0)} ${route(0, LAST_LIVE).replace(/^M[^C]*/, "")}`} />
          </svg>
          {PHASES.map((ph, i) => (
            <Fragment key={ph.n}>
              <span className="lp-road__node" aria-hidden="true" data-status={ph.status} data-phase-index={i} style={{ ["--x" as string]: NODE_X(i) / 10, ["--y" as string]: (NODE_Y(i) / 120) * 100 }} />
              <span className="lp-road__label" aria-hidden="true" data-side={i % 2 ? "above" : "below"} style={{ ["--x" as string]: NODE_X(i) / 10, ["--y" as string]: (NODE_Y(i) / 120) * 100 }}>{ph.n}</span>
            </Fragment>
          ))}
        </div>

        <ol className="lp-road__list">
          {PHASES.map((ph, i) => (
            <li className="lp-phase" data-status={ph.status} data-phase-index={i} key={ph.n} data-spot data-lp-reveal style={{ ["--i" as string]: i + 1 }}>
              <p className="lp-phase__top">
                <span className="lp-phase__n">{ph.name}</span>
                <span className="lp-chip" data-tone={ph.status}><i aria-hidden="true" />{STATUS_LABEL[ph.status]}</span>
              </p>
              <h3>{ph.name}</h3>
              <ul>{ph.items.map((t) => <li key={t}>{t}</li>)}</ul>
            </li>
          ))}
        </ol>
        <p className="lp-road__summary"><span>Production gate</span>The protocol stack is testnet-only; mainnet is not deployed. PRICE_GUARDED awaits an admitted reference pair. Production also requires security review, data rights and operational controls.</p>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- facts */
export function FactsSection() {
  return (
    <section className="lp-sec lp-facts" id="facts" aria-labelledby="facts-title">
      <div className="lp-wrap">
        <header className="lp-facts__head" data-lp-reveal>
          <div className="lp-facts__title">
            <p className="lp-facts__eyebrow">Protocol status</p>
            <h2 className="lp-facts__headline" id="facts-title">Testnet snapshot</h2>
          </div>
          <div className="lp-facts__stamp">
            <span className="lp-facts__stamp-label">Verified at</span>
            <time dateTime="2026-10-29T03:40:00Z"><span>29 Oct 2026</span><strong>03:40 UTC</strong></time>
            <span className="lp-facts__stamp-note">Static record · not live-updating</span>
          </div>
        </header>
        <dl className="lp-facts__grid" data-lp-reveal>
          <div className="lp-fact" data-spot><dt>Verified rehearsal</dt><dd>Historical REGULAR swap · earlier testnet pool</dd></div>
          <div className="lp-fact" data-spot><dt>Current asset</dt><dd>Pool and swap not yet verified</dd></div>
          <div className="lp-fact" data-spot><dt>Network</dt><dd>Robinhood Chain Testnet · {ROBINHOOD_TESTNET_CHAIN_ID}</dd></div>
          <div className="lp-fact" data-spot><dt>Mainnet</dt><dd>No protocol deployment</dd></div>
          <div className="lp-fact" data-spot><dt>PRICE_GUARDED</dt><dd>Blocked · no admitted reference</dd></div>
          <div className="lp-fact" data-spot><dt>Independent audit</dt><dd>Not completed</dd></div>
          <div className="lp-fact" data-spot><dt>Rehearsal token</dt><dd>Synthetic fixture · not an official Robinhood stock token</dd></div>
          <div className="lp-fact" data-spot><dt>SESSION_ONLY</dt><dd>Session controls; no independent counterasset price protection</dd></div>
        </dl>
      </div>
    </section>
  );
}
