'use client';

import { useEffect, useState } from 'react';
import { MAINNET } from '@/lib/mainnet-live';

type AssetStatus = {
  session: string;
  status: string;
  sessionFeedFresh: boolean | null;
  feedAgeSeconds: number | null;
  freshnessLimitSeconds?: number;
  anchorValid?: boolean;
};

type FeedStatus = {
  chainId: number;
  status: string;
  assets: Record<string, AssetStatus>;
};

export function MainnetSessionFeedStatus() {
  const [feedStatus, setFeedStatus] = useState<FeedStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    const endpoint = MAINNET.quoteUrl.replace(/\/quote$/, '/status');
    const refresh = async () => {
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok || Number(body.chainId) !== MAINNET.chainId || !body.assets) throw new Error('invalid status response');
        if (active) {
          setFeedStatus(body as FeedStatus);
          setUnavailable(false);
        }
      } catch {
        if (active) setUnavailable(true);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const assets = feedStatus?.assets ? Object.entries(feedStatus.assets).sort(([a], [b]) => a.localeCompare(b)) : [];
  return (
    <div className="mt-3 border border-line/70 bg-surface/30 px-3 py-2" aria-live="polite" aria-label="Live Chainlink session feed status">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-dim">Live Mainnet session feeds · refreshes every 30s</p>
      {unavailable && <p className="mt-1 text-[11px] text-muted">Live feed status is temporarily unavailable. Trading remains gated by onchain checks.</p>}
      {!feedStatus && !unavailable && <p className="mt-1 text-[11px] text-muted">Reading current session and feed freshness…</p>}
      {assets.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {assets.map(([symbol, item]) => {
            const feedAge = item.feedAgeSeconds === null
              ? ''
              : ` · last feed ${item.feedAgeSeconds}s old / ${item.freshnessLimitSeconds ?? 120}s gate`;
            const detail = item.session === 'CLOSED'
              ? `close anchor ${item.anchorValid ? 'valid' : 'missing'}${feedAge}`
              : item.sessionFeedFresh
                ? `fresh · ${item.feedAgeSeconds}s / ${item.freshnessLimitSeconds ?? 120}s`
                : `stale · ${item.feedAgeSeconds ?? '—'}s / ${item.freshnessLimitSeconds ?? 120}s`;
            return (
              <li key={symbol} className="font-mono text-[10px] text-muted">
                <span className="text-ink">{symbol}</span> {item.session} · {detail}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
