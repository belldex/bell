'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clipboard, ExternalLink, LoaderCircle, LogOut, Wallet, X } from 'lucide-react';
import { formatEther } from 'viem';
import { useWallet } from '@/lib/wallet';
import { detectWallets, onWalletProvidersChange, requestWalletProviders, WALLET_OPTIONS, type WalletId } from '@/lib/wallet-options';

export function WalletButton() {
  const wallet = useWallet();
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detected, setDetected] = useState<WalletId[]>([]);
  const [pending, setPending] = useState<WalletId | null>(null);
  const [error, setError] = useState('');
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chainHex, setChainHex] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const connectedOption = WALLET_OPTIONS.find((item) => item.id === wallet.walletId);

  useEffect(() => {
    const refresh = () => setDetected(detectWallets());
    requestWalletProviders();
    refresh();
    const unsubscribe = onWalletProvidersChange(refresh);
    const timer = window.setTimeout(refresh, 180);
    return () => { unsubscribe(); window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!modalOpen && !menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setModalOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); setModalOpen(false); }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [modalOpen, menuOpen]);

  useEffect(() => {
    if (!menuOpen || !wallet.provider || !wallet.account) return;
    let cancelled = false;
    setBalanceLoading(true);
    Promise.all([
      wallet.provider.request({ method: 'eth_getBalance', params: [wallet.account, 'latest'] }),
      wallet.provider.request({ method: 'eth_chainId' }),
    ]).then(([wei, chain]) => {
      if (cancelled) return;
      const amount = Number(formatEther(BigInt(String(wei))));
      setBalance(Number.isFinite(amount) ? amount.toLocaleString('en-US', { maximumFractionDigits: 5 }) : '—');
      setChainHex(String(chain));
    }).catch(() => { if (!cancelled) setBalance('Unavailable'); })
      .finally(() => { if (!cancelled) setBalanceLoading(false); });
    return () => { cancelled = true; };
  }, [menuOpen, wallet.provider, wallet.account]);

  async function selectWallet(id: WalletId) {
    setPending(id);
    setError('');
    try { await wallet.connectWallet(id); setModalOpen(false); setMenuOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not connect this wallet.'); }
    finally { setPending(null); }
  }

  async function copyAddress() {
    if (!wallet.account) return;
    try {
      await navigator.clipboard.writeText(wallet.account);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setError('Clipboard access is unavailable in this browser.'); }
  }

  const connected = wallet.status === 'connected' && Boolean(wallet.account);

  return (
    <div ref={rootRef} className="app-wallet-control">
      {!connected ? (
        <button type="button" onClick={() => { setError(''); setModalOpen(true); }} className="app-wallet-trigger" aria-haspopup="dialog">
          {wallet.status === 'connecting' ? <LoaderCircle className="app-wallet-trigger__icon app-spin" aria-hidden="true" /> : <Wallet className="app-wallet-trigger__icon" aria-hidden="true" />}
          <span>{wallet.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}</span>
          <ChevronDown className="app-wallet-trigger__chevron" aria-hidden="true" />
        </button>
      ) : (
        <button type="button" onClick={() => { setMenuOpen((open) => !open); setModalOpen(false); }} className={`app-wallet-trigger app-wallet-trigger--connected${wallet.wrongChain ? ' app-wallet-trigger--wrong' : ''}`} aria-haspopup="true" aria-expanded={menuOpen}>
          {connectedOption ? <img src={connectedOption.icon} alt="" className="app-wallet-trigger__logo" /> : <Wallet className="app-wallet-trigger__icon" aria-hidden="true" />}
          <span className="app-wallet-trigger__address">{wallet.account!.slice(0, 6)}…{wallet.account!.slice(-4)}</span>
          <ChevronDown className={`app-wallet-trigger__chevron${menuOpen ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
      )}

      {menuOpen && connected && wallet.account && (
        <div className="app-wallet-popover" role="dialog" aria-label="Connected wallet details">
          <div className="app-wallet-popover__identity">
            {connectedOption && <img src={connectedOption.icon} alt="" />}
            <div><span>Connected with</span><strong>{connectedOption?.name ?? 'EVM Wallet'}</strong></div>
            <span className="app-wallet-popover__connected">Connected</span>
          </div>
          <div className="app-wallet-popover__network"><span>NETWORK</span><strong>{wallet.wrongChain ? 'Unsupported network' : 'Robinhood Chain'} <small>{chainHex ? `· ${parseInt(chainHex, 16)}` : '· 4663'}</small></strong></div>
          <div className="app-wallet-popover__balance"><span>WALLET BALANCE</span><strong>{balanceLoading ? 'Reading balance…' : balance === null ? '—' : `${balance} ETH`}</strong><small>Native balance · for network fees</small></div>
          <div className="app-wallet-popover__address"><span>ACCOUNT</span><code>{wallet.account.slice(0, 10)}…{wallet.account.slice(-8)}</code></div>
          {wallet.wrongChain && <button type="button" className="app-wallet-popover__switch" onClick={() => void wallet.switchChain(4663)}>Switch to Robinhood Chain</button>}
          <div className="app-wallet-popover__actions">
            <button type="button" onClick={() => void copyAddress()}>{copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}{copied ? 'Copied' : 'Copy address'}</button>
            <button type="button" onClick={() => { wallet.disconnect(); setMenuOpen(false); }}><LogOut aria-hidden="true" />Disconnect</button>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="app-wallet-modal-backdrop" onClick={() => setModalOpen(false)}>
          <section className="app-wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title" onClick={(event) => event.stopPropagation()}>
            <header className="app-wallet-modal__header"><div><span>CONNECT TO BELL</span><h2 id="wallet-modal-title">Choose a wallet</h2></div><button type="button" aria-label="Close wallet picker" onClick={() => setModalOpen(false)}><X aria-hidden="true" /></button></header>
            <p className="app-wallet-modal__description">Connect an EVM wallet to Robinhood Chain. Your wallet stays in control of every transaction.</p>
            <div className="app-wallet-options">
              {WALLET_OPTIONS.map((option) => {
                const isDetected = detected.includes(option.id);
                const isPending = pending === option.id;
                return isDetected ? (
                  <button key={option.id} type="button" className="app-wallet-option" disabled={pending !== null} onClick={() => void selectWallet(option.id)}>
                    <img src={option.icon} alt="" /><span>{option.name}</span><small>{isPending ? <LoaderCircle className="app-spin" aria-label="Connecting" /> : 'Available'}</small>
                  </button>
                ) : (
                  <a key={option.id} className="app-wallet-option app-wallet-option--install" href={option.installUrl} target="_blank" rel="noreferrer noopener">
                    <img src={option.icon} alt="" /><span>{option.name}</span><small>Install <ExternalLink aria-hidden="true" /></small>
                  </a>
                );
              })}
            </div>
            {error && <p className="app-wallet-modal__error" role="alert">{error}</p>}
            <footer className="app-wallet-modal__footer">Robinhood Chain <span>·</span> Chain ID 4663</footer>
          </section>
        </div>
      )}
    </div>
  );
}
