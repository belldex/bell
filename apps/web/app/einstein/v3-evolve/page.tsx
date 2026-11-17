import type { Metadata } from 'next';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/einstein/einstein.css';
import { V3EvolvePage } from '@/components/einstein/v3-evolve-page';

const title = 'Einstein Hooks v3 Evolve | LP Economics Proof';
const description = 'Two NVDA/USDG pools on Robinhood Chain, one with the BELL hook and one plain Uniswap v4, side by side over a real weekend. Every LP number comes from onchain events and can be replayed.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/einstein/v3-evolve/' },
  openGraph: { title, description, url: '/einstein/v3-evolve/', type: 'website', images: [{ url: '/og/einstein.png', width: 1200, height: 630, alt: 'Einstein Hooks v3 Evolve' }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og/einstein.png'] },
};

export default function Page() {
  return <V3EvolvePage />;
}
