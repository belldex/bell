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
import { WagmiConfig, createConfig, http, injected } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { ConnectButton, RainbowKitProvider } from '@rainbow-me/rainbowkit/components';
import { darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defineChain } from 'viem';
import '@rainbow-me/rainbowkit/styles.css';

/** Robinhood Chain ids from the brief (§11). */
export const CHAINS = {
  4663: { name: 'Robinhood Chain', short: 'Mainnet' },
  46630: { name: 'Robinhood Chain Testnet', short: 'Testnet' },
} as const;

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  network: 'robinhood',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] }, public: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Robinhood Explorer', url: 'https://robinhoodchain.blockscout.com' } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  network: 'robinhood-testnet',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] }, public: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Robinhood Testnet Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
});

const chains = [robinhoodMainnet, robinhoodTestnet, mainnet] as const;
const wagmiConfig = createConfig({
  chains,
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [robinhoodMainnet.id]: http(),
    [robinhoodTestnet.id]: http(),
    [mainnet.id]: http(),
  },
});
const queryClient = new QueryClient();
export type SupportedChainId = keyof typeof CHAINS;
export const isSupportedChain = (id: number | null): id is SupportedChainId => id === 4663 || id === 46630;

export type WalletStatus = 'no-provider' | 'disconnected' | 'connecting' | 'connected';

interface WalletState {
  status: WalletStatus;
  account: `0x${string}` | null;
  chainId: number | null;
  wrongChain: boolean;
  error: string | null;
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

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) {
      setStatus('no-provider');
      return;
    }
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
  }, []);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) {
      setError('No EIP-1193 wallet found. You can still browse in read-only mode.');
      return;
    }
    setError(null);
    setStatus('connecting');
    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      setAccount(accounts[0] as `0x${string}`);
      setChainId(parseInt((await eth.request({ method: 'eth_chainId' })) as string, 16));
      setStatus('connected');
    } catch (e) {
      setStatus('disconnected');
      setError(e instanceof Error ? e.message : 'Connection rejected');
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    setStatus('disconnected');
  }, []);

  const switchChain = useCallback(async (id: SupportedChainId) => {
    const eth = window.ethereum;
    if (!eth) return;
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${id.toString(16)}` }] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch network');
    }
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      status,
      account,
      chainId,
      wrongChain: status === 'connected' && !isSupportedChain(chainId),
      error,
      connect,
      disconnect,
      switchChain,
    }),
    [status, account, chainId, error, connect, disconnect, switchChain],
  );

  return (
    <WagmiConfig config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={robinhoodTestnet}
          theme={darkTheme({
            accentColor: '#aeb7b9',
            accentColorForeground: '#101416',
            borderRadius: 'small',
            fontStack: 'system',
            overlayBlur: 'small',
          })}
        >
          <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiConfig>
  );
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
