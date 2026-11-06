import { getAddress } from 'viem';
import deployment from '../../../evidence/deploy/mainnet-4663.json';
import targets from '../../../scripts/auction-cli/targets.json';
import verified from '../../../scripts/auction-cli/verified.json';

/**
 * One source for every Mainnet address shown on the site. BELL contracts come from the deployment
 * manifest and the verified list; tokens and Uniswap contracts are fixed canonical addresses.
 */
export const CHAIN_ID = 4663;
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const KEEPER_URL = 'https://bell-keeper-b.asysyifaq25.workers.dev';
export const explorerAddress = (address: string) => `${EXPLORER}/address/${address}`;
export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;

export type ContractRow = {
  name: string;
  detail: string;
  address: string;
  /** Source verified on Sourcify (BELL contracts only). */
  verified: boolean;
  /** Not a BELL contract: shown for completeness, never counted as BELL's. */
  external?: boolean;
};
export type ContractGroup = { id: string; title: string; blurb: string; rows: ContractRow[] };

type Target = { group: string; label: string; name: string; address: string };
const TARGETS = targets as Target[];

const verifiedAddresses = new Set(
  Object.entries(verified as Record<string, { match?: string }>)
    .filter(([, v]) => v.match === 'match' || v.match === 'exact_match')
    .map(([address]) => address.toLowerCase()),
);
const isVerified = (address: string) => verifiedAddresses.has(address.toLowerCase());
const checksum = (address: string) => getAddress(address);

const DETAIL: Record<string, string> = {
  BellPoolFactory: 'Creates, seeds and activates pools against an immutable dependency profile.',
  BellRouter: 'Single entry point for swaps. Simulates and settles against onchain flow caps.',
  BellHookDeployerV2: 'Deploys one immutable hook per pool at a deterministic address, with the auction guard.',
  BellPolicyOracle: 'Aggregates every dependency reason into one policy answer. STATICCALL only.',
  BellModeEvaluator: 'Derives trade, window and closure budgets from the pool principal itself.',
  BellPolicyDependencyReader: 'Bounded staticcalls. A failed read is a recorded reason, never a healthy default.',
  SafetyController: 'Pause authority split across governance, guardian and treasury.',
  AssetRegistry: 'Admitted assets, code fingerprints, capability masks and evidence hashes.',
  CalendarRegistry: 'Merkle-committed market sessions. Advances only with a valid proof.',
  SessionRegistry: 'Price health, close anchors and per-asset observation state.',
  BellAuctionRegistry: 'Write-once map from each pool to its Opening Bell Auction.',
  BellAuctionFactoryModule: 'Deploys one reusable auction per USDG/stock pool, atomically with pool creation.',
};

const bell = (label: string): ContractRow => {
  const t = TARGETS.find((x) => x.label === label);
  if (!t) throw new Error(`target ${label} missing from targets.json`);
  return { name: t.name, detail: DETAIL[t.name] ?? '', address: checksum(t.address), verified: isVerified(t.address) };
};

const external = (name: string, detail: string, address: string): ContractRow => ({
  name, detail, address: checksum(address), verified: false, external: true,
});

/** Chainlink adapters, one row per asset and session. */
const adapters: ContractRow[] = TARGETS.filter((t) => t.group.includes('adapters')).map((t) => {
  const label = t.label
    .replace('ref ', '')
    .replace('.directAdapter', ' · direct')
    .replace('.regularAdapter', ' · regular')
    .replace('.extendedAdapter', ' · extended')
    .replace('.overnightAdapter', ' · overnight');
  const kind = t.name === 'ChainlinkTokenReferenceAdapter' ? 'Reference price' : t.name === 'AggregatorAdapter' ? 'Direct feed' : 'Session feed';
  return { name: label, detail: `${kind} · ${t.name}`, address: checksum(t.address), verified: isVerified(t.address) };
});

export const CONTRACT_GROUPS: ContractGroup[] = [
  {
    id: 'core',
    title: 'Core protocol',
    blurb: 'Where pools are created, priced and swapped.',
    rows: [
      bell('poolFactory'), bell('router'), bell('hookDeployer'),
      external('Uniswap v4 PoolManager', 'Canonical Uniswap v4 contract. Not a BELL contract.', deployment.poolManager),
      external('Uniswap v4 PositionManager', 'Canonical Uniswap v4 contract. Not a BELL contract.', deployment.positionManager),
    ],
  },
  {
    id: 'auction',
    title: 'Opening Bell Auction',
    blurb: 'One clearing price at the open, matched peer to peer.',
    rows: [bell('auctionRegistry'), bell('auctionFactoryModule')],
  },
  {
    id: 'policy',
    title: 'Registries and policy',
    blurb: 'What the hook reads before it lets a swap through.',
    rows: [
      bell('policyOracle'), bell('modeEvaluator'), bell('policyDependencyReader'),
      bell('calendarRegistry'), bell('sessionRegistry'), bell('assetRegistry'), bell('safetyController'),
      external('Permit2', 'Canonical token approval contract. Not a BELL contract.', deployment.permit2),
    ],
  },
  {
    id: 'tokens',
    title: 'Admitted tokens',
    blurb: 'Stock tokens and counterassets the AssetRegistry admits.',
    rows: [
      external('AAPL', 'Robinhood stock token · 18 decimals', '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'),
      external('NVDA', 'Robinhood stock token · 18 decimals', '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC'),
      external('TSLA', 'Robinhood stock token · 18 decimals', '0x322F0929c4625eD5bAd873c95208D54E1c003b2d'),
      external('MEME', 'Admitted counterasset · 18 decimals', '0x385F4f8ae47651ce5F58F5265395a669f8281e18'),
      external('USDG', 'Payment token · 6 decimals · pool service fee', '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),
      external('WETH', 'Wrapped native token · 18 decimals', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'),
    ],
  },
  {
    id: 'adapters',
    title: 'Chainlink adapters',
    blurb: 'Price inputs for the sessions and for checked pools.',
    rows: adapters,
  },
];

/** Used when the live pool directory cannot be reached. Liquidity and auction status then stay unknown. */
export const HOOK_FALLBACK: { pair: string; hook: string }[] = [
  { pair: 'USDG / AAPL', hook: '0xf9692a364e0edf76bba12e54c3eba599f436acc0' },
  { pair: 'USDG / AAPL', hook: '0x6c31e485883a9f0c3a5b4b9b2f012e7793e2acc0' },
  { pair: 'USDG / AAPL', hook: '0xc1ada05c75160ed1a62d7eacf30ef28859886cc0' },
  { pair: 'USDG / NVDA', hook: '0x89d4792e613199e3ed7e8ce7af51d0372027ecc0' },
  { pair: 'TSLA / USDG', hook: '0x6657dc160e05c0ff6afe2122ca7d8244390decc0' },
  { pair: 'TSLA / USDG', hook: '0xeece9e0c1a6b483d9989db9920596feba6d06cc0' },
].map((h) => ({ ...h, hook: checksum(h.hook) }));

export const HOOK_FLAGS = ['beforeInitialize', 'beforeAddLiquidity', 'afterAddLiquidity', 'beforeSwap', 'afterSwap'] as const;
export const BELL_TOKEN = '0xc5d6c1d90c8a87a07e2670b99b1556e818803228';
export const VERIFIED_COUNT = TARGETS.filter((t) => isVerified(t.address)).length;
export const BELL_CONTRACT_COUNT = TARGETS.length;
