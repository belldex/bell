import type { Metadata } from "next";
import "@/components/landing/gyevo/landing.css";
import "@/components/landing/gyevo/bell-control-room.css";
import "@/components/legal/legal.css";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms for using the BELL interface and protocol on Robinhood Chain: what BELL is, what it is not, and the risks of trading and providing liquidity.",
  alternates: { canonical: "/terms/" },
};

const sections: LegalSection[] = [
  {
    id: "what-bell-is",
    title: "What BELL is",
    body: (
      <>
        <p>
          BELL is an independent, wallet-connected interface and a set of smart contracts for Uniswap v4 pools on Robinhood Chain Mainnet. A BELL pool applies a market-hours schedule to its fees and limits. The interface lets you read pools, swap, create and seed a pool, manage positions, and take part in an Opening Bell Auction.
        </p>
        <p>
          BELL is software. It is not a broker, exchange, custodian, or financial institution, and it does not hold your assets. You act through your own wallet, and the smart contracts execute what you sign.
        </p>
      </>
    ),
  },
  {
    id: "no-affiliation",
    title: "No affiliation",
    body: (
      <p>
        BELL is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc. Names and marks of Robinhood, Uniswap, Hyperliquid, Elysium, and Kinetiq belong to their owners and appear only to say what BELL works with or reads from.
      </p>
    ),
  },
  {
    id: "not-advice",
    title: "Not advice",
    body: (
      <p>
        Nothing here is investment, legal, or tax advice, an offer or solicitation, a guarantee of liquidity, or a promise of profit. Pool descriptions, fee tables, and status labels explain how the contracts behave. They do not tell you what to buy, sell, or provide. Decide for yourself, and take your own advice where you need it.
      </p>
    ),
  },
  {
    id: "how-pools-behave",
    title: "How pools behave",
    body: (
      <>
        <ul>
          <li>A checked pool follows a live external price while that price is available. If it is not, the pool steps aside to its own market price with a 1% fee and tight flow caps.</li>
          <li>A market-price pool always trades on its own liquidity and claims no outside stock price.</li>
          <li>Fees, flow caps, and closure budgets change with the session. Swaps fail closed when the data a pool relies on is stale or missing.</li>
          <li>Pauses, an invalid calendar, registry failures, flow caps, and recovery rules can block swaps. The hook is built so that it cannot block removing liquidity.</li>
          <li>MEME has no external price source and is available only in market-price pools.</li>
        </ul>
        <p>Flow caps limit how much can move in a window. They do not guarantee a maximum loss.</p>
      </>
    ),
  },
  {
    id: "opening-bell-auction",
    title: "Opening Bell Auction",
    body: (
      <>
        <p>
          An Opening Bell Auction is a peer-to-peer, uniform-price batch at the start of a session. Orders are escrowed in the auction contract while the book is open, the book clears at one price, and any order that does not fill can be refunded. Refunds are permissionless, so anyone can trigger one for an order.
        </p>
        <p>
          The auction contracts are deployed on mainnet. An auction can fail to clear, can clear with partial fills, and can clear at a price you did not expect. Escrowed funds are subject to smart-contract risk until they are settled or refunded.
        </p>
      </>
    ),
  },
  {
    id: "transactions-and-risk",
    title: "Transactions and risk",
    body: (
      <>
        <p>
          The interface can request token approvals, simulate pool creation and swaps, create and seed a pool, and submit transactions through your connected wallet. Every transaction needs your confirmation in your wallet.
        </p>
        <ul>
          <li>Transactions are public, cannot be reversed, may fail, and can cause loss of funds.</li>
          <li>Check the network, recipient, amounts, fees, and contract details before you sign.</li>
          <li>Market-price trading can diverge sharply from the stock price.</li>
          <li>Prices, balances, and quotes shown in the interface are read from public infrastructure and can be late or wrong. The chain is authoritative.</li>
          <li>You are responsible for your keys, your wallet, and your approvals. Revoke approvals you no longer need.</li>
          <li>Never use funds you cannot afford to lose.</li>
        </ul>
      </>
    ),
  },
  {
    id: "audit-and-status",
    title: "Audit and status",
    body: (
      <>
        <p>
          Mainnet contracts and four-session adapter scopes are deployed, and the core contracts are source-verified. An independent security audit is not complete. Until it is, treat every BELL contract as unaudited.
        </p>
        <p>
          The <a href="/v4/">v4 page</a> labels each feature as live, deployed, in development, planned, or building toward. Those labels describe the state on the day they were written.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services",
    body: (
      <p>
        BELL depends on services it does not control: your wallet, RPC providers, block explorers, hosting, Robinhood Chain itself, and the price feeds a pool may read. If one of them is down, wrong, or changes, BELL can be slow, incomplete, or unavailable. Their own terms apply to your use of them.
      </p>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <p>
        Do not use BELL to break the law, to evade sanctions, to attack or probe the contracts or infrastructure in a way that harms others, or to misrepresent BELL as something it is not. You are responsible for following the laws that apply to you, including any restriction on using these services where you live.
      </p>
    ),
  },
  {
    id: "liability",
    title: "No warranty and liability",
    body: (
      <>
        <p>
          BELL is provided as is and as available, without warranties of any kind. To the extent the law allows, the people who build BELL are not liable for any loss arising from your use of it, including loss of funds, lost profits, failed or delayed transactions, or errors in displayed data.
        </p>
        <div className="legal__note"><p>Smart contracts can have bugs. If you do not accept that risk, do not use BELL.</p></div>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes and contact",
    body: (
      <p>
        These terms can change as the product does. The date at the top says which version you are reading, and continued use after a change means you accept it. Questions go to <a href="https://x.com/BELLdexFi" target="_blank" rel="noopener noreferrer">@BELLdexFi on X</a>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      slug="terms"
      title="Terms of use"
      updated="6 November 2026"
      lead="What BELL is, what it is not, and the risks you take when you trade or provide liquidity through it. Short on purpose, and meant to be read."
      sections={sections}
    />
  );
}
