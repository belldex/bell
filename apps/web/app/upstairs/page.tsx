import type { Metadata } from 'next';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/einstein/einstein.css';
import { UpstairsPage } from '@/components/upstairs/upstairs-page';

const title = 'BELL Upstairs | Block trades for stock tokens';
const description = 'Two wallets trade a large block of a stock token directly, settled onchain in one transaction, inside a session price band, without touching a BELL pool. Every claim can be replayed.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/upstairs/' },
  openGraph: { title, description, url: '/upstairs/', type: 'website', images: [{ url: '/og/einstein.png', width: 1200, height: 630, alt: 'BELL Upstairs' }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og/einstein.png'] },
};

export default function Page() {
  return <UpstairsPage />;
}
