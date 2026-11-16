import { ArrowUpRight } from "lucide-react";
import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { LandingNav } from "@/components/landing/gyevo/landing-nav";
import { EinsteinMotion } from "./einstein-motion";
import { AuctionClock } from "./auction-clock";
import { CopyCommand } from "./copy-command";
import proof from "./proof.json";

const POOL_SECTIONS = [
  { id: "hook", label: "The hook", desc: "Its permissions, read from its address." },
  { id: "claims", label: "Claims", desc: "Each claim, its check and its verdict." },
  { id: "fail", label: "What must fail", desc: "Attempts that have to revert." },
  { id: "clock", label: "Next", desc: "What is on the clock." },
  { id: "check", label: "Check it yourself", desc: "Replay every claim from a public RPC." },
  { id: "limits", label: "Honest limits", desc: "What this does not show." },
] as const;

type Verdict = "PASS" | "PARTIAL" | "PENDING" | "FAIL";
type Check = { kind: string; label?: string; tx?: string; address?: string; hook?: string };
type Claim = {
  id: string; title: string; question: string; passes: string; pending?: string; partial?: string;
  checks: Check[];
  result?: { verdict: Verdict; note: string; gas?: { label: string; gasUsed: number }[] };
};
type Negative = { id: string; attempt: string; mustRevertWith: string; mainnetTx: string | null; status: string; note: string };
type Pool = { hook: string; poolId: string; positionId: string; block: number; createTx: string; pair: string };

const explorer = proof.chain.explorer;
const claims = proof.claims as unknown as Claim[];
const negatives = proof.negatives as unknown as Negative[];
const pool = ((proof as { pool?: Pool | null }).pool ?? null) as Pool | null;
const lastRun = (proof as { lastRun?: string }).lastRun;
const verdictOf = (c: Claim): Verdict => c.result?.verdict ?? "PENDING";
const count = (v: Verdict) => claims.filter((c) => verdictOf(c) === v).length;
const short = (h: string, a = 8, b = 6) => `${h.slice(0, a)}…${h.slice(-b)}`;

// The 14 hook permission bits of a Uniswap v4 hook, highest bit first. A hook's permissions are the low 14 bits of its address.
const HOOK_BITS = [
  "beforeInitialize", "afterInitialize", "beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity",
  "beforeSwap", "afterSwap", "beforeDonate", "afterDonate", "beforeSwapReturnDelta", "afterSwapReturnDelta",
  "afterAddLiquidityReturnDelta", "afterRemoveLiquidityReturnDelta",
] as const;
const EXIT_BITS = new Set(["beforeRemoveLiquidity", "afterRemoveLiquidity", "afterRemoveLiquidityReturnDelta"]);

const VERDICT_WORD: Record<Verdict, string> = { PASS: "Proven", PARTIAL: "Partly proven", PENDING: "Pending", FAIL: "Failed" };

function evidenceFor(claim: Claim) {
  const txs: { label: string; tx: string }[] = [];
  const addresses: { label: string; address: string }[] = [];
  for (const c of claim.checks ?? []) {
    if (c.tx) txs.push({ label: c.label ?? c.kind, tx: c.tx });
    else if (c.address) addresses.push({ label: c.label ?? c.address, address: c.address });
    else if (c.hook) addresses.push({ label: "Pool hook", address: c.hook });
  }
  return { txs, addresses };
}

function HookStrip({ hook }: { hook: string }) {
  const low = Number(BigInt(hook) & BigInt(0x3fff));
  const hex = hook.slice(2);
  return (
    <figure className="pp-hook" data-reveal>
      <p className="pp-hook__addr" aria-label={`Hook address ${hook}`}>
        <span>{hex.slice(0, 36)}</span><b>{hex.slice(36)}</b>
      </p>
      <ol className="pp-bits" aria-label="The 14 permission bits at the end of the hook address">
        {HOOK_BITS.map((name, i) => {
          const bit = 13 - i;
          const on = ((low >> bit) & 1) === 1;
          const exit = EXIT_BITS.has(name);
          return (
            <li key={name} data-on={on} data-exit={exit} title={`${name}: ${on ? "on" : "off"}`}>
              <i aria-hidden="true" />
              <span>{name.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
            </li>
          );
        })}
      </ol>
      <figcaption>
        Lit squares are the five callbacks this hook has: before initialize, before and after add liquidity, before and after swap.
        The three dashed squares are the remove-liquidity callbacks. They are dark, so withdrawing never calls the hook.
        Anyone can read this from the address alone.
      </figcaption>
    </figure>
  );
}

export function PoolProofPage() {
  const total = claims.length;
  const gas = claims.find((c) => c.id === "P10")?.result?.gas ?? [];
  return (
    <div className="lp lp--bell legal ein pp" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={POOL_SECTIONS} />
      <EinsteinMotion />
      <main id="main" className="legal__main ein__main">
        <header className="ein-hero pp-hero">
          <div className="ein-hero__copy">
            <p className="ein-tag"><span>Einstein Hooks v2</span><b>{pool ? "First pool is live" : "First pool proof"}</b></p>
            <h1>
              Every claim has a link. <em>Or it says pending.</em>
            </h1>
            <p className="ein-lede">
              {pool
                ? <>A real pool, <a href={`${explorer}/address/${pool.hook}`} target="_blank" rel="noopener noreferrer">{pool.pair}</a>, is open on Robinhood Chain with about 1 USD in it. Below is what has been proven on mainnet, what has not, and the transaction behind each line.</>
                : <>The first pool on an Einstein hook is not open yet. Below is what can already be checked, and what is still pending.</>}
            </p>
            <div className="pp-score" role="group" aria-label="Verdicts of the last replay">
              <div className="pp-score__bar" aria-hidden="true">
                {(["PASS", "PARTIAL", "PENDING", "FAIL"] as Verdict[]).map((v) => (
                  count(v) > 0 ? <i key={v} data-v={v.toLowerCase()} style={{ flexGrow: count(v) }} /> : null
                ))}
              </div>
              <ul>
                {(["PASS", "PARTIAL", "PENDING", "FAIL"] as Verdict[]).map((v) => (
                  <li key={v} data-v={v.toLowerCase()}><b>{count(v)}</b><span>{VERDICT_WORD[v].toLowerCase()}</span></li>
                ))}
              </ul>
              <p>of {total} claims{lastRun ? `, replayed against mainnet on ${lastRun.slice(0, 10)}` : ""}</p>
            </div>
          </div>
          {pool && <HookStrip hook={pool.hook} />}
        </header>

        {pool && (
          <section id="hook" className="ein-section pp-pool" data-reveal>
            <h2>The pool</h2>
            <dl className="pp-facts">
              <div><dt>Pair</dt><dd>{pool.pair}</dd></div>
              <div><dt>Hook</dt><dd><a href={`${explorer}/address/${pool.hook}`} target="_blank" rel="noopener noreferrer">{short(pool.hook, 10, 8)}</a></dd></div>
              <div><dt>Created in block</dt><dd>{pool.block.toLocaleString("en-US")}</dd></div>
              <div><dt>Creation transaction</dt><dd><a href={`${explorer}/tx/${pool.createTx}`} target="_blank" rel="noopener noreferrer">{short(pool.createTx, 10, 8)}</a></dd></div>
              <div><dt>Position</dt><dd>#{pool.positionId}</dd></div>
              <div><dt>Service fee</dt><dd>49 USDG, paid at creation</dd></div>
            </dl>
          </section>
        )}

        <section id="claims" className="ein-section" data-reveal>
          <h2>Claims</h2>
          <p className="ein-ledger__lede">
            A claim is proven only when every one of its checks holds on chain. Partly proven means true but short of the bar. Pending means
            there is nothing on chain to check yet.
          </p>
          <ol className="pp-ledger">
            {claims.map((c) => {
              const v = verdictOf(c);
              const { txs, addresses } = evidenceFor(c);
              return (
                <li key={c.id} data-v={v.toLowerCase()}>
                  <div className="pp-ledger__id"><b>{c.id}</b><span>{VERDICT_WORD[v]}</span></div>
                  <div className="pp-ledger__body">
                    <h3>{c.title}</h3>
                    <p>{c.result?.note ?? c.pending}</p>
                    <p className="pp-ledger__bar"><span>Proven when</span> {c.passes}</p>
                    {(txs.length > 0 || addresses.length > 0) && (
                      <ul className="pp-links">
                        {txs.slice(0, 4).map((t) => (
                          <li key={t.tx + t.label}>
                            <a href={`${explorer}/tx/${t.tx}`} target="_blank" rel="noopener noreferrer">{t.label} <ArrowUpRight size={12} aria-hidden="true" /></a>
                          </li>
                        ))}
                        {addresses.length > 0 && addresses.length <= 2 && addresses.map((a) => (
                          <li key={a.address}><a href={`${explorer}/address/${a.address}`} target="_blank" rel="noopener noreferrer">{a.label} <ArrowUpRight size={12} aria-hidden="true" /></a></li>
                        ))}
                        {addresses.length > 2 && (
                          <li>
                            <details>
                              <summary>{addresses.length} contracts checked</summary>
                              <ul>
                                {addresses.map((a) => (
                                  <li key={a.address}><a href={`${explorer}/address/${a.address}`} target="_blank" rel="noopener noreferrer">{a.label}</a></li>
                                ))}
                              </ul>
                            </details>
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {gas.length > 0 && (
            <div className="pp-gas">
              <h3>What the post-quantum signature costs on mainnet</h3>
              <ul>
                {gas.map((g) => (
                  <li key={g.label}><span>{g.label}</span><b>{g.gasUsed.toLocaleString("en-US")} gas</b></li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section id="fail" className="ein-section" data-reveal>
          <h2>What must fail</h2>
          <p className="ein-ledger__lede">
            Each attempt has to revert with the named error, and the reverted transaction stays on chain as the proof. A test that is not
            proven yet has not been sent to mainnet.
          </p>
          <ul className="pp-fail">
            {negatives.map((n) => (
              <li key={n.id} data-proven={Boolean(n.mainnetTx)}>
                <p className="pp-fail__top"><b>{n.id}</b><span>{n.mainnetTx ? "Reverted on mainnet" : "Not sent yet"}</span></p>
                <h3>{n.attempt}</h3>
                <p className="pp-fail__err">Reverts with <code>{n.mustRevertWith}</code></p>
                {n.mainnetTx
                  ? <a href={`${explorer}/tx/${n.mainnetTx}`} target="_blank" rel="noopener noreferrer">The reverted transaction <ArrowUpRight size={12} aria-hidden="true" /></a>
                  : <p className="pp-fail__note">{n.note}</p>}
              </li>
            ))}
          </ul>
        </section>

        <section id="clock" className="ein-section pp-clock" data-reveal>
          <h2>Next on the clock</h2>
          <div className="pp-clock__grid">
            <AuctionClock opensAt="2026-11-23T00:50:00Z" closesAt="2026-11-23T01:00:00Z" />
            <ul className="pp-clock__list">
              <li><b>Opening Bell Auction</b><span>The first cycle, on 16 November, closed with no orders because the script that places them started after the ten-minute window. The next one is the weekend close ending 23 November. A buyer and a seller, from two different wallets, put orders in during the ten minutes before the market opens, and the orders clear at one price.</span></li>
              <li><b>Sessions that open</b><span>Regular, pre, post and overnight swaps need a keeper to activate each session. The keeper for this stack activated the overnight session on 16 November, and the pool swapped in it.</span></li>
              <li><b>Exit while paused</b><span>Needs a pause signed with both keys, so it spends one signing leaf.</span></li>
            </ul>
          </div>
        </section>

        <section id="check" className="ein-section" data-reveal>
          <h2>Check it yourself</h2>
          <p className="ein-ledger__lede">
            One script, Node 20 and a public RPC. No keys, no team API. It reads every address and transaction from proof.json and prints a
            line per claim, and it exits with an error if anything fails.
          </p>
          <CopyCommand
            command={`git clone https://github.com/belldex/bell && cd bell\nnode scripts/einstein/verify-einstein-pool.mjs --rpc https://rpc.mainnet.chain.robinhood.com`}
          />
          <pre className="pp-term" aria-label="Output of the last replay">
            {claims.map((c) => {
              const v = verdictOf(c);
              return <span key={c.id} data-v={v.toLowerCase()}><i>{c.id.padEnd(4)}</i><b>{v.padEnd(8)}</b>{c.title}{"\n"}</span>;
            })}
          </pre>
          <p className="ein-fine">
            <a href="https://github.com/belldex/bell/blob/main/scripts/einstein/verify-einstein-pool.mjs" target="_blank" rel="noopener noreferrer">Read the script <ArrowUpRight size={14} aria-hidden="true" /></a>
            {" "}and{" "}
            <a href="https://github.com/belldex/bell/blob/main/evidence/einstein/proof.json" target="_blank" rel="noopener noreferrer">proof.json <ArrowUpRight size={14} aria-hidden="true" /></a>
          </p>
        </section>

        <section id="limits" className="ein-section" data-reveal>
          <h2>Honest limits</h2>
          <ul className="pp-limits">
            {proof.honestLimits.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      </main>
      <footer className="legal__foot">
        <div className="lp-wrap">
          <p>
            BELL is an independent protocol. This page reports what can be checked on chain today. It is not an audit and not financial advice.
          </p>
          <nav aria-label="Related">
            <a href="/einstein/">Einstein Hooks v2</a>
            <a href="/proof/">Exit proof</a>
            <a href="/">Home</a>
          </nav>
        </div>
      </footer>
      <LandingEffects />
    </div>
  );
}
