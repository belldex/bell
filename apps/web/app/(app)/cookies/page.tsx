'use client';

import { useState } from 'react';

export default function CookiesPage() {
  const [saved, setSaved] = useState(false);
  return <article className="app-content-frame app-content-frame--reading"><p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">BELL · Legal</p><h1 className="mt-3 font-display text-[36px] font-bold leading-[1.06] tracking-[-0.04em] text-ink sm:text-[48px]">Cookies and local preferences</h1><p className="mt-6 text-base leading-relaxed text-muted">The landing and app may store a small local preference on this device. It is not an account, does not change onchain state, and is not used to claim a transaction happened.</p><button type="button" onClick={() => { localStorage.removeItem('bell-consent'); setSaved(true); }} className="mt-8 min-h-11 rounded-none border border-line px-4 font-mono text-xs uppercase tracking-[0.1em] text-ink transition-colors hover:border-ion hover:text-ion focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion">Clear local preference</button>{saved && <p role="status" className="mt-3 font-mono text-xs text-ion">Local preference cleared.</p>}<p className="mt-8 font-mono text-xs text-dim">Clearing local preference does not disconnect a wallet or change data on the chain.</p></article>;
}
