import type { Metadata } from "next";
import "@/components/landing/gyevo/landing.css";
import "@/components/landing/gyevo/bell-control-room.css";
import "@/components/landing/gyevo/auction-section.css";
import "@/components/v4/v4.css";
import { V4Page } from "@/components/v4/v4-page";

const title = "BELL v4 & Ecosystem";
const description =
  "Where BELL fits between Robinhood Chain, Uniswap v4, Hyperliquid and Elysium, what is live and what is not, and every mainnet address. Each claim carries an honest status.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/v4/" },
  openGraph: { title, description, url: "/v4/", type: "website", images: [{ url: "/assets/og-v4.png", width: 1200, height: 630, alt: "BELL v4: the market finally has a bell" }] },
  twitter: { card: "summary_large_image", title, description, images: ["/assets/og-v4.png"] },
};

export default function Page() {
  return <V4Page />;
}
