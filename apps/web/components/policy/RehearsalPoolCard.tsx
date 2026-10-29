'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Address } from 'viem';
import { useWallet } from '@/lib/wallet';
import { readLivePool, type LivePoolState } from '@/lib/live-swap';
import { TESTNET } from '@bell/protocol/testnet-status';
import { TokenPair } from '@/components/ui/TokenLogo';

// Public testnet evidence: evidence/deploy/testnet-pool-created.json
const REHEARSAL_HOOK = '0x42708E4001B85fcbd5e6d5e5c9Fe197CFd44aCc0' as Address;
const POOL_ID = '0xd32bb2cef93c6d9a612f362cfccc20c2549e4bf73887e6bf8cd0fb778413b82b';
const CREATE_BLOCK = 144308842;

export function RehearsalPoolCard() {
  const wallet = useWallet();
  const [pool, setPool] = useState<LivePoolState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.ethereum || wallet.status !== 'connected' || wallet.chainId !== TESTNET.chainId) {
      setPool(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await readLivePool(REHEARSAL_HOOK, window.ethereum);
      setPool(next);
    } catch (cause) {
      setPool(null);
      setError(cause instanceof Error ? cause.message : 'Could not read testnet pool policy');
    } finally {
      setLoading(false);
    }
  }, [wallet.status, wallet.chainId]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!window.ethereum) return;
    const onChain = () => void refresh();
    const onAccounts = () => void refresh();
    window.ethereum.on('chainChanged', onChain);
    window.ethereum.on('accountsChanged', onAccounts);
    return () => {
      window.ethereum?.removeListener('chainChanged', onChain);
      window.ethereum?.removeListener('accountsChanged', onAccounts);
    };
  }, [refresh]);

  const onTestnet = wallet.chainId === TESTNET.chainId;
  return (
    <article className="app-live-pool mb-9 border border-line bg-surface p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          <TokenPair symbols={['WETH', 'AAPL']} size={32} />
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-dim">Deployed testnet pool · rehearsal</p>
            <h2 className="mt-1 font-display text-2xl font-medium tracking-tight text-ink sm:text-3xl">WETH <span className="px-1 text-dim">/</span> AAPL</h2>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !onTestnet}
          className="inline-flex min-h-10 items-center border border-line-strong px-4 text-xs font-medium text-muted transition-colors hover:border-ion hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Reading…' : 'Refresh policy'}
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-line py-3 text-xs text-muted">
        <span><b className="font-medium text-ink">Live policy read</b> · values are read from the deployed hook</span>
        <span>Created at block <span className="num text-ink">{CREATE_BLOCK}</span></span>
        <span>Fixture rows below are examples, not deployed pools</span>
      </div>

      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">
            Connect a wallet to Robinhood Testnet to read the deployed policy. Browsing the preview fixtures below does not require a wallet.
      </p>

      {/* Policy values stay in a compact ledger so live state is easy to compare. */}
      <div className="mt-5 grid grid-cols-2 border-y border-line sm:grid-cols-4">
        <div className="py-4 pr-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-dim">Policy mode</p>
          <p className="mt-2 text-sm text-ink">{pool ? (pool.mode === 0 ? 'Price guarded' : 'Session only') : '—'}</p>
        </div>
        <div className="border-l border-line py-4 pl-4 sm:pl-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-dim">Onchain phase</p>
          <p className="mt-2 text-sm text-ink">{pool ? ['Unknown', 'Regular', 'Pre-market', 'Post-market', 'Overnight', 'Closed'][pool.phase] ?? `Phase ${pool.phase}` : '—'}</p>
        </div>
        <div className="border-t border-line py-4 pr-4 sm:border-l sm:border-t-0 sm:pl-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-dim">Policy decision</p>
          <p className={`mt-2 text-sm ${pool ? (pool.canSwap ? 'text-up' : 'text-down') : 'text-muted'}`}>
            {loading ? 'Reading…' : pool ? (pool.canSwap ? 'Tradable' : 'Halted') : onTestnet ? 'Not read' : 'Connect · testnet'}
          </p>
        </div>
        <div className="border-l border-line border-t border-line py-4 pl-4 sm:pl-5 sm:border-t-0">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-dim">Reason bits</p>
          <p className="num mt-2 text-sm text-ink">{pool ? pool.reasonBits.toString() : '—'}</p>
        </div>
      </div>

      {error ? <p className="mt-3 border border-down/30 p-3 text-xs text-down" role="alert">Onchain read failed: {error}</p> : null}
      {!onTestnet ? <p className="mt-3 text-xs text-muted">Connect a wallet on chain 46630 to read the deployed policy. Read-only browsing remains available.</p> : null}

      <details className="app-pool-identity mt-5">
        <summary>Contract references</summary>
        <div className="mt-3 grid gap-2 text-[10px] text-dim sm:grid-cols-2">
          <p>Hook <span className="break-all text-muted">{REHEARSAL_HOOK}</span></p>
          <p>PoolId <span className="break-all text-muted">{POOL_ID}</span></p>
        </div>
      </details>

      <Link href={`/swap/?hook=${REHEARSAL_HOOK}`} className="mt-5 inline-flex items-center gap-2 border-b border-line-strong pb-1 text-xs text-ink transition-colors hover:border-ion hover:text-ion">
        Open live policy panel <span aria-hidden="true">↗</span>
      </Link>
    </article>
  );
}
