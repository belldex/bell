'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { parseUnits } from 'viem';
import { AlertTriangle, ArrowDownUp, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { makeClients, useWallet } from '@/lib/wallet';
import { MAINNET, displayAmount, oracleUpdate, readLivePools, routerAbi, tokenAbi, type LivePool } from '@/lib/mainnet-live';

const MAX_SQRT = 1461446703485210103287273052203988822378723970341n;

function SwapInner() {
  const params = useSearchParams();
  const { account, status, wrongChain, connect, switchChain } = useWallet();
  const [pools, setPools] = useState<LivePool[]>([]);
  const [pool, setPool] = useState<LivePool | null>(null);
  const [direction, setDirection] = useState(true);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(50);
  const [quote, setQuote] = useState<{ amountOut: bigint; minOut: bigint; stamp: number; observedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [balance, setBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    readLivePools().then((items) => {
      if (!active) return;
      setPools(items);
      const requested = params.get('hook')?.toLowerCase();
      setPool((current) => items.find((item) => item.hook.toLowerCase() === (requested ?? current?.hook.toLowerCase())) ?? items[0] ?? null);
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Could not read Mainnet pool state'); });
    return () => { active = false; };
  }, [params, refreshKey]);

  const input = pool?.legs[direction ? 0 : 1];
  const output = pool?.legs[direction ? 1 : 0];
  const zeroForOne = direction;
  const rawIn = useMemo(() => {
    try { return input && amount ? parseUnits(amount, input.decimals) : 0n; } catch { return 0n; }
  }, [amount, input]);

  const loadWalletState = useCallback(async () => {
    if (!account || !input) { setBalance(null); setAllowance(null); return; }
    try {
      if (!window.ethereum) throw new Error('Wallet provider is not available');
      const { publicClient: connectedClient } = makeClients(window.ethereum);
      const [b, a] = await Promise.all([
        connectedClient.readContract({ address: input.address, abi: tokenAbi, functionName: 'balanceOf', args: [account] }),
        connectedClient.readContract({ address: input.address, abi: tokenAbi, functionName: 'allowance', args: [account, MAINNET.router] }),
      ]);
      setBalance(b); setAllowance(a);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read wallet token balance'); }
  }, [account, input]);
  useEffect(() => { void loadWalletState(); }, [loadWalletState]);

  const buildUpdates = async () => {
    if (!pool) return [];
    const stockLegs = pool.legs.filter((leg) => ['AAPL', 'NVDA', 'TSLA'].includes(leg.symbol));
    const bundles = await Promise.all(stockLegs.map(async (leg) => {
      const response = await fetch(`${MAINNET.quoteUrl}?symbol=${leg.symbol}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `Quote endpoint returned HTTP ${response.status}`);
      if (body.assetId?.toLowerCase() !== (leg === pool.legs[0] ? pool.asset0 : pool.asset1).toLowerCase()) throw new Error(`Signed ${leg.symbol} quote is for a different asset`);
      return oracleUpdate(body);
    }));
    return bundles;
  };

  const requestQuote = async () => {
    if (!pool || !input || !output || rawIn <= 0n) throw new Error('Enter a valid input amount');
    if (wrongChain) throw new Error('Switch your wallet to Robinhood Chain Mainnet first');
    setBusy(true); setError(''); setMessage('Fetching fresh signed quote and simulating against the live router…'); setQuote(null); setTxHash(null);
    try {
      if (!window.ethereum || !account) throw new Error('Connect your Robinhood Chain wallet first');
      const { publicClient: connectedClient } = makeClients(window.ethereum);
      const updates = await buildUpdates();
      const nonce = await connectedClient.readContract({ address: MAINNET.router, abi: routerAbi, functionName: 'nonces', args: [account] }) as bigint;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 90);
      const request = {
        hook: pool.hook, zeroForOne, exactInput: true, amountSpecified: rawIn, limitAmount: 1n,
        sqrtPriceLimitX96: zeroForOne ? 4295128740n : MAX_SQRT,
        recipient: account, nonce, deadline,
        expectedConfigHash: pool.configHash, wrapInput: false, unwrapOutput: false, unwrapRefund: false,
        oracleUpdates: updates,
      };
      const simulation: any = await connectedClient.simulateContract({ address: MAINNET.router, abi: routerAbi, functionName: 'swap', args: [request], account } as any);
      const amountOut = BigInt(simulation.result[1]);
      const minOut = amountOut * BigInt(10_000 - slippage) / 10_000n;
      if (minOut <= 0n) throw new Error('Router simulation returned zero output');
      setQuote({ amountOut, minOut, stamp: Date.now(), observedAt: updates.length ? Math.min(...updates.map((update: any) => Number(update.directSample.observedAt) * 1000)) : Date.now() });
      setMessage('Router simulation succeeded. Review output, approve the input token, then submit the swap.');
      await loadWalletState();
    } catch (e) { const err = e as Error & { shortMessage?: string }; setError(err.shortMessage ?? err.message ?? 'Could not quote this swap'); setMessage(''); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    if (!account || !input || rawIn <= 0n || !window.ethereum) return;
    setBusy(true); setError(''); setMessage('Confirm token approval in your wallet…');
    try {
      const { walletClient } = makeClients(window.ethereum);
      const hash = await walletClient.writeContract({ address: input.address, abi: tokenAbi, functionName: 'approve', args: [MAINNET.router, rawIn], account } as any);
      setMessage('Waiting for approval confirmation…');
      const { publicClient: connectedClient } = makeClients(window.ethereum);
      const receipt = await connectedClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Token approval reverted');
      await loadWalletState(); setMessage('Approval confirmed. Your quote may expire; refresh it before swapping.');
    } catch (e) { const err = e as Error & { shortMessage?: string }; setError(err.shortMessage ?? err.message ?? 'Approval failed'); setMessage(''); }
    finally { setBusy(false); }
  };

  const swap = async () => {
    if (!account || !pool || !input || !quote || !window.ethereum) return;
    if (Date.now() - quote.stamp > 25_000) { setError('Quote expired. Request a fresh quote before submitting.'); return; }
    setBusy(true); setError(''); setMessage('Refreshing signed quote and simulating the exact transaction…');
    try {
      const { publicClient: walletProvider, walletClient } = makeClients(window.ethereum);
      const updates = await buildUpdates();
      const nonce = await walletProvider.readContract({ address: MAINNET.router, abi: routerAbi, functionName: 'nonces', args: [account] }) as bigint;
      const request = {
        hook: pool.hook, zeroForOne, exactInput: true, amountSpecified: rawIn, limitAmount: quote.minOut,
        sqrtPriceLimitX96: zeroForOne ? 4295128740n : MAX_SQRT,
        recipient: account, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 90),
        expectedConfigHash: pool.configHash, wrapInput: false, unwrapOutput: false, unwrapRefund: false,
        oracleUpdates: updates,
      };
      const simulation: any = await walletProvider.simulateContract({ address: MAINNET.router, abi: routerAbi, functionName: 'swap', args: [request], account } as any);
      setMessage('Confirm swap in your wallet…');
      const hash = await walletClient.writeContract(simulation.request as any);
      setTxHash(hash); setMessage('Swap submitted. Waiting for Mainnet confirmation…');
      const receipt = await walletProvider.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Swap transaction reverted');
      setMessage(`Swap confirmed in block ${receipt.blockNumber}.`); setQuote(null); await loadWalletState();
    } catch (e) { const err = e as Error & { shortMessage?: string }; setError(err.shortMessage ?? err.message ?? 'Swap failed'); setMessage(''); }
    finally { setBusy(false); }
  };

  return <div className="app-swap-page mx-auto max-w-[1200px]">
    <header className="mb-7 max-w-3xl border-b border-line pb-6"><p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Swap / Robinhood Chain Mainnet</p><h1 className="mt-3 font-display text-[36px] font-bold leading-[1.06] tracking-[-0.04em] text-ink sm:text-[48px]">Quote, approve, and swap through BellRouter.</h1><p className="mt-4 text-sm leading-relaxed text-muted">Pool policy and output are simulated against the deployed contracts. Stock legs require fresh signed quote bundles.</p></header>
    {pools.length === 0 && !error && <section className="border border-line bg-surface/50 p-7"><h2 className="font-display text-2xl text-ink">No live pool to swap yet</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">No pool has been created on Mainnet. This screen reads the factory; it will enable trading after a pool and liquidity exist.</p><Link href="/pools" className="mt-5 inline-flex border border-ion/40 px-4 py-3 font-mono text-xs uppercase text-ion">Check live pools</Link></section>}
    {pools.length > 0 && pool && input && output && <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
      <section className="border border-line bg-surface/60 p-5 sm:p-7">
        <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Live pool</label>
        <select aria-label="Live pool" value={pool.hook} onChange={(e) => { setPool(pools.find((p) => p.hook === e.target.value) ?? null); setQuote(null); }} className="mt-2 min-h-12 w-full border border-line bg-bg-1 px-3 text-ink">{pools.map((p) => <option key={p.hook} value={p.hook}>{p.legs[0].symbol} / {p.legs[1].symbol} · {p.hook.slice(0, 10)}…</option>)}</select>
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3"><div className="border border-line bg-bg-1 p-4"><label htmlFor="swap-amount" className="font-mono text-[10px] uppercase text-dim">You pay</label><div className="mt-2 flex items-center gap-2"><input id="swap-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')); setQuote(null); }} placeholder="0.0" className="num min-w-0 flex-1 bg-transparent text-2xl text-ink outline-none"/><b className="text-sm text-ink">{input.symbol}</b></div><p className="mt-2 text-xs text-dim">Balance: {balance === null ? 'connect wallet' : displayAmount(balance, input.decimals)}</p></div>
          <button type="button" onClick={() => { setDirection((v) => !v); setQuote(null); }} aria-label="Reverse swap direction" className="grid h-10 w-10 place-items-center border border-line text-ion"><ArrowDownUp size={16}/></button>
          <div className="border border-line bg-bg-1 p-4"><span className="font-mono text-[10px] uppercase text-dim">Estimated output</span><p className="num mt-3 truncate text-xl text-ink">{quote ? displayAmount(quote.amountOut, output.decimals) : '—'}</p><p className="mt-2 text-xs text-dim">{output.symbol}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><label className="font-mono text-[10px] uppercase text-dim">Max slippage</label><div className="flex gap-2">{[[10, '0.1%'], [50, '0.5%'], [100, '1%']].map(([bps, label]) => <button key={bps} type="button" aria-pressed={slippage === bps} onClick={() => { setSlippage(Number(bps)); setQuote(null); }} className={`border px-3 py-2 font-mono text-xs ${slippage === bps ? 'border-ion text-ion' : 'border-line text-muted'}`}>{label}</button>)}</div></div>
        <div className="mt-5 flex flex-wrap gap-2">{status !== 'connected' ? <button type="button" onClick={() => void connect()} className="min-h-12 flex-1 bg-ion px-5 font-mono text-xs uppercase text-bg-0">Connect wallet</button> : wrongChain ? <button type="button" onClick={() => void switchChain(4663)} className="min-h-12 flex-1 border border-warn px-5 font-mono text-xs uppercase text-warn">Switch to Robinhood Chain</button> : <button type="button" disabled={busy || !amount || Number(amount) <= 0} onClick={() => void requestQuote()} className="min-h-12 flex-1 bg-ion px-5 font-mono text-xs uppercase text-bg-0 disabled:opacity-50">{busy ? 'Working…' : 'Get live quote'}</button>}
          {quote && account && allowance !== null && allowance < rawIn && <button type="button" disabled={busy} onClick={() => void approve()} className="min-h-12 flex-1 border border-ion px-5 font-mono text-xs uppercase text-ion disabled:opacity-50">Approve {input.symbol}</button>}
          {quote && account && allowance !== null && allowance >= rawIn && <button type="button" disabled={busy} onClick={() => void swap()} className="min-h-12 flex-1 bg-ion px-5 font-mono text-xs uppercase text-bg-0 disabled:opacity-50">Swap on Mainnet</button>}
        </div>
        {busy && <p className="mt-4 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="animate-spin" size={16}/>{message}</p>}
        {!busy && message && <p className="mt-4 flex items-center gap-2 text-sm text-ion"><CheckCircle2 size={16}/>{message}</p>}
        {error && <p role="alert" className="mt-4 flex items-start gap-2 border border-down/30 bg-down/5 p-3 text-sm text-down"><AlertTriangle size={16} className="mt-0.5 shrink-0"/>{error}</p>}
        {txHash && <a className="mt-4 inline-flex items-center gap-2 text-sm text-ion underline" href={`https://robinhoodchain.blockscout.com/tx/${txHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14}/></a>}
      </section>
      <aside className="space-y-4"><section className="border border-line bg-surface/50 p-5"><h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Onchain policy</h2><p className="mt-3 text-lg text-ink">{pool.policy.canSwap ? 'Currently tradable' : 'Fresh quote update required or policy blocked'}</p><p className="mt-2 text-xs leading-relaxed text-muted">Every quote and final transaction is simulated against the router with the signed stock updates included. The contract decides whether the swap can proceed.</p><dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-dim">Mode</dt><dd className="text-ink">{['Halted', 'Active', 'Closed', 'Recovering', 'Setup'][pool.policy.mode] ?? pool.policy.mode}</dd></div><div className="flex justify-between gap-3"><dt className="text-dim">Pool fee</dt><dd className="text-ink">{(pool.policy.lpFeeUnits / 10_000).toFixed(3)}%</dd></div><div className="flex justify-between gap-3"><dt className="text-dim">Quote observation age</dt><dd className="text-ink">{quote ? `${Math.max(0, Math.floor((now - quote.observedAt) / 1000))}s` : 'Not quoted'}</dd></div><div className="flex justify-between gap-3"><dt className="text-dim">Minimum received</dt><dd className="text-ink">{quote ? `${displayAmount(quote.minOut, output.decimals)} ${output.symbol}` : '—'}</dd></div></dl></section>
        <section className="border border-line p-5"><h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Live contract</h2><p className="mt-3 break-all font-mono text-xs text-dim">Hook: {pool.hook}</p><p className="mt-2 break-all font-mono text-xs text-dim">Pool ID: {pool.poolId}</p><a className="mt-4 inline-flex items-center gap-2 text-xs text-ion underline" href={`https://robinhoodchain.blockscout.com/address/${pool.hook}`} target="_blank" rel="noreferrer">Open in explorer <ExternalLink size={13}/></a></section>
        <button type="button" onClick={() => { setQuote(null); setError(''); setRefreshKey((v) => v + 1); }} className="inline-flex min-h-10 items-center gap-2 border border-line px-3 font-mono text-xs uppercase text-muted"><RefreshCw size={14}/>Refresh pool</button>
      </aside>
    </div>}
  </div>;
}

export default function SwapPage() {
  return <Suspense fallback={<div className="h-96 animate-pulse border border-line bg-surface/50" aria-busy="true"/>}><SwapInner/></Suspense>;
}
