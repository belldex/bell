import type { Metadata } from 'next';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/einstein/einstein.css';
import { AntPage } from '@/components/einstein/ant-page';

const title = 'ANT on BELL | Robinhood Anthropic stock token';
const description = "Where Robinhood's ANT stock token stands on BELL: the verified contract, what blocks a pool, and the checks anyone can replay.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/einstein/ant/' },
  openGraph: { title, description, url: '/einstein/ant/', type: 'website', images: [{ url: '/og/einstein.png', width: 1200, height: 630, alt: 'ANT on BELL' }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og/einstein.png'] },
};

export default function Page() {
  return <AntPage />;
}
