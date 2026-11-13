import type { Metadata } from 'next';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/proof/proof.css';
import '@/components/quantum/quantum.css';
import { QuantumPage } from '@/components/quantum/quantum-page';

const title = 'Quantum security research';
const description = 'BELL research into post-quantum signatures for protocol trust inputs. User wallets and LP exits remain outside this scope.';

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
