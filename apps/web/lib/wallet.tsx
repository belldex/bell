'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPublicClient, createWalletClient, custom, type EIP1193Provider } from 'viem';
import { defineChain } from 'viem';
import { connectSelectedWallet, detectWallet, getInjectedWalletProvider, isWalletDisconnected, loadSelectedWallet, onWalletProvidersChange, requestWalletProviders, saveSelectedWallet, setActiveWalletProvider, setWalletDisconnected, type EvmWalletProvider, type WalletId, WALLET_OPTIONS } from './wallet-options';

/** The app wallet is pinned to Robinhood Chain mainnet. */
export const CHAINS = {
  4663: { name: 'Robinhood Chain', short: 'Mainnet' },
} as const;

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  network: 'robinhood',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] }, public: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Robinhood Explorer', url: 'https://robinhoodchain.blockscout.com' } },
});

export type SupportedChainId = keyof typeof CHAINS;
export const isSupportedChain = (id: number | null): id is SupportedChainId => id === 4663;

export type WalletStatus = 'no-provider' | 'disconnected' | 'connecting' | 'connected';

interface WalletState {
  status: WalletStatus;
  account: `0x${string}` | null;
  chainId: number | null;
  wrongChain: boolean;
  error: string | null;
  provider: EIP1193Provider | null;
  walletId: WalletId | null;
  connectWallet: (id: WalletId) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: (id: SupportedChainId) => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

/**
 * Minimal EIP-1193 wallet layer (no login, no Supabase Auth, no token-launch wallet).
 * Read-only browsing works with no wallet at all.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>('disconnected');
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<EvmWalletProvider | null>(null);
  const [walletId, setWalletId] = useState<WalletId | null>(null);

  useEffect(() => {
    requestWalletProviders();
    const restore = () => {
      if (isWalletDisconnected()) {
        setActiveWalletProvider(null);
        setProvider(null);
        setWalletId(null);
        setAccount(null);
        setChainId(null);
        setStatus('disconnected');
        return;
      }
      const savedId = loadSelectedWallet();
      const selected = savedId ? detectWallet(savedId) : null;
      const eth = selected ?? getInjectedWalletProvider();
      if (!eth) { setStatus('no-provider'); return; }
      setActiveWalletProvider(eth);
      setProvider(eth);
      setWalletId(selected && savedId ? savedId : null);
    };
    restore();
    const unsubscribe = onWalletProvidersChange(restore);
    const refreshTimer = window.setTimeout(restore, 180);
    return () => { unsubscribe(); window.clearTimeout(refreshTimer); };
  }, []);

  useEffect(() => {
    const eth = provider;
    if (!eth) return;
    const onAccounts = (accounts: unknown) => {
      const list = accounts as string[];
      if (list.length === 0) {
        setAccount(null);
        setStatus('disconnected');
      } else {
        setAccount(list[0] as `0x${string}`);
        setStatus('connected');
      }
    };
    const onChain = (hex: unknown) => setChainId(parseInt(hex as string, 16));
    eth.request({ method: 'eth_accounts' }).then(onAccounts).catch(() => undefined);
    eth.request({ method: 'eth_chainId' }).then(onChain).catch(() => undefined);
    eth.on('accountsChanged', onAccounts);
    eth.on('chainChanged', onChain);
    return () => {
      eth.removeListener('accountsChanged', onAccounts);
      eth.removeListener('chainChanged', onChain);
    };
  }, [provider]);

  const connectWallet = useCallback(async (id: WalletId) => {
    setError(null);
    setStatus('connecting');
    try {
      const result = await connectSelectedWallet(id);
      setActiveWalletProvider(result.provider);
      setProvider(result.provider);
      setWalletId(id);
      setAccount(result.account);
      setChainId(parseInt((await result.provider.request({ method: 'eth_chainId' })) as string, 16));
      setStatus('connected');
    } catch (e) {
      setStatus('disconnected');
      setError(e instanceof Error ? e.message : 'Connection rejected');
      throw e;
    }
  }, []);

  const connect = useCallback(async () => {
    const preferred = walletId ?? loadSelectedWallet();
    const id = (preferred && detectWallet(preferred) ? preferred : WALLET_OPTIONS.find((item) => detectWallet(item.id))?.id) ?? null;
    if (!id) {
      setError('No EIP-1193 wallet found. You can still browse in read-only mode.');
      return;
    }
    try { await connectWallet(id); } catch { /* surfaced by the wallet menu when initiated there */ }
  }, [connectWallet, walletId]);

  const disconnect = useCallback(() => {
    setActiveWalletProvider(null);
    setWalletDisconnected(true);
    setProvider(null);
    setWalletId(null);
    setAccount(null);
    setChainId(null);
    setStatus('disconnected');
    setError(null);
    saveSelectedWallet(null);
  }, []);

  const switchChain = useCallback(async (id: SupportedChainId) => {
    const eth = provider;
    if (!eth) return;
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${id.toString(16)}` }] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch network');
    }
  }, [provider]);

  const value = useMemo<WalletState>(
    () => ({
      status,
      account,
      chainId,
      wrongChain: status === 'connected' && !isSupportedChain(chainId),
      error,
      provider,
      walletId,
      connectWallet,
      connect,
      disconnect,
      switchChain,
    }),
    [status, account, chainId, error, provider, walletId, connectWallet, connect, disconnect, switchChain],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Exposed for later SDK wiring (M08/M11 integration); unused in preview mode. */
export function makeClients(provider: EIP1193Provider) {
  return {
    publicClient: createPublicClient({ transport: custom(provider) }),
    walletClient: createWalletClient({ transport: custom(provider) }),
  };
}
