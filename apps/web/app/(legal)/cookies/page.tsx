import type { Metadata } from "next";
import "@/components/landing/gyevo/landing.css";
import "@/components/landing/gyevo/bell-control-room.css";
import "@/components/legal/legal.css";
import { ClearLocal } from "@/components/legal/clear-local";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Cookies and local storage",
  description: "The small preferences the BELL interface keeps in your browser, what they do, and how to clear them.",
  alternates: { canonical: "/cookies/" },
};

const sections: LegalSection[] = [
  {
    id: "summary",
    title: "The short version",
    body: (
      <p>
        BELL sets no advertising or tracking cookies. The landing and the app store a few small preferences in your browser&apos;s local storage. They are not an account, they do not change anything onchain, and they are never used to claim that a transaction happened.
      </p>
    ),
  },
  {
    id: "what-is-stored",
    title: "What is stored",
    body: (
      <table className="legal__table">
        <thead><tr><th>Key</th><th>What it is for</th></tr></thead>
        <tbody>
          <tr><td>bell.selected-wallet</td><td>Which wallet you picked last, so the interface can offer it again.</td></tr>
          <tr><td>bell.wallet-disconnected</td><td>Remembers that you disconnected, so the interface does not reconnect on its own.</td></tr>
        </tbody>
      </table>
    ),
  },
  {
    id: "third-party",
    title: "Third-party storage",
    body: (
      <p>
        Your wallet, and the sites you reach through links such as block explorers, keep their own storage under their own policies. BELL does not control them.
      </p>
    ),
  },
  {
    id: "clear",
    title: "Clear it",
    body: (
      <>
        <p>This removes the BELL keys above from this browser. It does not disconnect a wallet or change anything on the chain.</p>
        <ClearLocal />
      </>
    ),
  },
];

export default function CookiesPage() {
  return (
    <LegalPage
      slug="cookies"
      title="Cookies and local storage"
      updated="6 November 2026"
      lead="The small preferences BELL keeps in your browser, what each one does, and a button to clear them."
      sections={sections}
    />
  );
}
