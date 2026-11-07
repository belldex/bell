import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { LANDING_SECTIONS, LandingNav } from "@/components/landing/gyevo/landing-nav";
import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import data from "@/content/elysium-testnet.json";

/* /elysium. Everything on this page is read from content/elysium-testnet.json, which scripts/deploy/elysium-site-data.mjs
   builds from the repository's Elysium evidence. A check appears only with its transaction, and source verification is
   stated as the explorer reports it: a partial match, not a full one. */

const REPO = "https://github.com/belldex/bell/blob/main";
const tx = (hash: string) => `${data.explorer}/tx/${hash}`;
const addr = (a: string) => `${data.explorer}/address/${a}`;
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const units = (raw: string | undefined, decimals: number) => {
  if (!raw) return "0";
  const n = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
};

const NAV_TOC = [
  ["deployed", "What is deployed"],
  ["pools", "The pools"],
  ["checks", "What was checked"],
  ["auction", "The opening auction"],
  ["source", "Source on the explorer"],
  ["open", "What is not done"],
] as const;

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}><span>{String(n).padStart(2, "0")}</span>{title}</h2>
      {children}
    </section>
  );
}

export function ElysiumPage() {
  const groups = [...new Set(data.contracts.map((c) => c.group))];
  const checkGroups = [...new Set(data.checks.map((c) => c.group))];
  const a = data.auction;

  return (
    <div className="lp lp--bell legal proof elysium" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={LANDING_SECTIONS} base="/" />
      <main id="main" className="legal__main">
        <header className="legal__head lp-wrap">
          <p className="lp-eyebrow">Elysium testnet</p>
          <h1 className="legal__title proof__title">The same bell, on Elysium. <em>Rehearsed.</em></h1>
          <p className="legal__lead">
            The BELL contracts, unchanged, deployed to Elysium testnet with test tokens that have no value. Every transaction below is on the chain, and every row opens on the explorer.
          </p>
          <p className="legal__date">Chain {data.chainId} / test tokens only / not a mainnet deployment</p>
        </header>

        <div className="el-stats lp-wrap" role="list" aria-label="At a glance">
          <div className="el-stat" role="listitem"><strong>{data.stats.contracts}</strong><span>contracts on chain</span></div>
          <div className="el-stat" role="listitem"><strong>{data.stats.pools}</strong><span>pools, all live</span></div>
          <div className="el-stat" role="listitem"><strong>{data.stats.checks}</strong><span>checks with a transaction</span></div>
          <div className="el-stat" role="listitem"><strong>{data.stats.auctions}</strong><span>auction cycle settled</span></div>
        </div>

        <div className="legal__grid lp-wrap">
          <nav className="legal__toc" aria-label="On this page">
            <p>On this page</p>
            <ol>
              {NAV_TOC.map(([id, label], i) => (
                <li key={id}><a href={`#${id}`}><span>{String(i + 1).padStart(2, "0")}</span>{label}</a></li>
              ))}
            </ol>
          </nav>

          <div className="legal__body">
            <Section id="deployed" n={1} title="What is deployed">
              <p>
                The contracts are the ones running on Robinhood Chain, with no change to any of them. The only additions are test tokens named <code>(BELL test)</code>, which cannot pass for a real asset, rehearsal price adapters for those tokens, and a helper that swaps straight on the PoolManager. Hooks and auctions are created by the factory inside each pool-creation transaction. Uniswap v4 had no published address on Elysium testnet, so BELL deployed its own PoolManager and PositionManager.
              </p>
              {groups.map((g) => (
                <div key={g} className="pf-scroll">
                  <table className="legal__table pf-table">
                    <thead><tr><th>{g}</th><th>Address</th><th>Source</th></tr></thead>
                    <tbody>
                      {data.contracts.filter((c) => c.group === g).map((c) => (
                        <tr key={c.address}>
                          <td>{c.name}</td>
                          <td><a href={addr(c.address)} target="_blank" rel="noopener noreferrer"><code>{short(c.address)}</code></a></td>
                          <td>{c.source === "partial" ? <span className="pf-badge" data-pass="0">PARTIAL MATCH</span> : c.source ? <span className="pf-badge" data-pass="1">VERIFIED</span> : <span className="pf-dim">not published</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </Section>

            <Section id="pools" n={2} title="The pools">
              <p>Every hook address ends in <code>cc0</code> and carries the BELL mask, which has no permission to act when you withdraw. A pool gets an Opening Bell Auction only when one of its tokens is the factory&apos;s quote token, tUSDG.</p>
              <div className="el-pools">
                {data.pools.map((p) => (
                  <article key={p.hook} className="el-pool">
                    <p className="el-pool__pair">{p.pair}</p>
                    <p className="el-pool__kind">{p.kind}</p>
                    <dl>
                      <div><dt>Hook</dt><dd><a href={addr(p.hook)} target="_blank" rel="noopener noreferrer"><code>{short(p.hook)}</code></a></dd></div>
                      {p.auction && <div><dt>Auction</dt><dd><a href={addr(p.auction)} target="_blank" rel="noopener noreferrer"><code>{short(p.auction)}</code></a></dd></div>}
                      <div><dt>Calendar</dt><dd>{p.calendar}</dd></div>
                      <div><dt>Mask 0x2cc0</dt><dd>{p.maskOk ? "checked from the address" : "not checked"}</dd></div>
                    </dl>
                    <a className="pf-btn" href={tx(p.createTx)} target="_blank" rel="noopener noreferrer">Creation transaction <ArrowUpRight size={14} aria-hidden="true" /></a>
                  </article>
                ))}
              </div>
            </Section>

            <Section id="checks" n={3} title="What was checked">
              <p>Each row is a real transaction. A swap that is meant to be refused appears as a transaction that reverted, so the refusal itself is on chain.</p>
              {checkGroups.map((g) => (
                <div key={g} className="el-checks">
                  <p className="el-checks__group">{g}</p>
                  {data.checks.filter((c) => c.group === g).map((c) => (
                    <article key={c.tx} className="pf-receipt el-check">
                      <div className="pf-receipt__top">
                        <span className="pf-badge" data-done={c.result === "PASS" ? "1" : "0"}>{c.result === "PASS" ? "PASS" : "REFUSED"}</span>
                        <h3 className="pf-receipt__title">{c.title}</h3>
                      </div>
                      <p>{c.what}</p>
                      <p className="pf-receipt__hash">{c.tx}</p>
                      <a className="pf-btn" href={tx(c.tx)} target="_blank" rel="noopener noreferrer">Open on the explorer <ArrowUpRight size={14} aria-hidden="true" /></a>
                    </article>
                  ))}
                </div>
              ))}
              <div className="legal__note"><p>The compressed rehearsal uses a separate test asset with a ninety-minute calendar, so the open, the sessions and the close could all be exercised in one afternoon. It is a rehearsal table, not a market calendar, and it does not replace the US-Eastern calendar committed for tAAPL.</p></div>
            </Section>

            <Section id="auction" n={4} title="The opening auction">
              {a ? (
                <>
                  <p>Before the open, orders collect and ordinary swaps are blocked. At the bell the book locks and every order clears at one price.</p>
                  <div className="el-auction">
                    <div><span>Clearing price</span><strong>{a.clearingPrice} tUSDG</strong><small>per tNVDA, one price for everyone</small></div>
                    <div><span>Matched</span><strong>{units(a.matchedBase, 18)} tNVDA</strong><small>stage {a.stage}</small></div>
                    <div><span>Seller received</span><strong>{units(a.sellerReceived, 6)} tUSDG</strong><small>for 5 tNVDA, limit 99</small></div>
                    <div><span>Buyer refund</span><strong>{units(a.buyerRefund, 6)} tUSDG</strong><small>of 600 offered, limit 101</small></div>
                  </div>
                  <p>
                    <a className="pf-btn pf-btn--solid" href={tx(a.settleTx)} target="_blank" rel="noopener noreferrer">Settlement transaction <ArrowUpRight size={14} aria-hidden="true" /></a>
                  </p>
                </>
              ) : (
                <p>No auction cycle has settled yet.</p>
              )}
              <p>One thing the rehearsal showed: after a closed market the hook stays in recovery until a keeper checkpoints it twice, at least sixty seconds apart. Settlement needs the policy to allow swaps, so the first attempt failed until that had run. A real deployment needs that keeper.</p>
            </Section>

            <Section id="source" n={5} title="Source on the explorer">
              <p>
                The source, ABI and constructor arguments of {data.verification.partial + data.verification.full} contracts are published on the Elysium explorer. The explorer reports <strong>a partial match for every one</strong>: the deployed bytecode equals the compiled bytecode except for the metadata hash. None is a full match, so this page does not call them verified without that qualifier.
              </p>
              <p className="pf-source">{data.verification.full} full match / {data.verification.partial} partial match</p>
            </Section>

            <Section id="open" n={6} title="What is not done">
              <ul>
                <li>This is a testnet. Elysium mainnet is not deployed, and the test tokens have no value.</li>
                <li>Swaps in the rehearsal go straight to the PoolManager. The router needs a freshly signed price quote in every swap, and none can exist while the market is closed.</li>
                <li>No keeper runs on Elysium yet. The open, the close and the auction need one.</li>
                <li>Source verification is a partial match, not a full one.</li>
                <li>An independent security audit is not complete. Treat every BELL contract as unaudited. See the <Link href="/terms/">terms</Link>.</li>
              </ul>
              <p>The full write-up, with every address, is in <a href={`${REPO}/docs/elysium-testnet.md`} target="_blank" rel="noopener noreferrer">docs/elysium-testnet.md</a>.</p>
            </Section>
          </div>
        </div>
      </main>

      <footer className="legal__foot">
        <div className="lp-wrap">
          <p>BELL is an independent protocol, not affiliated with, endorsed by, or officially connected with Kinetiq, Hyperliquid, Uniswap Labs or Robinhood Markets, Inc. Nothing on this page is investment advice.</p>
          <nav aria-label="Related">
            <Link href="/terms/">Terms</Link>
            <Link href="/privacy/">Privacy</Link>
            <Link href="/proof/">Proof</Link>
            <Link href="/v4/">v4</Link>
            <Link href="/">Home</Link>
          </nav>
        </div>
      </footer>
      <LandingEffects />
    </div>
  );
}
