'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { readLivePools, type LivePool } from '@/lib/mainnet-live';
import { AppLoadingState } from '@/components/app/AppLoadingState';
import { TokenPair } from '@/components/ui/TokenLogo';
import { Button } from '@/components/ui/primitives';

/**
 * The Opening Bell Auction batches the order flow for a session open and clears it at one uniform
 * price, so the first swap after the bell cannot take the whole gap. Ordinary swaps are refused
 * while the batch is open; the refund path reopens them automatically.
 *
 * Everything on this page is read from chain. Nothing is inferred from a fixture, and a pool with no
 * bound auction is shown as such rather than as an empty auction.
 */
const REGISTRY = process.env.NEXT_PUBLIC_BELL_AUCTION_REGISTRY as Address | undefined;
const RPC = process.env.NEXT_PUBLIC_BELL_RPC_URL;

const registryAbi = parseAbi(['function auctionFor(bytes32 poolId) view returns (address)']);
const auctionAbi = parseAbi([
  'function stage() view returns (uint8)',
  'function blocksSwaps() view returns (bool)',
  'function orderCount() view returns (uint32)',
  'function openTime() view returns (uint64)',
  'function auctionLead() view returns (uint32)',
  'function settleTimeout() view returns (uint32)',
]);

const STAGE = ['Idle', 'Open', 'Locked', 'Settled', 'Refunded'] as const;

type AuctionView = {
  pool: LivePool;
  auction: Address;
  stage: number;
  blocksSwaps: boolean;
  orderCount: number;
  openTime: number;
  auctionLead: number;
  settleTimeout: number;
};

function countdown(openTime: number, stage: number, now: number) {
  if (stage === 3) return 'Cleared';
  if (stage === 4) return 'Refunded';
  const delta = openTime - now;
  if (stage === 0) return delta > 0 ? `Opens in ${Math.ceil(delta / 60)} min` : 'Opening';
  if (stage === 1) return 'Order book open';
  return 'Locked · awaiting settlement';
}

function AuctionCard({ view, now }: { view: AuctionView; now: number }) {
  const [left, right] = view.pool.legs;
  const tone = view.stage === 3 ? 'ion' : view.stage === 4 ? 'warn' : 'muted';
  return (
    <li className="glass border border-line bg-surface/75 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <span className="inline-flex min-w-0 items-center gap-3">
          <TokenPair symbols={[left.symbol, right.symbol]} size={34} />
          <span className="min-w-0">
            <span className="block truncate font-display text-2xl leading-tight text-ink">
              {left.symbol} / {right.symbol}
            </span>
            <span className="mt-1 block font-mono text-[10px] text-dim">
              auction {view.auction.slice(0, 8)}...{view.auction.slice(-6)}
            </span>
          </span>
        </span>
        <span
          className={`shrink-0 border px-2 py-1 font-mono text-[10px] uppercase ${
            tone === 'ion' ? 'border-ion/40 text-ion' : tone === 'warn' ? 'border-warn/40 text-warn' : 'border-line text-muted'
          }`}
        >
          {STAGE[view.stage] ?? `Stage ${view.stage}`}
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-line pt-4">
        <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Window</dt>
          <dd className="mt-1 text-sm text-ink">{countdown(view.openTime, view.stage, now)}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Orders</dt>
          <dd className="mt-1 text-sm text-ink">{view.orderCount}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Lead · timeout</dt>
          <dd className="mt-1 text-sm text-ink">
            {Math.round(view.auctionLead / 60)} min · {Math.round(view.settleTimeout / 60)} min
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Ordinary swaps</dt>
          <dd className={`mt-1 text-sm ${view.blocksSwaps ? 'text-warn' : 'text-ink'}`}>
            {view.blocksSwaps ? 'Paused for the batch' : 'Open'}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          href={`/pool/?hook=${view.pool.hook}`}
          className="inline-flex min-h-10 flex-1 justify-center items-center gap-2 border border-line px-3 font-mono text-[11px] uppercase text-muted transition-colors hover:border-line-strong hover:text-ink sm:flex-none"
        >
          Pool details
        </Link>
        <Link
          href={`/swap?hook=${view.pool.hook}`}
          className="inline-flex min-h-10 flex-1 justify-center items-center gap-2 border border-ion/40 px-3 font-mono text-[11px] uppercase text-ion transition-colors hover:bg-ion/10 sm:flex-none"
        >
          Open swap <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

export default function AuctionPage() {
  const [views, setViews] = useState<AuctionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    if (!REGISTRY || !RPC) {
      setError('The auction registry address is not configured for this deployment.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const client = createPublicClient({ transport: http(RPC) });
      const pools = await readLivePools();
      const next: AuctionView[] = [];
      for (const pool of pools) {
        const auction = (await client.readContract({
          address: REGISTRY,
          abi: registryAbi,
          functionName: 'auctionFor',
          args: [pool.poolId],
        })) as Address;
        if (auction === '0x0000000000000000000000000000000000000000') continue;
        const [stage, blocksSwaps, orderCount, openTime, auctionLead, settleTimeout] = await Promise.all([
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'stage' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'blocksSwaps' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'orderCount' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'openTime' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'auctionLead' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'settleTimeout' }),
        ]);
        next.push({
          pool,
          auction,
          stage: Number(stage),
          blocksSwaps,
          orderCount: Number(orderCount),
          openTime: Number(openTime),
          auctionLead: Number(auctionLead),
          settleTimeout: Number(settleTimeout),
        });
      }
      setViews(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read auction state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, revision]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="app-content-frame space-y-7">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Opening Bell · BELL Mainnet</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-ink">Opening Bell Auction</h1>
        <p className="mt-3 max-w-3xl text-base text-muted">
          Order flow for a session open is batched and cleared at one uniform price, so the first swap after the bell
          cannot take the whole gap. Ordinary swaps pause while the batch is open and reopen on settlement or refund.
        </p>
      </header>

      <div
        className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface p-4 text-sm text-muted"
        role="status"
        aria-live="polite"
      >
        <span>
          {loading
            ? 'Reading live auction state'
            : `${views.length} bound auction${views.length === 1 ? '' : 's'} on Robinhood Chain`}
        </span>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
          <RefreshCw className={`h-4 w-4${loading ? ' animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {loading && views.length === 0 && <AppLoadingState label="Reading live auction state" variant="cards" />}
      {error && (
        <div className="border border-down/40 bg-down/5 p-5 text-sm text-down" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && views.length === 0 && (
        <div className="border border-line bg-surface/60 p-6 text-sm text-muted">
          No pool currently has an Opening Bell Auction bound to it. Auctions are bound once, per pool, by the factory.
        </div>
      )}

      {views.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2">
          {views.map((view) => (
            <AuctionCard key={view.auction} view={view} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
