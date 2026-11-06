import type { Address } from 'viem';
import { MAINNET } from '@/lib/mainnet-live';

/**
 * Auction state served by the BELL keeper. The keeper reads the chain server-side, so the page keeps
 * working when a visitor's network blocks or rewrites the public chain RPC (the browser then only
 * shows "Failed to fetch"). Values arrive as JSON strings and are rebuilt into bigint here.
 */
export type FeedOrder = {
  id: number; owner: Address; isBuyer: boolean; amountIn: bigint; limitPriceX96: bigint;
  fillBase: bigint; quotePayout: bigint; quoteRefund: bigint; cancelled: boolean; claimed: boolean;
};

export type FeedAuction = {
  address: Address; stage: number; blocksSwaps: boolean; orderCount: number; cycleId: number;
  cycleFinalized: boolean; openTime: number; auctionLead: number; settleTimeout: number;
  priceX96: bigint; matchedBase: bigint; orders: FeedOrder[];
};

export type FeedCycle = {
  openTime: number; stage: number; finalized: boolean; priceX96: bigint; matchedBase: bigint; orders: FeedOrder[];
};

const feedBase = () => MAINNET.quoteUrl.replace(/\/quote$/, '/auctions');

const toOrder = (o: any): FeedOrder => ({
  id: Number(o.id), owner: o.owner, isBuyer: Boolean(o.isBuyer), amountIn: BigInt(o.amountIn),
  limitPriceX96: BigInt(o.limitPriceX96), fillBase: BigInt(o.fillBase), quotePayout: BigInt(o.quotePayout),
  quoteRefund: BigInt(o.quoteRefund), cancelled: Boolean(o.cancelled), claimed: Boolean(o.claimed),
});

async function getJson(url: string) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Auction feed unavailable (${response.status})`);
  return response.json();
}

export async function fetchAuctionFeed(poolIds: string[]): Promise<Record<string, FeedAuction>> {
  if (poolIds.length === 0) return {};
  const body = await getJson(`${feedBase()}?pools=${poolIds.join(',')}`);
  const out: Record<string, FeedAuction> = {};
  for (const [poolId, a] of Object.entries<any>(body.auctions ?? {})) {
    out[poolId.toLowerCase()] = {
      address: a.address, stage: Number(a.stage), blocksSwaps: Boolean(a.blocksSwaps),
      orderCount: Number(a.orderCount), cycleId: Number(a.cycleId), cycleFinalized: Boolean(a.cycleFinalized),
      openTime: Number(a.openTime), auctionLead: Number(a.auctionLead), settleTimeout: Number(a.settleTimeout),
      priceX96: BigInt(a.priceX96), matchedBase: BigInt(a.matchedBase), orders: (a.orders ?? []).map(toOrder),
    };
  }
  return out;
}

export async function fetchAuctionCycle(poolIds: string[], auction: string, cycle: number): Promise<FeedCycle> {
  const body = await getJson(`${feedBase()}?pools=${poolIds.join(',')}&auction=${auction}&cycle=${cycle}`);
  const c = body.cycle;
  return {
    openTime: Number(c.openTime), stage: Number(c.stage), finalized: Boolean(c.finalized),
    priceX96: BigInt(c.priceX96), matchedBase: BigInt(c.matchedBase), orders: (c.orders ?? []).map(toOrder),
  };
}
