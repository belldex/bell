import type { Metadata } from "next";
import "@/components/landing/gyevo/landing.css";
import "@/components/landing/gyevo/bell-control-room.css";
import "@/components/legal/legal.css";
import "@/components/proof/proof.css";
import { ProofPage } from "@/components/proof/proof-page";

const title = "Exit liveness proof";
const description =
  "When can you withdraw from a BELL pool? A check you can run from a hook address, run on every pool, with the withdraw transactions on record and what “always” does and does not mean.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/proof/" },
  openGraph: { title, description, url: "/proof/", type: "website" },
  twitter: { card: "summary", title, description },
};

export default function Page() {
  return <ProofPage />;
}
