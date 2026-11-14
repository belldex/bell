import type { Metadata } from 'next';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/einstein/einstein.css';
import { EinsteinPage } from '@/components/einstein/einstein-page';

const title = 'Einstein Hooks v2 | Post-Quantum Trust Inputs';
const description = 'BELL post-quantum trust-input contracts are deployed on Robinhood Chain Mainnet without a pool yet, with the signing path exercised on Elysium testnet. User wallets and LP exits remain outside this scope.';

const banner = 'Einstein Hooks v2: changing the rules takes two signatures, leaving takes none. A grid of 4,096 one-time signing leaves, three spent.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/einstein/' },
  openGraph: { title, description, url: '/einstein/', type: 'website', images: [{ url: '/og/einstein.png', width: 1200, height: 630, alt: banner }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og/einstein.png'] },
};

export default function Page() {
  return <EinsteinPage />;
}
