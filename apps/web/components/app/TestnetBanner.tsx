'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ExternalLink,
  ShieldAlert,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useTestnet } from '@/lib/use-testnet';
import { shortAddress } from '@/lib/wallet';

const EXPLORER_BASE = 'https://robinhood-testnet.explorer.alchemy.com/address/';

export function TestnetBanner() {
  const { isTestnet, status, loading, error, refresh, contracts } = useTestnet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const copy = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(addr);
      setCopyError(null);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopyError('Clipboard access is unavailable; copy the address from the explorer link instead.');
    }
  };

  if (!isTestnet) {
    return (
      <div className="relative z-10 border-b border-line bg-bg-1/80 px-4 py-2 text-center text-xs text-muted backdrop-blur">
        <span className="mr-2 rounded bg-ion/15 px-1.5 py-0.5 font-semibold uppercase tracking-[0.12em] text-ion">
          Testnet Live
        </span>
        Robinhood Testnet (Chain 46630) deployed · Connect wallet on Testnet to verify live contracts
      </div>
    );
  }

  return (
    <div className="relative z-20 border-b border-ion/30 bg-ion/10 text-xs text-ink backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ion/20 px-2.5 py-0.5 font-semibold text-ion">
            <span className="h-2 w-2 rounded-full bg-ion animate-pulse" aria-hidden="true" />
            Robinhood Testnet 46630
          </span>
          {loading ? (
            <span className="inline-flex items-center gap-1 text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Querying block-pinned state…
            </span>
          ) : status ? (
            <span className="text-muted">
              Block <span className="num font-medium text-ink">#{status.blockNumber}</span> · 10 contracts verified
            </span>
          ) : error ? (
            <span className="inline-flex items-center gap-1 text-warn">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              {error}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-bg-1/80 text-muted hover:text-ink disabled:opacity-50"
            title="Refresh onchain state"
            aria-label="Refresh onchain state"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-full border border-ion/40 bg-ion/15 px-3 py-1 font-medium text-ion transition-colors hover:bg-ion/25"
          >
            <span>Verified Contracts</span>
            {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line/60 bg-bg-0/95 px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-ink">Deployed Protocol Manifest (Chain 46630)</h3>
              {status?.issues?.includes('UNUSABLE_ROLE_ADDRESS') && (
                <span className="inline-flex items-center gap-1 rounded bg-warn/15 px-2 py-0.5 text-[0.7rem] text-warn">
                  <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                  Treasury currently bound to burn address (rehearsal only)
                </span>
              )}
            </div>

            <p role="status" className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
              Testnet rehearsal only. No eligible stock descriptor/report/calendar is active yet, and BellHook swap execution remains fail-closed. Pool creation and swaps are not advertised as ready.
            </p>
            {copyError && <p role="alert" className="mb-3 text-xs text-warn">{copyError}</p>}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(contracts).map(([name, address]) => {
                const isCopied = copied === address;
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg-1/60 p-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-ink capitalize">{name.replace(/([A-Z])/g, ' $1').trim()}</p>
                      <p className="font-mono text-muted text-[0.7rem]">{shortAddress(address)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => copy(address)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-white/10 hover:text-ink"
                        title="Copy address"
                        aria-label={`Copy ${name} address`}
                      >
                        {isCopied ? <Check className="h-3.5 w-3.5 text-ion" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <a
                        href={`${EXPLORER_BASE}${address}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-white/10 hover:text-ink"
                        title="View on explorer"
                        aria-label={`View ${name} on block explorer`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>

            {status?.wallet && (
              <div className="mt-4 rounded-xl border border-line bg-bg-1/40 p-3">
                <p className="mb-2 font-semibold text-ink">Connected Wallet Balances (Testnet)</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                  <div>
                    <span className="text-muted block">Native ETH:</span>
                    <span className="num font-medium text-ink">
                      {(Number(BigInt(status.wallet.nativeRaw)) / 1e18).toFixed(4)} ETH
                    </span>
                  </div>
                  <div>
                    <span className="text-muted block">Wrapped ETH (WETH):</span>
                    <span className="num font-medium text-ink">
                      {(Number(BigInt(status.wallet.wethRaw)) / 1e18).toFixed(4)} WETH
                    </span>
                  </div>
                  <div>
                    <span className="text-muted block">mBELL Fee Token:</span>
                    <span className="num font-medium text-ink">
                      {(Number(BigInt(status.wallet.feeTokenRaw)) / 1e6).toFixed(2)} mBELL
                    </span>
                  </div>
                  <div>
                    <span className="text-muted block">Router Nonce:</span>
                    <span className="num font-medium text-ink">#{status.wallet.routerNonce}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
