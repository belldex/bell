import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { LandingNav } from "@/components/landing/gyevo/landing-nav";
import { CopyCommand } from "@/components/einstein/copy-command";
import proof from "./upstairs-proof.json";
import "./upstairs.css";

const EXPLORER = "https://robinhoodchain.blockscout.com";
const REPO = "https://github.com/belldex/bell/blob/main";

const SECTIONS = [
  { id: "top", label: "Upstairs", desc: "Block trades for stock tokens." },
  { id: "flow", label: "How a block trades", desc: "Quote, fill, check, settle." },
  { id: "bands", label: "Session bands", desc: "How far from the reference a block may price." },
  { id: "claims", label: "Claims", desc: "Nine claims, replayed from the chain." },
  { id: "limits", label: "Honest limits", desc: "What v1 does not do." },
] as const;

type Verdict = "PASS" | "PARTIAL" | "PENDING" | "FAIL";
type Print = { tx: string; block: number; ts: number; maker: string; taker: string; makerSells: boolean; stockAmount: string; price: string; referencePrice: string; session: number; feeUsdg: string; notionalUsdg: string; swapInTx: boolean };
type Proof = {
  deployment: { contract: string; deployTx: string; block: number; constructor: { minNotional: string; maxNotional: string } } | null;
  claims: { id: string; title: string; proof: string; passes: string }[];
  replay: Record<string, { verdict: Verdict; note: string }>;
  prints: Print[];
  lastBuild: string;
};
const p = proof as unknown as Proof;
const SESSION = ["unknown", "PRE", "REGULAR", "POST", "OVERNIGHT", "CLOSED"];
const BAND_OF: Record<number, number> = { 2: 50, 1: 100, 3: 100, 4: 150 };

const short = (v: string, a = 8, b = 6) => `${v.slice(0, a)}…${v.slice(-b)}`;
const usd = (raw: string, d = 2) => `${(Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: d })} USDG`;
const when = (ts: number) => `${new Date(ts * 1000).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC`;
const A = ({ path, children }: { path: string; children: React.ReactNode }) => <a href={`${EXPLORER}/${path}`} target="_blank" rel="noreferrer">{children}</a>;

/** Turns every 32-byte hash and 20-byte address in a note into a short Blockscout link. */
const linkify = (text: string) => text.split(/(0x[0-9a-fA-F]{64}|0x[0-9a-fA-F]{40})/g).map((part, i) =>
  /^0x[0-9a-fA-F]{64}$/.test(part) ? <A key={i} path={`tx/${part}`}>{short(part, 10, 8)}</A>
  : /^0x[0-9a-fA-F]{40}$/.test(part) ? <A key={i} path={`address/${part}`}>{short(part, 8, 6)}</A>
  : part);

const CLAIM_TITLES: Record<string, string> = {
  U1: "The contract is what we say", U2: "A real block settled", U3: "The price held the band", U4: "Out-of-band quotes fail", U5: "Closed-market fills fail",
  U6: "Replays fail", U7: "Small trades go to the pool", U8: "The pool was untouched", U9: "The fee reached its address",
};

/** The session corridor: how far from the reference price a block may print, across a trading day. Hours are UTC, from the calendar of Fri 27 Nov 2026. */
function BandChart() {
  const T0 = 1, T1 = 24, X0 = 70, W = 1060, CY = 170, PX = 0.8;
  const x = (h: number) => X0 + ((h - T0) / (T1 - T0)) * W;
  const segs: [string, number, number, number, string][] = [
    ["OVERNIGHT", 1, 9, 150, "#9D3039"], ["PRE", 9, 14.5, 100, "#C7444F"], ["REGULAR", 14.5, 18, 50, "#E27478"], ["POST", 18, 22, 100, "#C7444F"], ["CLOSED", 22, 24, 0, "#67272D"],
  ];
  let path = "";
  for (let h = T0; h <= T1; h += 0.1) {
    const w = Math.sin(h * 1.3) * 0.5 + Math.sin(h * 0.55 + 1) * 0.8 + Math.sin(h * 2.9) * 0.18;
    path += `${path ? "L" : "M"}${x(h).toFixed(1)},${(CY - w * 9).toFixed(1)} `;
  }
  const edge = (c: string) => (c === "#9D3039" ? "#C7444F" : c);
  const ticks: [number, string][] = [[1, "8 PM"], [9, "4 AM"], [14.5, "9:30 AM"], [18, "1 PM"], [22, "5 PM"]];
  return (
    <svg viewBox="0 0 1200 400" role="img" aria-label="Price band by session across a trading day">
      <defs>
        <pattern id="up-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="12" stroke="#E27478" strokeWidth="2" opacity=".28" /></pattern>
        <filter id="up-glow" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {segs.map(([name, a, b, bps, c]) => {
        const h = bps * PX; const mid = (x(a) + x(b)) / 2;
        return (
          <g key={name}>
            {bps > 0 ? (
              <>
                <rect x={x(a)} y={CY - h} width={x(b) - x(a)} height={2 * h} fill={c} opacity=".28" />
                <line x1={x(a)} y1={CY - h} x2={x(b)} y2={CY - h} stroke={edge(c)} strokeWidth="4" />
                <line x1={x(a)} y1={CY + h} x2={x(b)} y2={CY + h} stroke={edge(c)} strokeWidth="4" />
              </>
            ) : <rect x={x(a)} y={CY - 120} width={x(b) - x(a)} height="240" fill="url(#up-hatch)" />}
            <text x={mid} y="318" textAnchor="middle" fontSize="15" letterSpacing="2" fill="#b7b2a8">{name}</text>
            <text x={mid} y="346" textAnchor="middle" fontSize="22" fontWeight="700" fill={bps > 0 ? "#fff" : "#E27478"}>{bps > 0 ? `± ${(bps / 100).toFixed(2)}%` : "no fills"}</text>
          </g>
        );
      })}
      <path d={path} fill="none" stroke="#EEECE5" strokeWidth="3" strokeLinejoin="round" filter="url(#up-glow)" />
      <circle cx={x(16.2)} cy={CY - 17 * PX - 4} r="14" fill="#121212" stroke="#EEECE5" strokeWidth="4" /><circle cx={x(16.2)} cy={CY - 17 * PX - 4} r="5" fill="#E27478" />
      <line x1={x(16.2)} y1={CY - 17 * PX - 20} x2={x(16.2)} y2={CY - 104} stroke="#EEECE5" strokeWidth="1.5" opacity=".5" />
      <text x={x(16.2)} y={CY - 128} textAnchor="middle" fontSize="15" fontWeight="700" fill="#EEECE5">BLOCK PRINT</text>
      <text x={x(16.2)} y={CY - 110} textAnchor="middle" fontSize="13" fill="#E27478">inside the band: settles</text>
      <g stroke="#E27478" strokeWidth="5" strokeLinecap="round"><line x1={x(11.4) - 12} y1={CY - 130 * PX - 12} x2={x(11.4) + 12} y2={CY - 130 * PX + 12} /><line x1={x(11.4) + 12} y1={CY - 130 * PX - 12} x2={x(11.4) - 12} y2={CY - 130 * PX + 12} /></g>
      <text x={x(11.4)} y={CY - 130 * PX - 40} textAnchor="middle" fontSize="15" fontWeight="700" fill="#EEECE5">QUOTE</text>
      <text x={x(11.4)} y={CY - 130 * PX - 22} textAnchor="middle" fontSize="13" fill="#E27478">outside the band: reverts</text>
      <line x1={X0} y1="372" x2={X0 + W} y2="372" stroke="#444" />
      {ticks.map(([h, t]) => <text key={t} x={x(h)} y="392" textAnchor="middle" fontSize="13" fill="#8d887e">{t}</text>)}
    </svg>
  );
}

function Receipt() {
  const r = p.prints[0];
  if (!r) {
    return <div className="up-rc up-rc--empty"><h3>BLOCK PRINT</h3><p>No block has settled yet. Each one prints here from the contract&apos;s BlockPrint event.</p></div>;
  }
  const dist = Math.round((Math.abs(Number(r.price) - Number(r.referencePrice)) / Number(r.referencePrice)) * 10000);
  const band = BAND_OF[r.session];
  return (
    <div className="up-rc">
      <h3>BLOCK PRINT</h3>
      <div className="up-rc__sub">UPSTAIRS SETTLEMENT · ROBINHOOD CHAIN</div>
      <hr />
      <dl>
        <div><dt>TIME</dt><dd>{when(r.ts)}</dd></div>
        <div><dt>SESSION</dt><dd>{SESSION[r.session] ?? r.session}</dd></div>
        <div><dt>SIDE</dt><dd>{r.makerSells ? "MAKER SELLS" : "MAKER BUYS"}</dd></div>
        <div><dt>SIZE</dt><dd>{(Number(r.stockAmount) / 1e18).toFixed(4)} NVDA</dd></div>
        <div><dt>PRICE</dt><dd>{(Number(r.price) / 1e18).toFixed(4)} USDG</dd></div>
        <div><dt>CHAINLINK REF</dt><dd>{(Number(r.referencePrice) / 1e18).toFixed(4)} USDG</dd></div>
        <div><dt>DISTANCE</dt><dd>{dist} bps of ±{band ?? "?"}</dd></div>
      </dl>
      <hr />
      <dl>
        <div><dt>FEE, 5 BPS</dt><dd>{usd(r.feeUsdg, 6)}</dd></div>
        <div><dt>POOL SWAP EVENTS</dt><dd>{r.swapInTx ? "1" : "0"}</dd></div>
      </dl>
      <hr />
      <div className="up-rc__tot"><span>NOTIONAL</span><span>{usd(r.notionalUsdg, 4)}</span></div>
      <hr />
      <div className="up-rc__ids">
        MAKER <A path={`address/${r.maker}`}>{short(r.maker, 6, 4)}</A><br />
        TAKER <A path={`address/${r.taker}`}>{short(r.taker, 6, 4)}</A><br />
        TX <A path={`tx/${r.tx}`}>{short(r.tx, 12, 10)}</A> · BLOCK {r.block}
      </div>
      <div className="up-stamp">SETTLED</div>
    </div>
  );
}

export function UpstairsPage() {
  const dep = p.deployment;
  const passes = Object.values(p.replay).filter((r) => r.verdict === "PASS").length;
  const total = p.claims.length;
  const first = p.prints[0];
  return (
    <div className="lp lp--bell up" id="top">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={SECTIONS} />
      <LandingEffects />
      <main id="main">
        <section className="up-hero">
          <div className="up-wrap up-hero__grid">
            <div>
              <p className="up-tag"><b>BELL Upstairs</b><span>Block trades for stock tokens</span></p>
              <h1>The pool is the floor. <em>Upstairs is where blocks trade.</em></h1>
              <p className="up-lede">Two wallets trade a large block of a stock token directly, settled onchain in one transaction, without touching a BELL pool. LPs take no arbitrage loss, and the pool caps stay as they are.</p>
              <div className="up-actions">
                <a className="up-btn up-btn--solid" href="#claims">See the {total} claims</a>
                {dep && <a className="up-btn" href={`${EXPLORER}/address/${dep.contract}`} target="_blank" rel="noreferrer">The contract</a>}
              </div>
              <div className="up-chips">
                <span className="up-chip"><i />LIVE ON MAINNET</span>
                <span className="up-chip"><i />NO OWNER, NO PROXY</span>
                <span className="up-chip"><i />NO POOL CALLED</span>
              </div>
            </div>
            <figure className="up-art" style={{ margin: 0 }}>
              <span className="up-art__badge">UPSTAIRS · BLOCK DESK</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/upstairs-hero.jpg" alt="A cutaway building: a queue of small trades at the turnstile on the ground floor, and one large block passing between two parties upstairs." width={1280} height={800} />
              <figcaption className="up-art__cap"><span>THE FLOOR: SMALL TRADES, CAPPED</span><span>UPSTAIRS: ONE BLOCK, ONE TRANSACTION</span></figcaption>
            </figure>
          </div>
        </section>

        <section className="up-stats">
          <div className="up-wrap up-stats__grid">
            <div className="up-stat"><b>{passes}<span>/{total}</span></b><small>claims replayed from the chain</small></div>
            <div className="up-stat"><b>{first ? (Number(first.notionalUsdg) / 1e6).toFixed(2) : "0"}</b><small>USDG in the first settled block</small></div>
            <div className="up-stat"><b>5<span> bps</span></b><small>flat fee, paid by the taker</small></div>
            <div className="up-stat"><b>0</b><small>pool swaps in the block</small></div>
          </div>
        </section>

        <section className="up-sec" id="flow">
          <div className="up-wrap">
            <div className="up-sec__head"><h2>How a block trades</h2></div>
            <div className="up-flow">
              <div>
                <ol className="up-steps">
                  <li><h3>The maker signs a quote</h3><p>Offchain, naming the one wallet allowed to fill it, the token, the amount and the price. It expires within 120 seconds and works once.</p></li>
                  <li><h3>The taker fills it onchain</h3><p>Only the named taker can. The contract never holds funds: tokens move straight from maker to taker in the same transaction.</p></li>
                  <li><h3>The contract checks, in order</h3><p>The signature, the asset, the block size, the session from the same calendar the hooks use, and that the price sits inside the session band around the Chainlink reference.</p></li>
                  <li><h3>It settles, or it reverts</h3><p>Both tokens move and the 5 bps fee is paid, or a named error reverts the whole transaction and nothing moves. No BELL pool is ever called.</p></li>
                </ol>
                <p className="up-note"><b>Why it exists.</b> BELL&apos;s caps deliberately stop big swaps, to protect LPs. A treasury moving a large block had nowhere to go. On Wall Street that trade goes upstairs: negotiated, then printed to the tape.</p>
              </div>
              <Receipt />
            </div>
          </div>
        </section>

        <section className="up-sec" id="bands">
          <div className="up-wrap">
            <div className="up-sec__head"><h2>The price band follows the session</h2></div>
            <p className="up-sec__lede">A block must print inside a band around the Chainlink reference price, and the band is tighter when the market is deeper. The pool&apos;s spot price is never read.</p>
            <figure className="up-chart" style={{ margin: 0 }}>
              <BandChart />
              <figcaption>WHITE LINE: THE CHAINLINK REFERENCE · BAND: THE ALLOWED DISTANCE FROM IT · HOURS FROM THE CALENDAR, FRI 27 NOV (ET) · PRICE PATH AND MARKERS ARE ILLUSTRATIVE</figcaption>
            </figure>
            <div className="up-bands">
              <div className="up-band up-band--r"><small>REGULAR</small><b>± 0.50%</b><span>50 bps</span></div>
              <div className="up-band up-band--p"><small>PRE AND POST</small><b>± 1.00%</b><span>100 bps</span></div>
              <div className="up-band up-band--o"><small>OVERNIGHT</small><b>± 1.50%</b><span>150 bps</span></div>
              <div className="up-band up-band--c"><small>CLOSED OR HALTED</small><b>no fills</b><span>reverts with UpstairsClosed</span></div>
            </div>
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

            {p.prints.length > 1 && (
              <>
                <div className="up-sec__head" style={{ marginTop: 64 }}><h2>Block prints</h2></div>
                <div className="up-table"><table>
                  <thead><tr><th>TIME (UTC)</th><th>SESSION</th><th>SIDE</th><th>SIZE</th><th>PRICE</th><th>FEE</th><th>TX</th></tr></thead>
                  <tbody>{p.prints.map((r) => (
                    <tr key={r.tx}><td>{when(r.ts)}</td><td>{SESSION[r.session] ?? r.session}</td><td>{r.makerSells ? "maker sells" : "maker buys"}</td><td>{usd(r.notionalUsdg, 4)}</td><td>{(Number(r.price) / 1e18).toFixed(2)}</td><td>{usd(r.feeUsdg, 6)}</td><td><A path={`tx/${r.tx}`}>{short(r.tx)}</A></td></tr>
                  ))}</tbody>
                </table></div>
              </>
            )}
          </div>
        </section>

        <section className="up-sec" id="limits">
          <div className="up-wrap">
            <div className="up-sec__head"><h2>Honest limits</h2></div>
            <div className="up-limits">
              <div className="up-limit"><i>!</i><div><h3>Not independently audited</h3><p>Until one is, the contract has a fixed cap on block size, and raising it means a new deployment.{dep ? <> Cap: {usd(dep.constructor.maxNotional, 0)}, minimum {usd(dep.constructor.minNotional, 0)}.</> : null}</p></div></div>
              <div className="up-limit"><i>1</i><div><h3>One named taker</h3><p>Every quote names one taker. There are no open quotes in v1.</p></div></div>
              <div className="up-limit"><i>2</i><div><h3>Chainlink only</h3><p>The reference price is Chainlink, with no TWAP fallback. A token with no Chainlink feed, such as ANT, cannot trade here yet.</p></div></div>
              <div className="up-limit"><i>3</i><div><h3>BELL is not the counterparty</h3><p>BELL is not a market maker in v1. It holds no funds and takes no side. Robinhood stock tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited, not offered to U.S. persons or where the issuer excludes them.</p></div></div>
            </div>
          </div>
        </section>

        <section className="up-cta">
          <div className="up-wrap">
            <h2>Check it yourself.</h2>
            <p>One script rebuilds all nine verdicts from a public RPC. The contract has no owner and no proxy.</p>
            <CopyCommand command={"git clone https://github.com/belldex/bell && cd bell\nnode scripts/upstairs/build-upstairs-proof.mjs --rpc https://rpc.mainnet.chain.robinhood.com"} />
            <div className="up-actions" style={{ marginTop: 26, marginBottom: 0 }}>
              <a className="up-btn" href={`${REPO}/contracts/src/upstairs/UpstairsSettlement.sol`} target="_blank" rel="noreferrer">Source</a>
              <a className="up-btn" href={`${REPO}/contracts/test/UpstairsSettlement.t.sol`} target="_blank" rel="noreferrer">38 tests</a>
              <a className="up-btn" href={`${REPO}/evidence/upstairs/proof.json`} target="_blank" rel="noreferrer">proof.json</a>
            </div>
            <p className="up-fine">BELL is an independent protocol. This page is not an audit and not financial advice. Last replay {new Date(p.lastBuild).toISOString().slice(0, 16).replace("T", " ")} UTC.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
