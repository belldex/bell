import type { Metadata } from 'next';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/einstein/einstein.css';
import { SpecialistPage } from '@/components/specialist/specialist-page';

const title = 'BELL Specialist | A bonded market maker for every stock';
const description = 'One bonded market maker per stock must place orders in every Opening Bell auction and keep depth on the floor. The contract rewards the duty and slashes the bond when it is missed. Every claim can be replayed.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/specialist/' },
  openGraph: { title, description, url: '/specialist/', type: 'website', images: [{ url: '/og/einstein.png', width: 1200, height: 630, alt: 'BELL Specialist' }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og/einstein.png'] },
};

export default function Page() {
  return <SpecialistPage />;
}
