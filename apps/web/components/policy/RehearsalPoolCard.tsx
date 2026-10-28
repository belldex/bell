'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import type { Address } from 'viem';
import { useWallet } from '@/lib/wallet';
import { readLivePool, type LivePoolState } from '@/lib/live-swap';
import { TESTNET } from '@bell/protocol/testnet-status';

// Public testnet evidence: evidence/deploy/testnet-pool-created.json
const REHEARSAL_HOOK = '0x549f0C6657d9E39a034f7524E501D218B2c6acc0' as Address;
const POOL_ID = '0xc2b56af343d2bcf1d9729517223fed8b6c2ec16f748e25a2d281c21c49e2e0ea';
const CREATE_BLOCK = 144043685;

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
    <article className="mb-8 border border-ion/30 bg-surface/80 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
            <span className="border border-ion/40 bg-ion/10 px-2 py-1 text-ion">Deployed testnet pool</span>
            <span className="border border-line px-2 py-1 text-muted">WETH / AAPL rehearsal</span>
            <span className="border border-warn/40 bg-warn/5 px-2 py-1 text-warn">Rehearsal · not production</span>
          </div>
          <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Live policy read</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Created at block {CREATE_BLOCK}. Policy values below come from the deployed hook when
            this browser wallet is connected to Robinhood Testnet; the fixture cards underneath are
            sample data, not deployed pools.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !onTestnet}
          className="inline-flex min-h-10 items-center gap-2 border border-line px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted hover:border-ion/50 hover:text-ion disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh policy
        </button>
      </div>

      <div className="mt-5 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-bg-0 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">Policy mode</p>
          <p className="mt-2 font-mono text-sm text-ink">{pool ? (pool.mode === 0 ? 'PRICE_GUARDED' : 'SESSION_ONLY') : '—'}</p>
        </div>
        <div className="bg-bg-0 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">Onchain phase</p>
          <p className="mt-2 font-mono text-sm text-ink">{pool ? ['UNKNOWN', 'REGULAR', 'PRE', 'POST', 'OVERNIGHT', 'CLOSED'][pool.phase] ?? `Phase ${pool.phase}` : '—'}</p>
        </div>
        <div className="bg-bg-0 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">Policy decision</p>
          <p className={`mt-2 font-mono text-sm ${pool ? (pool.canSwap ? 'text-up' : 'text-down') : 'text-muted'}`}>
            {loading ? 'READING…' : pool ? (pool.canSwap ? 'TRADABLE' : 'HALTED') : onTestnet ? 'NOT READ' : 'CONNECT · TESTNET'}
          </p>
        </div>
        <div className="bg-bg-0 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">Reason bits</p>
          <p className="mt-2 font-mono text-sm text-ink">{pool ? pool.reasonBits.toString() : '—'}</p>
        </div>
      </div>

      {error ? <p className="mt-3 border border-down/30 bg-down/5 p-3 font-mono text-xs text-down" role="alert">Onchain read failed: {error}</p> : null}
      {!onTestnet ? <p className="mt-3 font-mono text-xs text-muted">Connect a wallet on chain 46630 to read the deployed policy. Read-only browsing remains available.</p> : null}

      <div className="mt-4 grid gap-2 font-mono text-[10px] text-dim sm:grid-cols-2">
        <p>Hook <span className="break-all text-muted">{REHEARSAL_HOOK}</span></p>
        <p>PoolId <span className="break-all text-muted">{POOL_ID}</span></p>
      </div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Preview fixture rows below · not onchain records</p>
      <Link href={`/swap/?hook=${REHEARSAL_HOOK}`} className="mt-4 inline-flex items-center gap-1 border-b border-current pb-0.5 font-mono text-xs text-ion">
        Open swap policy panel <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
      </Link>
    </article>
  );
}
