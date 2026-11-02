'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { parseUnits } from 'viem';
import { AlertTriangle, ArrowDownUp, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { makeClients, useWallet } from '@/lib/wallet';
import { MAINNET, displayAmount, hookAbi, readLivePools, routerAbi, tokenAbi, type LivePool } from '@/lib/mainnet-live';
import { LogoSelect } from '@/components/ui/LogoSelect';
import { AppLoadingState } from '@/components/app/AppLoadingState';
import { SwapProgressModal, type SwapActionType } from '@/components/swap/SwapProgressModal';
// @ts-expect-error Shared decision helper is browser-safe and covered by node:test.
import { phaseLabel, quoteSourceForPhase } from '@/lib/swap-calendar.mjs';
// @ts-expect-error Shared math helper is browser-safe and covered by node:test.
import { calculateSwapBounds } from '@/lib/swap-quote.mjs';

const MAX_SQRT = 1461446703485210103287273052203988822378723970341n;
const isSuccessMessage = (msg: string) => msg.includes('confirmed') || msg.includes('confirmed.');

function SwapInner() {
  const params = useSearchParams();
  const { account, status, wrongChain, connect, switchChain, provider } = useWallet();
  const [pools, setPools] = useState<LivePool[]>([]);
  const [pool, setPool] = useState<LivePool | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [actionType, setActionType] = useState<SwapActionType>('swap');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    readLivePools().then((items) => {
      if (!active) return;
      setPools(items);
      const requested = params.get('hook')?.toLowerCase();
      setPool((current) => items.find((item) => item.hook.toLowerCase() === (requested ?? current?.hook.toLowerCase())) ?? items[0] ?? null);
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Could not read Mainnet pool state'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params, refreshKey]);

  const input = pool?.legs[direction ? 0 : 1];
  const output = pool?.legs[direction ? 1 : 0];
  const zeroForOne = direction;
  const rawSpecified = useMemo(() => {
    const token = exactInput ? input : output;
    try { return token && amount ? parseUnits(amount, token.decimals) : 0n; } catch { return 0n; }
  }, [amount, exactInput, input, output]);
  // The router pulls the input token with transferFrom, so a quote cannot even be simulated until
  // the allowance exists. The old flow only revealed Approve after a successful quote, which made a
  // fresh pool impossible to swap from the UI: simulate reverted on allowance, so Approve never
  // appeared. Approve is now driven by the allowance itself, sized from the typed amount.
  const approvalAmount = quote?.maxIn ?? (exactInput ? rawSpecified : 0n);
  const needsApproval = Boolean(
    account && allowance !== null && approvalAmount > 0n && allowance < approvalAmount,
  );
  const protectionFallback = Boolean(pool && pool.poolClass === 0 && (pool.policy.flags & 2) !== 0);
  const protectionLabel = !pool || pool.poolClass === 1 ? 'Not applicable' : protectionFallback ? 'AMM-only fallback' : 'Price protection active';
  const needsPolicyCheckpoint = Boolean(pool && !pool.policy.canSwap
    && (((pool.policy.reasonBits & (1n << 12n)) !== 0n)
      || (pool.policy.phase === 5 && pool.policy.mode === 2)));

  const loadWalletState = useCallback(async () => {
    if (!account || !input) { setBalance(null); setAllowance(null); return; }
    try {
      if (!provider) throw new Error('Wallet provider is not available');
      const { publicClient: connectedClient } = makeClients(provider);
      const [b, a] = await Promise.all([
        connectedClient.readContract({ address: input.address, abi: tokenAbi, functionName: 'balanceOf', args: [account] }),
        connectedClient.readContract({ address: input.address, abi: tokenAbi, functionName: 'allowance', args: [account, MAINNET.router] }),
      ]);
      setBalance(b); setAllowance(a);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read wallet token balance'); }
  }, [account, input, provider]);
  useEffect(() => { void loadWalletState(); }, [loadWalletState]);

  const buildUpdates = async () => {
    if (!pool) return [];
    // A market-price pool prices from its own liquidity, so it needs no external update and no
    // freshness gate. Sending one anyway would force the router through a feed the pool ignores.
    if (pool.poolClass === 1) return [];
    const source = quoteSourceForPhase(pool.policy.phase);
    if (source === 'anchor' || source === 'chainlink-feed') return [];
    if (source === 'unavailable') throw new Error('No price source is configured for this market phase. The router will only allow the swap if its onchain reference path is valid.');
    throw new Error('This market phase has no configured onchain stock price path.');
  };

  const requestQuote = async () => {
    if (!pool || !input || !output || rawSpecified <= 0n) throw new Error(`Enter a valid ${exactInput ? 'input' : 'output'} amount`);
    if (pool.lifecycle === 3) { setError('This pool is staged. Refresh its policy state; swaps unlock when the factory activates it.'); return; }
    if (wrongChain) throw new Error('Switch your wallet to Robinhood Chain Mainnet first');
    const anchored = quoteSourceForPhase(pool.policy.phase) === 'anchor';
    const onchainFeed = quoteSourceForPhase(pool.policy.phase) === 'chainlink-feed';
    setBusy(true); setError(''); setMessage(anchored ? 'Simulating against the verified weekend reference and live pool state…' : onchainFeed ? 'Checking fresh Chainlink feed rounds onchain and simulating…' : 'Simulating against the live router…'); setQuote(null); setTxHash(null);
    try {
      if (!provider || !account) throw new Error('Connect your Robinhood Chain wallet first');
      const { publicClient: connectedClient } = makeClients(provider);
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
      setMessage(`${protectionFallback ? 'Own-market fallback' : pool.poolClass === 1 ? 'Market price' : anchored ? 'External price check' : onchainFeed ? 'Live external price' : 'Live price'} simulation succeeded. Review ${exactInput ? 'minimum output' : 'maximum input'}, approve, then submit.`);
      await loadWalletState();
    } catch (e) { const err = e as Error & { shortMessage?: string }; setError(err.shortMessage ?? err.message ?? 'Could not quote this swap'); setMessage(''); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    if (!account || !input || approvalAmount <= 0n || !provider) return;
    if (balance !== null && balance < approvalAmount) { setError(`Insufficient ${input.symbol} balance for the quoted maximum input.`); return; }
    setActionType('approve');
    setShowModal(true);
    setTxHash(null);
    setBusy(true); setError(''); setMessage('Confirm token approval in your wallet…');
    try {
      const { walletClient } = makeClients(provider);
      // ERC-20 approve takes (spender, amount). Passing only the amount made viem throw
      // "ABI encoding params/values length mismatch" before the wallet ever saw the transaction.
      const hash = await walletClient.writeContract({
        address: input.address, abi: tokenAbi, functionName: 'approve',
        args: [MAINNET.router, approvalAmount], account,
      } as any);
      setMessage('Waiting for approval confirmation…');
      const { publicClient: connectedClient } = makeClients(provider);
      const receipt = await connectedClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Token approval reverted');
      await loadWalletState();
      setMessage('Approval confirmed. Pricing the swap against the live pool…');
      // Approval exists now, so the simulation that failed on allowance can succeed. Run it
      // immediately instead of making the user hunt for a second button.
      setShowModal(false);
      await requestQuote();
    } catch (e) { const err = e as Error & { shortMessage?: string }; setError(err.shortMessage ?? err.message ?? 'Approval failed'); setMessage(''); }
    finally { setBusy(false); }
  };

  const swap = async () => {
    if (!account || !pool || !input || !quote || !provider) return;
    if (Date.now() - quote.stamp > 25_000) { setError('Quote expired. Request a fresh quote before submitting.'); return; }
    const anchored = quoteSourceForPhase(pool.policy.phase) === 'anchor';
    const onchainFeed = quoteSourceForPhase(pool.policy.phase) === 'chainlink-feed';
    setActionType('swap');
    setShowModal(true);
    setTxHash(null);
    setBusy(true); setError(''); setMessage(anchored ? 'Rechecking the weekend reference and simulating the exact transaction…' : onchainFeed ? 'Rechecking Chainlink feed freshness and simulating the exact transaction…' : 'Simulating the exact transaction…');
    try {
      const { publicClient: walletProvider, walletClient } = makeClients(provider);
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

  const checkpointPolicy = async () => {
    if (!account || !provider || !pool) return;
    setActionType('checkpoint');
    setShowModal(true);
    setTxHash(null);
    setBusy(true); setError(''); setMessage('Confirm the onchain policy checkpoint in your wallet…');
    try {
      const { publicClient: client, walletClient } = makeClients(provider);
      const simulation = await client.simulateContract({ address: pool.hook, abi: hookAbi, functionName: 'refreshState', account } as any);
      const hash = await walletClient.writeContract(simulation.request as any);
      setMessage('Waiting for the recovery checkpoint…');
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Policy checkpoint reverted');
      setMessage(`Policy checkpoint confirmed in block ${receipt.blockNumber}. Refreshing live policy…`);
      setRefreshKey((value) => value + 1);
    } catch (e) { const err = e as Error & { shortMessage?: string }; setError(err.shortMessage ?? err.message ?? 'Could not checkpoint policy'); setMessage(''); }
    finally { setBusy(false); }
  };

  return <div className="app-swap-page app-content-frame space-y-7">
    <header>
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Swap · BELL Mainnet</p>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-ink">Quote, approve, and swap through BellRouter.</h1>
      <p className="mt-3 max-w-3xl text-base text-muted">Every swap is simulated against the deployed hook before your wallet signs it. Fees, flow limits, pause state and closure budgets are enforced onchain.</p>
    </header>
    {loading && pools.length === 0 && !error && <AppLoadingState label="Reading the live pool directory" variant="cards" />}
    {!loading && pools.length === 0 && !error && <section className="border border-line bg-surface p-7"><h2 className="font-display text-2xl text-ink">Pick a pool to trade</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">This screen reads the live factory directory. Create a pool first and it appears here with its liquidity, fee and limits ready to trade.</p><Link href="/create" className="mt-5 inline-flex border border-ion/40 px-4 py-3 font-mono text-xs uppercase text-ion">Create a pool</Link></section>}
    {pools.length > 0 && pool && input && output && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
      <section className="border border-line bg-surface p-5 sm:p-7">
        <label id="swap-live-pool-label" className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Live pool</label>
        <LogoSelect id="swap-live-pool" labelId="swap-live-pool-label" value={pool.hook} className="mt-2" options={pools.map((item) => ({ value: item.hook, label: `${item.legs[0].symbol} / ${item.legs[1].symbol}`, detail: `${item.poolClass === 0 ? 'Checked price' : 'Market price'} · ${item.lifecycle === 3 ? 'STAGED' : item.policy.flags & 2 ? 'OWN-MARKET FALLBACK' : item.policy.canSwap ? 'TRADABLE' : 'POLICY BLOCKED'}`, symbols: [item.legs[0].symbol, item.legs[1].symbol] }))} onChange={(hook) => { setPool(pools.find((item) => item.hook === hook) ?? null); setQuote(null); setError(''); }}/>
        {pool.lifecycle === 3 && <p className="mt-4 border border-warn/40 bg-warn/5 p-3 text-sm text-warn">Pool is staged and not tradable yet. Refresh its policy state to check whether the factory has activated it.</p>}
        {pool.funded === false && <p className="mt-4 border border-warn/40 bg-warn/5 p-3 text-sm text-warn">This pool has no liquidity, so there is nothing to trade against. Add liquidity from Positions, or pick another pool.</p>}
        {protectionFallback && <p className="mt-4 border border-warn/40 bg-warn/5 p-3 text-sm text-warn">External price protection is currently unavailable. This pool is using its AMM price with a 1% fee and the strictest flow caps. The pool price can diverge from the stock price.</p>}
        {needsPolicyCheckpoint && <div className="mt-4 border border-warn/40 bg-warn/5 p-3 text-sm text-warn"><p>{(pool.policy.reasonBits & (1n << 12n)) !== 0n ? 'Policy recovery needs a checkpoint. After the first checkpoint, wait at least 60 seconds for the next valid time observation, then checkpoint again.' : 'The hook needs to commit the scheduled CLOSED state before swaps can use the closed-session fallback.'}</p>{account && !wrongChain && <button type="button" disabled={busy} onClick={() => void checkpointPolicy()} className="mt-3 min-h-10 border border-warn/50 px-3 font-mono text-[10px] uppercase disabled:opacity-50">{busy ? 'Working…' : 'Checkpoint policy'}</button>}</div>}
        <div className="mt-5 flex gap-2" role="group" aria-label="Swap amount mode"><button type="button" aria-pressed={exactInput} onClick={() => { setExactInput(true); setAmount(''); setQuote(null); }} className={`border px-3 py-2 font-mono text-[10px] uppercase ${exactInput ? 'border-ion text-ion' : 'border-line text-muted'}`}>Exact input</button><button type="button" aria-pressed={!exactInput} onClick={() => { setExactInput(false); setAmount(''); setQuote(null); }} className={`border px-3 py-2 font-mono text-[10px] uppercase ${!exactInput ? 'border-ion text-ion' : 'border-line text-muted'}`}>Exact output</button></div>
        <div className="mt-4 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="border border-line bg-bg-1 p-4"><label htmlFor="swap-amount" className="font-mono text-[10px] uppercase text-dim">{exactInput ? 'You pay' : 'You receive'}</label><div className="mt-2 flex items-center gap-2"><input id="swap-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')); setQuote(null); }} placeholder="0.0" className="num min-w-0 flex-1 bg-transparent text-2xl text-ink outline-none"/><b className="shrink-0 text-sm text-ink">{exactInput ? input.symbol : output.symbol}</b></div><p className="mt-2 truncate text-xs text-dim">Balance {balance === null ? 'connect wallet' : `${displayAmount(balance, input.decimals)} ${input.symbol}`}</p></div>
          <button type="button" onClick={() => { setDirection((v) => !v); setQuote(null); }} aria-label="Reverse swap direction" className="mx-auto grid h-10 w-10 place-items-center self-center border border-line text-ion transition-colors hover:border-ion"><ArrowDownUp size={16}/></button>
          <div className="border border-line bg-bg-1 p-4"><span className="font-mono text-[10px] uppercase text-dim">{exactInput ? 'Estimated output' : 'Estimated input'}</span><p className="num mt-3 truncate text-xl text-ink">{quote ? displayAmount(exactInput ? quote.amountOut : quote.amountIn, exactInput ? output.decimals : input.decimals) : '—'}</p><p className="mt-2 truncate text-xs text-dim">{exactInput ? output.symbol : input.symbol}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><label className="font-mono text-[10px] uppercase text-dim">Max slippage</label><div className="flex gap-2">{[[10, '0.1%'], [50, '0.5%'], [100, '1%']].map(([bps, label]) => <button key={bps} type="button" aria-pressed={slippage === bps} onClick={() => { setSlippage(Number(bps)); setQuote(null); }} className={`border px-3 py-2 font-mono text-xs ${slippage === bps ? 'border-ion text-ion' : 'border-line text-muted'}`}>{label}</button>)}</div></div>
        <div className="mt-5 space-y-2">{status !== 'connected' ? <button type="button" onClick={() => void connect()} className="min-h-11 w-full border border-ion bg-ion px-5 font-mono text-xs uppercase tracking-[0.08em] text-bg-0 transition-opacity hover:opacity-90">Connect wallet</button> : wrongChain ? <button type="button" onClick={() => void switchChain(4663)} className="min-h-11 w-full border border-warn px-5 font-mono text-xs uppercase tracking-[0.08em] text-warn">Switch to Robinhood Chain</button> : pool.funded === false ? <button type="button" disabled className="min-h-11 w-full border border-line px-5 font-mono text-xs uppercase tracking-[0.08em] text-dim">Pool has no liquidity</button> : needsApproval ? <button type="button" disabled={busy} onClick={() => void approve()} className="min-h-11 w-full border border-ion px-5 font-mono text-xs uppercase tracking-[0.08em] text-ion transition-colors hover:bg-ion/10 disabled:opacity-50">{busy ? 'Approving…' : `Approve ${input.symbol}`}</button> : <button type="button" disabled={busy || rawSpecified <= 0n || pool.lifecycle === 3} onClick={() => void requestQuote()} className="min-h-11 w-full border border-ion bg-ion px-5 font-mono text-xs uppercase tracking-[0.08em] text-bg-0 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-dim disabled:opacity-100">{pool.lifecycle === 3 ? 'Waiting for verified price' : busy ? 'Working…' : rawSpecified <= 0n ? 'Enter an amount' : quote ? 'Refresh quote' : 'Simulate swap'}</button>}
          {quote && !needsApproval && <button type="button" disabled={busy || (balance !== null && balance < quote.maxIn)} onClick={() => void swap()} className="min-h-11 w-full border border-ion bg-ion px-5 font-mono text-xs uppercase tracking-[0.08em] text-bg-0 transition-opacity hover:opacity-90 disabled:opacity-50">Swap on Mainnet</button>}
        </div>
        {needsApproval && (
          <p className="mt-3 text-xs leading-relaxed text-dim">
            The router needs an allowance before it can price the swap. Approve {input.symbol}, then simulate.
          </p>
        )}
        {/* Reopen progress monitor if closed */}
        {!showModal && (busy || message || error || txHash) && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="mt-4 flex w-full items-center justify-between border border-line bg-surface/60 p-3 font-mono text-xs text-muted hover:border-ion hover:text-ink transition-colors"
          >
            <span className="flex items-center gap-2 truncate">
              {busy ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin text-ion" />
              ) : isSuccessMessage(message) ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-up" />
              ) : error ? (
                <AlertTriangle className="h-3.5 w-3.5 text-down" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-ion" />
              )}
              <span className="font-semibold text-ink">Transaction status:</span>
              <span className="truncate">{error ? error : message}</span>
            </span>
            <span className="text-ion underline shrink-0 ml-2">Open monitor ↗</span>
          </button>
        )}

        {busy && <p className="mt-4 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="animate-spin" size={16}/>{message}</p>}
        {!busy && message && <p className="mt-4 flex items-center gap-2 text-sm text-ion"><CheckCircle2 size={16}/>{message}</p>}
        {error && <p role="alert" className="mt-4 flex items-start gap-2 border border-down/30 bg-down/5 p-3 text-sm text-down"><AlertTriangle size={16} className="mt-0.5 shrink-0"/>{error}</p>}
        {txHash && <a className="mt-4 inline-flex items-center gap-2 text-sm text-ion underline" href={`https://robinhoodchain.blockscout.com/tx/${txHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14}/></a>}

        {/* Swap Action Progress Modal */}
        <SwapProgressModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          actionType={actionType}
          busy={busy}
          message={message}
          error={error}
          txHash={txHash}
          inputSymbol={input?.symbol ?? ''}
          outputSymbol={output?.symbol ?? ''}
          inputAmount={exactInput ? amount : quote ? displayAmount(quote.amountIn, input?.decimals ?? 18) : undefined}
          outputAmount={!exactInput ? amount : quote ? displayAmount(quote.amountOut, output?.decimals ?? 18) : undefined}
          onRetry={actionType === 'approve' ? () => void approve() : actionType === 'swap' ? () => void swap() : () => void checkpointPolicy()}
        />
      </section>
      <aside className="space-y-4">
        <section className="border border-line bg-surface p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Onchain policy</h2>
            <button type="button" onClick={() => { setQuote(null); setError(''); setRefreshKey((v) => v + 1); }} className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase text-muted transition-colors hover:text-ink"><RefreshCw size={12}/>Refresh</button>
          </div>
          <p className="mt-3 text-lg text-ink">{pool.lifecycle === 3 ? 'Staged · swaps unavailable' : pool.policy.canSwap ? 'Currently tradable' : 'Policy blocks this swap'}</p>
          <dl className="mt-4 divide-y divide-line text-sm">
            <div className="flex items-baseline justify-between gap-3 py-2"><dt className="shrink-0 text-dim">Lifecycle</dt><dd className="text-right text-ink">{pool.lifecycle === 3 ? 'Staged' : 'Live'}</dd></div>
            <div className="flex items-baseline justify-between gap-3 py-2"><dt className="shrink-0 text-dim">Price protection</dt><dd className="text-right text-ink">{protectionLabel}</dd></div>
            <div className="flex items-baseline justify-between gap-3 py-2"><dt className="shrink-0 text-dim">Mode · phase</dt><dd className="text-right text-ink">{['Halted', 'Active', 'Market-free', 'Recovering', 'Setup'][pool.policy.mode] ?? pool.policy.mode} · {phaseLabel(pool.policy.phase)}</dd></div>
            <div className="flex items-baseline justify-between gap-3 py-2"><dt className="shrink-0 text-dim">Pool fee</dt><dd className="text-right text-ink">{protectionFallback ? '1.000% fallback maximum' : quote ? 'Applied in router simulation' : 'Calculated onchain'}</dd></div>
            <div className="flex items-baseline justify-between gap-3 py-2"><dt className="shrink-0 text-dim">Per-trade cap</dt><dd className="text-right text-ink">{displayAmount(pool.policy.effectiveTradeCap[0], pool.legs[0].decimals)} {pool.legs[0].symbol} / {displayAmount(pool.policy.effectiveTradeCap[1], pool.legs[1].decimals)} {pool.legs[1].symbol}</dd></div>
            <div className="flex items-baseline justify-between gap-3 py-2"><dt className="shrink-0 text-dim">Rolling room</dt><dd className="text-right text-ink">{displayAmount(pool.policy.rollingRemaining[0], pool.legs[0].decimals)} {pool.legs[0].symbol} / {displayAmount(pool.policy.rollingRemaining[1], pool.legs[1].decimals)} {pool.legs[1].symbol}</dd></div>
            <div className="flex items-baseline justify-between gap-3 py-2"><dt className="shrink-0 text-dim">{pool.policy.phase === 5 ? 'Stock reference' : 'Price input'}</dt><dd className="text-right text-ink">{protectionFallback ? 'Unavailable · own-market fallback' : pool.poolClass === 1 ? 'Pool market price' : quote ? 'Checked in simulation' : 'Checked by router'}</dd></div>
            <div className="flex items-baseline justify-between gap-3 py-2"><dt className="shrink-0 text-dim">{exactInput ? 'Minimum received' : 'Maximum paid'}</dt><dd className="text-right text-ink">{quote ? exactInput ? `${displayAmount(quote.minOut, output.decimals)} ${output.symbol}` : `${displayAmount(quote.maxIn, input.decimals)} ${input.symbol}` : '—'}</dd></div>
            <div className="flex items-baseline justify-between gap-3 py-2"><dt className="shrink-0 text-dim">Valid until</dt><dd className="text-right text-ink">{pool.policy.validUntil ? new Date(Number(pool.policy.validUntil) * 1000).toLocaleString() : '—'}</dd></div>
          </dl>
        </section>
        <section className="border border-line bg-surface p-5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Live contract</h2>
          <dl className="mt-3 space-y-3">
            <div><dt className="font-mono text-[10px] uppercase text-dim">Hook</dt><dd className="mt-1 break-all font-mono text-xs leading-relaxed text-ink">{pool.hook}</dd></div>
            <div><dt className="font-mono text-[10px] uppercase text-dim">Pool ID</dt><dd className="mt-1 break-all font-mono text-xs leading-relaxed text-ink">{pool.poolId}</dd></div>
          </dl>
          <a className="mt-4 inline-flex items-center gap-2 text-xs text-ion underline" href={`https://robinhoodchain.blockscout.com/address/${pool.hook}`} target="_blank" rel="noreferrer">Open in explorer <ExternalLink size={13}/></a>
        </section>
      </aside>
    </div>}
  </div>;
}

export default function SwapPage() {
  return <Suspense fallback={<div className="app-content-frame"><AppLoadingState label="Preparing the swap desk" variant="cards" /></div>}><SwapInner/></Suspense>;
}
