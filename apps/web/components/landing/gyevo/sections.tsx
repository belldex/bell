import { Fragment } from "react";
import Link from "next/link";
import { Activity, ArrowLeftRight, ArrowRight, ArrowUpRight, BadgeCheck, BriefcaseBusiness, CalendarClock, CalendarDays, ChartNoAxesColumnIncreasing, CircleCheck, CircleX, Gauge, Percent, Plus, Radio, ShieldCheck } from "lucide-react";
import { Arrow } from "./arrow";
import { SessionFeeCurve } from "./session-fee-curve";
import { TokenLogo } from "@/components/ui/TokenLogo";

const ROBINHOOD_MAINNET_CHAIN_ID = 4663;
const MAINNET_POOL_SNAPSHOT_BLOCK = 102288657;

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
    stops: "Chainlink freshness is capped at 60 seconds in REGULAR and under 120 seconds in PRE, POST and OVERNIGHT; stale data halts swaps.",
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
            BELL is a Uniswap v4 hook for pools that include Robinhood Stock Tokens. It checks the market phase, sets the pool’s fee and flow limits, then allows a swap only while the Chainlink round passes its session gate: 60 seconds in REGULAR and under 120 seconds in PRE, POST and OVERNIGHT. Historical updates can be too sparse to keep swaps available throughout a session.
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

/* Routes to the connected product. This is not a sample dashboard or a claim of existing liquidity. */
const PRODUCT_PATHS = [
  { href: "/pools", area: "DIRECTORY", name: "Explore pools", state: "NO POOLS YET", detail: "Inspect deployed pool settings and onchain trading policy. The Mainnet directory is empty for now.", action: "Browse directory", icon: ChartNoAxesColumnIncreasing },
  { href: "/create", area: "POOL SETUP", name: "Create and seed", state: "WALLET APPROVAL", detail: "Choose admitted assets and a pool class, set your seed, then review and approve each transaction.", action: "Start a pool", icon: Plus },
  { href: "/swap", area: "QUOTE AND SWAP", name: "Prepare a swap", state: "POOL NEEDED", detail: "Build exact-input or exact-output quotes with slippage bounds. Trading starts when a pool exists.", action: "Open swap", icon: ArrowLeftRight },
  { href: "/positions", area: "LIQUIDITY", name: "Manage positions", state: "WALLET ACCESS", detail: "Find your BELL positions, add or remove liquidity, and collect fees from your wallet.", action: "View positions", icon: BriefcaseBusiness },
] as const;

function ProductFlowArt() {
  return (
    <figure className="lp-product__flow" data-lp-reveal>
      <div className="lp-product__flow-head">
        <span>HOW A BELL POOL COMES TO LIFE</span>
        <span>ROBINHOOD CHAIN MAINNET</span>
      </div>
      <svg viewBox="0 0 860 450" role="img" aria-label="Stock feeds pass through the BELL session and risk hook before reaching a tokenized-stock pool">
        <defs>
          <linearGradient id="product-rail" x1="0" x2="1">
            <stop offset="0" stopColor="#B7B4AD" stopOpacity=".18" />
            <stop offset=".5" stopColor="#EEECE5" stopOpacity=".72" />
            <stop offset="1" stopColor="#C7444F" stopOpacity=".86" />
          </linearGradient>
          <linearGradient id="product-hook" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#292725" />
            <stop offset="1" stopColor="#171717" />
          </linearGradient>
          <linearGradient id="product-pool-top" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#EEECE5" stopOpacity=".24" />
            <stop offset="1" stopColor="#C7444F" stopOpacity=".14" />
          </linearGradient>
          <pattern id="product-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M28 0H0V28" fill="none" stroke="#EEECE5" strokeOpacity=".035" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="860" height="450" fill="url(#product-grid)" />
        <path className="lp-product__rail" d="M185 143H285Q321 143 344 174L371 208H508Q552 208 575 179L611 143H681" />
        <path className="lp-product__rail" d="M185 225H340M510 225H681" />
        <path className="lp-product__rail" d="M185 307H285Q321 307 344 276L371 242H508Q552 242 575 271L611 307H681" />
        <path className="lp-product__beam" d="M185 143H285Q321 143 344 174L371 208H508Q552 208 575 179L611 143H681M185 225H340M510 225H681M185 307H285Q321 307 344 276L371 242H508Q552 242 575 271L611 307H681" />

        <g className="lp-product__feed lp-product__feed--top">
          <path d="M42 119H166L185 143L166 167H42Z" />
          <text className="lp-product__feed-name" x="62" y="142">AAPL</text>
          <text className="lp-product__feed-type" x="62" y="157">SIGNED FEED</text>
        </g>
        <g className="lp-product__feed lp-product__feed--mid">
          <path d="M42 201H166L185 225L166 249H42Z" />
          <text className="lp-product__feed-name" x="62" y="224">NVDA</text>
          <text className="lp-product__feed-type" x="62" y="239">STOCK DATA</text>
        </g>
        <g className="lp-product__feed lp-product__feed--bottom">
          <path d="M42 283H166L185 307L166 331H42Z" />
          <text className="lp-product__feed-name" x="62" y="306">TSLA</text>
          <text className="lp-product__feed-type" x="62" y="321">SIGNED FEED</text>
        </g>

        <g className="lp-product__hook">
          <path className="lp-product__hook-body" d="M370 126L402 99H480L512 126V324L480 351H402L370 324Z" />
          <path className="lp-product__hook-edge" d="M370 126L402 99H480L512 126V324L480 351H402L370 324Z" />
          <path className="lp-product__hook-scan" d="M382 162H500" />
          <text className="lp-product__hook-name" x="441" y="196" textAnchor="middle">BELL</text>
          <text className="lp-product__hook-label" x="441" y="222" textAnchor="middle">V4 HOOK</text>
          <path className="lp-product__hook-rule" d="M401 244H481" />
          <text className="lp-product__hook-check" x="441" y="269" textAnchor="middle">SESSION</text>
          <text className="lp-product__hook-check" x="441" y="290" textAnchor="middle">FEE</text>
          <text className="lp-product__hook-check" x="441" y="311" textAnchor="middle">FLOW LIMIT</text>
        </g>

        <g className="lp-product__pool">
          <path className="lp-product__pool-side" d="M681 143L743 176V275L681 307Z" />
          <path className="lp-product__pool-front" d="M611 176L681 143V307L611 275Z" />
          <path className="lp-product__pool-top" d="M611 176L681 143L743 176L674 211Z" />
          <path className="lp-product__pool-seam" d="M646 159V292M711 159V291M611 225L681 258L743 225" />
          <text className="lp-product__pool-name" x="674" y="351" textAnchor="middle">TOKENIZED POOL</text>
          <text className="lp-product__pool-type" x="674" y="371" textAnchor="middle">LIQUIDITY WITH RULES</text>
        </g>

        <text className="lp-product__rail-label" x="42" y="386">STOCK IDENTITY</text>
        <path className="lp-product__rail-mark" d="M42 399H188" />
        <text className="lp-product__rail-label" x="370" y="386">VERIFY BEFORE SWAP</text>
        <path className="lp-product__rail-mark" d="M370 399H512" />
        <text className="lp-product__rail-label" x="611" y="386">CREATE AND SEED</text>
        <path className="lp-product__rail-mark" d="M611 399H743" />
      </svg>
      <figcaption>
        <span>Fresh stock data enters the hook.</span>
        <span>Session policy sets the fee and flow limits.</span>
        <span>A pool must be created before swaps can happen.</span>
      </figcaption>
    </figure>
  );
}

export function ProductPathsSection() {
  return (
    <section className="lp-sec lp-product" id="product" aria-labelledby="product-title">
      <div className="lp-wrap">
        <Eyebrow>Use the deployed product</Eyebrow>
        <header className="lp-product__head">
          <div>
            <h2 className="lp-h2" id="product-title" data-lp-reveal>BELL is deployed. <em className="o">Start with a pool.</em></h2>
            <p className="lp-lead" data-lp-reveal style={{ ["--i" as string]: 1 }}>Create and seed a tokenized-stock pool from your wallet. BELL checks market data, fees and flow limits before swaps; the Mainnet directory is empty until the first pool is created.</p>
          </div>
          <Link className="lp-btn lp-btn--primary" href="/create">Create a pool <Arrow /></Link>
        </header>

        <div className="lp-product__body">
          <ProductFlowArt />
          <ul className="lp-product__paths">
            {PRODUCT_PATHS.map(({ href, area, name, state, detail, action, icon: Icon }, index) => (
              <li key={href} data-lp-reveal style={{ ["--i" as string]: index + 1 }}>
                <Link href={href} className="lp-product__path">
                  <span className="lp-product__path-icon"><Icon size={21} aria-hidden="true" /></span>
                  <span className="lp-product__path-copy">
                    <span className="lp-product__path-meta"><span>{area}</span><span>{state}</span></span>
                    <strong>{name}</strong>
                    <span className="lp-product__path-detail">{detail}</span>
                    <span className="lp-product__path-action">{action}<ArrowUpRight size={16} aria-hidden="true" /></span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="lp-product__assets" data-lp-reveal>
          <div><span className="lp-product__asset-label">Admitted stock assets</span><div className="lp-product__tokens">{["AAPL", "NVDA", "TSLA"].map((symbol) => <span key={symbol}><TokenLogo symbol={symbol} size={24} />{symbol}</span>)}</div></div>
          <div><span className="lp-product__asset-label">Counterassets</span><div className="lp-product__tokens">{["USDG", "WETH", "MEME"].map((symbol) => <span key={symbol}><TokenLogo symbol={symbol} size={24} />{symbol}{symbol === "MEME" && <small>SESSION_ONLY</small>}</span>)}</div></div>
          <p>MEME has no independent price reference or PRICE_GUARDED option. Pool eligibility is checked against the deployed AssetRegistry.</p>
        </div>
      </div>
    </section>
  );
}

/* Session fees and operating conditions: distinct, documented BELL sessions. */
const SESSIONS = [
  { name: "Pre-market", code: "PRE", rate: "0.30%", note: "Fresh Chainlink round required · may halt" },
  { name: "Regular", code: "REGULAR", rate: "0.05%", note: "Fresh Chainlink round required · may halt" },
  { name: "After-hours", code: "POST", rate: "0.30%", note: "Fresh Chainlink round required · may halt" },
  { name: "Overnight", code: "OVERNIGHT", rate: "0.50%", note: "Fresh Chainlink round required · may halt" },
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
const STATUS_LABEL: Record<PhaseStatus, string> = { done: "Rehearsed", live: "Live", wip: "In progress", blocked: "Blocked", future: "Pending" };

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
    n: "REHEARSAL",
    name: "Testnet rehearsal",
    status: "done",
    items: [
      "One earlier REGULAR-session pool completed a successful swap on Robinhood Testnet",
      "Historical rehearsal evidence; the current-asset pool and feed are not verified live",
      "Not a live health, uptime or asset-availability guarantee",
    ],
  },
  {
    n: "MAINNET",
    name: "Mainnet contracts",
    status: "live",
    items: [
      "Protocol contracts, Chainlink adapters and AAPL, NVDA, TSLA, USDG, WETH and MEME are live on Robinhood Chain 4663",
      "PRE, REGULAR, POST and OVERNIGHT use phase-specific feed scopes; stale rounds fail closed",
      "The new factory has no pool yet; create and seed are wallet-confirmed transactions",
    ],
  },
  {
    n: "ONCHAIN FEEDS",
    name: "Four-session Chainlink adapter scopes",
    status: "live",
    items: [
      "Session adapter scopes use onchain Chainlink AggregatorV3 stock feeds for PRE, REGULAR, POST and OVERNIGHT",
      "Every active-session swap checks its feed onchain; the effective age limit is 60 seconds in REGULAR and under 120 seconds in PRE, POST and OVERNIGHT",
      "Feeds may pause or go stale off-hours; an independent security audit is not complete",
    ],
  },
  {
    n: "LIQUIDITY",
    name: "First live pool",
    status: "future",
    items: [
      "No Mainnet pool, seeded position, or completed Mainnet swap exists yet",
      "The wallet-connected create flow is ready; it has not been used to seed a pool yet",
      "Session-only pools carry no independent counterasset price protection",
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
          Contracts are deployed. <em className="o">Liquidity is not.</em>
        </h2>
        <p className="lp-lead" data-lp-reveal style={{ ["--i" as string]: 2 }}>
          The protocol, Chainlink adapters, admitted assets and 60-day calendars are deployed on Robinhood Chain ({ROBINHOOD_MAINNET_CHAIN_ID}). Adapter scopes cover PRE, REGULAR, POST and OVERNIGHT, but historical rounds rarely remain within the effective gate (60 seconds in REGULAR and under 120 seconds in the other sessions); continuous 24/5 swap availability is not established. The factory has no pool, seeded liquidity or completed Mainnet swap.
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
      <p className="lp-road__summary"><span>Current state</span>Mainnet contracts, four session adapter scopes, asset descriptors and calendar roots are deployed. Freshness can be intermittent; no pool has been created or funded, and an independent security review is not complete.</p>
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
            <h2 className="lp-facts__headline" id="facts-title">Mainnet snapshot</h2>
          </div>
          <div className="lp-facts__stamp">
            <span className="lp-facts__stamp-label">Directory checked</span>
            <time dateTime="2026-10-31T04:38:00Z"><span>31 Oct 2026</span><strong>04:38 UTC</strong></time>
            <span className="lp-facts__stamp-note">Worker response · block {MAINNET_POOL_SNAPSHOT_BLOCK}</span>
          </div>
        </header>
        <dl className="lp-facts__grid" data-lp-reveal>
          <div className="lp-fact" data-spot><dt>Network</dt><dd>Robinhood Chain Mainnet · {ROBINHOOD_MAINNET_CHAIN_ID}</dd></div>
          <div className="lp-fact" data-spot><dt>Contracts</dt><dd>Deployed · Mainnet verification evidence published</dd></div>
          <div className="lp-fact" data-spot><dt>Price source</dt><dd>Robinhood Chainlink AggregatorV3 · read onchain during swaps</dd></div>
          <div className="lp-fact" data-spot><dt>Pool directory</dt><dd>Empty at block {MAINNET_POOL_SNAPSHOT_BLOCK} · no pool or liquidity</dd></div>
          <div className="lp-fact" data-spot><dt>Stock assets</dt><dd>AAPL · NVDA · TSLA admitted</dd></div>
          <div className="lp-fact" data-spot><dt>Counterassets</dt><dd>USDG · WETH · MEME</dd></div>
          <div className="lp-fact" data-spot><dt>MEME policy</dt><dd>SESSION_ONLY · no independent price protection</dd></div>
          <div className="lp-fact" data-spot><dt>Feed freshness</dt><dd>REGULAR ≤60s · PRE/POST/OVERNIGHT &lt;120s · stale feed blocks swaps</dd></div>
          <div className="lp-fact" data-spot><dt>Session readiness</dt><dd>PRE · REGULAR · POST · OVERNIGHT configured · fresh rounds can be intermittent</dd></div>
          <div className="lp-fact" data-spot><dt>Closed-session anchor</dt><dd>Not captured for the active registry · closed swaps blocked</dd></div>
          <div className="lp-fact" data-spot><dt>Independent audit</dt><dd>Not complete</dd></div>
          <div className="lp-fact" data-spot><dt>Pool classes</dt><dd>PRICE_GUARDED where both live references pass · SESSION_ONLY for one-stock pairs</dd></div>
        </dl>
      </div>
    </section>
  );
}
