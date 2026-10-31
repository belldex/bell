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

type FeedStatus = { chainId: number; status: string; assets: Record<string, AssetStatus> };

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
        if (active) { setFeedStatus(body as FeedStatus); setUnavailable(false); }
      } catch {
        if (active) setUnavailable(true);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const assets = feedStatus?.assets ? Object.entries(feedStatus.assets).sort(([a], [b]) => a.localeCompare(b)) : [];
  const attentionCount = assets.filter(([, item]) => item.session === 'CLOSED' ? item.anchorValid !== true : item.sessionFeedFresh !== true).length;
  const summary = unavailable
    ? 'Status unavailable'
    : !feedStatus
      ? 'Checking feeds'
      : attentionCount > 0
        ? `${attentionCount} ${attentionCount === 1 ? 'feed update' : 'feed updates'} unavailable`
        : 'Feeds current';
  const state = unavailable || attentionCount > 0 ? 'attention' : feedStatus ? 'ready' : 'pending';

  return (
    <details className="app-session-feeds" aria-live="polite">
      <summary data-state={state}><span>Chainlink feeds</span><strong>{summary}</strong></summary>
      <div className="app-session-feeds__panel">
        {unavailable && <p>Live feed status is temporarily unavailable. Each pool still enforces its own onchain policy.</p>}
        {!feedStatus && !unavailable && <p>Reading the current session and feed freshness…</p>}
        {assets.length > 0 && <ul>
          {assets.map(([symbol, item]) => {
            const age = item.feedAgeSeconds === null ? '' : `${item.feedAgeSeconds}s / ${item.freshnessLimitSeconds ?? 120}s`;
            const outsideFeedWindow = item.session === 'CLOSED';
            const displaySession = outsideFeedWindow ? 'Off-hours' : item.session;
            const detail = outsideFeedWindow
              ? item.anchorValid ? 'reference available' : 'AMM fallback · SESSION_ONLY is independent of feed'
              : item.sessionFeedFresh ? `fresh · ${age}` : `stale · ${age || 'no recent round'} · PRICE_GUARDED may use AMM fallback; SESSION_ONLY ignores feed age`;
            const feedUnavailable = outsideFeedWindow ? item.anchorValid !== true : item.sessionFeedFresh !== true;
            return <li key={symbol} data-state={feedUnavailable ? 'attention' : 'ready'}><span>{symbol}</span><span>{displaySession}</span><strong>{detail}</strong></li>;
          })}
        </ul>}
      </div>
    </details>
  );
}
