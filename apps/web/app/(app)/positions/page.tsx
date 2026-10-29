'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronDown, CircleHelp, Coins, LifeBuoy, Minus, Plus, ShieldAlert } from 'lucide-react';
import { Button, ClassBadge, HaltBadge, PhaseBadge } from '@/components/ui/primitives';
import { TokenPair } from '@/components/ui/TokenLogo';
import { POSITIONS, getPool, type PositionPreview } from '@/lib/fixtures';
import { cn } from '@/lib/format';
import { useWallet } from '@/lib/wallet';

function PositionCard({ p }: { p: PositionPreview }) {
  const pool = getPool(p.poolId)!;
  const [mode, setMode] = useState<'none' | 'remove' | 'add'>('none');
  const [pct, setPct] = useState(50);

  return (
    <article className="glass rounded-none border border-line bg-surface/75 p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-dim">Position fixture {p.id}</p>
          <Link href={`/pool/?id=${pool.id}`} className="mt-2 inline-flex items-center gap-3 font-display text-2xl font-medium tracking-tight text-ink transition-colors hover:text-ion sm:text-3xl">
            <TokenPair symbols={pool.pair} size={32} />
            {pool.pair[0]} <span className="text-dim font-normal">/</span> {pool.pair[1]} <span className="text-sm text-dim" aria-hidden="true">↗</span>
          </Link>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <ClassBadge poolClass={pool.poolClass} />
            {pool.canSwap ? <PhaseBadge phase={pool.poolPhase} /> : <HaltBadge />}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-right">
          <div><dt className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">Range</dt><dd className="mt-1 text-sm text-ink">{p.range}</dd></div>
          <div><dt className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">Pool share</dt><dd className="num mt-1 text-sm text-ink">{p.liquidityShare}</dd></div>
        </dl>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-none border border-line bg-bg-1/70 p-4">
          <p className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">Principal (in-kind)</p>
          <p className="num mt-2 text-lg text-ink">{p.amounts[0]}</p>
          <p className="num text-lg text-ink">{p.amounts[1]}</p>
        </div>
        <div className="rounded-none border border-line bg-bg-1/70 p-4">
            <p className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">Sample accrued fees</p>
            <p className="num mt-2 text-lg text-ink">{p.feesAccrued[0]}</p>
            <p className="num text-lg text-ink">{p.feesAccrued[1]}</p>
        </div>
      </div>

      {p.note && (
        <p className="mt-4 flex items-start gap-2 rounded-none border border-ion/25 bg-ion/[0.06] px-4 py-3 text-sm text-ink/90"><LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-ion" aria-hidden="true" />{p.note}</p>
      )}

      <p className="mt-4 text-xs text-dim">Sample position only — no position NFT has been read from this wallet. {pool.poolClass === 'SESSION_ONLY' ? 'Shown in raw token units only — there is no USD NAV for this class.' : 'Valuation uses the pool reference and is labelled frozen when the stock is closed.'}</p>

      <div className="mt-5 flex flex-wrap gap-2.5">
        <Button variant="outline" size="sm" onClick={() => setMode(mode === 'add' ? 'none' : 'add')} aria-expanded={mode === 'add'} title="Show why add is unavailable"><Plus className="h-4 w-4" aria-hidden="true" /> Add info</Button>
        <Button variant="outline" size="sm" onClick={() => setMode(mode === 'remove' ? 'none' : 'remove')} aria-expanded={mode === 'remove'} title="Show exit path status"><Minus className="h-4 w-4" aria-hidden="true" /> Exit info</Button>
        <Button size="sm" disabled title="No live position NFT loaded"><Coins className="h-4 w-4" aria-hidden="true" /> Collect unavailable</Button>
        <span className="ml-auto self-center text-xs text-dim">Preview values only · no transactions sent</span>
      </div>

      {mode === 'remove' && (
        <div className="mt-5 rounded-none border border-line bg-bg-1/70 p-5">
          <p className="text-sm font-medium text-ink">In-kind exit</p>
          <p className="mt-2 text-sm text-muted">The live PositionManager reader and remove transaction are not connected. This sample card cannot estimate or submit an exit for your wallet.</p>
          <p className="mt-2 text-xs text-dim">No swap happens for a real in-kind exit; protocol guards do not gate PositionManager removal.</p>
        </div>
      )}

      {mode === 'add' && (
        <div className="mt-5 rounded-none border border-line bg-bg-1/70 p-5 text-sm text-muted">
          <p className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />Add liquidity is unavailable for preview fixtures. A live PositionManager add flow has not been wired here.</p>
        </div>
      )}
    </article>
  );
}

export default function PositionsPage() {
  const wallet = useWallet();
  const [guide, setGuide] = useState(false);
  const [positions, setPositions] = useState(POSITIONS);

  useEffect(() => {
    // No PositionManager indexer/read-by-owner path is configured yet. Keep sample
    // cards distinct and never infer ownership from fixtures, even when connected.
    setPositions(POSITIONS);
  }, [wallet.account, wallet.chainId]);

  return (
    <div>
      <header className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Your liquidity · preview</p>
        <h1 className="mt-3 max-w-[760px] font-display text-[36px] font-bold leading-[1.06] tracking-[-0.04em] text-ink sm:text-[48px]">
          Liquidity positions at a glance.
        </h1>
        <p className="mt-3 text-base text-muted">
          Position data comes from your wallet when the live PositionManager reader is available.
          Until then, fixture cards are examples and add/remove/collect actions stay disabled.
        </p>
      </header>

        <p className="mt-6 flex items-center gap-2 rounded-none border border-warn/30 bg-warn/5 px-4 py-3 font-mono text-xs text-warn">
        <CircleHelp className="h-4 w-4 shrink-0" aria-hidden="true" />
        {wallet.status === 'connected'
          ? 'No PositionManager indexer is connected yet. Cards below are fixtures, not positions from your wallet.'
          : 'Showing sample positions only. Connect a wallet to prepare for live position reads; fixture cards are never executable.'}
      </p>

      <div className="mt-8 grid gap-px border border-line bg-line md:grid-cols-2">
        {positions.map((p) => <PositionCard key={p.id} p={p} />)}
      </div>

      <section className="glass mt-8 rounded-none border border-line bg-surface/75 p-6 sm:p-7" aria-labelledby="exit-guide">
        <button type="button" onClick={() => setGuide((v) => !v)} aria-expanded={guide} aria-controls="exit-body" className="flex w-full items-center justify-between gap-4 text-left">
          <span id="exit-guide" className="flex items-center gap-3 font-display text-xl font-bold text-ink"><LifeBuoy className="h-5 w-5 text-ion" aria-hidden="true" /> Exit without this website</span>
          <ChevronDown className={cn('h-5 w-5 text-dim transition-transform', guide && 'rotate-180')} aria-hidden="true" />
        </button>
        {guide && (
          <div id="exit-body" className="mt-5 space-y-3 text-sm leading-relaxed text-muted">
            <p>If the API or this site is unavailable, you can still exit directly through the Uniswap v4 PositionManager from any tool you trust:</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Find your position’s <span className="num text-ink">tokenId</span> (the NFT in your wallet).</li>
              <li>Call <span className="num text-ink">modifyLiquidities(unlockData, deadline)</span> with <span className="num text-ink">DECREASE_LIQUIDITY</span> for your full liquidity, followed by <span className="num text-ink">TAKE_PAIR</span> to your address.</li>
              <li>BELL’s hook has no remove callbacks, so this path needs no oracle, calendar or budget.</li>
              <li>Token issuers, the chain or core can still restrict transfers — BELL cannot override those.</li>
            </ol>
            <p className="text-dim">Contract addresses will be listed in the signed deployment manifest once deployed.</p>
          </div>
        )}
      </section>
    </div>
  );
}
