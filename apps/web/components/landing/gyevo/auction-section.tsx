import Link from "next/link";
import { Arrow } from "./arrow";

/* Opening Bell Auction. Presentation only: every figure below is a deployed contract parameter
   (10 minute order window, 15 minute settle timeout, 25 orders per cycle, no fee). The order book in the
   drawing is an illustration with sample orders and is labelled as one. */

/* Illustrative book. Prices are USDG per AAPL, x is cumulative volume. */
const Y = (price: number) => 300 - (price - 336) * 10;
const CLEAR_PRICE = 349;
const CLEAR_X = 360;
const CLEAR_Y = Y(CLEAR_PRICE);

type Step = readonly [price: number, from: number, to: number];
const DEMAND: readonly Step[] = [[356, 60, 150], [352, 150, 250], [350, 250, 360], [344, 360, 470], [340, 470, 570]];
const SUPPLY: readonly Step[] = [[338, 60, 140], [342, 140, 240], [345, 240, 330], [349, 330, 430], [353, 430, 520], [357, 520, 600]];

/* A staircase between two x positions, clipped to [from, to]. `k` stretches the volume axis. */
const X = (x: number, k: number) => Math.round(60 + (x - 60) * k);
function stairs(steps: readonly Step[], from: number, to: number, k: number) {
  let d = "";
  let last: number | null = null;
  for (const [price, a, b] of steps) {
    const x1 = Math.max(a, from);
    const x2 = Math.min(b, to);
    if (x2 <= x1) continue;
    d += last === null ? `M${X(x1, k)} ${Y(price)}` : `V${Y(price)}`;
    d += `H${X(x2, k)}`;
    last = price;
  }
  return d;
}

const GRID = [340, 345, 350, 355] as const;

const STAGES = [
  { when: "Before the open", name: "Orders collect", text: "For 10 minutes buyers lock USDG and sellers lock the stock token in escrow. Cancel any time before the book locks." },
  { when: "At the open", name: "The book locks", text: "No new orders. Ordinary swaps and liquidity adds pause on that pool; LP withdrawals are never blocked.", bell: true },
  { when: "Anyone can settle", name: "One clearing price", text: "settle() takes no price. The contract tests every limit and keeps the price that matches the most volume." },
  { when: "Up to 15 minutes later", name: "Claim or refund", text: "Matched orders receive their fill. Everything else comes back in full. If nobody settles, anyone can open refunds." },
] as const;

const FACTS = [
  ["10 min", "order window"],
  ["25", "orders per cycle"],
  ["0", "auction fee"],
] as const;

const d = (value: number) => ({ ["--d" as string]: `${value}ms` });

/* Two drawings of the same book: a wide one for desktop boards and a compact one for phones, where the
   type has to stay readable at about half size. CSS shows exactly one of them. */
function ClearingBoard({ wide }: { wide: boolean }) {
  const k = wide ? 1.4 : 0.72;
  const right = X(690, k);
  const width = right + 18;
  const id = wide ? "wide" : "compact";
  const clearX = X(CLEAR_X, k);
  return (
    <svg className={`lp-auc__chart lp-auc__chart--${id}`} viewBox={`0 0 ${width} 340`} role="img" aria-labelledby={`auc-${id}-title auc-${id}-desc`} preserveAspectRatio="xMidYMid meet">
      <title id={`auc-${id}-title`}>Example order book clearing at one price</title>
      <desc id={`auc-${id}-desc`}>
        Buy orders step down and sell orders step up. They cross at 349 USDG per AAPL, where the most volume matches. Orders beyond the crossing are refunded.
      </desc>

      <g className="lp-auc__grid" aria-hidden="true">
        {GRID.map((price) => (
          <g key={price}>
            <path d={`M60 ${Y(price)}H${right}`} />
            <text x="0" y={Y(price) + 4}>{price}</text>
          </g>
        ))}
        <path className="lp-auc__axis" d={`M60 316H${right}`} />
        <text className="lp-auc__unit" x="0" y="22">USDG / AAPL</text>
        <text className="lp-auc__unit" x={right} y="336" textAnchor="end">volume</text>
      </g>

      {/* Matched volume: a band from the first order to the crossing. */}
      <g className="lp-auc__match" aria-hidden="true" style={d(2300)}>
        <rect x="60" y="64" width={clearX - 60} height="252" />
        <path d={`M60 64V316M${clearX} 64V316`} />
        <text x={clearX - 8} y="84" textAnchor="end">matched</text>
      </g>

      {/* Orders beyond the crossing stay on the book and are refunded. */}
      <path className="lp-auc__seg lp-auc__seg--out" pathLength="1" d={stairs(DEMAND, CLEAR_X, 700, k)} style={d(1700)} />
      <path className="lp-auc__seg lp-auc__seg--out" pathLength="1" d={stairs(SUPPLY, CLEAR_X, 700, k)} style={d(1900)} />
      <path className="lp-auc__seg lp-auc__seg--buy" pathLength="1" d={stairs(DEMAND, 0, CLEAR_X, k)} style={d(300)} />
      <path className="lp-auc__seg lp-auc__seg--sell" pathLength="1" d={stairs(SUPPLY, 0, CLEAR_X, k)} style={d(700)} />

      <g className="lp-auc__tags" aria-hidden="true" style={d(2900)}>
        <text x={X(520, k)} y={Y(340) - 12} textAnchor="middle">refunded</text>
        <text x={X(560, k)} y={Y(353) - 14} textAnchor="middle">refunded</text>
      </g>
      <g className="lp-auc__names" aria-hidden="true">
        <text x="68" y={Y(356) - 12}>buy orders</text>
        <text x="68" y={Y(338) + 24}>sell orders</text>
      </g>

      {/* The strike: one price across the book. */}
      <path className="lp-auc__price" pathLength="1" d={`M60 ${CLEAR_Y}H${right}`} style={d(1500)} />
      <g className="lp-auc__strike" style={d(2200)}>
        <circle className="lp-auc__ring" cx={clearX} cy={CLEAR_Y} r="9" />
        <circle className="lp-auc__dot" cx={clearX} cy={CLEAR_Y} r="5" />
      </g>
      <g className="lp-auc__chip" style={d(2100)}>
        <rect x={right - 92} y={CLEAR_Y - 31} width="92" height="24" rx="2" />
        <text x={right - 46} y={CLEAR_Y - 15} textAnchor="middle">349.00</text>
      </g>
    </svg>
  );
}

export function AuctionSection() {
  return (
    <section className="lp-sec lp-auc" id="auction" aria-labelledby="auction-title">
      <div className="lp-wrap lp-auc__wrap">
        <header className="lp-auc__intro">
          <div className="lp-auc__title">
            <p className="lp-eyebrow" data-lp-reveal>
              <i aria-hidden="true" />
              Opening Bell Auction
            </p>
            <h2 className="lp-h2" id="auction-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
              One price <em className="o">at the open.</em>
            </h2>
          </div>
          <div className="lp-auc__side" data-lp-reveal style={{ ["--i" as string]: 2 }}>
            <p className="lp-lead">
              After a close, orders collect in escrow. At the open the contract picks the single price that matches the most volume, and whatever does not match goes back to its owner.
            </p>
            <dl className="lp-auc__facts">
              {FACTS.map(([value, label]) => (
                <div key={label}><dt>{value}</dt><dd>{label}</dd></div>
              ))}
            </dl>
          </div>
        </header>

        <figure className="lp-auc__board" data-lp-reveal="up" style={{ ["--i" as string]: 2 }}>
          <figcaption className="lp-auc__cap">
            <span>Example book · sample orders</span>
            <span>Clears at 349.00 USDG per AAPL</span>
          </figcaption>
          <div className="lp-auc__plot">
            <ClearingBoard wide />
            <ClearingBoard wide={false} />
          </div>
          <ul className="lp-auc__legend" aria-label="How to read the drawing">
            <li data-k="buy">Buy limits</li>
            <li data-k="sell">Sell limits</li>
            <li data-k="price">Clearing price</li>
            <li data-k="match">Matched volume</li>
          </ul>
        </figure>

        <ol className="lp-auc__stages">
          {STAGES.map((s) => (
            <li key={s.name} data-bell={"bell" in s ? "true" : "false"} data-lp-reveal style={{ ["--i" as string]: 1 }}>
              <span className="lp-auc__when">{s.when}</span>
              <b>{s.name}</b>
              <small>{s.text}</small>
            </li>
          ))}
        </ol>

        <footer className="lp-auc__bottom">
          <p className="lp-auc__fine" data-lp-reveal>
            Orders sit in the auction contract while the window is open. A book with only buyers or only sellers settles with no fills and refunds everything; the pool’s AMM price does not move. Contracts are deployed and verified on Robinhood Chain, and every USDG/stock pool created through the current factory gets its own auction.
          </p>
          <div className="lp-auc__cta" data-lp-reveal style={{ ["--i" as string]: 1 }}>
            <Link className="lp-btn lp-btn--primary" href="/auction">Open the auction <Arrow /></Link>
            <Link className="lp-btn lp-btn--ghost" href="/protocol#contracts">Read the contracts</Link>
          </div>
        </footer>
      </div>
    </section>
  );
}
