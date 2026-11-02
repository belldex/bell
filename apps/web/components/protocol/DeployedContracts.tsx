'use client';

import { useMemo, useState } from 'react';
import { Check, Clipboard, ExternalLink, Layers, Search, ShieldCheck } from 'lucide-react';
import { TokenLogo } from '@/components/ui/TokenLogo';

type Category = 'all' | 'core' | 'registries' | 'tokens' | 'governance';

interface ContractRecord {
  name: string;
  category: 'core' | 'registries' | 'tokens' | 'governance';
  tag: string;
  address: string;
  symbol?: string;
  description: string;
}

const CONTRACTS: ContractRecord[] = [
  // Core Protocol
  {
    name: 'BellPoolFactory',
    category: 'core',
    tag: 'Factory & Lifecycle',
    address: '0xf677edc6346be53686E6DD42374A744cab9d0A5B',
    description: 'Upgraded factory deploying isolated Uniswap v4 hook instances and initializing session-aware pools.',
  },
  {
    name: 'BellRouter',
    category: 'core',
    tag: 'Execution Router',
    address: '0x178d78419e8b7cd1f5e1e4a65f71d86c7f6516d5',
    description: 'Front-facing router executing exact-input and exact-output swaps with onchain slippage and budget bounds.',
  },
  {
    name: 'Uniswap v4 PoolManager',
    category: 'core',
    tag: 'AMM Core State',
    address: '0x8b26fefa276860592d45114cb30b335dddd87b56',
    description: 'Canonical Uniswap v4 PoolManager contract handling core liquidity curves, balance tracking, and swap execution.',
  },
  {
    name: 'PositionManager',
    category: 'core',
    tag: 'Liquidity NFTs',
    address: '0x84da249aafa359886c6a2ae1ebdc78a6059b662d',
    description: 'Noncustodial ERC-721 position manager for adding liquidity, in-kind burning, and fee collections.',
  },
  {
    name: 'HookDeployer',
    category: 'core',
    tag: 'CREATE2 Deployer',
    address: '0x3e5cEBb068ac71D742f700Db918908a15B8c45C5',
    description: 'Deterministic hook deployer enforcing exact permission flags on newly initialized pool hooks.',
  },

  // Registries & Oracles
  {
    name: 'SessionRegistry',
    category: 'registries',
    tag: 'Session Engine',
    address: '0x5f1b0212dc6167cbc1883f910640a685b1243795',
    description: 'Tracks verified market sessions, session capability masks, health checkpoints, and round timestamps.',
  },
  {
    name: 'CalendarRegistry',
    category: 'registries',
    tag: 'Exchange Calendar',
    address: '0x394983bff2715d57197389f323d807b0d61c05a3',
    description: 'Holds committed NYSE calendar roots, trading intervals, early closures, and holiday schedules.',
  },
  {
    name: 'AssetRegistry',
    category: 'registries',
    tag: 'Asset Directory',
    address: '0x0d9c0c8b2065b08a8ad4abc861eb128385ef18c6',
    description: 'Authoritative onchain registry for canonical Robinhood Stock Tokens, counterassets, and feed mappings.',
  },
  {
    name: 'PolicyOracle',
    category: 'registries',
    tag: 'Price Verification',
    address: '0x908bea5cd3C5297Ad69aCb19279c413d594cd335',
    description: 'Verifies onchain Chainlink feed freshness (60s REGULAR / 120s extended) and external reference valuation bounds.',
  },
  {
    name: 'ModeEvaluator',
    category: 'registries',
    tag: 'Safety Mode Engine',
    address: '0xEBDb2291f07F10490E7f34a5cD5C37dF95F877F4',
    description: 'Evaluates current pool state into ACTIVE, CLOSED, HALTED, or RECOVERING to enforce fee and flow bands.',
  },
  {
    name: 'SafetyController',
    category: 'registries',
    tag: 'Circuit Breaker',
    address: '0x7243cf13f0308edd4a0397551042fea3cf9da179',
    description: 'Multisig-isolated emergency controller for limited pause and delayed resume without touching LP principal.',
  },
  {
    name: 'Permit2',
    category: 'registries',
    tag: 'Signature Approvals',
    address: '0x000000000022d473030f116ddee9f6b43ac78ba3',
    description: 'Canonical Permit2 signature-based approval contract for efficient and secure ERC-20 allowances.',
  },

  // Admitted Tokens
  {
    name: 'Apple Inc. (AAPL)',
    category: 'tokens',
    tag: 'Stock Token',
    symbol: 'AAPL',
    address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
    description: 'Canonical Robinhood Stock Token tracking Apple Inc. with 4-session Chainlink feeds (18 decimals).',
  },
  {
    name: 'NVIDIA Corporation (NVDA)',
    category: 'tokens',
    tag: 'Stock Token',
    symbol: 'NVDA',
    address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
    description: 'Canonical Robinhood Stock Token tracking NVIDIA Corporation with 4-session Chainlink feeds (18 decimals).',
  },
  {
    name: 'Tesla, Inc. (TSLA)',
    category: 'tokens',
    tag: 'Stock Token',
    symbol: 'TSLA',
    address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d',
    description: 'Canonical Robinhood Stock Token tracking Tesla, Inc. with 4-session Chainlink feeds (18 decimals).',
  },
  {
    name: 'Global Dollar (USDG)',
    category: 'tokens',
    tag: 'Stablecoin / Fee Token',
    symbol: 'USDG',
    address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    description: 'Primary stablecoin counterasset and service fee currency on Robinhood Chain Mainnet (6 decimals).',
  },
  {
    name: 'Wrapped Ether (WETH)',
    category: 'tokens',
    tag: 'Counterasset',
    symbol: 'WETH',
    address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
    description: 'Canonical wrapped Ether contract on Robinhood Chain used for native ETH pool pairs (18 decimals).',
  },
  {
    name: 'Community Meme Token (MEME)',
    category: 'tokens',
    tag: 'Market-Price Token',
    symbol: 'MEME',
    address: '0x385F4f8ae47651ce5F58F5265395a669f8281e18',
    description: 'Admitted counterasset without external oracle feed; trades strictly in own-market price mode (18 decimals).',
  },

  // Governance & Accounts
  {
    name: 'Governance Deployer',
    category: 'governance',
    tag: 'Protocol Deployer',
    address: '0x6c3659988bd5f9e94f927b3fd7d0ee3746f8d399',
    description: 'Authorized deployer account responsible for verified protocol initialization and calendar commits.',
  },
  {
    name: 'Protocol Treasury',
    category: 'governance',
    tag: 'Treasury Safe',
    address: '0xf6e272fbf862ae055949c61bc41e6395dfe20841',
    description: 'Multi-signature treasury holding protocol reserves; isolated from liquidity and LP principal.',
  },
  {
    name: 'Service Recipient',
    category: 'governance',
    tag: 'Fee Recipient',
    address: '0x58cd82a008cb9a6c0c605991b40a09bd6aa1a6fc',
    description: 'Designated recipient for factory pool creation service fees (49 USDG per deployed pool).',
  },
];

const CATEGORY_TABS: { id: Category; label: string }[] = [
  { id: 'all', label: 'All Active' },
  { id: 'core', label: 'Core Protocol' },
  { id: 'registries', label: 'Registries & Oracles' },
  { id: 'tokens', label: 'Admitted Tokens' },
  { id: 'governance', label: 'Accounts & Roles' },
];

export function DeployedContracts() {
  const [selectedCategory, setSelectedCategory] = useState<Category>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const filteredContracts = useMemo(() => {
    return CONTRACTS.filter((item) => {
      const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        item.name.toLowerCase().includes(q) ||
        item.address.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q) ||
        (item.symbol && item.symbol.toLowerCase().includes(q)) ||
        item.description.toLowerCase().includes(q)
      );
    });
  }, [selectedCategory, searchQuery]);

  async function handleCopy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      window.setTimeout(() => setCopiedAddress(null), 1500);
    } catch {
      // fallback
    }
  }

  return (
    <section className="app-contracts-section" id="contracts" aria-labelledby="contracts-heading">
      <div className="app-contracts-section__header">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ion">
            Robinhood Chain Mainnet · Chain ID 4663
          </p>
          <h2 id="contracts-heading" className="mt-2 font-display text-[26px] font-semibold tracking-[-0.03em] text-ink sm:text-[32px]">
            Deployed Active Contracts
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Authoritative smart contracts and token assets currently active on Robinhood Chain Mainnet.
            Every contract is immutable or governed by strict timelocks with zero upgradeable proxy risk.
          </p>
        </div>

        {/* Quick Stats Pill */}
        <div className="app-contracts-section__stats">
          <div>
            <span>NETWORK</span>
            <strong>Robinhood Chain 4663</strong>
          </div>
          <div>
            <span>ACTIVE DEPLOYS</span>
            <strong>{CONTRACTS.length} Addresses</strong>
          </div>
          <div>
            <span>ARCHITECTURE</span>
            <strong>Uniswap v4 Hooks</strong>
          </div>
        </div>
      </div>

      {/* Control Bar: Tabs + Search */}
      <div className="app-contracts-controls">
        <div className="app-contracts-tabs" role="tablist">
          {CATEGORY_TABS.map((tab) => {
            const count = tab.id === 'all'
              ? CONTRACTS.length
              : CONTRACTS.filter((c) => c.category === tab.id).length;
            const active = selectedCategory === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedCategory(tab.id)}
                className={`app-contracts-tab${active ? ' is-active' : ''}`}
              >
                <span>{tab.label}</span>
                <span className="app-contracts-tab__count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="app-contracts-search">
          <Search size={14} className="text-dim" aria-hidden="true" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, symbol, or 0x address…"
            aria-label="Filter contracts"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="font-mono text-[10px] uppercase text-dim hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Contracts Grid */}
      <div className="app-contracts-grid">
        {filteredContracts.map((item) => {
          const isCopied = copiedAddress === item.address;
          return (
            <article key={item.address + item.name} className="app-contract-card">
              <div className="app-contract-card__top">
                <div className="flex items-center gap-3 min-w-0">
                  {item.symbol ? (
                    <TokenLogo symbol={item.symbol} size={28} />
                  ) : (
                    <div className="app-contract-card__icon" aria-hidden="true">
                      {item.category === 'core' ? (
                        <Layers size={16} />
                      ) : item.category === 'governance' ? (
                        <ShieldCheck size={16} />
                      ) : (
                        <span className="font-mono text-[11px] font-bold">0x</span>
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-base font-semibold text-ink">
                      {item.name}
                    </h3>
                    <span className="app-contract-card__tag">{item.tag}</span>
                  </div>
                </div>

                <a
                  href={`https://robinhoodchain.blockscout.com/address/${item.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="app-contract-card__explorer"
                  title="View on Robinhood Chain Blockscout Explorer"
                >
                  <span>Explorer</span>
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </div>

              <p className="app-contract-card__desc">{item.description}</p>

              <div className="app-contract-card__address-bar">
                <code title={item.address}>{item.address}</code>
                <button
                  type="button"
                  onClick={() => void handleCopy(item.address)}
                  className={`app-contract-card__copy${isCopied ? ' is-copied' : ''}`}
                  aria-label={`Copy address for ${item.name}`}
                >
                  {isCopied ? (
                    <>
                      <Check size={12} aria-hidden="true" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Clipboard size={12} aria-hidden="true" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {filteredContracts.length === 0 && (
        <div className="app-contracts-empty">
          <p className="text-sm text-muted">No contracts matching &ldquo;{searchQuery}&rdquo;.</p>
        </div>
      )}
    </section>
  );
}
