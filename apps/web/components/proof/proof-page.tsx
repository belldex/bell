import Link from "next/link";
import { ArrowUpRight, Check, X } from "lucide-react";
import { LANDING_SECTIONS, LandingNav } from "@/components/landing/gyevo/landing-nav";
import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { EXPECTED_BELL_FLAGS, PERMISSION_BITS } from "@/lib/hook-flags";
import { explorerTx } from "@/config/mainnet";
import proof from "@/content/exit-proof.json";
import lp from "@/content/lp-proof.json";
import { AddressCheck, ExitTable } from "./exit-check";
import { ProofHero } from "./proof-hero";
import "./proof-hero.css";

/* /proof. The claim is one sentence: no BELL policy can hold back a withdraw. Every row on this page is something a
   reader can recompute or open, and a withdraw is listed only with its transaction. */

const REPO = "https://github.com/belldex/bell/blob/main";

const TESTS: { file: string; name: string; what: string }[] = [
  { file: "contracts/test/unit/hook/BellHook.t.sol", name: "testHookPermissionsAreExactAndReturnDeltaFlagsAreFalse", what: "The hook reports exactly mask 0x2cc0, no remove-liquidity flag, and its address carries those bits." },
  { file: "contracts/test/integration/public-lp/PublicPositionManager.t.sol", name: "testPublicInKindExitWhilePoolAndAssetPaused", what: "Pool and asset both paused through the safety controller: the owner still exits." },
  { file: "contracts/test/integration/public-lp/PublicPositionManager.t.sol", name: "testPublicInKindExitWithStaleHealthAndCalendar", what: "Health and calendar data gone stale: the owner still exits." },
  { file: "contracts/test/integration/public-lp/PublicPositionManager.t.sol", name: "testPublicInKindExitWithAllBellDependenciesUnavailable", what: "Every BELL dependency reverts on read: the owner still exits." },
  { file: "contracts/test/integration/public-lp/PublicPositionManager.t.sol", name: "testPublicInKindExitClosedLatchedAndExhaustedBudgets", what: "Market closed, closure latched and every flow budget spent: the owner still exits." },
  { file: "contracts/test/invariant/exit/ExitLivenessFuzz.t.sol", name: "testFuzzOwnerCanAlwaysExitAfterAnySequenceOfBellEvents", what: "The fuzzer combines pauses, dead dependencies, stale time, a latched closure and spent budgets in any order. After every step the owner removes all liquidity in kind and BELL's state is unchanged." },
  { file: "contracts/test/invariant/exit/ExitLivenessFuzz.t.sol", name: "testOwnerExitsAfterEveryEventAtOnce", what: "Every kind of event stacked on one pool, in a fixed order, so a regression names itself without a seed." },
];

const NAV_TOC = [
  ["address", "The check, from the address"],
  ["pools", "Every pool, checked"],
  ["any", "Check any address"],
  ["receipts", "A withdraw on the record"],
  ["tests", "Tests that guard it"],
  ["run", "Run it yourself"],
  ["limits", "What “always” means"],
  ["lp", "LP proof: the weekend replay"],
] as const;

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}><span>{String(n).padStart(2, "0")}</span>{title}</h2>
      {children}
    </section>
  );
}

export function ProofPage() {
  return (
    <div className="lp lp--bell legal proof" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={LANDING_SECTIONS} base="/" />
      <main id="main" className="legal__main">
        <header className="legal__head lp-wrap">
          <p className="lp-eyebrow">Exit liveness proof</p>
          <h1 className="legal__title proof__title">When can you withdraw from a BELL pool? <em>Always.</em></h1>
          <p className="legal__lead">
            No BELL policy can hold back a withdraw. You do not have to take our word for it: this page shows how to check it from a hook&apos;s address, runs that check on every pool, and links a real withdraw we made on mainnet.
          </p>
          <p className="legal__date">Chain {proof.chainId} / hook mask {proof.mask}</p>
        </header>
        <ProofHero />

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
            <Section id="address" n={1} title="The check, from the address">
              <p>
                In Uniswap v4 a hook&apos;s permissions are not stored anywhere you have to trust. They are the <strong>low 14 bits of the hook&apos;s own address</strong>. The PoolManager calls a hook callback only when its bit is set, so a hook whose remove-liquidity bits are clear is never called while liquidity is removed. That can be read from the address alone, without reading any source code.
              </p>
              <p>
                BELL hook addresses end in <code>cc0</code>. The digit before it varies, because the two highest of those sixteen bits are not permissions. The fourteen that are read <code>0x2cc0</code>, which sets five permissions and clears the three that touch removal.
              </p>
              <div className="pf-scroll">
                <table className="legal__table pf-table">
                  <thead><tr><th>Bit</th><th>Permission</th><th>In 0x2cc0</th></tr></thead>
                  <tbody>
                    {PERMISSION_BITS.map((p) => {
                      const on = ((EXPECTED_BELL_FLAGS >> p.bit) & 1) === 1;
                      return (
                        <tr key={p.bit} data-exit={p.exit ? "1" : "0"}>
                          <td>{p.bit}</td>
                          <td>{p.name}{p.exit && <em className="pf-tag">exit</em>}</td>
                          <td>{on ? <span className="pf-yes"><Check size={14} aria-hidden="true" /> set</span> : <span className="pf-no"><X size={14} aria-hidden="true" /> clear</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="legal__note"><p>The three rows marked exit are bits 9, 8 and 0. A hook with any of them set could act when you withdraw. None of BELL&apos;s does.</p></div>
            </Section>

            <Section id="pools" n={2} title="Every pool, checked">
              <p>The list below comes from the BELL keeper&apos;s <code>/pools</code>, and the arithmetic runs in your browser. If the keeper cannot be reached, it shows the list committed to the repository instead and says so.</p>
              <ExitTable initial={proof.hooks.map((h) => ({ pair: h.pair, poolId: h.poolId, hook: h.hook }))} generatedAt={proof.generatedAt} />
              <p>The deployed bytecode also reports its own permissions through <code>getHookPermissions()</code>. Running the script with <code>--rpc</code> confirms that each hook has code and that what it reports matches what its address says.</p>
            </Section>

            <Section id="any" n={3} title="Check any address">
              <p>Do not trust the table either. Paste a hook address and see its fourteen bits.</p>
              <AddressCheck />
            </Section>

            <Section id="receipts" n={4} title="A withdraw on the record">
              <p>One real withdraw from a BELL pool on Robinhood Chain mainnet, through the Uniswap v4 PositionManager. Open the transaction and check it yourself.</p>
              {proof.receipts.map((r) => (
                <article key={r.scenario} className="pf-receipt">
                  <div className="pf-receipt__top">
                    <span className="pf-badge" data-done={r.status === "DONE" ? "1" : "0"}>{r.status}</span>
                    <h3 className="pf-receipt__title">{r.scenario} withdraw</h3>
                  </div>
                  <p>{r.proves}.{r.note ? ` ${r.note}` : ""}</p>
                  {r.tx && (
                    <>
                      <p className="pf-receipt__hash">{r.tx}</p>
                      <p className="pf-receipt__meta">{r.session} / {r.when?.replace("T", " ").replace("Z", " UTC")}</p>
                      <a className="pf-btn pf-btn--solid" href={explorerTx(r.tx)} target="_blank" rel="noopener noreferrer">Open on Blockscout <ArrowUpRight size={15} aria-hidden="true" /></a>
                    </>
                  )}
                </article>
              ))}
            </Section>

            <Section id="tests" n={5} title="Tests that guard it">
              <p>The contract tests below run in the Foundry suite. The committed hook list is checked on every push, and the live pool list every six hours. Either check fails the build if any hook has an exit bit set.</p>
              <ul className="pf-tests">
                {TESTS.map((t) => (
                  <li key={t.name}>
                    <a href={`${REPO}/${t.file}`} target="_blank" rel="noopener noreferrer"><code>{t.name}</code></a>
                    <span>{t.what}</span>
                  </li>
                ))}
              </ul>
              <p>The randomised test draws up to 24 events per run and 1,500 runs per pass. It checks the exit after each event on a snapshot it then rolls back. It does not cover swaps, which BELL is allowed to stop, or the Uniswap contracts themselves.</p>
            </Section>

            <Section id="run" n={6} title="Run it yourself">
              <p>Node 24 runs the script directly, with no install for the basic check.</p>
              <pre className="pf-code" tabIndex={0}>{`git clone https://github.com/belldex/bell
cd bell

# every pool the keeper lists
node scripts/verify-exit-liveness.ts

# one or more addresses you choose
node scripts/verify-exit-liveness.ts --hook 0x6657dc160e05c0ff6afe2122ca7d8244390decc0

# also check code exists and getHookPermissions() agrees (needs an RPC URL and viem)
node scripts/verify-exit-liveness.ts --rpc https://your-robinhood-chain-rpc`}</pre>
              <p>
                It prints one row per hook with PASS or FAIL and exits with 1 if any hook can touch a withdraw. The source is <a href={`${REPO}/scripts/verify-exit-liveness.ts`} target="_blank" rel="noopener noreferrer">scripts/verify-exit-liveness.ts</a> and the arithmetic is a few lines in <a href={`${REPO}/apps/web/lib/hook-flags.ts`} target="_blank" rel="noopener noreferrer">hook-flags.ts</a>.
              </p>
            </Section>

            <Section id="limits" n={7} title="What “always” means">
              <p>It means <strong>no BELL policy can hold a withdraw back</strong>: no pause, no closed market, no stale feed, no spent budget and no admin action in the BELL contracts stops the owner of a position from removing liquidity.</p>
              <p>It does not mean more than that:</p>
              <ul>
                <li>Withdrawing goes through the Uniswap v4 PositionManager and PoolManager and needs Robinhood Chain to be running. If either is unavailable, so is every withdraw.</li>
                <li>The tokens in a pool are issued by others, and BELL does not control their transfer rules.</li>
                <li>You get back the tokens the pool holds for you. That is not a promise about their price, and a position can be worth less than you put in.</li>
                <li>Swaps are a different matter. BELL can and does stop swaps in some sessions and states. Only exits are guaranteed.</li>
                <li>An independent security audit is not complete. Treat every BELL contract as unaudited. See the <Link href="/terms/">terms</Link>.</li>
              </ul>
            </Section>

            <Section id="lp" n={8} title="LP proof: the weekend replay">
              <p>
                Exit liveness is about getting your tokens out. This section is about what an LP keeps while the market is closed. We replayed {lp.weekends} real weekends of TSLA, NVDA and AAPL, {lp.firstFriday} to {lp.lastFriday}, against two pools that start with the same liquidity, the same range and the same price: a standard Uniswap v4 pool with a fixed 0.30% fee, and a BELL pool with the Opening Bell Auction.
              </p>
              <div className="legal__note"><p>This replay is a simulation, not a live weekend result. A live side-by-side test of a standard pool and a BELL pool over a real weekend has not been run. What has run on Robinhood Chain mainnet is listed under the replay.</p></div>
              <div className="pf-scroll">
                <table className="legal__table pf-table">
                  <thead><tr><th>Over {lp.rows} stock-weekends</th><th>Standard pool</th><th>BELL pool</th></tr></thead>
                  <tbody>
                    <tr><td>Average LP result against holding</td><td>{lp.meanLpNetBpStandard} bp</td><td>{lp.meanLpNetBpBell} bp</td></tr>
                    <tr><td>Largest loss in one stock-weekend</td><td>{lp.largestLossBpStandard} bp</td><td>{lp.largestLossBpBell} bp</td></tr>
                    <tr><td>Gap of 1% or more ({lp.bigGap.rows} rows), average</td><td>{lp.bigGap.meanBpStandard} bp</td><td>{lp.bigGap.meanBpBell} bp</td></tr>
                    <tr><td>Gap under 1% ({lp.smallGap.rows} rows), average</td><td>{lp.smallGap.meanBpStandard} bp</td><td>{lp.smallGap.meanBpBell} bp</td></tr>
                  </tbody>
                </table>
              </div>
              <p>
                One basis point (bp) is 0.01% of the starting liquidity, which was {lp.capitalUsd.toLocaleString("en-US")} USD in each pool. BELL did better in {lp.better} of {lp.rows} rows, the standard pool did better in {lp.worse}, and {lp.tie} were a tie. The ties are the weekends with a gap under about 1%: there both pools end at the same price with the same fees. The difference appears when the gap is large, which is when the closed-session fee and the flow caps act.
              </p>
              <figure className="pf-figure">
                <img src="/proof/chart-lp-net-by-weekend.png" width={1600} height={900} loading="lazy" alt="Bar chart of LP result against holding for each of the 20 weekends, standard pool in grey and BELL pool in white." style={{ width: "100%", height: "auto" }} />
                <figcaption>LP result after the weekend, standard pool against BELL, average of three stocks per weekend.</figcaption>
              </figure>
              <figure className="pf-figure">
                <img src="/proof/chart-gap-vs-difference.png" width={1600} height={900} loading="lazy" alt="Scatter chart of weekend gap against the BELL LP result minus the standard pool LP result, one point per stock and weekend." style={{ width: "100%", height: "auto" }} />
                <figcaption>Each point is one stock over one weekend. Up means the BELL LP kept more.</figcaption>
              </figure>
              <p>What the simulation assumes, and where it stops:</p>
              <ul>
                <li>The arbitrage agent is rational, informed and fast. Real arbitrage is slower and less certain.</li>
                <li>Auction participation is simulated: the arbitrage agent plus eight pseudo-random orders per weekend. Real volume may be smaller. The auction matches orders peer to peer and does not move the pool price, so the LP difference above comes from the closed-session fee, the flow caps and the bell fee, not from the auction clearing.</li>
                <li>The contracts are the repository&apos;s own bytecode run in a Foundry test. It is not a fork of mainnet: tokens, calendar and session data are test doubles.</li>
                <li>Prices are hourly bars from Yahoo Finance. The overnight session from 20:00 to 04:00 ET is not in that source.</li>
                <li>Results depend on the size of the gap, and the sample is {lp.weekends} weekends of three stocks.</li>
              </ul>
              <p>What has run on Robinhood Chain mainnet so far, each one a transaction you can open:</p>
              <ul>
                <li>An LP seeded a USDG/AAPL pool, swapped in it and withdrew all of it within seven minutes on 2 November, during the regular session, before the Opening Bell Auction existed: <a href="https://robinhoodchain.blockscout.com/tx/0x832da6d3ac7b6d79e00a79109232a843509d0dec75c255278492f03c2217f97b" target="_blank" rel="noopener noreferrer">seed</a>, <a href="https://robinhoodchain.blockscout.com/tx/0x06c73162f5dd214b30e622201124fa811843a664e5d5f8593e295de6ffc2647c" target="_blank" rel="noopener noreferrer">swap</a>, <a href="https://robinhoodchain.blockscout.com/tx/0x427c4f646a7fa74ef1d51090087ac37fbfe2ce58123407433aa753767a59a9da" target="_blank" rel="noopener noreferrer">withdraw</a>.</li>
                <li>An LP withdrew all of the liquidity from a TSLA/USDG pool on 6 November, in the pre-market session: <a href="https://robinhoodchain.blockscout.com/tx/0x3a6144b81e988cdda55994fb6eafdc55067fb26c1694c50765fcf271d5628bfc" target="_blank" rel="noopener noreferrer">withdraw</a>.</li>
                <li>A swap above the trade cap on the TSLA/USDG pool reverted with <code>TradeCapExceeded</code>: <a href="https://robinhoodchain.blockscout.com/tx/0x6eadcd4f35343ee43f13c52c4552770e50d08a6d363f8dd78e4088bc722448a4" target="_blank" rel="noopener noreferrer">transaction</a>.</li>
              </ul>
              <p>
                The one real weekend on record is 7 and 8 November. Three funded BELL pools held liquidity through it, and none of them took a swap, so no LP in them paid anything for the weekend. Prices below were read on 9 November at 02:57 UTC; the Friday close is the last post-market bar on 6 November.
              </p>
              <div className="pf-scroll">
                <table className="legal__table pf-table">
                  <thead><tr><th>Pool</th><th>Pool price</th><th>Friday close</th><th>Difference</th><th>Swaps since creation</th></tr></thead>
                  <tbody>
                    <tr><td>AAPL/USDG</td><td>325.21</td><td>342.65</td><td>-5.1%</td><td>0</td></tr>
                    <tr><td>NVDA/USDG</td><td>207.05</td><td>188.70</td><td>+9.7%</td><td>0</td></tr>
                    <tr><td>TSLA/USDG</td><td>350.34</td><td>359.40</td><td>-2.5%</td><td>0</td></tr>
                  </tbody>
                </table>
              </div>
              <p>
                Read this carefully. The differences come from the price each pool was seeded at, not from the weekend, and nobody has traded to correct them. So these pools show that a BELL pool takes no flow while it sits unpriced, and they do not show that a BELL LP loses less than an LP in a standard pool: there is no standard pool beside them and there was no arbitrage to lose to. What has not run: a live weekend measured side by side with a standard pool, a mainnet withdraw while the market was closed, and an Opening Bell Auction on mainnet with orders in it (the cycle on 9 November closed with none). The amounts are small, so they show that the rules work, not what an LP keeps.
              </p>
              <p>
                The script, the prices, the result of every row and the charts are in the public repository:<a href={`${REPO}/research/replay/README.md`} target="_blank" rel="noopener noreferrer">research/replay</a>. To rerun it, run <code>forge test --match-contract WeekendReplay -vv</code> from the <code>contracts</code> folder.
              </p>
            </Section>
          </div>
        </div>
      </main>

      <footer className="legal__foot">
        <div className="lp-wrap">
          <p>BELL is an independent protocol, not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc. Nothing on this page is investment advice.</p>
          <nav aria-label="Related">
            <Link href="/terms/">Terms</Link>
            <Link href="/privacy/">Privacy</Link>
            <Link href="/protocol/">Protocol</Link>
            <Link href="/v4/">v4</Link>
            <Link href="/">Home</Link>
          </nav>
        </div>
      </footer>
      <LandingEffects />
    </div>
  );
}
