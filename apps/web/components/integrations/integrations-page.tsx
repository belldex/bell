'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { KEEPER_URL, EXPLORER, CONTRACT_GROUPS } from '@/config/mainnet';
import verification from '@/content/mainnet-verification.json';
import lensMap from '@/content/mainnet-pool-lenses.json';
import { LandingEffects } from '@/components/landing/gyevo/landing-effects';
import { LandingNav, LANDING_SECTIONS } from '@/components/landing/gyevo/landing-nav';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/proof/proof.css';
import './integrations.css';

type LivePool = {
  poolId: string;
  hook: string;
  token0: string;
  token1: string;
  legs?: Array<{ address: string; symbol: string; decimals: number }>;
  poolClass?: number;
  hasAuction?: boolean | null;
  auction?: string | null;
  lens?: string | null;
  policy?: { phase?: number; lpFeeUnits?: number; canSwap?: boolean };
};
type PoolDirectory = { chainId: number; blockNumber: string; observedAt?: string; pools: LivePool[] };

const REASONS = [
  ['AuctionActive', 'The bound opening auction is collecting orders or locked for settlement.'],
  ['PolicyBlocked', 'The policy or one of its required onchain dependencies blocks this swap.'],
  ['TradeCapExceeded', 'The exact input exceeds the remaining per-trade gross budget.'],
  ['WindowCapExceeded', 'The rolling gross flow budget is exhausted.'],
];

export function IntegrationsPage() {
  const [directory, setDirectory] = useState<PoolDirectory | null>(null);
  const [auctions, setAuctions] = useState<Record<string, any>>({});
  const [auctionsLoaded, setAuctionsLoaded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const feeEvents = useMemo(() => verification.pools.flatMap((pool) =>
    (pool.latestSwapBySession ?? []).map((swap) => ({ ...swap, poolId: pool.poolId }))), []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    setError('');
    setAuctionsLoaded(false);
    try {
      const response = await fetch(`${KEEPER_URL}/pools`, { cache: 'no-store', signal });
      const body = await response.json();
      if (!response.ok || Number(body.chainId) !== 4663 || !Array.isArray(body.pools)) {
        throw new Error(body?.error ?? 'Pool directory returned an invalid Mainnet response');
      }
      setDirectory(body as PoolDirectory);
      const ids = body.pools.map((pool: LivePool) => pool.poolId).filter(Boolean);
      if (ids.length) {
        const auctionResponse = await fetch(`${KEEPER_URL}/auctions?pools=${ids.join(',')}`, { cache: 'no-store', signal });
        const auctionBody = await auctionResponse.json();
        if (auctionResponse.ok) { setAuctions(auctionBody.auctions ?? {}); setAuctionsLoaded(true); }
      }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Live integration data is unavailable.');
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, revision]);

  return <div className="lp lp--bell legal proof integrations" data-phase="dark">
    <a className="lp-skip" href="#main">Skip to content</a>
    <LandingNav appName="BELL" sections={LANDING_SECTIONS} base="/" />
    <main id="main" className="legal__main">
      <header className="legal__head lp-wrap">
        <p className="lp-eyebrow">Protocol integration pack · chain 4663</p>
        <h1 className="legal__title proof__title">Build against BELL. <em>Verify every route.</em></h1>
        <p className="legal__lead">A live directory, session-fee receipts, auction status, and deployed contracts. Per-pool Lens preflight is planned and becomes available only after its Lens is deployed and registered.</p>
        <p className="legal__date">{directory ? `Observed at block ${directory.blockNumber}` : 'Live snapshot not loaded'} · {directory?.observedAt ?? 'Refresh to read the current directory'}</p>
      </header>

      <div className="legal__grid lp-wrap">
        <nav className="legal__toc" aria-label="Integration pack sections"><p>In this pack</p><ol>
          <li><a href="#directory"><span>01</span>Live pools</a></li>
          <li><a href="#quote"><span>02</span>Preflight a route</a></li>
          <li><a href="#fees"><span>03</span>Session fees</a></li>
          <li><a href="#auction"><span>04</span>Opening auction</a></li>
          <li><a href="#errors"><span>05</span>Errors and contracts</a></li>
        </ol></nav>

        <div className="legal__body">
          <section id="directory" className="integrations__section" aria-labelledby="directory-title">
            <div className="integrations__section-head"><div><p className="lp-eyebrow">Live factory directory</p><h2 id="directory-title">Pools on Robinhood Chain</h2></div><button type="button" onClick={() => setRevision((value) => value + 1)} disabled={busy} className="integrations__refresh"><RefreshCw size={14} className={busy ? 'integrations__spin' : ''} aria-hidden="true" /> Refresh</button></div>
            {error && <p className="integrations__error" role="alert">Live pool directory unavailable: {error}</p>}
            {busy && !directory && <p className="pf-dim">Reading the live pool directory…</p>}
            {directory?.pools.length === 0 && <p className="pf-dim">The factory has no pools in this snapshot.</p>}
            <div className="pf-scroll"><table className="legal__table pf-table verify__table"><thead><tr><th>Pool ID</th><th>Tokens</th><th>Hook</th><th>Auction</th><th>Lens</th><th>Details</th></tr></thead>
              <tbody>{directory?.pools.map((pool) => {
                const auction = auctions[pool.poolId];
                const pair = pool.legs?.map((leg) => leg.symbol).join(' / ') ?? `${pool.token0.slice(0, 8)}… / ${pool.token1.slice(0, 8)}…`;
                return <tr key={pool.poolId}>
                  <td><code>{pool.poolId.slice(0, 12)}…</code></td><td>{pair}</td>
                  <td><a href={`${EXPLORER}/address/${pool.hook}`} target="_blank" rel="noreferrer">{pool.hook.slice(0, 8)}…</a></td>
                  <td>{auction?.address ? <a href={`${EXPLORER}/address/${auction.address}`} target="_blank" rel="noreferrer">LIVE · {auction.stageLabel ?? `stage ${auction.stage}`}</a> : auctionsLoaded ? 'No auction bound' : pool.hasAuction === true ? 'Bound · details unavailable' : 'Unavailable'}</td>
                  <td>{pool.lens ? <a href={`${EXPLORER}/address/${pool.lens}`} target="_blank" rel="noreferrer">DEPLOYED</a> : 'PLANNED'}</td>
                  <td><Link href={lensMap.pools.some((entry) => entry.poolId.toLowerCase() === pool.poolId.toLowerCase()) ? `/pool/${pool.poolId}/` : `/pool/?id=${pool.poolId}`}>Verify pool <ArrowUpRight size={12} /></Link></td>
                </tr>;
              })}</tbody>
            </table></div>
            <p className="pf-source">Live JSON endpoint: <a href={`${KEEPER_URL}/pools`} target="_blank" rel="noreferrer">{KEEPER_URL}/pools <ArrowUpRight size={12} /></a></p>
          </section>

          <section id="quote" className="integrations__section" aria-labelledby="quote-title">
            <p className="lp-eyebrow">Before routing</p><h2 id="quote-title">Ask the Lens about the exact input</h2>
            <p className="integrations__error">Lens deployment is pending. The status endpoint cannot provide a live preflight for a pool until its Lens is registered.</p>
            <p>Call <code>BellSwapLens.getSwapStatus(poolId, zeroForOne, amountIn)</code> before routing. `amountIn` is the raw integer token amount. Route only when <code>allowed</code> is true; display <code>reason</code>, the current fee, and both token budgets when it is not.</p>
            <pre className="integrations__code"><code>{`GET ${KEEPER_URL}/pools/<poolId>/status?zeroForOne=true&amountIn=<raw-uint256>`}</code></pre>
            <p>The Worker pins the read to one observed block and returns the Lens address, hook flags, auction binding, current session, fee, remaining gross budgets, and next transition. It does not sign, approve, or submit a swap.</p>
          </section>

          <section id="fees" className="integrations__section" aria-labelledby="fees-title">
            <p className="lp-eyebrow">Observed evidence · block {verification.observedBlock}</p><h2 id="fees-title">Session fees from Swap events</h2>
            <p>Every row is an actual PoolManager <code>Swap</code> event linked to its transaction. Empty sessions remain empty; no fee sample is synthesized.</p>
            {feeEvents.length ? <div className="pf-scroll"><table className="legal__table pf-table verify__table"><thead><tr><th>Pool</th><th>Session at event</th><th>Fee · pips</th><th>Block</th><th>Receipt</th></tr></thead><tbody>
              {feeEvents.map((row) => <tr key={`${row.poolId}-${row.tx}`}><td><code>{row.poolId.slice(0, 12)}…</code></td><td>{row.session}</td><td>{row.fee}</td><td>{row.blockNumber}</td><td><a href={row.explorer} target="_blank" rel="noreferrer">Open Swap <ArrowUpRight size={12} /></a></td></tr>)}
            </tbody></table></div> : <p className="integrations__error">No successful Swap fee event is recorded in this snapshot.</p>}
            <p className="pf-source">Snapshot time: {verification.observedAt} UTC. Refresh with <code>pnpm verify:bell</code>.</p>
          </section>

          <section id="auction" className="integrations__section" aria-labelledby="auction-title">
            <p className="lp-eyebrow">Opening Bell · live registry</p><h2 id="auction-title">Auction windows and state</h2>
            <p>Only pools with a nonzero auction registry binding use the P2P opening auction. The live <code>/auctions</code> response reports its stage, open time, lead, and settlement deadline. Ordinary AMM swaps are blocked only while the contract reports that the auction blocks swaps.</p>
            <ul className="integrations__plain-list">{directory?.pools.map((pool) => {
              const auction = auctions[pool.poolId];
              return <li key={pool.poolId}><code>{pool.poolId.slice(0, 12)}…</code><span>{auction?.address ? `Auction ${auction.address} · stage ${auction.stage} · ${auction.blocksSwaps ? 'swaps blocked' : 'swaps open'}` : auctionsLoaded ? 'No auction binding' : 'Auction status unavailable'}</span></li>;
            })}</ul>
            <p className="pf-source">Live auction data: <a href={`${KEEPER_URL}/auctions?pools=${directory?.pools.map((pool) => pool.poolId).join(',') ?? ''}`} target="_blank" rel="noreferrer">Worker JSON <ArrowUpRight size={12} /></a></p>
          </section>

          <section id="errors" className="integrations__section" aria-labelledby="errors-title">
            <p className="lp-eyebrow">Source and behavior</p><h2 id="errors-title">Custom errors and deployed contracts</h2>
            <ul className="integrations__errors">{REASONS.map(([name, meaning]) => <li key={name}><code>{name}</code><span>{meaning}</span></li>)}</ul>
            <ul className="integrations__contracts">{CONTRACT_GROUPS.flatMap((group) => group.rows).map((contract) => <li key={contract.address}><span>{contract.name}</span><a href={`${EXPLORER}/address/${contract.address}${contract.verified ? '?tab=contract' : ''}`} target="_blank" rel="noreferrer">{contract.verified ? 'LIVE · source match' : 'LIVE · source status unverified'} <ArrowUpRight size={12} /></a></li>)}</ul>
            <div className="integrations__footer"><Link href="/verify/">Four-step pool verification <ArrowUpRight size={13} /></Link><a href="/integrations/integration-pack.md" target="_blank" rel="noreferrer">Markdown integration pack <ArrowUpRight size={13} /></a><a href="/integrations/bell-integration-pack.pdf" target="_blank" rel="noreferrer">PDF integration pack <ArrowUpRight size={13} /></a></div>
            {error && <span className="pf-badge" data-pass="0">Live data unavailable</span>}
          </section>
        </div>
      </div>
    </main>
    <footer className="legal__foot"><div className="lp-wrap"><p>BELL is an independent protocol. Integrators must read the deployed contract and current Worker response before routing.</p><nav aria-label="Related"><Link href="/verify/">Verify</Link><Link href="/proof/">Proof</Link><Link href="/pools/">Pools</Link><Link href="/">Home</Link></nav></div></footer>
    <LandingEffects />
  </div>;
}
