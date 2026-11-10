import type { Metadata } from 'next';
import { IntegrationsPage } from '@/components/integrations/integrations-page';

export const metadata: Metadata = {
  title: 'BELL integrations',
  description: 'Live BELL pool metadata, quote checks, custom errors, fees, auction state, and verified contract links for integrators.',
  alternates: { canonical: '/integrations/' },
  openGraph: { title: 'BELL integrations', url: '/integrations/', type: 'website' },
};

export default function Page() {
  return <IntegrationsPage />;
}
