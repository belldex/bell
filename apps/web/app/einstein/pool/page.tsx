import type { Metadata } from 'next';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/einstein/einstein.css';
import { PoolProofPage } from '@/components/einstein/pool-proof-page';

const title = 'Einstein Hooks v2 | First Pool Proof';
const description = 'What can be checked on Robinhood Chain today about the first Einstein Hooks v2 pool, and what is still pending. Generated from one proof file and replayable from a public RPC.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/einstein/pool/' },
  openGraph: { title, description, url: '/einstein/pool/', type: 'website', images: [{ url: '/og/einstein.png', width: 1200, height: 630, alt: 'Einstein Hooks v2' }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og/einstein.png'] },
};

export default function Page() {
  return <PoolProofPage />;
}
