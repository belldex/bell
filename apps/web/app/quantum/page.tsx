import type { Metadata } from 'next';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/proof/proof.css';
import '@/components/quantum/quantum.css';
import { QuantumPage } from '@/components/quantum/quantum-page';

const title = 'Bell State Hooks | Hybrid Trust Inputs on Testnet';
const description = 'BELL hybrid post-quantum trust-input signing is deployed on Elysium testnet. Mainnet hook integration is gated; user wallets and LP exits remain outside this scope.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/quantum/' },
  openGraph: { title, description, url: '/quantum/', type: 'website' },
  twitter: { card: 'summary', title, description },
};

export default function Page() {
  return <QuantumPage />;
}
