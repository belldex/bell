import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { LandingNav } from "@/components/landing/gyevo/landing-nav";
import { EinsteinMotion } from "@/components/einstein/einstein-motion";
import { CopyCommand } from "@/components/einstein/copy-command";
import proof from "./upstairs-proof.json";

const EXPLORER = "https://robinhoodchain.blockscout.com";

const SECTIONS = [
  { id: "status", label: "Status", desc: "Where Upstairs stands." },
  { id: "flow", label: "How a block trades", desc: "Quote, fill, check, settle." },
  { id: "bands", label: "Session bands", desc: "How far from the reference a block may price." },
  { id: "prints", label: "Block prints", desc: "Every settled block, from events." },
  { id: "check", label: "Check it yourself", desc: "Replay every claim." },
  { id: "limits", label: "Honest limits", desc: "What v1 does not do." },
] as const;

type Verdict = "PASS" | "PARTIAL" | "PENDING" | "FAIL";
type Print = { tx: string; ts: number; maker: string; taker: string; makerSells: boolean; stockAmount: string; price: string; referencePrice: string; session: number; feeUsdg: string; notionalUsdg: string };
type Proof = {
  deployment: { contract: string; deployTx: string; block: number; constructor: { minNotional: string; maxNotional: string } } | null;
  claims: { id: string; title: string; proof: string; passes: string }[];
  replay: Record<string, { verdict: Verdict; note: string }>;
  prints: Print[];
  lastBuild: string;
};
const p = proof as unknown as Proof;
const SESSION = ["unknown", "PRE", "REGULAR", "POST", "OVERNIGHT", "CLOSED"];
const BANDS: [string, string][] = [["REGULAR", "50 bps"], ["PRE and POST", "100 bps"], ["OVERNIGHT", "150 bps"], ["CLOSED, HALTED, UNKNOWN", "no fills"]];
const usd = (raw: string) => `${(Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDG`;
const short = (v: string, a = 8, b = 6) => `${v.slice(0, a)}…${v.slice(-b)}`;
const link = (path: string, text: string) => <a href={`${EXPLORER}/${path}`} target="_blank" rel="noreferrer">{text}</a>;
/** Turns every 32-byte hash and 20-byte address in a note into a short Blockscout link. */
const linkify = (text: string) => text.split(/(0x[0-9a-fA-F]{64}|0x[0-9a-fA-F]{40})/g).map((part, i) =>
  /^0x[0-9a-fA-F]{64}$/.test(part) ? <a key={i} href={`${EXPLORER}/tx/${part}`} target="_blank" rel="noreferrer">{short(part, 10, 8)}</a>
  : /^0x[0-9a-fA-F]{40}$/.test(part) ? <a key={i} href={`${EXPLORER}/address/${part}`} target="_blank" rel="noreferrer">{short(part, 8, 6)}</a>
  : part);
const et = (ts: number) => new Date(ts * 1000).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

export function UpstairsPage() {
  const dep = p.deployment;
  const passes = Object.values(p.replay).filter((r) => r.verdict === "PASS").length;
  return (
    <div className="lp lp--bell legal ein pp" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={SECTIONS} />
      <EinsteinMotion />
      <LandingEffects />
      <main id="main" className="legal__main ein__main">
        <header className="ein-hero pp-hero">
          <div className="ein-hero__copy">
            <p className="ein-tag"><span>BELL Upstairs</span><b>Block trades for stock tokens</b></p>
            <h1>The pool is the floor. <em>Upstairs is where the blocks trade.</em></h1>
            <p className="ein-lede">Two wallets trade a large block of a stock token directly, settled onchain in one transaction, without touching a BELL pool. LPs carry no arbitrage loss from it, and the pool caps stay as they are.</p>
          </div>
        </header>

        <section id="status" className="ein-section" data-reveal>
          <h2>Status</h2>
          {dep ? (
            <dl className="pp-facts">
              <div><dt>Contract</dt><dd>{link(`address/${dep.contract}`, short(dep.contract, 10, 8))}</dd></div>
              <div><dt>Deployed</dt><dd>{link(`tx/${dep.deployTx}`, `block ${dep.block}`)}</dd></div>
              <div><dt>Block size</dt><dd>{usd(dep.constructor.minNotional)} to {usd(dep.constructor.maxNotional)}, fixed at deploy</dd></div>
              <div><dt>Claims replayed</dt><dd>{passes} of {p.claims.length} PASS</dd></div>
            </dl>
          ) : (
            <p className="ein-ledger__lede">Not deployed yet. The contract and its tests are in the repository. Nothing on this page is a result until a block settles on mainnet and the replay below passes.</p>
          )}
          <p className="ein-fine">No independent audit has been done. Until one is, the contract has a fixed cap on block size, and raising it means a new deployment.</p>
        </section>

        <section id="flow" className="ein-section" data-reveal>
          <h2>How a block trades</h2>
          <ol className="pp-links">
            <li>The maker signs a quote offchain: the one wallet allowed to fill it, the token, the amount, the price, and an expiry at most 120 seconds away.</li>
            <li>The named taker fills it onchain. Nobody else can, and a quote works once.</li>
            <li>The contract checks the signature, the asset, the block size, the session from the same calendar the hooks use, and that the price sits inside the session band around the reference price.</li>
            <li>It moves both tokens and takes the fee in the same transaction, or it reverts with a named error and nothing moves. No pool is called and BELL never holds funds.</li>
          </ol>
          <p className="ein-fine">The fee is a flat 5 bps of the block, paid by the taker in USDG. The reference price is the Chainlink feed, and only while it is fresh. The pool&apos;s spot price is never read.</p>
        </section>

        <section id="bands" className="ein-section" data-reveal>
          <h2>Session bands</h2>
          <dl className="pp-facts">
            {BANDS.map(([name, band]) => <div key={name}><dt>{name}</dt><dd>{band}</dd></div>)}
          </dl>
          <p className="ein-fine">The band is how far the price may sit from the reference price. Outside it, the fill reverts with <code>OutsideBand</code>. In a closed, halted or unknown session it reverts with <code>UpstairsClosed</code>.</p>
        </section>

        <section id="prints" className="ein-section" data-reveal>
          <h2>Block prints</h2>
          {p.prints.length ? (
            <div className="ein-table" role="table">
              <table>
                <thead><tr><th>Time (ET)</th><th>Session</th><th>Direction</th><th>Size</th><th>Price</th><th>From reference</th><th>Fee</th><th>Tx</th></tr></thead>
                <tbody>
                  {p.prints.map((r) => {
                    const dist = ((Number(r.price) - Number(r.referencePrice)) / Number(r.referencePrice)) * 1e4;
                    return (
                      <tr key={r.tx}>
                        <td>{et(r.ts)}</td><td>{SESSION[r.session] ?? r.session}</td><td>{r.makerSells ? "maker sells" : "maker buys"}</td>
                        <td>{usd(r.notionalUsdg)}</td><td>{(Number(r.price) / 1e18).toFixed(2)}</td><td>{dist.toFixed(1)} bps</td><td>{usd(r.feeUsdg)}</td><td>{link(`tx/${r.tx}`, short(r.tx))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="ein-ledger__lede">No block has settled yet. Each one will be listed here, read only from the contract&apos;s BlockPrint events.</p>}
        </section>

        <section id="check" className="ein-section" data-reveal>
          <h2>Check it yourself</h2>
          <ul className="pp-links">
            {p.claims.map((c) => (
              <li key={c.id}><b>{c.id}</b> {c.title}: <b>{p.replay[c.id]?.verdict ?? "PENDING"}</b>. {linkify(p.replay[c.id]?.note ?? "")}</li>
            ))}
          </ul>
          <CopyCommand command="node scripts/upstairs/build-upstairs-proof.mjs --rpc https://rpc.mainnet.chain.robinhood.com" />
          <p className="ein-fine">PENDING is never a PASS. Last built {new Date(p.lastBuild).toISOString().slice(0, 16).replace("T", " ")} UTC.</p>
        </section>

        <section id="limits" className="ein-section" data-reveal>
          <h2>Honest limits</h2>
          <ul className="pp-links">
            <li>Every quote names one taker. There are no open quotes in v1.</li>
            <li>The reference price is Chainlink only, with no TWAP fallback. A token with no Chainlink feed, such as ANT, cannot trade here yet.</li>
            <li>BELL is not a market maker in v1. It is not a counterparty and holds no funds.</li>
            <li>There is no independent audit, so the block size is capped.</li>
            <li>Robinhood stock tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited. They are not offered to U.S. persons or where the issuer excludes them. This page is not an audit and not financial advice.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
