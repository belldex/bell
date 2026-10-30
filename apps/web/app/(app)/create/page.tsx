'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatUnits, parseUnits, type Address } from 'viem';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ExternalLink, LoaderCircle, Lock, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { TokenPair } from '@/components/ui/TokenLogo';
import { cn } from '@/lib/format';
import { makeClients, useWallet } from '@/lib/wallet';
import { MAINNET } from '@/lib/mainnet-live';
import { availablePoolClasses, createMainnetPool, MAINNET_ASSET_OPTIONS, type CreateStage, type CreateResult } from '@/lib/mainnet-create-flow';

const STEPS = ['Pair', 'Pool class', 'Seed', 'Review & create'] as const;
const STAGE_LABELS: Record<string, string> = {
  preflight: 'Mainnet checks', prepared: 'Preflight', wrap: 'Wrap WETH', approve: 'Token approval',
  health: 'Fresh market health', create: 'Create and seed', complete: 'Complete',
};
const inputCls = 'num h-12 w-full border border-line bg-bg-1 px-4 text-ink outline-none focus:border-ion/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ion';
const classes = { 0: 'PRICE_GUARDED', 1: 'SESSION_ONLY' } as const;

function decimalsFor(symbol: string) { return symbol === 'USDG' ? 6 : 18; }
function amountRaw(value: string, symbol: string) {
  try { return parseUnits(value || '0', decimalsFor(symbol)); } catch { return 0n; }
}
function amountLabel(raw: bigint, symbol: string) {
  const text = formatUnits(raw, decimalsFor(symbol));
  const [whole, fraction] = text.split('.');
  return `${whole}${fraction ? `.${fraction.slice(0, 6).replace(/0+$/, '')}` : ''}`;
}

export default function CreatePage() {
  const wallet = useWallet();
  const [step, setStep] = useState(0);
  const [stockSymbol, setStockSymbol] = useState('AAPL');
  const [counterSymbol, setCounterSymbol] = useState('USDG');
  const [poolClass, setPoolClass] = useState<0 | 1>(0);
  const [seedStock, setSeedStock] = useState('0.05');
  const [seedCounter, setSeedCounter] = useState('20');
  const [wrapWeth, setWrapWeth] = useState(false);
  const [ackRisk, setAckRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<CreateStage | null>(null);
  const [history, setHistory] = useState<CreateStage[]>([]);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [feeLabel, setFeeLabel] = useState('Read from factory before signing');
  const [gasPrice, setGasPrice] = useState('');

  const stockOptions = MAINNET_ASSET_OPTIONS.filter((asset) => asset.isStock);
  const counterOptions = MAINNET_ASSET_OPTIONS.filter((asset) => asset.symbol !== stockSymbol);
  const allowedClasses = useMemo(() => {
    try { return availablePoolClasses(stockSymbol, counterSymbol); } catch { return []; }
  }, [stockSymbol, counterSymbol]);
  const stock = MAINNET_ASSET_OPTIONS.find((asset) => asset.symbol === stockSymbol)!;
  const counter = MAINNET_ASSET_OPTIONS.find((asset) => asset.symbol === counterSymbol)!;
  const rawStock = amountRaw(seedStock, stockSymbol);
  const rawCounter = amountRaw(seedCounter, counterSymbol);
  const price = rawStock > 0n ? Number(seedCounter) / Number(seedStock) : 0;

  useEffect(() => {
    if (allowedClasses.length && !allowedClasses.includes(poolClass)) setPoolClass(allowedClasses[0] as 0 | 1);
  }, [allowedClasses, poolClass]);

  useEffect(() => {
    if (!wallet.account || !window.ethereum || wallet.wrongChain) { setFeeLabel('Connect to Robinhood Chain to read'); return; }
    let active = true;
    const { publicClient } = makeClients(window.ethereum);
    Promise.all([
      publicClient.readContract({ address: MAINNET.factory, abi: [{ type: 'function', name: 'serviceFee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] }], functionName: 'serviceFee' }),
      publicClient.readContract({ address: MAINNET.factory, abi: [{ type: 'function', name: 'serviceRecipient', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }], functionName: 'serviceRecipient' }),
      publicClient.getGasPrice(),
    ]).then(([fee, recipient, gas]) => {
      if (!active) return;
      setFeeLabel(`${formatUnits(fee as bigint, 6)} USDG → ${recipient}`);
      setGasPrice(`${formatUnits(gas as bigint, 18)} ETH/gas unit`);
    }).catch(() => { if (active) setFeeLabel('Fee read unavailable; create preflight will stop'); });
    return () => { active = false; };
  }, [wallet.account, wallet.chainId, wallet.wrongChain]);

  const stepOk = [
    Boolean(stock && counter && stockSymbol !== counterSymbol && allowedClasses.length),
    allowedClasses.includes(poolClass),
    rawStock > 0n && rawCounter > 0n,
    Boolean(wallet.account && !wallet.wrongChain && ackRisk),
  ];

  const startCreate = async () => {
    if (!window.ethereum || !wallet.account) { await wallet.connect(); return; }
    if (wallet.wrongChain) { await wallet.switchChain(4663); return; }
    if (!stepOk[3]) return;
    setBusy(true); setError(''); setStage(null); setHistory([]); setResult(null);
    try {
      const created = await createMainnetPool({
        provider: window.ethereum,
        account: wallet.account as Address,
        selection: { stockSymbol, counterSymbol, poolClass, amountStock: rawStock, amountCounter: rawCounter, wrapWeth },
        onStage: (next) => {
          setStage(next);
          setHistory((old) => [...old, next]);
        },
      });
      setResult(created);
    } catch (cause) {
      const failure = cause as Error & { shortMessage?: string };
      setError(failure.shortMessage ?? failure.message ?? 'Pool creation stopped');
    } finally { setBusy(false); }
  };

  return <div className="mx-auto w-full max-w-[920px]">
    <header className="max-w-3xl">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Create · Robinhood Chain Mainnet</p>
      <h1 className="mt-3 font-display text-[36px] font-bold leading-[1.06] tracking-[-0.04em] text-ink sm:text-[48px]">Create and seed a live pool.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">Only admitted assets can proceed. The app checks the live factory, reads reference prices, gets signed quote bundles, updates health, simulates the exact request, then asks your wallet to create and seed.</p>
    </header>

    <ol className="mt-8 flex gap-2 overflow-x-auto" aria-label="Pool creation steps">
      {STEPS.map((label, index) => <li key={label} className="flex items-center gap-2">
        <button type="button" disabled={index > step || busy} onClick={() => setStep(index)} aria-current={index === step ? 'step' : undefined} className={cn('min-h-10 whitespace-nowrap border px-3 font-mono text-[10px] uppercase tracking-[0.08em]', index === step ? 'border-ion/60 bg-ion/10 text-ion' : index < step ? 'border-line text-ink' : 'border-line text-dim opacity-60')}>
          {index < step ? <Check className="mr-1 inline h-3 w-3" aria-hidden="true"/> : null}{label}
        </button>{index < STEPS.length - 1 && <span className="h-px w-5 bg-line" aria-hidden="true"/>}
      </li>)}
    </ol>

    <section className="mt-6 border border-line bg-surface/75 p-5 sm:p-8">
      {step === 0 && <div className="space-y-6">
        <div className="flex items-center gap-4 border-b border-line pb-5"><TokenPair symbols={[stockSymbol, counterSymbol]} size={32}/><div><p className="font-mono text-[10px] uppercase text-dim">Selected pair</p><p className="mt-1 text-lg text-ink">{stockSymbol} / {counterSymbol}</p></div></div>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-[10px] uppercase tracking-[0.14em] text-dim">Stock token<select className={`${inputCls} mt-2`} value={stockSymbol} onChange={(event) => { setStockSymbol(event.target.value); if (event.target.value === counterSymbol) setCounterSymbol(event.target.value === 'AAPL' ? 'USDG' : 'AAPL'); }}>
            {stockOptions.map((asset) => <option key={asset.symbol} value={asset.symbol}>{asset.symbol} · admitted stock</option>)}
          </select></label>
          <label className="text-[10px] uppercase tracking-[0.14em] text-dim">Counterasset<select className={`${inputCls} mt-2`} value={counterSymbol} onChange={(event) => setCounterSymbol(event.target.value)}>
            {counterOptions.map((asset) => <option key={asset.symbol} value={asset.symbol}>{asset.symbol} · {asset.isStock ? 'admitted stock' : 'admitted token'}</option>)}
          </select></label>
        </div>
        <div className="border border-line bg-bg-1 p-4"><p className="font-mono text-[10px] uppercase text-muted">Live asset set</p><p className="mt-2 text-sm text-ink">{MAINNET_ASSET_OPTIONS.map((asset) => asset.symbol).join(' · ')}</p><p className="mt-2 text-xs text-dim">Token addresses and descriptor IDs are rechecked against the Mainnet AssetRegistry before any approval.</p></div>
      </div>}

      {step === 1 && <div className="space-y-5">
        <h2 className="font-display text-3xl text-ink">Choose the permanent pool class.</h2>
        <p className="text-sm leading-relaxed text-muted">Pool class cannot be changed after creation. Choose only among options supported by both selected assets and their live reference adapters.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {([0, 1] as const).filter((value) => allowedClasses.includes(value)).map((value) => <button key={value} type="button" aria-pressed={poolClass === value} onClick={() => setPoolClass(value)} className={cn('border p-5 text-left', poolClass === value ? 'border-ion/60 bg-ion/[0.06]' : 'border-line')}>
            <span className="font-mono text-[10px] uppercase text-ion">{classes[value]}</span><span className="mt-2 block text-sm text-ink">{value === 0 ? 'Independent reference guard' : 'Session rules only'}</span><span className="mt-2 block text-xs leading-relaxed text-muted">{value === 0 ? 'Both assets need a live Chainlink reference; the factory checks the opening price against the reference band.' : 'Exactly one stock leg. The opening price comes from your seed ratio and has no independent counterasset price protection.'}</span>
          </button>)}
          {allowedClasses.length === 0 && <p role="alert" className="border border-down/30 p-4 text-sm text-down">No pool class is supported for this pair on the deployed Mainnet factory.</p>}
        </div>
        {poolClass === 1 && <p className="border border-warn/30 bg-warn/5 p-4 text-sm text-warn">SESSION_ONLY carries no independent counterasset price protection. The displayed seed ratio is the opening price.</p>}
        {poolClass === 0 && <p className="border border-line bg-bg-1 p-4 text-sm text-muted">Opening price uses current onchain reference adapter values. The factory will reject stale feeds or a price outside its configured band.</p>}
      </div>}

      {step === 2 && <div className="space-y-6">
        <h2 className="font-display text-3xl text-ink">Set the maximum seed amounts.</h2>
        <p className="text-sm leading-relaxed text-muted">The factory pulls no more than these amounts, then refunds unused amounts in the same transaction. Token decimals are verified from the live contracts before signing.</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-[10px] uppercase tracking-[0.14em] text-dim">{stockSymbol} maximum seed<input inputMode="decimal" className={`${inputCls} mt-2`} value={seedStock} onChange={(event) => setSeedStock(event.target.value.replace(/[^0-9.]/g, ''))}/><span className="mt-1 block text-xs text-dim">{amountRaw(seedStock, stockSymbol).toString()} base units</span></label>
          <label className="text-[10px] uppercase tracking-[0.14em] text-dim">{counterSymbol} maximum seed<input inputMode="decimal" className={`${inputCls} mt-2`} value={seedCounter} onChange={(event) => setSeedCounter(event.target.value.replace(/[^0-9.]/g, ''))}/><span className="mt-1 block text-xs text-dim">{amountRaw(seedCounter, counterSymbol).toString()} base units</span></label>
        </div>
        <div className="grid gap-4 border border-line bg-bg-1 p-4 sm:grid-cols-3"><Metric label="Seed ratio" value={`${price > 0 ? price.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—'} ${counterSymbol} / ${stockSymbol}`} note={poolClass === 0 ? 'Guarded opening price is derived from live references' : 'Used as the SESSION_ONLY opening price'}/><Metric label="Factory service fee" value={feeLabel} note="Live factory getter; seed is charged separately"/><Metric label="Current gas quote" value={gasPrice || 'Read from wallet RPC during preflight'} note="Final create gas is estimated after simulation"/></div>
        {counterSymbol === 'WETH' && <label className="flex items-start gap-3 border border-line p-4 text-sm text-muted"><input type="checkbox" checked={wrapWeth} onChange={(event) => setWrapWeth(event.target.checked)} className="mt-1 accent-ion"/>If my WETH balance is short, allow the app to ask my wallet to wrap only the exact ETH shortfall into WETH. Gas is additional.</label>}
        <p className="border border-line p-4 text-xs leading-relaxed text-dim">The deployed factory profile fixes pool flow caps. They are checked live and cannot be customized in this creation request. Fee and seed approvals are limited to the exact required amounts.</p>
      </div>}

      {step === 3 && <div className="space-y-6">
        <h2 className="font-display text-3xl text-ink">Review every wallet transaction.</h2>
        <dl className="divide-y divide-line border-y border-line">
          <ReviewRow label="Network" value={`Robinhood Chain Mainnet · ${MAINNET.chainId}`}/>
          <ReviewRow label="Pair" value={`${stockSymbol} / ${counterSymbol}`}/>
          <ReviewRow label="Pool class" value={classes[poolClass]}/>
          <ReviewRow label="Maximum seed" value={`${amountLabel(rawStock, stockSymbol)} ${stockSymbol} + ${amountLabel(rawCounter, counterSymbol)} ${counterSymbol}`}/>
          <ReviewRow label="Service fee" value={feeLabel}/>
          <ReviewRow label="Position recipient" value={wallet.account ?? 'Connect wallet'}/>
          <ReviewRow label="Initial price" value={poolClass === 0 ? 'Live onchain references; checked by factory' : `${price > 0 ? price.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—'} ${counterSymbol} per ${stockSymbol} from seed ratio`}/>
          <ReviewRow label="Approval spender" value={MAINNET.factory}/>
        </dl>
        <div className="space-y-3 text-sm text-muted">
          <p>Depending on balances and allowances, your wallet may ask you to confirm WETH wrapping, exact token approvals, one fresh health update, and the final atomic create-and-seed transaction.</p>
          <label className="flex cursor-pointer items-start gap-3 border border-warn/30 bg-warn/5 p-4"><input type="checkbox" checked={ackRisk} onChange={(event) => setAckRisk(event.target.checked)} className="mt-1 accent-ion"/><span>I understand the pool class is permanent, seed tokens can be lost, the factory service fee is paid separately, and the position NFT will be minted to my connected wallet.</span></label>
        </div>
      </div>}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
        <Button variant="ghost" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || busy}><ArrowLeft className="h-4 w-4"/> Back</Button>
        <div className="flex flex-wrap gap-2">
          {step < STEPS.length - 1 && <Button onClick={() => setStep((current) => current + 1)} disabled={!stepOk[step] || busy}>Continue <ArrowRight className="h-4 w-4"/></Button>}
          {step === STEPS.length - 1 && <button type="button" onClick={() => void startCreate()} disabled={busy || !stepOk[3]} className="inline-flex min-h-11 items-center gap-2 bg-ion px-5 font-mono text-xs uppercase tracking-[0.08em] text-bg-0 disabled:opacity-50">{busy ? <><LoaderCircle className="h-4 w-4 animate-spin"/>{stage?.message ?? 'Working…'}</> : wallet.status !== 'connected' ? <><Wallet className="h-4 w-4"/>Connect wallet</> : wallet.wrongChain ? 'Switch to Mainnet' : 'Create and seed pool'}</button>}
        </div>
      </div>
    </section>

    {wallet.wrongChain && <p role="alert" className="mt-4 border border-warn/30 bg-warn/5 p-4 text-sm text-warn">Switch your wallet to Robinhood Chain Mainnet (4663) to continue.</p>}
    {wallet.error && <p role="alert" className="mt-4 text-sm text-down">{wallet.error}</p>}
    {error && <p role="alert" className="mt-4 flex items-start gap-2 border border-down/30 bg-down/5 p-4 text-sm text-down"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/>{error}</p>}

    {(stage || history.length > 0) && <section className="mt-5 border border-line bg-surface/50 p-5" aria-live="polite"><h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Transaction progress</h2><ol className="mt-4 space-y-3">{history.map((item, index) => <li key={`${item.key}-${index}`} className="border-t border-line pt-3"><p className="text-sm text-ink">{STAGE_LABELS[item.key] ?? item.key}: {item.message}</p>{item.hash && <a className="mt-1 inline-flex items-center gap-1 text-xs text-ion underline" href={`https://robinhoodchain.blockscout.com/tx/${item.hash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink className="h-3 w-3"/></a>}</li>)}</ol></section>}

    {result && <section className="mt-5 border border-up/30 bg-up/5 p-6"><p className="font-mono text-xs uppercase text-up">Pool deployed and seeded</p><p className="mt-2 break-all font-mono text-xs text-ink">Hook {result.hook}</p><p className="mt-1 break-all font-mono text-xs text-dim">Pool ID {result.poolId}</p><p className="mt-2 text-sm text-muted">Position NFT #{result.tokenId} is owned by {wallet.account}. Seed used: {amountLabel(result.principal[0], result.token0.toLowerCase() === stock.token.toLowerCase() ? stockSymbol : counterSymbol)} {result.token0.toLowerCase() === stock.token.toLowerCase() ? stockSymbol : counterSymbol} and {amountLabel(result.principal[1], result.token1.toLowerCase() === stock.token.toLowerCase() ? stockSymbol : counterSymbol)} {result.token1.toLowerCase() === stock.token.toLowerCase() ? stockSymbol : counterSymbol}.</p><div className="mt-4 flex flex-wrap gap-4"><Link className="text-sm text-ion underline" href={`/pool?hook=${result.hook}`}>Open live pool</Link><a className="inline-flex items-center gap-1 text-sm text-ion underline" href={`https://robinhoodchain.blockscout.com/tx/${result.createHash}`} target="_blank" rel="noreferrer">View creation transaction <ExternalLink className="h-3 w-3"/></a></div></section>}

    <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-dim"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0"/>No private key leaves your wallet. The quote Worker returns signed data only. Pool creation, report updates, and approvals are visible Mainnet transactions that require your wallet confirmation.</p>
  </div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="min-w-0"><p className="font-mono text-[10px] uppercase text-dim">{label}</p><p className="mt-2 break-words text-sm text-ink">{value}</p><p className="mt-1 text-xs text-dim">{note}</p></div>;
}
function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-wrap justify-between gap-3 py-3"><dt className="font-mono text-[10px] uppercase text-dim">{label}</dt><dd className="break-all text-right text-sm text-ink">{value}</dd></div>;
}
