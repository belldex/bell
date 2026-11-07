import type { Metadata } from "next";
import "@/components/landing/gyevo/landing.css";
import "@/components/landing/gyevo/bell-control-room.css";
import "@/components/legal/legal.css";
import "@/components/proof/proof.css";
import "@/components/proof/proof-hero.css";
import "@/components/elysium/elysium.css";
import { ElysiumPage } from "@/components/elysium/elysium-page";

const title = "BELL on Elysium testnet";
const description =
  "The BELL contracts, unchanged, deployed to Elysium testnet with test tokens. Every pool, swap, refusal, withdraw and one full opening auction, each with its transaction.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/elysium/" },
  openGraph: { title, description, url: "/elysium/", type: "website" },
  twitter: { card: "summary", title, description },
};

export default function Page() {
  return <ElysiumPage />;
}
