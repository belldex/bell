import type { Metadata } from 'next';
import { VerifyPage } from '@/components/verify/verify-page';

export const metadata: Metadata = {
  title: 'Verify a BELL pool',
  description: 'Four checks to verify BELL pool creation, hook permissions, session fees, and enforced rules directly on Robinhood Chain.',
  alternates: { canonical: '/verify/' },
  openGraph: { title: 'Verify a BELL pool', url: '/verify/', type: 'website' },
};

export default function Page() {
  return <VerifyPage />;
}
