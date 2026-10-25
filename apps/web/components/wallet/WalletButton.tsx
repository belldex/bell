'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, Eye, LogOut, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { CHAINS, isSupportedChain, shortAddress, useWallet } from '@/lib/wallet';

export function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);

  if (w.status === 'no-provider') {
    return (
      <span className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm text-muted" title="No EIP-1193 wallet detected. Browsing works read-only.">
        <Eye className="h-4 w-4" aria-hidden="true" /> Read-only
      </span>
    );
  }

  if (w.status !== 'connected' || !w.account) {
    return (
      <Button size="sm" onClick={w.connect} disabled={w.status === 'connecting'} aria-busy={w.status === 'connecting'}>
        <Wallet className="h-4 w-4" aria-hidden="true" />
        {w.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
      </Button>
    );
  }

  if (w.wrongChain) {
    return (
      <Button size="sm" variant="outline" className="border-warn/50 text-warn hover:border-warn hover:bg-warn/10" onClick={() => w.switchChain(4663)}>
        <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Switch to Robinhood Chain
      </Button>
    );
  }

  const chain = isSupportedChain(w.chainId) ? CHAINS[w.chainId] : null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="glass inline-flex h-10 items-center gap-2.5 rounded-full pl-3 pr-3.5 text-sm text-ink transition-colors hover:border-ion/40"
      >
        <span className="h-2 w-2 rounded-full bg-up shadow-[0_0_10px_var(--color-up)]" aria-hidden="true" />
        <span className="hidden text-xs text-muted sm:inline">{chain?.short}</span>
        <span className="num">{shortAddress(w.account)}</span>
        <ChevronDown className="h-4 w-4 text-dim" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="glass absolute right-0 top-12 z-50 w-56 rounded-2xl p-1.5">
          <p className="px-3 py-2 text-xs text-dim">{chain?.name}</p>
          <button role="menuitem" type="button" onClick={() => { w.disconnect(); setOpen(false); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-white/5 hover:text-ink">
            <LogOut className="h-4 w-4" aria-hidden="true" /> Disconnect (this site)
          </button>
        </div>
      )}
    </div>
  );
}
