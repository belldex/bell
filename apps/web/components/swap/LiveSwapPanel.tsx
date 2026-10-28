'use client';

/**
 * Live swap panel.
 *
 * Renders only when a real pool exists and the wallet is on testnet. It reads the hook policy
 * onchain, so the button state is the protocol's answer, not a UI guess. If the pool is halted the
 * panel says so and refuses to build a transaction.
 *
 * The demo fixture flow stays untouched elsewhere; this component is additive and only appears
 * when a live pool address is configured.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { useWallet } from '@/lib/wallet';
import {
  ERC20_ABI,
  ROUTER,
  SWAP_ABI,
  buildSwapRequest,
  describeSwapError,
  maxUint256,
  publicClientFor,
  readAllowance,
  readLivePool,
  readRouterNonce,
  type LivePoolState,
} from '@/lib/live-swap';
import { createWalletClient, custom, parseUnits, type Address } from 'viem';
import { TESTNET } from '@bell/protocol/testnet-status';

/** viem requires an explicit chain object for wallet writes. */
const chain = {
  id: TESTNET.chainId,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [] as string[] } },
} as const;

/** Set NEXT_PUBLIC_BELL_LIVE_HOOK once a pool is live to enable this panel. */
const LIVE_HOOK = (process.env.NEXT_PUBLIC_BELL_LIVE_HOOK ?? '') as Address | '';

type Stage = 'idle' | 'reading' | 'approving' | 'swapping' | 'done' | 'failed';

export function LiveSwapPanel() {
  const wallet = useWallet();
  const [pool, setPool] = useState<LivePoolState | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [amount, setAmount] = useState('0.001');
  const [zeroForOne, setZeroForOne] = useState(true);
  const [decimalsIn, setDecimalsIn] = useState(18);
  const [txHash, setTxHash] = useState<string | null>(null);

  const enabled = Boolean(LIVE_HOOK) && wallet.status === 'connected' && wallet.chainId === TESTNET.chainId;

  const refresh = useCallback(async () => {
    if (!LIVE_HOOK) return;
    setStage('reading');
    try {
      const provider = (window as unknown as { ethereum?: unknown }).ethereum;
      const next = await readLivePool(LIVE_HOOK, provider as never);
      setPool(next);
      const tokenIn = zeroForOne ? next.currency0 : next.currency1;
      const client = createWalletClient({ transport: custom(provider as never) });
      void client;
      setStage('idle');
    } catch (error) {
      setMessage(describeSwapError(error));
      setStage('failed');
    }
  }, [zeroForOne]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const cta = useMemo(() => {
    if (!LIVE_HOOK) return { label: 'No live pool configured', disabled: true };
    if (wallet.status !== 'connected') return { label: 'Connect wallet', disabled: true };
    if (wallet.chainId !== TESTNET.chainId) return { label: 'Switch to testnet', disabled: true };
    if (stage === 'reading' || !pool) return { label: 'Reading pool state…', disabled: true };
    if (!pool.canSwap) return { label: 'Pool is not currently tradable', disabled: true };
    return { label: stage === 'swapping' ? 'Submitting…' : 'Swap onchain', disabled: stage === 'swapping' || stage === 'approving' };
  }, [pool, stage, wallet.chainId, wallet.status]);

  const run = async () => {
    if (!pool || !wallet.account) return;
    const provider = (window as unknown as { ethereum?: unknown }).ethereum;
    if (!provider) return;
    setMessage(null);
    setTxHash(null);
    try {
      const client = createWalletClient({ transport: custom(provider as never), account: wallet.account, chain });
      const tokenIn = (zeroForOne ? pool.currency0 : pool.currency1) as Address;

      setStage('approving');
      const allowance = await readAllowance(tokenIn, wallet.account, provider as never);
      const raw = parseUnits(amount, decimalsIn);
      if (allowance < raw) {
        const approveHash = await client.writeContract({
          address: tokenIn,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [ROUTER, maxUint256],
          chain,
        });
        const approveRc = await publicClientFor(provider as never).waitForTransactionReceipt({ hash: approveHash });
        if (approveRc.status !== 'success') throw new Error('Approval failed');
      }

      setStage('swapping');
      const nonce = await readRouterNonce(wallet.account, provider as never);
      const request = buildSwapRequest({
        pool,
        zeroForOne,
        exactInput: true,
        amount,
        tokenInDecimals: decimalsIn,
        slippageBps: 50,
        recipient: wallet.account,
        deadlineSeconds: 60,
        nonce,
      });
      const hash = await client.writeContract({
        address: ROUTER,
        abi: SWAP_ABI,
        functionName: 'swap',
        args: [request],
        chain,
      });
      setTxHash(hash);
      const rc = await publicClientFor(provider as never).waitForTransactionReceipt({ hash });
      if (rc.status !== 'success') throw new Error('Swap transaction reverted onchain');
      setStage('done');
      setMessage('Swap confirmed onchain.');
      void refresh();
    } catch (error) {
      setStage('failed');
      setMessage(describeSwapError(error));
    }
  };

  if (!LIVE_HOOK) return null;

  return (
    <section className="glass mt-6 rounded-2xl border border-line bg-surface/75 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-dim">Live pool</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-[0.7rem] uppercase tracking-[0.14em] text-dim">Mode</dt>
          <dd className="num mt-1 text-ink">{pool ? pool.mode : '—'}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] uppercase tracking-[0.14em] text-dim">Phase</dt>
          <dd className="num mt-1 text-ink">{pool ? pool.phase : '—'}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] uppercase tracking-[0.14em] text-dim">Can swap</dt>
          <dd className={`mt-1 ${pool?.canSwap ? 'text-up' : 'text-down'}`}>{pool ? String(pool.canSwap) : '—'}</dd>
        </div>
        <div>
          <dt className="text-[0.7rem] uppercase tracking-[0.14em] text-dim">Reason bits</dt>
          <dd className="num mt-1 text-ink">{pool ? pool.reasonBits.toString() : '—'}</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="flex-1">
          <span className="text-[0.7rem] uppercase tracking-[0.14em] text-dim">Amount in</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="num mt-1 h-11 w-full rounded-xl border border-line bg-bg-1 px-3 text-ink outline-none focus:border-ion/60"
          />
        </label>
        <button
          type="button"
          onClick={() => setZeroForOne((v) => !v)}
          className="h-11 rounded-xl border border-line px-4 text-sm text-muted hover:text-ink"
        >
          {zeroForOne ? 'token0 → token1' : 'token1 → token0'}
        </button>
        <label className="w-28">
          <span className="text-[0.7rem] uppercase tracking-[0.14em] text-dim">Decimals</span>
          <input
            value={decimalsIn}
            onChange={(e) => setDecimalsIn(Number(e.target.value))}
            inputMode="numeric"
            className="num mt-1 h-11 w-full rounded-xl border border-line bg-bg-1 px-3 text-ink outline-none focus:border-ion/60"
          />
        </label>
      </div>

      <Button size="lg" className="mt-5 w-full" disabled={cta.disabled} onClick={() => void run()}>
        {(stage === 'approving' || stage === 'swapping') && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {cta.label}
      </Button>

      {message && (
        <p
          role="status"
          className={`mt-4 flex items-start gap-2 text-sm ${stage === 'done' ? 'text-up' : 'text-down'}`}
        >
          {stage === 'done' ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          {message}
        </p>
      )}

      {txHash && (
        <p className="mt-2 break-all text-xs text-dim">
          tx {txHash}
        </p>
      )}
    </section>
  );
}
