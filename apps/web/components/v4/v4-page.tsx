import Link from "next/link";
import { ArrowUpRight, Check, X } from "lucide-react";
import { FaXTwitter } from "react-icons/fa6";
import { AuctionBook } from "@/components/landing/gyevo/auction-section";
import { BrandLogo } from "@/components/landing/gyevo/bell-mark";
import { LandingEffects } from "@/components/landing/gyevo/landing-effects";
import { LandingNav } from "@/components/landing/gyevo/landing-nav";
import { SmoothScroll } from "@/components/landing/gyevo/smooth-scroll";
import { BELL_TOKEN, explorerAddress, explorerTx } from "@/config/mainnet";
import progress from "@/content/build-progress.json";
import { ContractsLedger } from "./contracts-ledger";
import { LiveProvider, LiveStrip } from "./live";
import { StatusBadge, type Status } from "./status-badge";
import { BellSculpture, V4Hero } from "./v4-hero";
import { WeekClock } from "./week-clock";

/* /v4. Every claim carries a status from the same small vocabulary, and each status is true on the day it ships.
   Dated facts (first opening, verified count) live in content/build-progress.json so they are easy to update. */

const SHARE_TEXT = `Robinhood Chain has the stock tokens.
Uniswap has the engine.
Hyperliquid has the 24/7 price.

BELL holds the bell.

bellstocks.tech/v4`;

/* Official marks, as each project publishes them (wordmarks for Robinhood and Uniswap, the mark for Hyperliquid and Elysium). */
const FITS: { name: string; role: string; text: string; status: Status; logo: { src: string; w: number; h: number; invert?: boolean } }[] = [
  { name: "Robinhood Chain", role: "The stadium", status: null, logo: { src: "/landing/partners/robinhood.svg", w: 148, h: 29, invert: true }, text: "Stock tokens trade 24/7. Standard pools can’t tell 3 AM Sunday from 10 AM Tuesday." },
  { name: "Uniswap v4", role: "The engine", status: "LIVE", logo: { src: "/landing/partners/uniswap.svg", w: 112, h: 28, invert: true }, text: "The best AMM engine onchain. BELL is built natively on it, and gives it a clock." },
  { name: "Hyperliquid", role: "The scoreboard", status: null, logo: { src: "/landing/partners/hyperliquid.png", w: 40, h: 40 }, text: "Equity prices that never stop. A 24/7 price still doesn’t protect a spot LP from the weekend." },
  { name: "Elysium", role: "The bridge", status: "BUILDING TOWARD", logo: { src: "/landing/partners/elysium.svg", w: 40, h: 40 }, text: "Kinetiq’s Hyperliquid L2. BELL is deployed on its testnet with test tokens. Its planned HyperCore read access is the price BELL’s auction wants at the open." },
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
  { name: "Elysium testnet rehearsal", status: "DEPLOYED", note: "The same contracts on Elysium testnet, with test tokens that have no value. Elysium mainnet is not deployed" },
  { name: "Exit Liveness Proof at /proof", status: "LIVE", note: `Every hook checked from its address. A mainnet withdraw is linked as proof` },
  { name: "Orders private until the bell (sealed-bid)", status: "PLANNED", note: "v2 auction" },
  { name: "HyperCore reference price", status: "BUILDING TOWARD", note: "Depends on the HyperCore read precompile Elysium plans to add after its mainnet" },
];

const RECEIPTS: [string, string | null][] = [
  ["$BELL buyback", explorerTx("0xae06d09f417ed585532963b33610f682cd1c94fd46973b2c7affab5d19b4880a")],
  ["$BELL burn (2.9M)", explorerTx("0x72b08574afe1045d5bd6f71e70b28d61f7886225d388ad524e4c2b2b0c365c30")],
  ["$BELL token", explorerAddress(BELL_TOKEN)],
  ["$BELL chart", null],
  ["Source code", "https://github.com/belldex/bell"],
  ["All contracts", "/protocol/#contracts"],
  ["Exit liveness proof", "/proof/"],
  ["Elysium testnet rehearsal", "/elysium/"],
  ["Official X", "https://x.com/BELLdexFi"],
];

const DISCLAIMER =
  "BELL is an independent protocol. Not affiliated with or endorsed by Robinhood Markets, Inc., Uniswap Labs, Hyperliquid, or Kinetiq. The Opening Bell Auction contracts are deployed; no auction has settled yet. Independent audit in progress. Not financial advice.";

const NAV = [
  { id: "clock", label: "Clock", desc: "The session BELL is in right now." },
  { id: "fits", label: "Fits", desc: "Robinhood Chain, Uniswap, Hyperliquid and Elysium." },
  { id: "compare", label: "Compare", desc: "A standard pool next to BELL." },
  { id: "in-v4", label: "In v4", desc: "Every feature with an honest status." },
  { id: "open", label: "The open", desc: "One clearing price at the open." },
  { id: "contracts", label: "Contracts", desc: "Every mainnet address." },
  { id: "receipts", label: "Receipts", desc: "Check every claim yourself." },
] as const;

function Eyebrow({ children }: { children: string }) {
  return <p className="lp-eyebrow" data-lp-reveal>{children}</p>;
}

export function V4Page() {
  return (
    <div className="lp lp--bell v4" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={NAV} />
      <main id="main">
        <V4Hero />

        <section className="lp-sec v4-sec" id="clock" aria-labelledby="clock-title">
          <div className="lp-wrap">
            <Eyebrow>The clock BELL keeps</Eyebrow>
            <h2 className="lp-h2 v4-h2" id="clock-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
              A market that never closes <em className="o">needs a clock.</em>
            </h2>
            <div className="v4-clockwrap" data-lp-reveal style={{ ["--i" as string]: 2 }}><WeekClock /></div>
          </div>
        </section>

        <section className="lp-sec v4-sec" id="fits" aria-labelledby="fits-title">
          <div className="lp-wrap">
            <Eyebrow>Where BELL fits</Eyebrow>
            <h2 className="lp-h2 v4-h2" id="fits-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
              Four pieces of the market. <em className="o">One keeps time.</em>
            </h2>
            <ul className="v4-fits">
              {FITS.map((f, i) => (
                <li key={f.name} data-lp-reveal style={{ ["--i" as string]: i }}>
                  <span className="v4-logo"><img src={f.logo.src} width={f.logo.w} height={f.logo.h} alt="" data-invert={f.logo.invert ? "1" : undefined} loading="lazy" decoding="async" /></span>
                  <span className="v4-role">{f.role}</span>
                  <b>{f.name}</b>
                  <p>{f.text}</p>
                  <StatusBadge status={f.status} />
                </li>
              ))}
            </ul>
            <article className="v4-bellcard" data-lp-reveal>
              <div>
                <span className="v4-logo"><BrandLogo size={34} /></span>
                <span className="v4-role">The bell</span>
                <h3>BELL</h3>
              </div>
              <p>Session-aware fees, flow caps, fail-closed swaps, unblockable exits. One fair price at the open.</p>
              <StatusBadge status="LIVE">LIVE + v4 ROADMAP</StatusBadge>
            </article>
          </div>
        </section>

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

        {/* the landing's own order book, so the drawing and the copy are one thing */}
        <section className="lp-sec lp-auc v4-sec" id="open" aria-labelledby="open-title">
          <div className="lp-wrap lp-auc__wrap">
            <div>
              <Eyebrow>How the open works</Eyebrow>
              <h2 className="lp-h2 v4-h2" id="open-title" data-lp-reveal style={{ ["--i" as string]: 1 }}>
                Orders gather. The book locks. <em className="o">One price.</em>
              </h2>
            </div>
            <AuctionBook />
            <p className="v4-openfoot" data-lp-reveal>
              <Link href="/#auction">The full auction, with its parameters <ArrowUpRight size={14} aria-hidden="true" /></Link>
            </p>
          </div>
        </section>

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
                {" / "}{progress.coreContractsVerified} core contracts verified on {progress.verifiedOn}
              </p>
              <small>Updated {progress.updated} from content/build-progress.json</small>
            </article>
          </div>
        </section>

        <section className="lp-sec v4-cta-sec" id="cta" aria-labelledby="cta-title">
          <BellSculpture />
          <div className="lp-wrap v4-cta-sec__copy">
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
      <SmoothScroll />
    </div>
  );
}
