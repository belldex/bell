'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { parseUnits } from 'viem';
import { AlertTriangle, ArrowDownUp, ChevronDown, Info, RefreshCw, Timer } from 'lucide-react';
import { Button, ClassBadge, PhaseBadge } from '@/components/ui/primitives';
import { BudgetBar } from '@/components/policy/BudgetBar';
import { POOLS, getPool, type CurrencyBudget, type PoolPolicy } from '@/lib/fixtures';
import { cn, formatRaw, remaining } from '@/lib/format';
import { effectiveLimits, feePercent, type MarketPhase } from '@/lib/policy';
import { useWallet } from '@/lib/wallet';
import { LiveSwapPanel } from '@/components/swap/LiveSwapPanel';

/** Preview pricing only: 1 stock = price counter units. Not a market quote. */
const RATE: Record<string, { stock: string; price: number }> = {
  'usdg-aapl': { stock: 'AAPL', price: 215.4 },
  'weth-tsla': { stock: 'TSLA', price: 0.0745 },
  'meme-nvda': { stock: 'NVDA', price: 238_000 },
  'nvda-amzn': { stock: 'AMZN', price: 0.9 },
  'usdg-msft': { stock: 'MSFT', price: 421.1 },
  'pons-pltr': { stock: 'PLTR', price: 155_000 },
};

const QUOTE_TTL = 30;

function fmt(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return n.toLocaleString('en-US', { maximumFractionDigits: d });
}

function toRaw(amount: number, decimals: number): bigint {
  if (!(amount > 0) || !isFinite(amount)) return 0n;
  const s = amount.toFixed(Math.min(decimals, 12));
  return parseUnits(s, decimals);
}

interface Quote {
  amountIn: number;
  amountOut: number;
  minOut: number;
  maxIn: number;
  feeAmount: number;
  impactBps: number;
  canExecute: boolean;
  reasons: string[];
  stamp: number;
  key: string;
}

function SwapInner() {
  const params = useSearchParams();
  const wallet = useWallet();
  const swappable = POOLS.filter((p) => p.canSwap);
  const initial = getPool(params.get('pool')) ?? getPool('weth-tsla') ?? swappable[0];
  const [poolId, setPoolId] = useState(initial.id);
  const pool = getPool(poolId) as PoolPolicy;

  const [flip, setFlip] = useState(false);
  const [mode, setMode] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('100');
  const [slip, setSlip] = useState(0.5);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const rate = RATE[pool.id];
  const inB: CurrencyBudget = pool.budgets[flip ? 1 : 0];
  const outB: CurrencyBudget = pool.budgets[flip ? 0 : 1];
  const sellsStock = inB.symbol === rate.stock;
  const px = sellsStock ? rate.price : 1 / rate.price; // out per 1 in (pre-fee)
  const phase = (pool.poolPhase === 'HALTED' ? null : pool.poolPhase) as MarketPhase | null;

  const key = `${pool.id}|${flip}|${mode}|${amount}|${slip}`;

  const compute = useCallback((): Quote => {
    const a = parseFloat(amount);
    const f = pool.effectiveFeeUnits / 1_000_000; // v4 units: 1_000_000 = 100%, 500 = 0.05%
    let amountIn = 0;
    let amountOut = 0;
    if (a > 0) {
      if (mode === 'in') {
        amountIn = a;
        amountOut = a * (1 - f) * px;
      } else {
        amountOut = a;
        amountIn = a / ((1 - f) * px);
      }
    }
    const reasons: string[] = [];
    const lim = phase ? effectiveLimits(phase, BigInt(inB.perTrade), BigInt(inB.rolling)) : null;
    const rawIn = toRaw(amountIn, inB.decimals);
    const rawOutAbs = toRaw(amountOut, outB.decimals);
    const limOut = phase ? effectiveLimits(phase, BigInt(outB.perTrade), BigInt(outB.rolling)) : null;
    if (!(a > 0)) reasons.push('Enter an amount');
    if (!lim || !limOut) reasons.push('Pool is halted');
    else {
      if (rawIn > lim.perTrade) reasons.push(`Exceeds per-trade limit on ${inB.symbol}: ${formatRaw(String(lim.perTrade), inB.decimals)}`);
      if (rawOutAbs > limOut.perTrade) reasons.push(`Exceeds per-trade limit on ${outB.symbol}: ${formatRaw(String(limOut.perTrade), outB.decimals)}`);
      if (rawIn > BigInt(remaining(inB.rollingUsed, String(lim.rolling)))) reasons.push(`Rolling budget on ${inB.symbol} too low right now`);
      if (rawOutAbs > BigInt(remaining(outB.rollingUsed, String(limOut.rolling)))) reasons.push(`Rolling budget on ${outB.symbol} too low right now`);
      if (pool.poolPhase === 'CLOSED') {
        if (rawIn > BigInt(remaining(inB.closureUsed, inB.closure))) reasons.push(`Closure budget on ${inB.symbol} would be exceeded`);
        if (rawOutAbs > BigInt(remaining(outB.closureUsed, outB.closure))) reasons.push(`Closure budget on ${outB.symbol} would be exceeded`);
      }
    }
    const frac = lim && lim.perTrade > 0n ? Number((rawIn * 10_000n) / lim.perTrade) / 10_000 : 0;
    const impactBps = Math.round(2 + frac * 28);
    const slipF = slip / 100;
    return {
      amountIn,
      amountOut,
      minOut: amountOut * (1 - slipF),
      maxIn: amountIn * (1 + slipF),
      feeAmount: amountIn * f,
      impactBps,
      canExecute: reasons.length === 0,
      reasons,
      stamp: Date.now(),
      key,
    };
  }, [amount, mode, px, pool, phase, inB, outB, slip, key]);

  // invalidate quote on any change in inputs/state; auto-quote after typing
  useEffect(() => {
    const id = window.setTimeout(() => setQuote(compute()), 250);
    return () => window.clearTimeout(id);
  }, [compute]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const age = quote ? (now - quote.stamp) / 1000 : 0;
  const expired = !!quote && age >= QUOTE_TTL;
  const stale = !!quote && quote.key !== key;
  const left = Math.max(0, QUOTE_TTL - age);

  const cta = (() => {
    if (wallet.wrongChain) return { label: 'Switch network', action: () => wallet.switchChain(46630), disabled: false };
    if (wallet.status !== 'connected') return { label: 'Connect wallet', action: undefined, disabled: true };
    if (!quote || stale) return { label: 'Fetching quote…', action: undefined, disabled: true };
    if (expired) return { label: 'Quote expired — re-quote', action: () => setQuote(compute()), disabled: false };
    if (!quote.canExecute) return { label: quote.reasons[0] ?? 'Cannot execute', action: undefined, disabled: true };
    return { label: 'No executable fixture quote — open live policy panel below', action: undefined, disabled: true };
  })();

  const lim = phase ? effectiveLimits(phase, BigInt(inB.perTrade), BigInt(inB.rolling)) : null;

    return (
      <div className="mx-auto max-w-[1440px]">
      <header className="mb-8 max-w-[760px] border-b border-line pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Swap · Policy preview</p>
        <h1 id="swap-title" className="mt-3 font-display text-[36px] font-bold leading-[1.06] tracking-[-0.04em] text-ink sm:text-[48px]">Review the policy before you sign.</h1>
        <p className="mt-4 max-w-[620px] text-sm leading-relaxed text-muted">Fixture quotes are for UI review only. They are not live prices or executable quotes. A separate panel below reads the deployed testnet hook policy.</p>
      </header>
      <div className="mb-6 flex flex-wrap items-center gap-2 border border-warn/30 bg-warn/5 px-4 py-3 font-mono text-[11px] text-warn">
        <span className="font-semibold uppercase tracking-[0.1em]">Preview only</span>
        <span className="text-muted">These fixture amounts and quotes do not reach the router.</span>
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-2">
      {/* Preview form — never submits; the live policy panel is a separate onchain reader. */}
      <section aria-label="Preview swap inputs" className="glass rounded-none border border-line bg-surface/75 p-6 sm:p-7">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-dim">Preview inputs</h2>
          <span className="rounded-none border border-warn/40 bg-warn/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-warn">Fixture · no tx sent</span>
        </div>

        <div className="mt-5">
          <label htmlFor="pool-select" className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Pool fixture</label>
          <div className="relative mt-2">
            <select id="pool-select" value={poolId} onChange={(e) => setPoolId(e.target.value)} className="h-12 w-full appearance-none rounded-none border border-line bg-bg-1 px-4 pr-10 text-ink outline-none transition-colors focus:border-ion/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion">
              {swappable.map((p) => <option key={p.id} value={p.id}>{p.pair.join(' / ')} · {p.poolClass === 'PRICE_GUARDED' ? 'Price guarded' : 'Session only'}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" aria-hidden="true" />
          </div>
        </div>

        <div className="mt-4 inline-flex rounded-none border border-line bg-bg-1/70 p-1" role="radiogroup" aria-label="Amount type">
          {(['in', 'out'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn('min-h-10 rounded-none px-4 font-mono text-[11px] uppercase tracking-[0.08em]', mode === m ? 'bg-ion/15 text-ion' : 'text-muted hover:text-ink')}>
              {m === 'in' ? 'Exact input' : 'Exact output'}
            </button>
          ))}
        </div>

        <div className="relative mt-4 space-y-2">
          <TokenRow label={mode === 'in' ? 'You pay' : 'You pay (estimated)'} symbol={inB.symbol} editable={mode === 'in'} value={mode === 'in' ? amount : quote ? fmt(quote.amountIn) : ''} onChange={setAmount} />
          <button type="button" onClick={() => setFlip((v) => !v)} aria-label="Swap direction" className="absolute left-1/2 top-1/2 z-10 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-bg-0 text-ion transition-transform hover:rotate-180">
            <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <TokenRow label={mode === 'out' ? 'You receive' : 'You receive (estimated)'} symbol={outB.symbol} editable={mode === 'out'} value={mode === 'out' ? amount : quote ? fmt(quote.amountOut) : ''} onChange={setAmount} />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="text-[0.7rem] uppercase tracking-[0.16em] text-dim">Max slippage</legend>
            <div className="mt-2 flex gap-1.5">
              {[0.1, 0.5, 1].map((s) => (
                <button key={s} type="button" aria-pressed={slip === s} onClick={() => setSlip(s)} className={cn('num min-h-10 flex-1 rounded-xl border text-sm', slip === s ? 'border-ion/60 bg-ion/10 text-ion' : 'border-line text-muted hover:text-ink')}>{s}%</button>
              ))}
            </div>
          </fieldset>
          <p className="flex items-center border border-line px-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Preview only · tx deadline not applicable</p>
        </div>

        {quote && !quote.canExecute && quote.reasons[0] !== 'Enter an amount' && (
          <ul role="alert" className="mt-5 space-y-1.5 rounded-none border border-down/30 bg-down/10 p-4 text-sm text-down">
            {quote.reasons.map((r) => <li key={r} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{r}</li>)}
          </ul>
        )}

        <Button size="lg" className="mt-5 w-full" disabled={cta.disabled} onClick={cta.action}>
          {cta.label}
        </Button>
      </section>

      {/* Disclosure + quote */}
      <aside className="space-y-5" aria-label="Fixture quote and disclosures">
          <div className="glass rounded-none border border-line bg-surface/75 p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-dim">Before you sign</h2>
            <div className="flex items-center gap-2">
              <ClassBadge poolClass={pool.poolClass} />
              <PhaseBadge phase={pool.poolPhase} />
            </div>
          </div>

          {pool.poolClass === 'SESSION_ONLY' && (
            <p className="mt-4 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm font-medium text-warn">Session controls only; no independent price protection for the counterasset.</p>
          )}

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <Row label="Pool fee" value={feePercent(pool.effectiveFeeUnits)} sub={quote ? `${fmt(quote.feeAmount)} ${inB.symbol}` : undefined} />
            <Row label="Price impact" value={quote ? `${(quote.impactBps / 100).toFixed(2)}%` : '—'} sub="estimated" />
            <Row label={mode === 'in' ? 'Min received' : 'Max paid'} value={quote ? `${fmt(mode === 'in' ? quote.minOut : quote.maxIn)} ${mode === 'in' ? outB.symbol : inB.symbol}` : '—'} sub={`slippage ${slip}%`} />
            <Row label="Data source" value={pool.legs.map((l) => `${l.symbol} ${l.source === 'FROZEN' ? 'frozen' : l.source === 'LIVE' ? 'live' : 'n/a'}`).join(' · ')} sub={pool.legs[0].anchorAgeSec !== null ? `anchor ${Math.round(pool.legs[0].anchorAgeSec / 3600)} h old` : pool.legs[0].ageSec !== null ? `${pool.legs[0].ageSec}s old` : undefined} />
            <Row label="Per-trade limit" value={lim ? `${formatRaw(String(lim.perTrade), inB.decimals)} ${inB.symbol}` : 'halted'} />
            <Row label="Closure nonce" value={pool.closureNonce ?? '—'} sub={pool.poolPhase === 'CLOSED' ? 'episode active' : 'no closure'} />
          </dl>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <BudgetBar label={`Rolling · ${inB.symbol}`} symbol={inB.symbol} decimals={inB.decimals} used={inB.rollingUsed} total={lim ? String(lim.rolling) : inB.rolling} />
            <BudgetBar label={`Closure · ${inB.symbol}`} symbol={inB.symbol} decimals={inB.decimals} used={inB.closureUsed} total={inB.closure} tone="closed" note={pool.poolPhase === 'CLOSED' ? 'Never refills this episode' : 'Applies only while closed'} />
          </div>
          {pool.poolPhase === 'CLOSED' && (
            <p className="mt-4 flex items-start gap-2 text-sm text-muted"><Info className="mt-0.5 h-4 w-4 shrink-0 text-phase-closed" aria-hidden="true" /> This pool is closed. Prices are anchored to a historical close, not a live stock price, and swaps may stop before the weekend ends.</p>
          )}
        </div>

          <div className="glass rounded-none border border-line bg-surface/75 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-dim"><Timer className="h-4 w-4 text-ion" aria-hidden="true" /> Preview refresh age</h2>
            <button type="button" onClick={() => setQuote(compute())} className="inline-flex min-h-10 items-center gap-2 rounded-none border border-line px-3.5 font-mono text-[11px] uppercase text-muted hover:border-ion/50 hover:text-ink">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Re-quote
            </button>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div className={cn('h-full rounded-full transition-[width] duration-500', expired ? 'bg-down' : 'bg-ion')} style={{ width: `${(left / QUOTE_TTL) * 100}%` }} />
          </div>
          <p className="num mt-2 text-sm text-muted" role="status">{expired ? 'Fixture preview expired. Refresh to recalculate.' : stale ? 'Inputs changed — recalculating preview…' : `Fixture calculation refreshed ${Math.ceil(left)} s ago · not an executable quote`}</p>
        </div>
      </aside>
      <LiveSwapPanel />
      </div>
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <dt className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">{label}</dt>
      <dd className="num mt-1 text-[0.95rem] text-ink">{value}</dd>
      {sub && <p className="text-[0.7rem] text-dim">{sub}</p>}
    </div>
  );
}

function TokenRow({ label, symbol, value, editable, onChange }: { label: string; symbol: string; value: string; editable: boolean; onChange: (v: string) => void }) {
  const id = `amt-${label.replace(/\W/g, '')}`;
  return (
    <div className={cn('rounded-none border bg-bg-1 p-4 transition-colors', editable ? 'border-line-strong focus-within:border-ion/60' : 'border-line')}>
      <label htmlFor={id} className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{label}</label>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          readOnly={!editable}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
          placeholder="0.0"
          className="num w-full min-w-0 bg-transparent text-3xl text-ink outline-none placeholder:text-dim"
        />
        <span className="rounded-none border border-line bg-bg-0 px-3.5 py-2 font-mono text-xs text-ink">{symbol}</span>
      </div>
    </div>
  );
}

export default function SwapPage() {
  return (
    <Suspense fallback={<div className="glass h-96 animate-pulse rounded-[2rem]" aria-busy="true" />}>
      <SwapInner />
    </Suspense>
  );
}
