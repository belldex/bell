import type { EIP1193Provider } from 'viem';

export type WalletId = 'metamask' | 'rabby' | 'coinbase' | 'okx' | 'trust' | 'phantom';
export type EvmWalletProvider = EIP1193Provider & Record<string, unknown>;
export type WalletOption = { id: WalletId; name: string; icon: string; installUrl: string };


export const WALLET_OPTIONS: WalletOption[] = [
  { id: 'metamask', name: 'MetaMask', icon: '/wallets/metamask.svg', installUrl: 'https://metamask.io/download/' },
  { id: 'rabby', name: 'Rabby', icon: '/wallets/rabby.svg', installUrl: 'https://rabby.io/' },
  { id: 'coinbase', name: 'Coinbase Wallet', icon: '/wallets/coinbase.svg', installUrl: 'https://www.coinbase.com/wallet/downloads' },
  { id: 'okx', name: 'OKX Wallet', icon: '/wallets/okx.svg', installUrl: 'https://www.okx.com/web3' },
  { id: 'trust', name: 'Trust Wallet', icon: '/wallets/trust.png', installUrl: 'https://trustwallet.com/download' },
  { id: 'phantom', name: 'Phantom', icon: '/wallets/phantom.svg', installUrl: 'https://phantom.app/download' },
];

type ProviderDetail = { info: { uuid: string; name: string; rdns: string }; provider: EvmWalletProvider };
const announced: ProviderDetail[] = [];
const listeners = new Set<() => void>();
const SELECTED_WALLET_KEY = 'bell.selected-wallet';
const DISCONNECTED_KEY = 'bell.wallet-disconnected';
let activeProvider: EvmWalletProvider | null = null;

export function setActiveWalletProvider(provider: EvmWalletProvider | null) { activeProvider = provider; }
export function getActiveWalletProvider(): EvmWalletProvider | null { return activeProvider; }
export function getInjectedWalletProvider(): EvmWalletProvider | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ethereum?: EvmWalletProvider }).ethereum ?? null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', ((event: CustomEvent<ProviderDetail>) => {
    const detail = event.detail;
    if (!detail?.info || !detail.provider) return;
    const index = announced.findIndex((item) => item.info.uuid === detail.info.uuid);
    if (index === -1) announced.push(detail);
    else announced[index] = detail;
    listeners.forEach((listener) => listener());
  }) as EventListener);
}

export function requestWalletProviders() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export function onWalletProvidersChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function injectedProviders(): EvmWalletProvider[] {
  if (typeof window === 'undefined') return [];
  const root = (window as unknown as { ethereum?: EvmWalletProvider & { providers?: EvmWalletProvider[] } }).ethereum;
  return [...announced.map((item) => item.provider), ...(root?.providers ?? []), ...(root ? [root] : [])];
}

function matches(provider: EvmWalletProvider, id: WalletId) {
  const p = provider as Record<string, unknown>;
  if (id === 'rabby') return p.isRabby === true;
  if (id === 'phantom') return p.isPhantom === true;
  if (id === 'coinbase') return p.isCoinbaseWallet === true || p.isCoinbaseBrowser === true;
  if (id === 'okx') return p.isOkxWallet === true;
  if (id === 'trust') return p.isTrust === true || p.isTrustWallet === true;
  return p.isMetaMask === true && !p.isRabby && !p.isPhantom && !p.isCoinbaseWallet && !p.isOkxWallet && !p.isTrust;
}

export function detectWallet(id: WalletId): EvmWalletProvider | null {
  for (const detail of announced) {
    const identity = `${detail.info.rdns} ${detail.info.name}`.toLowerCase();
    if (identity.includes(id) || (id === 'coinbase' && identity.includes('coinbase'))) return detail.provider;
  }
  return injectedProviders().find((provider) => matches(provider, id)) ?? null;
}

export function detectWallets(): WalletId[] {
  return WALLET_OPTIONS.map(({ id }) => id).filter((id) => detectWallet(id) !== null);
}

export function saveSelectedWallet(id: WalletId | null) {
  try {
    if (id) localStorage.setItem(SELECTED_WALLET_KEY, id);
    else localStorage.removeItem(SELECTED_WALLET_KEY);
  } catch { /* storage may be unavailable */ }
}

export function setWalletDisconnected(value: boolean) {
  try {
    if (value) localStorage.setItem(DISCONNECTED_KEY, '1');
    else localStorage.removeItem(DISCONNECTED_KEY);
  } catch { /* storage may be unavailable */ }
}

export function isWalletDisconnected() {
  try { return localStorage.getItem(DISCONNECTED_KEY) === '1'; }
  catch { return false; }
}

export function loadSelectedWallet(): WalletId | null {
  try {
    const value = localStorage.getItem(SELECTED_WALLET_KEY);
    return WALLET_OPTIONS.some((wallet) => wallet.id === value) ? value as WalletId : null;
  } catch { return null; }
}

export async function connectSelectedWallet(id: WalletId) {
  const provider = detectWallet(id);
  if (!provider) throw new Error('Wallet is not installed or detected.');
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  const account = accounts?.[0];
  if (!account) throw new Error('No account was returned by the wallet.');
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] });
  } catch (error) {
    if ((error as { code?: number })?.code === 4902) {
      try {
        await provider.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: '0x1237', chainName: 'Robinhood Chain',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
          blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
        }] });
      } catch { /* connect on the current chain; the account menu will offer a switch */ }
    }
    // User rejection or a wallet-specific switch failure should not block account connection.
  }
  saveSelectedWallet(id);
  setWalletDisconnected(false);
  return { provider, account: account as `0x${string}` };
}
