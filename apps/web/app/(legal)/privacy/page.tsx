import type { Metadata } from "next";
import "@/components/landing/gyevo/landing.css";
import "@/components/landing/gyevo/bell-control-room.css";
import "@/components/legal/legal.css";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What the BELL interface receives when you browse or connect a wallet, who processes it, and what stays public on the chain.",
  alternates: { canonical: "/privacy/" },
};

const sections: LegalSection[] = [
  {
    id: "no-account",
    title: "No account",
    body: (
      <p>
        Browsing BELL does not require an account, an email address, or a sign-up. BELL does not receive your private key or seed phrase, and it never asks for one.
      </p>
    ),
  },
  {
    id: "wallet",
    title: "When you connect a wallet",
    body: (
      <>
        <p>
          If you connect a wallet, the interface receives its public address and asks your wallet and the RPC provider for account and chain data, such as balances, allowances, and positions. Amounts and assets you select for a swap or a pool are processed in your browser and your wallet.
        </p>
        <p>
          A transaction is broadcast to Robinhood Chain only after you approve it in your wallet. It then becomes public chain activity, tied to your address, for good.
        </p>
      </>
    ),
  },
  {
    id: "worker",
    title: "The BELL Worker",
    body: (
      <p>
        The interface reads public pool and session-feed status through the BELL Worker, a small service that serves public chain data and the market-hours schedule. It does not ask for who you are. Like any web service, it may log request metadata such as IP address, time, and route in its hosting provider&apos;s logs.
      </p>
    ),
  },
  {
    id: "providers",
    title: "Providers that process requests",
    body: (
      <>
        <p>These providers may see request metadata, such as your IP address, timestamp, and the route you asked for:</p>
        <ul>
          <li>Your wallet and its software.</li>
          <li>The RPC provider the interface or your wallet uses to read and write the chain.</li>
          <li>The hosting and delivery provider that serves the site.</li>
          <li>The BELL Worker and its hosting provider.</li>
          <li>Block explorers, if you open a link to one. They are separate sites with their own policies.</li>
        </ul>
        <p>Each provider has its own privacy policy, and BELL does not control it.</p>
      </>
    ),
  },
  {
    id: "on-device",
    title: "What stays on your device",
    body: (
      <p>
        The interface keeps a few small preferences in your browser, such as which wallet you picked and whether you disconnected. They never leave your device and are not an account. The <a href="/cookies/">cookies and local storage page</a> lists them and lets you clear them.
      </p>
    ),
  },
  {
    id: "public-chain",
    title: "Public by design",
    body: (
      <>
        <p>
          Everything you do onchain is public: your address, the pools you use, your swaps, and your positions. Anyone can read it on a block explorer. BELL cannot hide it, change it, or delete it, and disconnecting your wallet does not erase it.
        </p>
        <div className="legal__note"><p>If you need your address kept apart from your identity, that is for you to arrange before you transact.</p></div>
      </>
    ),
  },
  {
    id: "no-sale",
    title: "No sale, no ads",
    body: (
      <p>
        BELL does not sell personal data and does not run advertising or cross-site tracking in the interface.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes and contact",
    body: (
      <p>
        This policy changes when the product does. The date at the top says which version you are reading. Questions go to <a href="https://x.com/BELLdexFi" target="_blank" rel="noopener noreferrer">@BELLdexFi on X</a>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      slug="privacy"
      title="Privacy policy"
      updated="6 November 2026"
      lead="What the BELL interface sees when you browse or connect a wallet, who else processes it, and what is public on the chain no matter what."
      sections={sections}
    />
  );
}
