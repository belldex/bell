import Link from "next/link";
import { ArrowUpRight, Check, X } from "lucide-react";
import { FaXTwitter } from "react-icons/fa6";
import { BrandLogo } from "@/components/landing/gyevo/bell-mark";
import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { BellWordmark } from "@/components/ui/Logo";
import { BELL_TOKEN, explorerAddress, explorerTx } from "@/config/mainnet";
import progress from "@/content/build-progress.json";
import { ContractsLedger } from "./contracts-ledger";
import { LiveProvider, LiveStrip } from "./live";
import { StatusBadge, type Status } from "./status-badge";
import { WeekClock } from "./week-clock";

/* /v4. Every claim carries a status from the same small vocabulary, and each status is true on the day it ships.
   Dated facts (first opening, verified count) live in content/build-progress.json so they are easy to update. */

const SHARE_TEXT = `Robinhood Chain has the stock tokens.
Uniswap has the engine.
Hyperliquid has the 24/7 price.

BELL holds the bell.

bellstocks.tech/v4`;

const FITS: { name: string; role: string; text: string; status: Status }[] = [
  { name: "Robinhood Chain", role: "The stadium", status: null, text: "Stock tokens trade 24/7. Standard pools can’t tell 3 AM Sunday from 10 AM Tuesday." },
  { name: "Uniswap v4", role: "The engine", status: "LIVE", text: "The best AMM engine onchain. BELL is built natively on it, and gives it a clock." },
  { name: "Hyperliquid", role: "The scoreboard", status: null, text: "Equity prices that never stop. A 24/7 price still doesn’t protect a spot LP from the weekend." },
  { name: "Elysium", role: "The bridge", status: "BUILDING TOWARD", text: "Contracts that read HyperCore directly. The price BELL’s auction wants at the open." },
];

const VERSUS: [string, string, string][] = [
  ["Monday morning after the weekend", "The first swap takes the whole gap", "Orders at the open clear at one price"],
  ["Market closed", "Same fees and rules as market hours", "100 bps fee, flow cap, closure budget"],
  ["Stale price data", "Swaps keep running", "Swaps fail closed"],
  ["Admin or pause", "Depends on the hook, can block withdrawals", "The hook has no permission to block withdrawals"],
  ["Contract upgrades", "Often behind a proxy", "Zero proxies, immutable hooks"],
];

const FEATURES: { name: string; status: Status; note: string }[] = [
  { name: "Session-aware fees, flow caps, fail-closed swaps", status: "LIVE", note: "On mainnet" },
  { name: "Unblockable LP exits", status: "LIVE", note: "Hook mask 0x2CC0 has five flags, none of them for removing liquidity" },
  { name: "Opening Bell Auction", status: "LIVE", note: `Contracts live and verified. First opening: ${progress.firstOpeningLabel}` },
  { name: "BellHookV2 and the write-once auction registry", status: "LIVE", note: "Pools created from the current factory get their own auction" },
  { name: `Source verification of the ${progress.coreContractsVerified} core contracts`, status: "LIVE", note: `Verified on ${progress.verifiedOn}. Pool hooks are next` },
  { name: "Exit Liveness Proof at /proof", status: "PLANNED", note: "" },
  { name: "Orders private until the bell (sealed-bid)", status: "PLANNED", note: "v2 auction" },
  { name: "HyperCore reference price", status: "BUILDING TOWARD", note: "Depends on Elysium EL1Read" },
];

const OPEN_STEPS = [
  { n: "01", title: "Orders collect", text: "Before the open, orders gather in escrow instead of racing each other. Cancel any time until the book locks." },
  { n: "02", title: "Book locks", text: "At the bell the book closes. No order can jump the line, and ordinary swaps on that pool pause." },
  { n: "03", title: "One clearing price", text: "The contract picks the single price that matches the most volume. Everything that does not match is refunded." },
];

const RECEIPTS: [string, string | null][] = [
  ["$BELL buyback", explorerTx("0xae06d09f417ed585532963b33610f682cd1c94fd46973b2c7affab5d19b4880a")],
  ["$BELL burn (2.9M)", explorerTx("0x72b08574afe1045d5bd6f71e70b28d61f7886225d388ad524e4c2b2b0c365c30")],
  ["$BELL token", explorerAddress(BELL_TOKEN)],
  ["$BELL chart", null],
  ["Source code", "https://github.com/belldex/bell"],
  ["All contracts", "/protocol/#contracts"],
  ["Official X", "https://x.com/BELLdexFi"],
];

const DISCLAIMER =
  "BELL is an independent protocol. Not affiliated with or endorsed by Robinhood Markets, Inc., Uniswap Labs, Hyperliquid, or Kinetiq. The Opening Bell Auction contracts are deployed; no auction has settled yet. Independent audit in progress. Not financial advice.";

function Header() {
  const links: [string, string][] = [["Fits", "#fits"], ["Compare", "#compare"], ["In v4", "#in-v4"], ["The open", "#open"], ["Contracts", "#contracts"], ["Receipts", "#receipts"]];
  return (
    <header className="v4-bar">
      <Link className="lp-brand" href="/" aria-label="BELL home">
        <BrandLogo size={40} priority />
        <BellWordmark>BELL</BellWordmark>
      </Link>
      <nav aria-label="On this page">
        {links.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
      </nav>
      <div className="v4-bar__right">
        <a className="lp-social-link" href="https://x.com/BELLdexFi" target="_blank" rel="noopener noreferrer" aria-label="BELL on X"><FaXTwitter aria-hidden="true" /></a>
        <Link className="lp-pill lp-pill--launch" href="/pools">
          <span>Open app</span><span className="lp-launch__arrow" aria-hidden="true">↗</span>
        </Link>
      </div>
    </header>
  );
}

function Eyebrow({ children }: { children: string }) {
  return <p className="lp-eyebrow" data-lp-reveal><i aria-hidden="true" />{children}</p>;
}

export function V4Page() {
  return (
    <div className="lp lp--bell v4" data-phase="dark">
      <Header />
      <main id="main">
        {/* 01 · hero */}
        <section className="lp-sec v4-hero" id="top" aria-labelledby="v4-title">
          <div className="lp-wrap v4-hero__grid">
            <div className="v4-hero__copy">
              <p className="v4-label" data-lp-reveal>BELL v4 · LIVE + ROADMAP</p>
              <h1 className="v4-h1" id="v4-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
                The market finally has <em>a bell.</em>
              </h1>
              <p className="v4-sub" data-lp-reveal style={{ ["--i" as string]: 2 }}>
                <span>Robinhood Chain has the stock tokens.</span>
                <span>Uniswap has the engine.</span>
                <span>Hyperliquid has the 24/7 price.</span>
                <strong>BELL holds the bell.</strong>
              </p>
              <div className="v4-cta" data-lp-reveal style={{ ["--i" as string]: 3 }}>
                <Link className="lp-btn lp-btn--primary" href="/swap/">Swap <StatusBadge status="LIVE" /></Link>
                <a className="lp-btn lp-btn--ghost" href="#contracts">See contracts</a>
              </div>
            </div>
            <div className="v4-hero__clock" data-lp-reveal style={{ ["--i" as string]: 2 }}><WeekClock /></div>
          </div>
        </section>

        {/* 02 · where BELL fits */}
        <section className="lp-sec v4-sec" id="fits" aria-labelledby="fits-title">
          <div className="lp-wrap">
            <Eyebrow>Where BELL fits</Eyebrow>
            <h2 className="lp-h2 v4-h2" id="fits-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
              Four pieces of the market. <em className="o">One keeps time.</em>
            </h2>
            <ul className="v4-fits">
              {FITS.map((f, i) => (
                <li key={f.name} data-lp-reveal style={{ ["--i" as string]: i }}>
                  <span className="v4-role">{f.role}</span>
                  <b>{f.name}</b>
                  <p>{f.text}</p>
                  <StatusBadge status={f.status} />
                </li>
              ))}
            </ul>
            <article className="v4-bellcard" data-lp-reveal>
              <div>
                <span className="v4-role">The bell</span>
                <h3>BELL</h3>
              </div>
              <p>Session-aware fees, flow caps, fail-closed swaps, unblockable exits. One fair price at the open.</p>
              <StatusBadge status="LIVE">LIVE + v4 ROADMAP</StatusBadge>
            </article>
          </div>
        </section>

        {/* 03 · there vs here */}
        <section className="lp-sec v4-sec" id="compare" aria-labelledby="compare-title">
          <div className="lp-wrap">
            <Eyebrow>There vs here</Eyebrow>
            <h2 className="lp-h2 v4-h2" id="compare-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
              What a standard pool can’t do. <em className="o">What BELL does.</em>
            </h2>
            <div className="v4-versus" role="table" aria-label="Standard pool compared with BELL">
              <div className="v4-versus__head" role="row">
                <span role="columnheader">Situation</span>
                <span role="columnheader">Standard pool</span>
                <span role="columnheader">BELL</span>
              </div>
              {VERSUS.map(([situation, standard, bell], i) => (
                <div className="v4-versus__row" role="row" key={situation} data-lp-reveal style={{ ["--i" as string]: i }}>
                  <b role="cell">{situation}</b>
                  <p role="cell" className="v4-versus__no"><X size={15} aria-hidden="true" /><span>{standard}</span></p>
                  <p role="cell" className="v4-versus__yes"><Check size={15} aria-hidden="true" /><span>{bell}</span></p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 04 · what's in v4 */}
        <section className="lp-sec v4-sec" id="in-v4" aria-labelledby="in-v4-title">
          <div className="lp-wrap">
            <Eyebrow>What’s in v4</Eyebrow>
            <h2 className="lp-h2 v4-h2" id="in-v4-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
              Every item carries <em className="o">an honest status.</em>
            </h2>
            <ul className="v4-features">
              {FEATURES.map((f, i) => (
                <li key={f.name} data-lp-reveal style={{ ["--i" as string]: Math.min(i, 4) }}>
                  <StatusBadge status={f.status} />
                  <b>{f.name}</b>
                  <small>{f.note}</small>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 05 · how the open works */}
        <section className="lp-sec v4-sec" id="open" aria-labelledby="open-title">
          <div className="lp-wrap">
            <Eyebrow>How the open works</Eyebrow>
            <h2 className="lp-h2 v4-h2" id="open-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
              Three steps. <em className="o">One price.</em>
            </h2>
            <ol className="v4-open">
              {OPEN_STEPS.map((s, i) => (
                <li key={s.n} data-lp-reveal style={{ ["--i" as string]: i }}>
                  <span className="v4-open__n" aria-hidden="true">{s.n}</span>
                  <b>{s.title}</b>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
            <p className="v4-open__foot" data-lp-reveal>
              10 minute order window · up to 25 orders per cycle · no auction fee.{" "}
              <Link href="/#auction">Watch the book clear <ArrowUpRight size={14} aria-hidden="true" /></Link>
            </p>
          </div>
        </section>

        {/* 06 · live on mainnet */}
        <section className="lp-sec v4-sec" id="contracts" aria-labelledby="contracts-title">
          <div className="lp-wrap">
            <Eyebrow>Live on mainnet today</Eyebrow>
            <h2 className="lp-h2 v4-h2" id="contracts-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
              Every address. <em className="o">Open any of them.</em>
            </h2>
            <LiveProvider>
              <LiveStrip />
              <ContractsLedger />
            </LiveProvider>
          </div>
        </section>

        {/* 07 · receipts */}
        <section className="lp-sec v4-sec" id="receipts" aria-labelledby="receipts-title">
          <div className="lp-wrap v4-two">
            <div>
              <Eyebrow>Receipts</Eyebrow>
              <h2 className="lp-h2 v4-h2" id="receipts-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
                Check every claim <em className="o">yourself.</em>
              </h2>
            </div>
            <ul className="v4-receipts">
              {RECEIPTS.filter(([, url]) => url).map(([label, url]) => (
                <li key={label} data-lp-reveal>
                  <Check size={15} aria-hidden="true" />
                  <b>{label}</b>
                  <a href={url as string} {...((url as string).startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                    {(url as string).replace(/^https?:\/\//, "")}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 08 · build progress */}
        <section className="lp-sec v4-sec" id="progress" aria-labelledby="progress-title">
          <div className="lp-wrap v4-two">
            <div>
              <Eyebrow>Build progress</Eyebrow>
              <h2 className="lp-h2 v4-h2" id="progress-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
                Where v4 <em className="o">stands.</em>
              </h2>
            </div>
            <article className="v4-progress" data-lp-reveal>
              <StatusBadge status="LIVE" />
              <p>
                Opening Bell Auction {progress.auctionMergedToMain ? "merged to main" : "not merged to main"}
                {" · "}{progress.coreContractsVerified} core contracts verified on {progress.verifiedOn}
              </p>
              <small>Updated {progress.updated} from content/build-progress.json</small>
            </article>
          </div>
        </section>

        {/* 09 · cta */}
        <section className="lp-sec v4-cta-sec" id="cta" aria-labelledby="cta-title">
          <div className="lp-wrap">
            <h2 className="v4-h1 v4-h1--cta" id="cta-title" data-lp-reveal>The bell rings <em>onchain.</em></h2>
            <div className="v4-cta" data-lp-reveal style={{ ["--i" as string]: 1 }}>
              <Link className="lp-btn lp-btn--primary" href="/swap/">Swap on BELL</Link>
              <a className="lp-btn lp-btn--ghost" href={`https://x.com/intent/post?text=${encodeURIComponent(SHARE_TEXT)}`} target="_blank" rel="noopener noreferrer">
                Share on X <FaXTwitter aria-hidden="true" />
              </a>
            </div>
            <pre className="v4-share" data-lp-reveal aria-label="Share text">{SHARE_TEXT}</pre>
          </div>
        </section>
      </main>

      {/* 10 · disclaimer */}
      <footer className="v4-foot">
        <div className="lp-wrap">
          <p>{DISCLAIMER}</p>
          <nav aria-label="Footer">
            <Link href="/terms/">Terms</Link>
            <Link href="/privacy/">Privacy</Link>
            <Link href="/protocol/">Protocol</Link>
          </nav>
        </div>
      </footer>
      <LandingEffects />
    </div>
  );
}
