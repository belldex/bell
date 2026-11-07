import Link from "next/link";
import { ArrowUpRight, Check, X } from "lucide-react";
import { LANDING_SECTIONS, LandingNav } from "@/components/landing/gyevo/landing-nav";
import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { EXPECTED_BELL_FLAGS, PERMISSION_BITS } from "@/lib/hook-flags";
import { explorerTx } from "@/config/mainnet";
import proof from "@/content/exit-proof.json";
import { AddressCheck, ExitTable } from "./exit-check";

/* /proof. The claim is one sentence: no BELL policy can hold back a withdraw. Every row on this page is something a
   reader can recompute or open, and a scenario without a transaction says PENDING. */

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
  ["receipts", "Withdraws on the record"],
  ["tests", "Tests that guard it"],
  ["run", "Run it yourself"],
  ["limits", "What “always” means"],
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
  const done = proof.receipts.filter((r) => r.status === "DONE").length;
  return (
    <div className="lp lp--bell legal proof" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={LANDING_SECTIONS} base="/" />
      <main id="main" className="legal__main">
        <header className="legal__head lp-wrap">
          <p className="lp-eyebrow">Exit liveness proof</p>
          <h1 className="legal__title proof__title">When can you withdraw from a BELL pool? <em>Always.</em></h1>
          <p className="legal__lead">
            No BELL policy can hold back a withdraw. You do not have to take our word for it: this page shows how to check it from a hook&apos;s address, runs that check on every pool, and lists the withdraws we have made on mainnet. {done} of {proof.receipts.length} scenarios are on the record so far, and the rest say pending until they are.
          </p>
          <p className="legal__date">Chain {proof.chainId} / hook mask {proof.mask}</p>
        </header>

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
                BELL hooks end in <code>…ecc0</code>, which is <code>0x2cc0</code>. It sets five permissions and clears the three that touch removal.
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

            <Section id="receipts" n={4} title="Withdraws on the record">
              <p>A claim about every situation needs a transaction for every situation. These are the ones we planned. A row says DONE only with a transaction behind it.</p>
              <div className="pf-scroll">
                <table className="legal__table pf-table pf-receipts">
                  <thead><tr><th>Scenario</th><th>Status</th><th>What it proves</th><th>Transaction</th></tr></thead>
                  <tbody>
                    {proof.receipts.map((r) => (
                      <tr key={r.scenario}>
                        <td>{r.scenario}</td>
                        <td><span className="pf-badge" data-done={r.status === "DONE" ? "1" : "0"}>{r.status}</span></td>
                        <td>{r.proves}{r.note && <small>{r.note}</small>}</td>
                        <td>
                          {r.tx ? (
                            <>
                              <a href={explorerTx(r.tx)} target="_blank" rel="noopener noreferrer">{r.tx.slice(0, 10)}…{r.tx.slice(-6)} <ArrowUpRight size={13} aria-hidden="true" /></a>
                              <small>{r.session}, {r.when?.replace("T", " ").replace("Z", " UTC")}</small>
                            </>
                          ) : <span className="pf-dim">none yet</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>The safety pause is only ever exercised on a dedicated test pool and announced first. A user pool is never paused for a demonstration.</p>
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
