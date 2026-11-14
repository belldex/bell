import type { Metadata } from 'next';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/proof/proof.css';
import '@/components/quantum/quantum.css';
import { QuantumPage } from '@/components/quantum/quantum-page';

// /quantum is the earlier address of the same page. /einstein is the canonical one; this route keeps old links working.
const title = 'Einstein Hooks v2 | Hybrid Trust Inputs on Testnet';
const description = 'BELL hybrid post-quantum trust-input signing is deployed on Elysium testnet. Mainnet hook integration is gated; user wallets and LP exits remain outside this scope.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/einstein/' },
  openGraph: { title, description, url: '/einstein/', type: 'website' },
  twitter: { card: 'summary', title, description },
};

export default function Page() {
  return <QuantumPage />;
}
