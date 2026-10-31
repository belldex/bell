'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { parseUnits } from 'viem';
import { AlertTriangle, ArrowDownUp, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { makeClients, useWallet } from '@/lib/wallet';
import { MAINNET, displayAmount, readLivePools, routerAbi, tokenAbi, type LivePool } from '@/lib/mainnet-live';
import { LogoSelect } from '@/components/ui/LogoSelect';
// @ts-expect-error Shared decision helper is browser-safe and covered by node:test.
import { phaseLabel, quoteSourceForPhase } from '@/lib/swap-calendar.mjs';
// @ts-expect-error Shared math helper is browser-safe and covered by node:test.
import { calculateSwapBounds } from '@/lib/swap-quote.mjs';

const MAX_SQRT = 1461446703485210103287273052203988822378723970341n;

function SwapInner() {
  const params = useSearchParams();
  const { account, status, wrongChain, connect, switchChain } = useWallet();
  const [pools, setPools] = useState<LivePool[]>([]);
  const [pool, setPool] = useState<LivePool | null>(null);
  const [direction, setDirection] = useState(true);
  const [exactInput, setExactInput] = useState(true);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(50);
  const [quote, setQuote] = useState<{ amountIn: bigint; amountOut: bigint; maxIn: bigint; minOut: bigint; stamp: number } | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
  const rawSpecified = useMemo(() => {
    const token = exactInput ? input : output;
    try { return token && amount ? parseUnits(amount, token.decimals) : 0n; } catch { return 0n; }
  }, [amount, exactInput, input, output]);
  const approvalAmount = quote?.maxIn ?? (exactInput ? rawSpecified : 0n);

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
    const source = quoteSourceForPhase(pool.policy.phase);
    if (source === 'anchor' || source === 'chainlink-feed') return [];
    if (source === 'unavailable') throw new Error('No live price source is configured for this market phase. The router will only allow the swap if its onchain reference path is valid.');
    throw new Error('This market phase has no configured onchain stock price path.');
  };

  const requestQuote = async () => {
    if (!pool || !input || !output || rawSpecified <= 0n) throw new Error(`Enter a valid ${exactInput ? 'input' : 'output'} amount`);
    if (wrongChain) throw new Error('Switch your wallet to Robinhood Chain Mainnet first');
    const anchored = quoteSourceForPhase(pool.policy.phase) === 'anchor';
    const onchainFeed = quoteSourceForPhase(pool.policy.phase) === 'chainlink-feed';
    setBusy(true); setError(''); setMessage(anchored ? 'Simulating against the verified weekend reference and live pool state…' : onchainFeed ? 'Checking fresh Chainlink feed rounds onchain and simulating…' : 'Simulating against the live router…'); setQuote(null); setTxHash(null);
    try {
      if (!window.ethereum || !account) throw new Error('Connect your Robinhood Chain wallet first');
      const { publicClient: connectedClient } = makeClients(window.ethereum);
      const updates = await buildUpdates();
      const nonce = await connectedClient.readContract({ address: MAINNET.router, abi: routerAbi, functionName: 'nonces', args: [account] }) as bigint;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 90);
      const request = {
        hook: pool.hook, zeroForOne, exactInput, amountSpecified: rawSpecified,
        limitAmount: exactInput ? 1n : (1n << 128n) - 1n,
        sqrtPriceLimitX96: zeroForOne ? 4295128740n : MAX_SQRT,
        recipient: account, nonce, deadline,
        expectedConfigHash: pool.configHash, wrapInput: false, unwrapOutput: false, unwrapRefund: false,
        oracleUpdates: updates,
      };
      const simulation: any = await connectedClient.simulateContract({ address: MAINNET.router, abi: routerAbi, functionName: 'swap', args: [request], account } as any);
      const amountIn = BigInt(simulation.result[0]);
      const amountOut = BigInt(simulation.result[1]);
      const { maxIn, minOut } = calculateSwapBounds({ exactInput, amountIn, amountOut, slippageBps: slippage });
      if (minOut <= 0n) throw new Error('Router simulation returned zero minimum output');
      setQuote({ amountIn, amountOut, maxIn, minOut, stamp: Date.now() });
      setMessage(`${anchored ? 'Weekend-reference' : onchainFeed ? 'Fresh onchain-feed' : 'Live-price'} router simulation succeeded. Review ${exactInput ? 'minimum output' : 'maximum input'}, approve, then submit.`);
      await loadWalletState();
    } catch (e) { const err = e as Error & { shortMessage?: string }; setError(err.shortMessage ?? err.message ?? 'Could not quote this swap'); setMessage(''); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    if (!account || !input || approvalAmount <= 0n || !window.ethereum) return;
    if (balance !== null && balance < approvalAmount) { setError(`Insufficient ${input.symbol} balance for the quoted maximum input.`); return; }
    setBusy(true); setError(''); setMessage('Confirm token approval in your wallet…');
    try {
      const { walletClient } = makeClients(window.ethereum);
      const hash = await walletClient.writeContract({ address: input.address, abi: tokenAbi, functionName: 'approve', args: [approvalAmount], account } as any);
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
    const anchored = quoteSourceForPhase(pool.policy.phase) === 'anchor';
    const onchainFeed = quoteSourceForPhase(pool.policy.phase) === 'chainlink-feed';
    setBusy(true); setError(''); setMessage(anchored ? 'Rechecking the weekend reference and simulating the exact transaction…' : onchainFeed ? 'Rechecking Chainlink feed freshness and simulating the exact transaction…' : 'Simulating the exact transaction…');
    try {
      const { publicClient: walletProvider, walletClient } = makeClients(window.ethereum);
      const updates = await buildUpdates();
      const nonce = await walletProvider.readContract({ address: MAINNET.router, abi: routerAbi, functionName: 'nonces', args: [account] }) as bigint;
      const request = {
        hook: pool.hook, zeroForOne, exactInput, amountSpecified: rawSpecified,
        limitAmount: exactInput ? quote.minOut : quote.maxIn,
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
    <header className="mb-7 max-w-3xl border-b border-line pb-6"><p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Swap / Robinhood Chain Mainnet</p><h1 className="mt-3 font-display text-[36px] font-bold leading-[1.06] tracking-[-0.04em] text-ink sm:text-[48px]">Quote, approve, and swap through BellRouter.</h1><p className="mt-4 text-sm leading-relaxed text-muted">Every swap is simulated against deployed policy. During PRE, REGULAR, POST, and OVERNIGHT, the contract reads Chainlink’s onchain price feed and rejects rounds 120 seconds old or older. Feed updates can be intermittent. Closed-session swaps also require a verified stored close reference; the active registry currently has no valid close anchor.</p></header>
    {pools.length === 0 && !error && <section className="border border-line bg-surface/50 p-7"><h2 className="font-display text-2xl text-ink">No live pool to swap yet</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">No pool has been created on Mainnet. This screen reads the factory; it will enable trading after a pool and liquidity exist.</p><Link href="/pools" className="mt-5 inline-flex border border-ion/40 px-4 py-3 font-mono text-xs uppercase text-ion">Check live pools</Link></section>}
    {pools.length > 0 && pool && input && output && <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
      <section className="border border-line bg-surface/60 p-5 sm:p-7">
        <label id="swap-live-pool-label" className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Live pool</label>
        <LogoSelect id="swap-live-pool" labelId="swap-live-pool-label" value={pool.hook} className="mt-2" options={pools.map((item) => ({ value: item.hook, label: `${item.legs[0].symbol} / ${item.legs[1].symbol}`, detail: `${item.poolClass === 0 ? 'PRICE_GUARDED' : 'SESSION_ONLY'} · ${item.policy.canSwap ? 'TRADABLE' : 'POLICY BLOCKED'}`, symbols: [item.legs[0].symbol, item.legs[1].symbol] }))} onChange={(hook) => { setPool(pools.find((item) => item.hook === hook) ?? null); setQuote(null); setError(''); }}/>
        <div className="mb-4 flex gap-2" role="group" aria-label="Swap amount mode"><button type="button" aria-pressed={exactInput} onClick={() => { setExactInput(true); setAmount(''); setQuote(null); }} className={`border px-3 py-2 font-mono text-[10px] uppercase ${exactInput ? 'border-ion text-ion' : 'border-line text-muted'}`}>Exact input</button><button type="button" aria-pressed={!exactInput} onClick={() => { setExactInput(false); setAmount(''); setQuote(null); }} className={`border px-3 py-2 font-mono text-[10px] uppercase ${!exactInput ? 'border-ion text-ion' : 'border-line text-muted'}`}>Exact output</button></div>
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3"><div className="border border-line bg-bg-1 p-4"><label htmlFor="swap-amount" className="font-mono text-[10px] uppercase text-dim">{exactInput ? 'You pay' : 'You receive'}</label><div className="mt-2 flex items-center gap-2"><input id="swap-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')); setQuote(null); }} placeholder="0.0" className="num min-w-0 flex-1 bg-transparent text-2xl text-ink outline-none"/><b className="text-sm text-ink">{exactInput ? input.symbol : output.symbol}</b></div><p className="mt-2 text-xs text-dim">Input balance: {balance === null ? 'connect wallet' : `${displayAmount(balance, input.decimals)} ${input.symbol}`}</p></div>
          <button type="button" onClick={() => { setDirection((v) => !v); setQuote(null); }} aria-label="Reverse swap direction" className="grid h-10 w-10 place-items-center border border-line text-ion"><ArrowDownUp size={16}/></button>
          <div className="border border-line bg-bg-1 p-4"><span className="font-mono text-[10px] uppercase text-dim">{exactInput ? 'Estimated output' : 'Estimated input'}</span><p className="num mt-3 truncate text-xl text-ink">{quote ? displayAmount(exactInput ? quote.amountOut : quote.amountIn, exactInput ? output.decimals : input.decimals) : '—'}</p><p className="mt-2 text-xs text-dim">{exactInput ? output.symbol : input.symbol}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><label className="font-mono text-[10px] uppercase text-dim">Max slippage</label><div className="flex gap-2">{[[10, '0.1%'], [50, '0.5%'], [100, '1%']].map(([bps, label]) => <button key={bps} type="button" aria-pressed={slippage === bps} onClick={() => { setSlippage(Number(bps)); setQuote(null); }} className={`border px-3 py-2 font-mono text-xs ${slippage === bps ? 'border-ion text-ion' : 'border-line text-muted'}`}>{label}</button>)}</div></div>
        <div className="mt-5 flex flex-wrap gap-2">{status !== 'connected' ? <button type="button" onClick={() => void connect()} className="min-h-12 flex-1 bg-ion px-5 font-mono text-xs uppercase text-bg-0">Connect wallet</button> : wrongChain ? <button type="button" onClick={() => void switchChain(4663)} className="min-h-12 flex-1 border border-warn px-5 font-mono text-xs uppercase text-warn">Switch to Robinhood Chain</button> : <button type="button" disabled={busy || rawSpecified <= 0n} onClick={() => void requestQuote()} className="min-h-12 flex-1 bg-ion px-5 font-mono text-xs uppercase text-bg-0 disabled:opacity-50">{busy ? 'Working…' : 'Simulate swap'}</button>}
          {quote && account && allowance !== null && allowance < quote.maxIn && <button type="button" disabled={busy} onClick={() => void approve()} className="min-h-12 flex-1 border border-ion px-5 font-mono text-xs uppercase text-ion disabled:opacity-50">Approve up to {input.symbol}</button>}
        {quote && account && allowance !== null && allowance >= quote.maxIn && <button type="button" disabled={busy || (balance !== null && balance < quote.maxIn)} onClick={() => void swap()} className="min-h-12 flex-1 bg-ion px-5 font-mono text-xs uppercase text-bg-0 disabled:opacity-50">Swap on Mainnet</button>}
        </div>
        {busy && <p className="mt-4 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="animate-spin" size={16}/>{message}</p>}
        {!busy && message && <p className="mt-4 flex items-center gap-2 text-sm text-ion"><CheckCircle2 size={16}/>{message}</p>}
        {error && <p role="alert" className="mt-4 flex items-start gap-2 border border-down/30 bg-down/5 p-3 text-sm text-down"><AlertTriangle size={16} className="mt-0.5 shrink-0"/>{error}</p>}
        {txHash && <a className="mt-4 inline-flex items-center gap-2 text-sm text-ion underline" href={`https://robinhoodchain.blockscout.com/tx/${txHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14}/></a>}
      </section>
      <aside className="space-y-4"><section className="border border-line bg-surface/50 p-5"><h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Onchain policy</h2><p className="mt-3 text-lg text-ink">{pool.policy.canSwap ? 'Currently tradable' : pool.policy.phase === 5 ? 'Verified close anchor required or policy blocked' : 'Fresh Chainlink round required or policy blocked'}</p><p className="mt-2 text-xs leading-relaxed text-muted">The router simulates every swap. During PRE, REGULAR, POST, and OVERNIGHT it checks the Chainlink round directly onchain; a round 120 seconds old or older fails closed. During a closed session it requires a stored close reference; the active registry currently has no valid anchor.</p><dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-dim">Mode · phase</dt><dd className="text-ink">{['Halted', 'Active', 'Market-free', 'Recovering', 'Setup'][pool.policy.mode] ?? pool.policy.mode} · {phaseLabel(pool.policy.phase)}</dd></div><div className="flex justify-between gap-3"><dt className="text-dim">Pool fee</dt><dd className="text-ink">{(pool.policy.lpFeeUnits / 10_000).toFixed(3)}%</dd></div><div className="flex justify-between gap-3"><dt className="text-dim">{pool.policy.phase === 5 ? 'Stock reference' : 'Chainlink feed'}</dt><dd className="text-ink">{pool.policy.phase === 5 ? 'Stored historical reference' : quote ? 'Fresh in simulation' : 'Checked by router'}</dd></div><div className="flex justify-between gap-3"><dt className="text-dim">{exactInput ? 'Minimum received' : 'Maximum paid'}</dt><dd className="text-ink">{quote ? exactInput ? `${displayAmount(quote.minOut, output.decimals)} ${output.symbol}` : `${displayAmount(quote.maxIn, input.decimals)} ${input.symbol}` : '—'}</dd></div><div className="flex justify-between gap-3"><dt className="text-dim">Valid until</dt><dd className="text-ink">{pool.policy.validUntil ? new Date(Number(pool.policy.validUntil) * 1000).toLocaleString() : '—'}</dd></div></dl></section>
        <section className="border border-line p-5"><h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Live contract</h2><p className="mt-3 break-all font-mono text-xs text-dim">Hook: {pool.hook}</p><p className="mt-2 break-all font-mono text-xs text-dim">Pool ID: {pool.poolId}</p><a className="mt-4 inline-flex items-center gap-2 text-xs text-ion underline" href={`https://robinhoodchain.blockscout.com/address/${pool.hook}`} target="_blank" rel="noreferrer">Open in explorer <ExternalLink size={13}/></a></section>
        <button type="button" onClick={() => { setQuote(null); setError(''); setRefreshKey((v) => v + 1); }} className="inline-flex min-h-10 items-center gap-2 border border-line px-3 font-mono text-xs uppercase text-muted"><RefreshCw size={14}/>Refresh pool</button>
      </aside>
    </div>}
  </div>;
}

export default function SwapPage() {
  return <Suspense fallback={<div className="h-96 animate-pulse border border-line bg-surface/50" aria-busy="true"/>}><SwapInner/></Suspense>;
}
