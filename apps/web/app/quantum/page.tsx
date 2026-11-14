import type { Metadata } from 'next';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/proof/proof.css';
import '@/components/quantum/quantum.css';
import { QuantumPage } from '@/components/quantum/quantum-page';

// /quantum is the earlier address of the same page. /einstein is the canonical one; this route keeps old links working.
const title = 'Einstein Hooks v2 | Post-Quantum Trust Inputs';
const description = 'BELL post-quantum trust-input contracts are deployed on Robinhood Chain Mainnet without a pool yet, with the signing path exercised on Elysium testnet. User wallets and LP exits remain outside this scope.';

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
