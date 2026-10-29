'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit/components';
import { ChevronDown, Wallet } from 'lucide-react';

/** RainbowKit owns wallet state; this custom renderer keeps BELL's touch targets and visual system. */
export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        return (
          <div aria-hidden={!ready} className="min-w-0">
            {!connected ? (
              <button type="button" onClick={openConnectModal} disabled={!ready} className="inline-flex min-h-11 w-full items-center justify-center gap-2 border border-line-strong bg-bg-1 px-3 font-mono text-[11px] uppercase tracking-[0.06em] text-ink transition-colors hover:border-ion hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion disabled:opacity-60">
                <Wallet className="h-4 w-4 text-ion" aria-hidden="true" /> Connect wallet
              </button>
            ) : chain.unsupported ? (
              <button type="button" onClick={openChainModal} className="inline-flex min-h-11 w-full items-center justify-center gap-2 border border-warn/50 bg-warn/5 px-3 font-mono text-[11px] uppercase tracking-[0.04em] text-warn hover:border-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-warn">
                Wrong network <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={openChainModal} className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 border border-line px-2 font-mono text-[10px] uppercase tracking-[0.02em] text-muted hover:border-ion hover:text-ion focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion">
                  {chain.hasIcon && chain.iconUrl ? <img src={chain.iconUrl} alt="" className="h-4 w-4 rounded-full" /> : <span className="h-2 w-2 bg-ion" />}
                  <span className="truncate">{chain.name ?? 'Network'}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
                <button type="button" onClick={openAccountModal} className="min-h-11 min-w-0 border border-line-strong bg-bg-1 px-3 font-mono text-[11px] text-ink hover:border-ion focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion">
                  <span className="block max-w-32 truncate">{account.displayName}</span>
                </button>
              </div>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
