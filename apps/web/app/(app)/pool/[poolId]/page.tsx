import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import poolLenses from '@/content/mainnet-pool-lenses.json';
import { PoolVerificationPage } from '@/components/pool/pool-verification-page';

export const dynamicParams = false;

export function generateStaticParams() {
  if (poolLenses.chainId !== 4663) return [];
  return poolLenses.pools
    .filter((pool) => /^0x[0-9a-f]{64}$/i.test(pool.poolId))
    .map((pool) => ({ poolId: pool.poolId }));
}

type PageParameters = { params: Promise<{ poolId: string }> };

export async function generateMetadata({ params }: PageParameters): Promise<Metadata> {
  const { poolId } = await params;
  const pool = poolLenses.pools.find((item) => item.poolId.toLowerCase() === poolId.toLowerCase());
  return {
    title: pool ? `Verify pool ${pool.poolId.slice(0, 10)}…` : 'Verify BELL pool',
    description: 'Read a BELL pool’s hook, session fee, swap limits, and transaction receipts from Robinhood Chain.',
    alternates: { canonical: `/pool/${poolId}/` },
  };
}

export default async function Page({ params }: PageParameters) {
  const { poolId } = await params;
  const pool = poolLenses.pools.find((item) => item.poolId.toLowerCase() === poolId.toLowerCase());
  if (!pool) notFound();
  return <PoolVerificationPage poolId={pool.poolId} lensAddress={pool.lens} />;
}
