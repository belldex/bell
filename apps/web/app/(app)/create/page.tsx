'use client';

import { useEffect, useMemo, useState } from 'react';
import { isAddress, parseUnits, formatUnits } from 'viem';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CircleDashed, Coins, FileCheck2, Lock, ShieldCheck, Sparkles, Timer } from 'lucide-react';
import { Button, ClassBadge } from '@/components/ui/primitives';
import { cn } from '@/lib/format';
import { nowWeekMinuteET, phaseAtWeekMinute, SERVICE_FEE_USDG, HOOK_PERMISSION_MASK } from '@/lib/policy';
import { useWallet } from '@/lib/wallet';

interface Tok { symbol: string; decimals: number; usd: number; stock: boolean }
const STOCKS: Tok[] = [
  { symbol: 'AAPL', decimals: 18, usd: 215.4, stock: true },
  { symbol: 'TSLA', decimals: 18, usd: 219.8, stock: true },
  { symbol: 'NVDA', decimals: 18, usd: 138.2, stock: true },
  { symbol: 'AMZN', decimals: 18, usd: 196.4, stock: true },
  { symbol: 'MSFT', decimals: 18, usd: 421.1, stock: true },
  { symbol: 'PLTR', decimals: 18, usd: 74.5, stock: true },
];
const QUOTES: Tok[] = [
  { symbol: 'USDG', decimals: 6, usd: 1, stock: false },
  { symbol: 'WETH', decimals: 18, usd: 2950, stock: false },
];
const CUSTOM = 'CUSTOM';
const STEPS = ['Pair', 'Mode', 'Seed & price', 'Caps', 'Review'] as const;

const num = (s: string) => { const n = parseFloat(s); return isFinite(n) && n > 0 ? n : 0; };
const raw = (s: string, d: number): bigint => { try { return parseUnits(s || '0', d); } catch { return 0n; } };
const fmtUnits = (v: bigint, d: number) => { const t = formatUnits(v, d); const [w, f = ''] = t.split('.'); return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? '.' + f.slice(0, 6).replace(/0+$/, '') : ''}`.replace(/\.$/, ''); };

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | false; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[0.7rem] uppercase tracking-[0.16em] text-dim">{label}</label>
      <div className="mt-2">{children}</div>
      {error ? <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-down"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{error}</p> : hint ? <p className="mt-1.5 text-xs text-dim">{hint}</p> : null}
    </div>
  );
}
const inputCls = 'num h-11 w-full rounded-xl border border-line bg-surface px-4 text-ink text-sm outline-none transition-colors placeholder:text-dim focus:border-ion/60';

export default function CreatePage() {
  const wallet = useWallet();
  const [step, setStep] = useState(0);
  const [stockSym, setStockSym] = useState('AAPL');
  const [counter, setCounter] = useState('USDG');
  const [customAddr, setCustomAddr] = useState('');
  const [customDec, setCustomDec] = useState('18');
  const [customSym, setCustomSym] = useState('TOKEN');
  const [secondary, setSecondary] = useState(false);
  const [seedStock, setSeedStock] = useState('10');
  const [seedCounter, setSeedCounter] = useState('2154');
  const [ackPrice, setAckPrice] = useState(false);
  const [caps, setCaps] = useState({ tS: '1', wS: '4', cS: '1', tC: '250', wC: '1000', cC: '200' });
  const [ackAll, setAckAll] = useState({ klass: false, caps: false, seed: false });
  const [done, setDone] = useState<'idle' | 'running' | 'ok'>('idle');
  const [phaseNow, setPhaseNow] = useState<string>('—');

  useEffect(() => { setPhaseNow(phaseAtWeekMinute(nowWeekMinuteET())); }, []);

  const stock = STOCKS.find((s) => s.symbol === stockSym)!;
  const isCustom = counter === CUSTOM;
  const counterTok: Tok = isCustom
    ? { symbol: customSym || 'TOKEN', decimals: Math.min(18, Math.max(0, parseInt(customDec) || 0)), usd: 0, stock: false }
    : [...QUOTES, ...STOCKS].find((t) => t.symbol === counter)!;
  const sameAsset = !isCustom && counter === stockSym;
  const poolClass = isCustom ? 'SESSION_ONLY' : 'PRICE_GUARDED';
  const addrOk = !isCustom || isAddress(customAddr);

  // seed + price
  const refRatio = isCustom ? null : stock.usd / counterTok.usd; // counter units per 1 stock
  const sS = num(seedStock), sC = num(seedCounter);
  const implied = sS > 0 ? sC / sS : 0;
  const devBps = refRatio && implied ? Math.round(((implied - refRatio) / refRatio) * 10_000) : null;
  const inBand = devBps === null ? null : Math.abs(devBps) <= 200;
  const tickRaw = implied > 0 ? Math.log(implied) / Math.log(1.0001) : 0;
  const tick = Math.floor(tickRaw / 60) * 60;

  const seedRawS = raw(seedStock, stock.decimals);
  const seedRawC = raw(seedCounter, counterTok.decimals);
  const maxCS = seedRawS / 10n; // C <= 10% of seed, rounded down
  const maxCC = seedRawC / 10n;
  const T = { s: raw(caps.tS, stock.decimals), c: raw(caps.tC, counterTok.decimals) };
  const Wv = { s: raw(caps.wS, stock.decimals), c: raw(caps.wC, counterTok.decimals) };
  const Cv = { s: raw(caps.cS, stock.decimals), c: raw(caps.cC, counterTok.decimals) };
  const capErr = (t: bigint, w: bigint, c: bigint, max: bigint): string | false => {
    if (t <= 0n || w <= 0n || c <= 0n) return 'All caps must be positive';
    if (t > w) return 'Per-trade cap T must be ≤ rolling budget W';
    const m2 = t * 2n < w ? t * 2n : w;
    if (c > m2) return 'Closure budget C must be ≤ min(2T, W)';
    if (c > max) return `C must be ≤ 10% of the seeded amount (${fmtUnits(max, 0)} raw floor)`;
    return false;
  };
  const errS = capErr(T.s, Wv.s, Cv.s, maxCS);
  const errC = capErr(T.c, Wv.c, Cv.c, maxCC);

  const marketUnhealthy = poolClass === 'PRICE_GUARDED' && phaseNow === 'CLOSED';

  const stepOk = [
    !sameAsset && addrOk && (counter !== CUSTOM || customSym.length > 0),
    true,
    sS > 0 && sC > 0 && (poolClass === 'PRICE_GUARDED' ? inBand === true : ackPrice),
    !errS && !errC,
    ackAll.klass && ackAll.caps && ackAll.seed && !marketUnhealthy,
  ];

  const recipient = wallet.account ?? '— connect wallet —';
  const create = () => { setDone('running'); window.setTimeout(() => setDone('ok'), 2400); };

  const request = [
    ['chainId', wallet.chainId ? String(wallet.chainId) : '4663 / 46630'],
    ['pair', `${stock.symbol} / ${counterTok.symbol}${isCustom && isAddress(customAddr) ? ` (${customAddr.slice(0, 8)}…)` : ''}`],
    ['class', poolClass],
    ['price / anchor mode', poolClass === 'SESSION_ONLY' ? 'none (no counter reference)' : secondary ? 'SECONDARY_REFERENCE' : 'FROZEN_CLOSE'],
    ['liquidityMode', 'PUBLIC'],
    ['dynamic fee / spacing', '0x800000 / 60'],
    ['hook permission mask', HOOK_PERMISSION_MASK],
    [`T (${stock.symbol})`, `${fmtUnits(T.s, 0)} raw`],
    [`W (${stock.symbol})`, `${fmtUnits(Wv.s, 0)} raw`],
    [`C (${stock.symbol})`, `${fmtUnits(Cv.s, 0)} raw`],
    [`T (${counterTok.symbol})`, `${fmtUnits(T.c, 0)} raw`],
    [`W (${counterTok.symbol})`, `${fmtUnits(Wv.c, 0)} raw`],
    [`C (${counterTok.symbol})`, `${fmtUnits(Cv.c, 0)} raw`],
    ['seed', `${seedStock} ${stock.symbol} + ${seedCounter} ${counterTok.symbol}`],
    ['initial price tick', `${tick} (full range, spacing 60)`],
    ['position recipient', recipient],
    ['service fee', `${SERVICE_FEE_USDG} USDG → service recipient`],
    ['deadline', '≤ 120 s after signing'],
  ];

  return (
    <div className="w-full">
      <header className="max-w-3xl">
        <p className="text-xs uppercase tracking-[0.22em] text-ion font-medium">Create pool</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          One transaction. Everything locked.
        </h1>
        <p className="mt-3 text-base text-muted">
          Fee, deploy, initialize and seed happen atomically. Class, caps and sources cannot be changed afterwards — a different configuration is a different pool.
        </p>
      </header>

      <ol className="mt-8 flex items-center gap-2 overflow-x-auto scroll-hide" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <button
              type="button"
              disabled={i > step}
              onClick={() => setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center gap-2 rounded-xl border px-3.5 text-xs font-medium transition-all whitespace-nowrap',
                i === step
                  ? 'border-ion/60 bg-ion/15 text-ion shadow-[0_0_12px_-3px_var(--color-ion)]'
                  : i < step
                  ? 'border-line text-ink hover:border-line-strong'
                  : 'border-line text-dim opacity-60'
              )}
            >
              <span className={cn('grid h-4 w-4 place-items-center rounded-full text-[0.62rem]', i < step ? 'bg-ion text-bg-0 font-bold' : 'border border-current')}>{i < step ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : i + 1}</span>
              {s}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-5 bg-line" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <div className="glass mt-6 rounded-2xl border border-line bg-surface/75 p-6 sm:p-8">
        {step === 0 && (
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Canonical Stock Token" hint="Only reviewed canonical Robinhood Stock Tokens can anchor a pool.">
              <select value={stockSym} onChange={(e) => setStockSym(e.target.value)} className={inputCls}>
                {STOCKS.map((s) => <option key={s.symbol}>{s.symbol}</option>)}
              </select>
            </Field>
            <Field label="Counterasset" error={sameAsset && 'Counterasset must differ from the stock token'}>
              <select value={counter} onChange={(e) => setCounter(e.target.value)} className={inputCls}>
                <optgroup label="Price source available">
                  {QUOTES.map((s) => <option key={s.symbol}>{s.symbol}</option>)}
                  {STOCKS.filter((s) => s.symbol !== stockSym).map((s) => <option key={s.symbol}>{s.symbol}</option>)}
                </optgroup>
                <optgroup label="Any ERC-20 (session only)"><option value={CUSTOM}>Custom token address…</option></optgroup>
              </select>
            </Field>
            {isCustom && (
              <>
                <div className="sm:col-span-2">
                  <Field label="Token contract address" error={customAddr.length > 0 && !isAddress(customAddr) && 'Not a valid EVM address'} hint="Unknown tokens enter intake. No special treatment for any token, including $BELL, and no launch wallet is ever requested.">
                    <input value={customAddr} onChange={(e) => setCustomAddr(e.target.value.trim())} placeholder="0x…" spellCheck={false} className={inputCls} />
                  </Field>
                </div>
                <Field label="Symbol (display)"><input value={customSym} onChange={(e) => setCustomSym(e.target.value.toUpperCase().slice(0, 10))} className={inputCls} /></Field>
                <Field label="Decimals (verified at intake)"><input value={customDec} inputMode="numeric" onChange={(e) => setCustomDec(e.target.value.replace(/\D/g, '').slice(0, 2))} className={inputCls} /></Field>
                <div className="sm:col-span-2 rounded-2xl border border-line bg-bg-1/70 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink"><CircleDashed className="h-4 w-4 text-warn" aria-hidden="true" /> Intake required before deployment</p>
                  <ul className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2">
                    {['Nonzero code & stable decimals 0–18', 'Actual debit/credit equals nominal on official route', 'No fee-on-transfer, rebase or reflect behavior', 'Proxy / admin / blacklist capabilities disclosed', 'Approval semantics (zero-first if needed)', 'Position can be redeemed in-kind'].map((t) => (
                      <li key={t} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-dim" aria-hidden="true" />{t}</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-dim">These checks run against the chain once contracts and the intake endpoint exist. Nothing is marked as passed in preview.</p>
                </div>
              </>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <ClassBadge poolClass={poolClass} />
              <span className="text-sm text-muted">Locked at deployment. It never changes through an admin toggle.</span>
            </div>
            {poolClass === 'SESSION_ONLY' ? (
              <p className="rounded-2xl border border-warn/30 bg-warn/5 p-4 text-sm font-medium text-warn">Session controls only; no independent price protection for the counterasset.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <ModeCard active={!secondary} onClick={() => setSecondary(false)} icon={ShieldCheck} title="FROZEN_CLOSE (default)" body="Closed stock uses its captured close anchor; the counterasset stays live. No extra dependency." />
                <ModeCard active={secondary} onClick={() => setSecondary(true)} icon={Timer} title="SECONDARY_REFERENCE" body="Only if a 24/7 feed for this same canonical token is proven. If it fails the pool halts — it never falls back." />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <ModeCard active icon={Coins} title="PUBLIC liquidity" body="Noncustodial positions via PositionManager. The position NFT is minted to you." />
              <div className="rounded-2xl border border-line p-4 opacity-55" aria-disabled="true">
                <p className="flex items-center gap-2 text-sm font-medium text-ink"><Lock className="h-4 w-4" aria-hidden="true" /> TREASURY_ONLY</p>
                <p className="mt-1.5 text-sm text-muted">Reserved for project-owned pilot pools. Not available to creators.</p>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label={`Seed ${stock.symbol}`}><input className={inputCls} inputMode="decimal" value={seedStock} onChange={(e) => setSeedStock(e.target.value.replace(/[^0-9.]/g, ''))} /></Field>
            <Field label={`Seed ${counterTok.symbol}`}><input className={inputCls} inputMode="decimal" value={seedCounter} onChange={(e) => setSeedCounter(e.target.value.replace(/[^0-9.]/g, ''))} /></Field>
            <div className="sm:col-span-2 grid gap-4 rounded-2xl border border-line bg-bg-1/70 p-5 sm:grid-cols-3">
              <Metric label="Initial price" value={implied ? `${implied.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${counterTok.symbol}` : '—'} sub={`per 1 ${stock.symbol}`} />
              <Metric label="Initial tick" value={implied ? String(tick) : '—'} sub="full range · spacing 60" />
              {poolClass === 'PRICE_GUARDED' ? (
                <Metric label="Vs reference" value={devBps === null ? '—' : `${devBps > 0 ? '+' : ''}${(devBps / 100).toFixed(2)}%`} sub={inBand ? 'inside ±2% band' : 'must be inside ±2%'} tone={inBand ? 'ok' : 'bad'} />
              ) : (
                <Metric label="Reference" value="None" sub="creator-approved price" />
              )}
            </div>
            {poolClass === 'SESSION_ONLY' && (
              <label className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-2xl border border-warn/30 bg-warn/5 p-4 text-sm text-warn">
                <input type="checkbox" checked={ackPrice} onChange={(e) => setAckPrice(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#3ce6ff]" />
                I understand the initial price is my own decision. It is not validated by any oracle.
              </label>
            )}
            {marketUnhealthy && <p role="alert" className="sm:col-span-2 text-sm text-warn">Price-guarded pools can only be created while the stock market is open and data is healthy. Scheduled phase now: {phaseNow}.</p>}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-8 sm:grid-cols-2">
            <CapGroup sym={stock.symbol} dec={stock.decimals} caps={[caps.tS, caps.wS, caps.cS]} set={(i, v) => setCaps((c) => ({ ...c, [['tS', 'wS', 'cS'][i]]: v }))} err={errS} max={maxCS} />
            <CapGroup sym={counterTok.symbol} dec={counterTok.decimals} caps={[caps.tC, caps.wC, caps.cC]} set={(i, v) => setCaps((c) => ({ ...c, [['tC', 'wC', 'cC'][i]]: v }))} err={errC} max={maxCC} />
            <p className="sm:col-span-2 text-xs leading-relaxed text-dim">Caps are fixed raw token units, never USD. T ≤ W, C ≤ min(2T, W) and C ≤ 10% of what you actually seed. Adding liquidity later does not raise them. They bound flow; they do not insure value.</p>
          </div>
        )}

        {step === 4 && (
          <div>
            <div className="flex flex-wrap items-center gap-3"><ClassBadge poolClass={poolClass} /><span className="text-sm text-muted">Exactly what the factory will receive</span></div>
            <dl className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {request.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line/70 pb-2">
                  <dt className="text-xs uppercase tracking-[0.12em] text-dim">{k}</dt>
                  <dd className="num truncate text-right text-sm text-ink" title={v}>{v}</dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-4 border-b border-line/70 pb-2">
                <dt className="text-xs uppercase tracking-[0.12em] text-dim">predicted hook / PoolId</dt>
                <dd className="text-right text-sm text-dim">from factory preview</dd>
              </div>
            </dl>
            <div className="mt-6 space-y-3">
              {([
                ['klass', poolClass === 'PRICE_GUARDED' ? 'I understand the class is permanent and protection applies only inside the reference band.' : 'I understand there is no independent price protection for the counterasset.'],
                ['caps', 'I understand caps are fixed raw units that bound flow and do not insure my liquidity.'],
                ['seed', `I will pay ${SERVICE_FEE_USDG} USDG plus my seed. Fee, deploy, initialize and seed succeed or fail together.`],
              ] as const).map(([k, t]) => (
                <label key={k} className="flex cursor-pointer items-start gap-3 text-sm text-muted">
                  <input type="checkbox" checked={ackAll[k]} onChange={(e) => setAckAll((a) => ({ ...a, [k]: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-[#3ce6ff]" />
                  {t}
                </label>
              ))}
            </div>
            {marketUnhealthy && <p role="alert" className="mt-4 text-sm text-warn">Creation blocked: stock market is closed (scheduled phase {phaseNow}). Price-guarded pools bootstrap only on healthy active data.</p>}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button size="lg" disabled={!stepOk[4] || done !== 'idle'} onClick={create} aria-busy={done === 'running'}>
                {done === 'ok' ? <><Check className="h-5 w-5" aria-hidden="true" /> Simulated</> : done === 'running' ? 'Simulating…' : <><Sparkles className="h-5 w-5" aria-hidden="true" /> Simulate create (preview)</>}
              </Button>
              <span className="text-xs text-dim">No transaction is sent. Needs live factory + preview endpoint.</span>
            </div>
            {done === 'ok' && <p className="mt-4 flex items-center gap-2 text-sm text-ion" role="status"><FileCheck2 className="h-4 w-4" aria-hidden="true" /> Request encoding matched the preview. With live contracts you would receive the position NFT at {wallet.account ? wallet.account.slice(0, 8) + '…' : 'your wallet'}.</p>}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between border-t border-line pt-6">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back</Button>
          {step < STEPS.length - 1 && <Button onClick={() => setStep((s) => s + 1)} disabled={!stepOk[step]}>Continue <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>}
        </div>
      </div>
    </div>
  );
}

function ModeCard({ active, onClick, icon: Icon, title, body }: { active: boolean; onClick?: () => void; icon: React.ComponentType<{ className?: string }>; title: string; body: string }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} aria-pressed={onClick ? active : undefined} className={cn('rounded-2xl border p-4 text-left transition-colors', active ? 'border-ion/50 bg-ion/[0.07]' : 'border-line hover:border-line-strong')}>
      <p className="flex items-center gap-2 text-sm font-medium text-ink"><Icon className={cn('h-4 w-4', active ? 'text-ion' : 'text-dim')} aria-hidden="true" /> {title}</p>
      <p className="mt-1.5 text-sm text-muted">{body}</p>
    </Tag>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'bad' }) {
  return (
    <div>
      <p className="text-[0.66rem] uppercase tracking-[0.14em] text-dim">{label}</p>
      <p className={cn('num mt-1 text-xl', tone === 'ok' ? 'text-up' : tone === 'bad' ? 'text-down' : 'text-ink')}>{value}</p>
      {sub && <p className="text-xs text-dim">{sub}</p>}
    </div>
  );
}

function CapGroup({ sym, dec, caps, set, err, max }: { sym: string; dec: number; caps: [string, string, string]; set: (i: number, v: string) => void; err: string | false; max: bigint }) {
  const labels = ['Per-trade T', 'Rolling W (300 s)', 'Closure episode C'];
  return (
    <fieldset className="space-y-4">
      <legend className="mb-1 font-display text-3xl text-ink">{sym}</legend>
      {labels.map((l, i) => (
        <Field key={l} label={`${l} · ${sym}`} hint={i === 2 ? `Max ≈ ${fmtUnits(max, dec)} ${sym} (10% of seed)` : undefined}>
          <input className={inputCls} inputMode="decimal" value={caps[i]} onChange={(e) => set(i, e.target.value.replace(/[^0-9.]/g, ''))} />
        </Field>
      ))}
      {err && <p role="alert" className="flex items-start gap-1.5 text-xs text-down"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{err}</p>}
    </fieldset>
  );
}
