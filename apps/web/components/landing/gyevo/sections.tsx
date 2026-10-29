import Link from "next/link";
import { Arrow } from "./arrow";

const ROBINHOOD_TESTNET_CHAIN_ID = 46630;

/* Product sections between the hero and footer. Describes the BELL policy and current rehearsal status. */

function Eyebrow({ n, children, ac }: { n: string; children: string; ac?: "blue" | "orange" }) {
  return (
    <p className="lp-eyebrow" data-lp-reveal style={{ ["--ac" as string]: ac === "blue" ? "var(--lp-public)" : "var(--lp-accent)" }}>
      <i aria-hidden="true" />
      {children}
    </p>
  );
}

/* ----------------------------------------------------------------- 02 */
const STEPS = [
  {
    name: "Verify the session",
    lane: "public",
    where: "Calendar + stock data",
    text: "BELL checks the exchange session, stock identity, feed freshness and required market-data capability before deciding whether a swap may proceed.",
    pub: ["Session and calendar state", "Stock feed age and status"],
    priv: ["No guessed session", "No stale data treated as live"],
  },
  {
    name: "Set fee and limits",
    lane: "public",
    where: "Pool policy",
    text: "The session determines a base LP fee and the size of per-trade and rolling gross-flow limits. Less liquid sessions receive tighter limits.",
    pub: ["Base session fee", "Per-trade and rolling caps"],
    priv: ["Caps do not refill on new liquidity", "Or at midnight"],
  },
  {
    name: "Check the swap",
    lane: "public",
    where: "At execution",
    text: "The hook evaluates the current market state and cumulative flow atomically with the swap. A failed guard rejects the swap; it does not silently choose another source.",
    pub: ["Quote and fee follow pool policy", "Limits apply before execution"],
    priv: ["Unknown state means halt", "No automatic fallback feed"],
  },
  {
    name: "Handle scheduled closure",
    lane: "public",
    where: "Only with valid context",
    text: "A proven planned closure may use the captured historical close and one non-refilling episode budget. The anchor remains historical, not a live quote.",
    pub: ["Closure source and anchor status", "Finite remaining budget"],
    priv: ["Invalid anchor or changed multiplier halts", "LP exits remain in-kind"],
  },
] as const;

export function PathSection() {
  return (
    <section className="lp-sec" id="how" aria-labelledby="how-title">
      <div className="lp-wrap">
        <Eyebrow n="">How it works</Eyebrow>
        <h2 className="lp-h2" id="how-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
          Every swap clears a series of <em className="o">gates.</em>
        </h2>
        <p className="lp-lead" data-lp-reveal style={{ ["--i" as string]: 2 }}>
          BELL checks its inputs in order. A single stale feed, invalid session or exhausted limit keeps the swap from executing.
        </p>
        <p className="lp-legend" data-lp-reveal style={{ ["--i" as string]: 3 }}>
          <span className="pv"><i aria-hidden="true" />Required inputs are verified</span>
          <span className="pb"><i aria-hidden="true" />Invalid state stops the swap</span>
        </p>

        <ol className="lp-path" data-lp-rail>
          {STEPS.map((s, i) => (
            <li className="lp-step" data-lane={s.lane} key={s.name} data-spot data-lp-reveal style={{ ["--i" as string]: i + 1 }}>
              <span className="lp-step__node" aria-hidden="true">{["CHECK", "PRICE", "CAP", "CLOSE"][i]}</span>
              <p className="lp-step__where">{s.where}</p>
              <h3>{s.name}</h3>
              <p>{s.text}</p>
              <div className="lp-lists">
              <div>
                  <h4>Verified inputs</h4>
                  <ul>{s.pub.map((t) => <li key={t}>{t}</li>)}</ul>
                </div>
                <div className="priv">
                  <h4>Fail-safe rules</h4>
                  <ul>{s.priv.map((t) => <li key={t}>{t}</li>)}</ul>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* Session fees and operating conditions: distinct, documented BELL sessions. */
const SESSIONS = [
  { name: "Regular", code: "REGULAR", rate: "0.05%", note: "Active stock stream and regular-session data required." },
  { name: "Pre-market", code: "PRE", rate: "0.30%", note: "Supported extended-hours feed; tighter limits." },
  { name: "After-hours", code: "POST", rate: "0.30%", note: "Supported extended-hours feed; tighter limits." },
  { name: "Overnight", code: "OVERNIGHT", rate: "0.50%", note: "Supported overnight feed; smallest active-session limits." },
  { name: "Scheduled close", code: "CLOSED", rate: "1.00%", note: "Valid closure context, historical anchor and bounded episode budget." },
] as const;

export function SessionSection() {
  return (
    <section className="lp-sec lp-lend" id="sessions" aria-labelledby="lending-title">
      <div className="lp-wrap lp-lend__wrap">
        <div className="lp-lend__copy">
          <Eyebrow n="" ac="blue">Fees follow the session</Eyebrow>
          <h2 className="lp-h2" id="lending-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
            A market clock. <em className="o">A fee curve.</em>
          </h2>
          <p className="lp-lead" data-lp-reveal style={{ ["--i" as string]: 2 }}>
            BELL&apos;s documented base fees scale with the market session. The hook also applies session-specific gross-flow limits and halts when required feeds or calendar state cannot be verified.
          </p>
          <p className="lp-lend__fine" data-lp-reveal style={{ ["--i" as string]: 3 }}>
            These are base fees, not a promise of live data availability. PRE, POST and OVERNIGHT require supported healthy feeds; an unsupported or unexpected state is halted.
          </p>
          <div className="lp-lend__cta" data-lp-reveal style={{ ["--i" as string]: 4 }}>
            <Link className="lp-btn lp-btn--primary" href="/pools">Explore pools <Arrow /></Link>
            <Link className="lp-btn lp-btn--ghost" href="/protocol">Read protocol policy</Link>
          </div>
        </div>

        <figure className="lp-lend__board" data-lp-reveal="right" style={{ ["--i" as string]: 2 }}>
          <figcaption className="lp-lend__cap">
            <span>BELL base LP fees</span>
            <span>Session policy</span>
          </figcaption>
          <ol className="lp-lend__acts">
            {SESSIONS.map((s) => (
              <li key={s.code} data-proof={s.code === "CLOSED" ? "true" : "false"}>
                <span className="lp-lend__idx" aria-hidden="true">{s.code}</span>
                <span className="lp-lend__act"><b>{s.name}</b><small>{s.note}</small></span>
                <span className="lp-lend__gate">{s.rate}</span>
              </li>
            ))}
          </ol>
          <p className="lp-lend__foot"><span>UNKNOWN</span>Unverified session or unexpected stale data means no swap.</p>
        </figure>
      </div>
    </section>
  );
}

/* Current status, clearly separating rehearsal from production readiness. */
type PhaseStatus = "done" | "live" | "wip" | "blocked" | "future";
const STATUS_LABEL: Record<PhaseStatus, string> = { done: "Rehearsed", live: "Testnet", wip: "Specified · not live", blocked: "Blocked", future: "Pending" };

const PHASES: readonly { n: string; name: string; status: PhaseStatus; items: readonly string[] }[] = [
  {
    n: "PROVED",
    name: "REGULAR session rehearsal",
    status: "done",
    items: [
      "One REGULAR pool rehearsal on Robinhood Testnet",
      "A successful swap recorded during the rehearsal",
      "Historical evidence only; not a live health or uptime guarantee",
    ],
  },
  {
    n: "SCOPED",
    name: "Broader session coverage",
    status: "wip",
    items: [
      "PRE, POST, OVERNIGHT and planned-close controls are specified",
      "Every session still depends on a supported, healthy data source",
      "Unsupported or unexpected state must halt rather than fall back",
    ],
  },
  {
    n: "HELD",
    name: "PRICE_GUARDED profile",
    status: "blocked",
    items: [
      "Blocked until an independent reference pair is admitted",
      "No price-protection badge or guarantee is currently available",
      "SESSION_ONLY has no independent price protection for its counterasset",
    ],
  },
  {
    n: "PENDING",
    name: "Production readiness",
    status: "future",
    items: [
      "Mainnet has not been touched",
      "Independent security review has not been completed",
      "Data rights, operations and production controls remain prerequisites",
    ],
  },
];

/* Spread the route across the four current milestones. */
const NODE_X = (i: number) => 100 + i * (800 / (PHASES.length - 1));
const NODE_Y = (i: number) => (i % 2 ? 28 : 92);
const route = (from: number, to: number) => {
  let d = `M${NODE_X(from)} ${NODE_Y(from)}`;
  for (let i = from; i < to; i++) d += ` C${NODE_X(i) + 100} ${NODE_Y(i)} ${NODE_X(i + 1) - 100} ${NODE_Y(i + 1)} ${NODE_X(i + 1)} ${NODE_Y(i + 1)}`;
  return d;
};
const LAST_LIVE = PHASES.reduce((last, p, i) => (p.status === "done" || p.status === "live" ? i : last), 0);

export function RoadmapSection() {
  return (
    <section className="lp-sec lp-road" id="roadmap" aria-labelledby="road-title">
      <div className="lp-wrap">
        <Eyebrow n="" ac="blue">Status, without the gloss</Eyebrow>
        <h2 className="lp-h2" id="road-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
          The rehearsal is evidence, <em className="o">not a release.</em>
        </h2>
        <p className="lp-lead" data-lp-reveal style={{ ["--i" as string]: 2 }}>
          BELL has one successful REGULAR-session rehearsal on Robinhood Testnet ({ROBINHOOD_TESTNET_CHAIN_ID}). That evidence is a snapshot; it does not mean the pool or market-data feeds are currently live.
        </p>

        {/* the route: solid where the work is done or live, dotted where it is not. Decorative; the list below says the same in words. */}
        <div className="lp-road__map" data-lp-rail aria-hidden="true">
          <svg className="lp-road__svg lp-road__svg--todo" viewBox="0 0 1000 120" preserveAspectRatio="none" focusable="false">
            <path d={LAST_LIVE < PHASES.length - 1 ? `${route(LAST_LIVE, PHASES.length - 1)} L1000 ${NODE_Y(PHASES.length - 1)}` : ""} />
          </svg>
          <svg className="lp-road__svg lp-road__svg--done" viewBox="0 0 1000 120" preserveAspectRatio="none" focusable="false">
            <path d={`M0 ${NODE_Y(0)} L${NODE_X(0)} ${NODE_Y(0)} ${route(0, LAST_LIVE).replace(/^M[^C]*/, "")}`} />
          </svg>
          {PHASES.map((ph, i) => (
            <span className="lp-road__node" data-status={ph.status} key={ph.n} style={{ ["--x" as string]: NODE_X(i) / 10, ["--y" as string]: (NODE_Y(i) / 120) * 100 }}>
              {ph.status === "done" ? "✓" : ph.n}
            </span>
          ))}
        </div>

        <ol className="lp-road__list">
          {PHASES.map((ph, i) => (
            <li className="lp-phase" data-status={ph.status} key={ph.n} data-spot data-lp-reveal style={{ ["--i" as string]: i + 1 }}>
              <p className="lp-phase__top">
                <span className="lp-phase__n">{ph.name}</span>
                <span className="lp-chip" data-tone={ph.status}><i aria-hidden="true" />{STATUS_LABEL[ph.status]}</span>
              </p>
              <h3>{ph.name}</h3>
              <ul>{ph.items.map((t) => <li key={t}>{t}</li>)}</ul>
            </li>
          ))}
        </ol>
        <p className="lp-lead">Mainnet is untouched. PRICE_GUARDED is blocked. Production use still requires independent review, admitted data references and operational readiness.</p>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- facts */
export function FactsSection() {
  return (
    <section className="lp-sec lp-facts" aria-labelledby="facts-title">
      <div className="lp-wrap">
        <p className="lp-eyebrow lp-facts__title" id="facts-title" data-lp-reveal>
          <i aria-hidden="true" />
          What is live today
        </p>
        <dl className="lp-facts__grid" data-lp-reveal>
          <div className="lp-fact" data-spot><dt>Latest rehearsal</dt><dd>One REGULAR-session swap · testnet</dd></div>
          <div className="lp-fact" data-spot><dt>Network</dt><dd>Robinhood Testnet · {ROBINHOOD_TESTNET_CHAIN_ID}</dd></div>
          <div className="lp-fact" data-spot><dt>Mainnet</dt><dd>Not deployed</dd></div>
          <div className="lp-fact" data-spot><dt>PRICE_GUARDED</dt><dd>Blocked · no admitted reference</dd></div>
          <div className="lp-fact" data-spot><dt>Independent audit</dt><dd>Not completed</dd></div>
          <div className="lp-fact" data-spot><dt>SESSION_ONLY</dt><dd>Session controls; no independent counterasset price protection</dd></div>
        </dl>
      </div>
    </section>
  );
}
