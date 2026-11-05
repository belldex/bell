'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { createPublicClient, formatUnits, http, parseAbi, parseUnits, type Address } from 'viem';
import { MAINNET, readLivePools, tokenAbi, type LivePool } from '@/lib/mainnet-live';
import { makeClients, useWallet } from '@/lib/wallet';
import { AppLoadingState } from '@/components/app/AppLoadingState';
import { TokenPair } from '@/components/ui/TokenLogo';
import { Button } from '@/components/ui/primitives';

/**
 * The Opening Bell Auction matches eligible peer orders at one uniform price before ordinary
 * swaps reopen. One-sided or unmatched orders are refunded; the AMM price itself is unchanged.
 * Ordinary swaps pause while the batch is open.
 *
 * Everything on this page is read from chain. Nothing is inferred from a fixture, and a pool with no
 * bound auction is shown as such rather than as an empty auction.
 */
const REGISTRY = MAINNET.auctionRegistry ?? process.env.NEXT_PUBLIC_BELL_AUCTION_REGISTRY as Address | undefined;
const RPC = MAINNET.publicRpc;

const registryAbi = parseAbi(['function auctionFor(bytes32 poolId) view returns (address)']);
const auctionAbi = parseAbi([
  'function currentStage() view returns (uint8)',
  'function blocksSwaps() view returns (bool)',
  'function orderCount() view returns (uint32)',
  'function totalOrderCount() view returns (uint32)',
  'function cycleOrderCount(uint64) view returns (uint32)',
  'function cycleOrderId(uint64,uint32) view returns (uint32)',
  'function cycleSummary(uint64) view returns (uint64 cycleOpenTime,uint64 deadline,uint8 cycleStage,uint160 priceX96,uint128 matchedBase,bool finalized)',
  'function openTime() view returns (uint64)',
  'function auctionLead() view returns (uint32)',
  'function settleTimeout() view returns (uint32)',
  'function cycleId() view returns (uint64)',
  'function indicativeClearing() view returns (uint160 priceX96,uint128 matchedBase)',
  'function order(uint32) view returns ((address owner,uint128 amountIn,uint160 limitPriceX96,uint64 cycleId,bool isBuyer,bool cancelled,bool claimed))',
  'function allocation(uint64,uint32) view returns (uint128 baseFill,uint128 quotePayout,uint128 quoteRefund)',
  'function submitOrder(bool isBuyer,uint128 amountIn,uint160 limitPriceX96) returns (uint32)',
  'function cancelOrder(uint32 orderId)',
  'function claimUnfilled(uint64,uint32)',
]);

const STAGE = ['Idle', 'Armed', 'Open', 'Locked', 'Settled', 'Refunded'] as const;
const STAGE_ARMED = 1;
const STAGE_OPEN = 2;
const STAGE_LOCKED = 3;
const STAGE_SETTLED = 4;
const STAGE_REFUNDED = 5;

type AuctionView = {
  pool: LivePool;
  auction: Address;
  stage: number;
  blocksSwaps: boolean;
  orderCount: number;
  cycleId: number;
  cycleFinalized: boolean;
  openTime: number;
  auctionLead: number;
  settleTimeout: number;
  indicativePriceX96: bigint;
  matchedBase: bigint;
  orders: { id: number; owner: Address; isBuyer: boolean; amountIn: bigint; limitPriceX96: bigint; fillBase: bigint; quotePayout: bigint; quoteRefund: bigint; cancelled: boolean; claimed: boolean }[];
};

function indicativeText(view: AuctionView) {
  if (view.indicativePriceX96 === 0n) return 'No matching volume';
  const quote = view.pool.legs.find((leg) => leg.symbol === 'USDG');
  const base = view.pool.legs.find((leg) => leg.symbol !== 'USDG');
  if (!quote || !base) return `${view.matchedBase.toString()} base raw units matched`;
  const humanQuotePerBase = view.indicativePriceX96 * 10n ** BigInt(base.decimals) * 10n ** 18n
    / ((1n << 96n) * 10n ** BigInt(quote.decimals));
  return `${formatUnits(humanQuotePerBase, 18)} USDG per ${base.symbol} · ${formatUnits(view.matchedBase, base.decimals)} matched`;
}

function stageText(stage: number, finalized: boolean) {
  if (stage === STAGE_REFUNDED && !finalized) return 'Refund available';
  return STAGE[stage] ?? `Stage ${stage}`;
}

function countdown(openTime: number, auctionLead: number, stage: number, now: number, finalized: boolean) {
  if (stage === STAGE_SETTLED) return 'Cleared';
  if (stage === STAGE_REFUNDED) return finalized ? 'Refunded' : 'Refund available';
  if (stage === STAGE_ARMED) return `Opens in ${Math.max(0, Math.ceil((openTime - now - auctionLead) / 60))} min`;
  const delta = openTime - now;
  if (stage === STAGE_OPEN) return 'Order book open';
  if (stage === STAGE_LOCKED) return 'Locked · awaiting settlement';
  if (stage === 0) return openTime === 0 ? 'Waiting for calendar-verified cycle' : delta > 0 ? `Opens in ${Math.ceil(delta / 60)} min` : 'Opening';
  return 'Locked · awaiting settlement';
}

function AuctionCard({ view, now, wallet, refresh }: { view: AuctionView; now: number; wallet: ReturnType<typeof useWallet>; refresh: () => void }) {
  const [selectedCycle, setSelectedCycle] = useState(view.cycleId);
  const [historyOrders, setHistoryOrders] = useState(view.orders);
  const [historyStage, setHistoryStage] = useState(view.stage);
  const [historyFinalized, setHistoryFinalized] = useState(view.cycleFinalized);
  const [historyOpenTime, setHistoryOpenTime] = useState(view.openTime);
  const [historyPriceX96, setHistoryPriceX96] = useState(view.indicativePriceX96);
  const [historyMatchedBase, setHistoryMatchedBase] = useState(view.matchedBase);
  const [buyAmount, setBuyAmount] = useState('');
  const [buyLimit, setBuyLimit] = useState('');
  const [sellAmount, setSellAmount] = useState('');
  const [sellLimit, setSellLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [left, right] = view.pool.legs;
  const tone = historyStage === STAGE_SETTLED ? 'ion' : historyStage === STAGE_REFUNDED ? 'warn' : 'muted';

  useEffect(() => {
    setSelectedCycle(view.cycleId);
    setHistoryOrders(view.orders);
    setHistoryStage(view.stage);
    setHistoryFinalized(view.cycleFinalized);
    setHistoryOpenTime(view.openTime);
    setHistoryPriceX96(view.indicativePriceX96);
    setHistoryMatchedBase(view.matchedBase);
  }, [view.cycleId, view.orders, view.stage, view.cycleFinalized, view.openTime, view.indicativePriceX96, view.matchedBase]);

  const loadCycle = async (cycle: number) => {
    if (!RPC || !Number.isInteger(cycle) || cycle <= 0 || cycle > view.cycleId) return;
    try {
      const client = createPublicClient({ transport: http(RPC) });
      const [summary, count] = await Promise.all([
        client.readContract({ address: view.auction, abi: auctionAbi, functionName: 'cycleSummary', args: [BigInt(cycle)] }),
        client.readContract({ address: view.auction, abi: auctionAbi, functionName: 'cycleOrderCount', args: [BigInt(cycle)] }),
      ]);
      const [openAt, , stage, priceX96, matchedBase, finalized] = summary;
      const ids = await Promise.all(Array.from({ length: Number(count) }, (_, index) =>
        client.readContract({ address: view.auction, abi: auctionAbi, functionName: 'cycleOrderId', args: [BigInt(cycle), index] }) as Promise<number>));
      const orders = await Promise.all(ids.map(async (id) => {
        const [order, allocation] = await Promise.all([
          client.readContract({ address: view.auction, abi: auctionAbi, functionName: 'order', args: [id] }),
          client.readContract({ address: view.auction, abi: auctionAbi, functionName: 'allocation', args: [BigInt(cycle), id] }),
        ]);
        return { id, owner: order.owner, isBuyer: order.isBuyer, amountIn: order.amountIn, limitPriceX96: order.limitPriceX96, fillBase: allocation[0], quotePayout: allocation[1], quoteRefund: allocation[2], cancelled: order.cancelled, claimed: order.claimed };
      }));
      setSelectedCycle(cycle);
      setHistoryOrders(orders);
      setHistoryStage(Number(stage));
      setHistoryFinalized(finalized);
      setHistoryOpenTime(Number(openAt));
      setHistoryPriceX96(priceX96);
      setHistoryMatchedBase(matchedBase);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read that auction cycle.'); }
  };

  const submit = async (isBuyer: boolean) => {
    if (!wallet.provider || !wallet.account) { setError('Connect your wallet first.'); return; }
    const quote = view.pool.legs.find((leg) => leg.symbol === 'USDG');
    const base = view.pool.legs.find((leg) => leg.symbol !== 'USDG');
    if (!quote || !base) { setError('Auction requires a USDG/stock pool.'); return; }
    try {
      setBusy(true); setError(''); setMessage('');
      const { publicClient, walletClient } = makeClients(wallet.provider);
      if (await publicClient.getChainId() !== 4663) throw new Error('Switch your wallet to Robinhood Chain Mainnet.');
      const amount = parseUnits(isBuyer ? buyAmount : sellAmount, isBuyer ? quote.decimals : base.decimals);
      const humanLimit18 = parseUnits(isBuyer ? buyLimit : sellLimit, 18);
      if (amount <= 0n || humanLimit18 <= 0n) throw new Error('Enter an amount and a positive USDG-per-stock limit.');
      // UI accepts human USDG per stock. Auction price is quote raw/base raw scaled by Q96.
      const limit = humanLimit18 * (1n << 96n) * (10n ** BigInt(quote.decimals))
        / (10n ** 18n * (10n ** BigInt(base.decimals)));
      if (limit <= 0n || limit > (1n << 160n) - 1n) throw new Error('The price limit is outside the supported range.');
      const input = isBuyer ? quote : base;
      const allowance = await publicClient.readContract({ address: input.address, abi: tokenAbi, functionName: 'allowance', args: [wallet.account, view.auction] });
      if (allowance < amount) {
        const approval = await walletClient.writeContract({ address: input.address, abi: tokenAbi, functionName: 'approve', args: [view.auction, amount], account: wallet.account });
        await publicClient.waitForTransactionReceipt({ hash: approval });
      }
      const sim = await publicClient.simulateContract({ address: view.auction, abi: auctionAbi, functionName: 'submitOrder', args: [isBuyer, amount, limit], account: wallet.account });
      const hash = await walletClient.writeContract(sim.request);
      await publicClient.waitForTransactionReceipt({ hash });
      setMessage(`Order confirmed: ${hash}`);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Auction order failed.');
    } finally { setBusy(false); }
  };

  const actOnOrder = async (action: 'cancelOrder' | 'claimUnfilled', id: number) => {
    if (!wallet.provider || !wallet.account) { setError('Connect your wallet first.'); return; }
    try {
      setBusy(true); setError('');
      const { publicClient, walletClient } = makeClients(wallet.provider);
      const args = action === 'cancelOrder' ? [id] as const : [BigInt(selectedCycle), id] as const;
      const sim = await publicClient.simulateContract({ address: view.auction, abi: auctionAbi, functionName: action, args, account: wallet.account } as any);
      const hash = await walletClient.writeContract(sim.request as any);
      await publicClient.waitForTransactionReceipt({ hash });
      setMessage(`Confirmed: ${hash}`); refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Auction action failed.'); }
    finally { setBusy(false); }
  };
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
          {stageText(historyStage, historyFinalized)}{selectedCycle !== view.cycleId ? ` · cycle ${selectedCycle}` : ''}
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-line pt-4">
        <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Window</dt>
          <dd className="mt-1 text-sm text-ink">{countdown(historyOpenTime, view.auctionLead, historyStage, now, historyFinalized)}</dd>
        </div>
        {selectedCycle === view.cycleId && <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Orders</dt>
          <dd className="mt-1 text-sm text-ink">{view.orderCount}</dd>
        </div>}
        {selectedCycle === view.cycleId && <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Lead · timeout</dt>
          <dd className="mt-1 text-sm text-ink">
            {Math.round(view.auctionLead / 60)} min · {Math.round(view.settleTimeout / 60)} min
          </dd>
        </div>}
        {selectedCycle === view.cycleId && <div>
          <dt className="font-mono text-[10px] uppercase text-dim">Ordinary swaps</dt>
          <dd className={`mt-1 text-sm ${view.blocksSwaps ? 'text-warn' : 'text-ink'}`}>
            {view.blocksSwaps ? 'Paused for the batch' : 'Open'}
          </dd>
        </div>}
        <div>
          <dt className="font-mono text-[10px] uppercase text-dim">{historyFinalized ? 'Final clearing' : 'Indicative clearing'}</dt>
          <dd className="mt-1 text-sm text-ink">{indicativeText({ ...view, indicativePriceX96: historyPriceX96, matchedBase: historyMatchedBase })}</dd>
        </div>
      </dl>

      {view.cycleId > 1 && <div className="mt-4 flex items-center gap-2 text-sm">
        <label htmlFor={`auction-cycle-${view.auction}`} className="font-mono text-[10px] uppercase text-dim">Cycle history</label>
        <select id={`auction-cycle-${view.auction}`} aria-label="Select auction cycle history" value={selectedCycle} onChange={(e) => void loadCycle(Number(e.target.value))} className="min-h-11 border border-line bg-bg-0 px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion">
          {Array.from({ length: Math.min(view.cycleId, 512) }, (_, index) => view.cycleId - index).map((cycle) => <option key={cycle} value={cycle}>Cycle {cycle}</option>)}
        </select>
      </div>}
      {historyOrders.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <h2 className="font-mono text-[10px] uppercase text-dim">Cycle orders</h2>
          <ul className="mt-2 space-y-2">
            {historyOrders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>#{order.id} · {order.isBuyer ? 'Buy' : 'Sell'} · {order.amountIn.toString()} raw</span>
                <span className="flex items-center gap-2">
                  {order.cancelled ? 'Cancelled' : order.claimed ? 'Claimed' : `Fill ${order.fillBase.toString()} base · refund ${order.quoteRefund.toString()} quote`}
                  {wallet.account && selectedCycle === view.cycleId && order.owner.toLowerCase() === wallet.account.toLowerCase() && !order.cancelled && !order.claimed && view.stage === STAGE_OPEN && <Button size="sm" variant="outline" disabled={busy} onClick={() => void actOnOrder('cancelOrder', order.id)}>Cancel</Button>}
                  {wallet.account && order.owner.toLowerCase() === wallet.account.toLowerCase() && !order.cancelled && !order.claimed && (historyStage === STAGE_SETTLED || historyStage === STAGE_REFUNDED) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void actOnOrder('claimUnfilled', order.id)}>Claim</Button>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedCycle === view.cycleId && view.stage === STAGE_OPEN && (
        <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <div className="space-y-2">
            <h2 className="font-mono text-[10px] uppercase text-dim">Buy with USDG</h2>
            <input aria-label="Buy amount USDG" value={buyAmount} onChange={(e) => setBuyAmount(e.target.value)} placeholder="USDG amount" className="min-h-10 w-full border border-line bg-bg-0 px-3 text-sm text-ink" />
            <input aria-label="Buy maximum USDG per stock" value={buyLimit} onChange={(e) => setBuyLimit(e.target.value)} placeholder="Maximum USDG per stock" className="min-h-10 w-full border border-line bg-bg-0 px-3 text-sm text-ink" />
            <Button size="sm" disabled={busy || !wallet.account} onClick={() => void submit(true)}>Submit buy order</Button>
          </div>
          <div className="space-y-2">
            <h2 className="font-mono text-[10px] uppercase text-dim">Sell stock</h2>
            <input aria-label="Sell amount stock" value={sellAmount} onChange={(e) => setSellAmount(e.target.value)} placeholder="Stock amount" className="min-h-10 w-full border border-line bg-bg-0 px-3 text-sm text-ink" />
            <input aria-label="Sell minimum USDG per stock" value={sellLimit} onChange={(e) => setSellLimit(e.target.value)} placeholder="Minimum USDG per stock" className="min-h-10 w-full border border-line bg-bg-0 px-3 text-sm text-ink" />
            <Button size="sm" disabled={busy || !wallet.account} onClick={() => void submit(false)}>Submit sell order</Button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 break-all text-xs text-ion" role="status">{message}</p>}
      {error && <p className="mt-3 text-xs text-down" role="alert">{error}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          href={`/pool/?hook=${view.pool.hook}`}
          className="inline-flex min-h-10 flex-1 justify-center items-center gap-2 border border-line px-3 font-mono text-[11px] uppercase text-muted transition-colors hover:border-line-strong hover:text-ink sm:flex-none"
        >
          Pool details
        </Link>
        {view.blocksSwaps ? (
          <span aria-disabled="true" title="Ordinary swaps are paused during this auction batch" className="inline-flex min-h-10 flex-1 cursor-not-allowed items-center justify-center gap-2 border border-line px-3 font-mono text-[11px] uppercase text-dim sm:flex-none">
            Swap paused for batch
          </span>
        ) : (
          <Link
            href={`/swap?hook=${view.pool.hook}`}
            className="inline-flex min-h-10 flex-1 justify-center items-center gap-2 border border-ion/40 px-3 font-mono text-[11px] uppercase text-ion transition-colors hover:bg-ion/10 sm:flex-none"
          >
            Open swap <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
    </li>
  );
}

export default function AuctionPage() {
  const wallet = useWallet();
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
        const [stage, blocksSwaps, orderCount, openTime, auctionLead, settleTimeout, cycleId] = await Promise.all([
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'currentStage' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'blocksSwaps' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'orderCount' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'openTime' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'auctionLead' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'settleTimeout' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'cycleId' }),
        ]);
        const [indicative, count, summary] = await Promise.all([
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'indicativeClearing' }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'cycleOrderCount', args: [cycleId] }),
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'cycleSummary', args: [cycleId] }),
        ]);
        const [, indicativeMatchedBase] = indicative as readonly [bigint, bigint];
        const cycleFinalized = summary[5];
        const matchedBase = cycleFinalized ? summary[4] : indicativeMatchedBase;
        const clearingPriceX96 = cycleFinalized ? summary[3] : indicative[0];
        const ids = await Promise.all(Array.from({ length: Number(count) }, (_, index) =>
          client.readContract({ address: auction, abi: auctionAbi, functionName: 'cycleOrderId', args: [cycleId, index] }) as Promise<number>));
        const rawOrders = await Promise.all(ids.map(async (id) => {
          const [o, a] = await Promise.all([
            client.readContract({ address: auction, abi: auctionAbi, functionName: 'order', args: [id] }),
            client.readContract({ address: auction, abi: auctionAbi, functionName: 'allocation', args: [cycleId, id] }),
          ]);
          return { id, order: o, allocation: a };
        }));
        next.push({
          pool,
          auction,
          stage: Number(stage),
          blocksSwaps,
          orderCount: Number(orderCount),
          openTime: Number(summary[0] || openTime),
          auctionLead: Number(auctionLead),
          settleTimeout: Number(settleTimeout),
          cycleFinalized,
          cycleId: Number(cycleId),
          indicativePriceX96: clearingPriceX96,
          matchedBase,
          orders: rawOrders.map(({ id, order, allocation }) => ({
            id, owner: order.owner, isBuyer: order.isBuyer, amountIn: order.amountIn,
            limitPriceX96: order.limitPriceX96, fillBase: allocation[0], quotePayout: allocation[1],
            quoteRefund: allocation[2], cancelled: order.cancelled, claimed: order.claimed,
          })),
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
          Eligible peer orders for a session open can match at one uniform price. One-sided or unmatched orders are
          refunded, and the AMM price itself is unchanged. Ordinary swaps pause while the batch is open.
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
            <AuctionCard key={view.auction} view={view} now={now} wallet={wallet} refresh={() => setRevision((v) => v + 1)} />
          ))}
        </ul>
      )}
    </div>
  );
}
