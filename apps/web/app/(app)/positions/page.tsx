'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatUnits, parseAbi, parseUnits, type Address } from 'viem';
import { Coins, Minus, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { TokenPair } from '@/components/ui/TokenLogo';
import { MAINNET, readLivePools, type LivePool, tokenAbi } from '@/lib/mainnet-live';
import { makeClients, useWallet } from '@/lib/wallet';
// @ts-expect-error Shared protocol codec is browser-safe and encodes the pinned public PositionManager path.
import { buildPublicLpTransaction } from '../../../../../packages/protocol/src/lp-codec.mjs';

const manager = MAINNET.positionManager;
const positionAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256 info)',
  'function getPositionLiquidity(uint256 tokenId) view returns (uint128)',
]);
const explorer = 'https://robinhoodchain.blockscout.com/tx/';
type Position = { id: bigint; pool: LivePool; liquidity: bigint; lower: number; upper: number };

function tickRange(info: bigint) {
  return [Number(BigInt.asIntN(24, (info >> 8n) & 0xffffffn)), Number(BigInt.asIntN(24, (info >> 32n) & 0xffffffn))] as const;
}

function PositionCard({ position, refresh }: { position: Position; refresh: () => void }) {
  const wallet = useWallet();
  const [mode, setMode] = useState<'none' | 'add' | 'remove'>('none');
  const [percent, setPercent] = useState(50);
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [minimum0, setMinimum0] = useState('0');
  const [minimum1, setMinimum1] = useState('0');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [hash, setHash] = useState('');

  const submit = async (operation: 'increase' | 'remove' | 'collect') => {
    if (!window.ethereum || !wallet.account) throw new Error('Connect your wallet first.');
    setBusy(true); setStatus('Preparing a direct PositionManager transaction…'); setHash('');
    try {
      const { publicClient, walletClient } = makeClients(window.ethereum);
      if (await publicClient.getChainId() !== MAINNET.chainId) throw new Error('Switch your wallet to BELL Mainnet (4663).');
      const chainNow = BigInt(Math.floor(Date.now() / 1000));
      const amounts = [
        parseUnits(amount0 || '0', position.pool.legs[0].decimals),
        parseUnits(amount1 || '0', position.pool.legs[1].decimals),
      ];
      const minimums = [
        parseUnits(minimum0 || '0', position.pool.legs[0].decimals),
        parseUnits(minimum1 || '0', position.pool.legs[1].decimals),
      ];
      if (operation === 'increase') {
        if (amounts[0] === 0n && amounts[1] === 0n) throw new Error('Enter a maximum amount for at least one token.');
        for (const [i, leg] of position.pool.legs.entries()) {
          if (amounts[i] === 0n) continue;
          const [balance, allowance] = await Promise.all([
            publicClient.readContract({ address: leg.address, abi: tokenAbi, functionName: 'balanceOf', args: [wallet.account] }),
            publicClient.readContract({ address: leg.address, abi: tokenAbi, functionName: 'allowance', args: [wallet.account, manager] }),
          ]);
          if (balance < amounts[i]) throw new Error(`Insufficient ${leg.symbol} balance.`);
          if (allowance < amounts[i]) {
            setStatus(`Approve ${leg.symbol} for the PositionManager in your wallet…`);
            const approval = await walletClient.writeContract({ address: leg.address, abi: tokenAbi, functionName: 'approve', args: [manager, amounts[i]], account: wallet.account, chain: undefined });
            await publicClient.waitForTransactionReceipt({ hash: approval });
          }
        }
      }
      const liquidity = operation === 'remove' ? position.liquidity * BigInt(percent) / 100n : 0n;
      if (operation === 'remove' && liquidity === 0n) throw new Error('Selected exit is below the smallest removable liquidity unit.');
      const tx = buildPublicLpTransaction({
        operation, account: wallet.account, positionManager: manager, recipient: wallet.account,
        currency0: position.pool.token0, currency1: position.pool.token1,
        tokenId: position.id.toString(), now: chainNow.toString(), deadline: (chainNow + 90n).toString(),
        ...(operation === 'increase' ? { amountMax: amounts.map(String) } : operation === 'remove' ? { liquidity: liquidity.toString(), amountMin: minimums.map(String) } : { liquidity: '0', amountMin: ['0', '0'] }),
      });
      setStatus('Checking the exact transaction on-chain…');
      await publicClient.call({ account: wallet.account, to: tx.to as Address, data: tx.data as `0x${string}`, value: tx.value });
      setStatus('Confirm this transaction in your wallet…');
      const sent = await walletClient.sendTransaction({ account: wallet.account, to: tx.to as Address, data: tx.data as `0x${string}`, value: tx.value, chain: undefined });
      setHash(sent); setStatus('Transaction sent. Waiting for confirmation…');
      await publicClient.waitForTransactionReceipt({ hash: sent });
      setStatus(`${operation === 'increase' ? 'Liquidity added' : operation === 'remove' ? 'Liquidity removed in-kind' : 'Fees collected'} successfully.`);
      refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const { pool } = position;
  return <article className="glass border border-line bg-surface/75 p-6">
    <div className="flex flex-wrap justify-between gap-4">
      <div><p className="font-mono text-xs text-dim">Position NFT #{position.id.toString()}</p>
        <Link href={`/pool/?id=${pool.poolId}`} className="mt-2 inline-flex items-center gap-3 font-display text-2xl text-ink"><TokenPair symbols={[pool.legs[0].symbol, pool.legs[1].symbol]} size={32}/>{pool.legs[0].symbol} / {pool.legs[1].symbol}</Link>
        <p className="mt-2 text-sm text-muted">BELL pool · hook {pool.hook.slice(0, 8)}…{pool.hook.slice(-6)}</p></div>
      <dl className="text-right text-sm"><dt className="text-xs uppercase text-dim">Position range</dt><dd className="mt-1 text-ink">{position.lower} to {position.upper} ticks</dd><dt className="mt-3 text-xs uppercase text-dim">Liquidity units</dt><dd className="mt-1 font-mono text-ink">{position.liquidity.toString()}</dd></dl>
    </div>
    <p className="mt-5 text-sm text-muted">Current NFT ownership and liquidity units are read from Mainnet. Add uses your entered maximum amounts. Set minimum in-kind outputs before removing; the PositionManager reverts if either token amount falls below them. Collect sends accrued fees directly to your wallet; amounts are calculated on-chain when collected.</p>
    <div className="mt-5 flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => setMode(mode === 'add' ? 'none' : 'add')}><Plus className="h-4 w-4"/> Add liquidity</Button>
      <Button variant="outline" size="sm" onClick={() => setMode(mode === 'remove' ? 'none' : 'remove')}><Minus className="h-4 w-4"/> Remove liquidity</Button>
      <Button size="sm" disabled={busy} onClick={() => void submit('collect')}><Coins className="h-4 w-4"/> Collect fees</Button>
    </div>
    {mode === 'add' && <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <label className="text-xs text-dim">Max {pool.legs[0].symbol}<input value={amount0} onChange={e => setAmount0(e.target.value)} inputMode="decimal" placeholder="0" className="mt-1 block w-full border border-line bg-bg-1 p-3 text-sm text-ink"/></label>
      <label className="text-xs text-dim">Max {pool.legs[1].symbol}<input value={amount1} onChange={e => setAmount1(e.target.value)} inputMode="decimal" placeholder="0" className="mt-1 block w-full border border-line bg-bg-1 p-3 text-sm text-ink"/></label>
      <Button className="self-end" disabled={busy} onClick={() => void submit('increase')}>Add</Button>
    </div>}
    {mode === 'remove' && <div className="mt-4 space-y-3"><div className="flex flex-wrap items-center gap-3"><label className="text-sm text-muted">Remove <select value={percent} onChange={e => setPercent(Number(e.target.value))} className="mx-2 border border-line bg-bg-1 p-2 text-ink"><option value={25}>25%</option><option value={50}>50%</option><option value={100}>100%</option></select> of liquidity</label></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-dim">Minimum {pool.legs[0].symbol} received<input value={minimum0} onChange={e => setMinimum0(e.target.value)} inputMode="decimal" className="mt-1 block w-full border border-line bg-bg-1 p-3 text-sm text-ink"/></label><label className="text-xs text-dim">Minimum {pool.legs[1].symbol} received<input value={minimum1} onChange={e => setMinimum1(e.target.value)} inputMode="decimal" className="mt-1 block w-full border border-line bg-bg-1 p-3 text-sm text-ink"/></label></div><Button disabled={busy} onClick={() => void submit('remove')}>Remove in-kind</Button></div>}
    {status && <p className="mt-4 break-words text-sm text-muted" role="status">{status} {hash && <a className="text-ion underline" href={`${explorer}${hash}`} target="_blank" rel="noreferrer">View transaction</a>}</p>}
  </article>;
}

export default function PositionsPage() {
  const wallet = useWallet();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!wallet.account || !window.ethereum || wallet.chainId !== MAINNET.chainId) { setPositions([]); return; }
    setLoading(true); setError('');
    try {
      const [pools, response] = await Promise.all([
        readLivePools(), fetch(`${MAINNET.quoteUrl.replace(/\/quote$/, '/positions')}?owner=${wallet.account}`, { cache: 'no-store' }),
      ]);
      const directory = await response.json();
      if (!response.ok || directory.chainId !== MAINNET.chainId || directory.owner.toLowerCase() !== wallet.account.toLowerCase()) throw new Error(directory.error || 'Position directory returned an invalid response.');
      const { publicClient } = makeClients(window.ethereum);
      const rows = await Promise.all((directory.tokenIds as string[]).map(async id => {
        try {
          const tokenId = BigInt(id);
          const [owner, [key, info], liquidity] = await Promise.all([
            publicClient.readContract({ address: manager, abi: positionAbi, functionName: 'ownerOf', args: [tokenId] }),
            publicClient.readContract({ address: manager, abi: positionAbi, functionName: 'getPoolAndPositionInfo', args: [tokenId] }),
            publicClient.readContract({ address: manager, abi: positionAbi, functionName: 'getPositionLiquidity', args: [tokenId] }),
          ]);
          if (owner.toLowerCase() !== wallet.account!.toLowerCase()) return null;
          const pool = pools.find(p => p.hook.toLowerCase() === key.hooks.toLowerCase() && p.token0.toLowerCase() === key.currency0.toLowerCase() && p.token1.toLowerCase() === key.currency1.toLowerCase());
          if (!pool) return null;
          const [lower, upper] = tickRange(info);
          return { id: tokenId, pool, liquidity, lower, upper } satisfies Position;
        } catch { return null; }
      }));
      setPositions(rows.filter((row): row is Position => Boolean(row)));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [wallet.account, wallet.chainId]);
  useEffect(() => { void refresh(); }, [refresh]);

  return <main className="space-y-7">
    <header className="max-w-3xl"><p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Your liquidity · BELL Mainnet</p>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-ink">Liquidity positions at a glance.</h1>
      <p className="mt-3 text-base text-muted">Connect the wallet that owns your position NFT. BELL positions are user-owned PositionManager NFTs; add, in-kind remove and fee collection are sent directly from your wallet.</p></header>
    {!wallet.account ? <p className="border border-line bg-surface p-5 text-sm text-muted">Connect your wallet to read your positions.</p>
      : wallet.chainId !== MAINNET.chainId ? <p className="border border-warn/30 bg-warn/5 p-5 text-sm text-warn">Switch your wallet to BELL Mainnet (4663) to read positions.</p>
      : <div className="flex items-center justify-between border border-line bg-surface p-4 text-sm text-muted"><span>{loading ? 'Reading wallet NFTs and live BELL pools…' : `${positions.length} BELL position${positions.length === 1 ? '' : 's'} found`}</span><Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}><RefreshCw className="h-4 w-4"/> Refresh</Button></div>}
    {error && <p role="alert" className="border border-warn/30 bg-warn/5 p-4 text-sm text-warn">Could not load live positions: {error}</p>}
    {positions.length ? <div className="grid gap-4 md:grid-cols-2">{positions.map(position => <PositionCard key={position.id.toString()} position={position} refresh={() => void refresh()}/>)}</div>
      : !loading && wallet.account && wallet.chainId === MAINNET.chainId && !error && <section className="border border-line bg-surface p-8"><h2 className="font-display text-2xl text-ink">No BELL positions in this wallet</h2><p className="mt-2 text-sm text-muted">Only NFTs verified against the live BELL pool directory appear here. Create a pool to mint its first position NFT.</p><Link className="mt-5 inline-block text-ion underline" href="/create">Create a pool</Link></section>}
    <p className="text-xs text-dim">Position NFTs are also transferable. Add requires ERC-20 approval when needed. Removal uses zero minimum token outputs, and Collect displays the mined transaction receipt. The app filters out unrelated Uniswap v4 PositionManager NFTs.</p>
  </main>;
}
