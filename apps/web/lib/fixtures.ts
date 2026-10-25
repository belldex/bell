import type { Lifecycle, MarketPhase, PoolClass } from './policy';

/**
 * PREVIEW DATA. Shapes follow the brief §20.K policy response:
 * raw amounts are decimal STRINGS (never JS numbers), plus decimals.
 * No contract is deployed yet, so no addresses / block hashes are invented.
 */

export type SourceMode = 'LIVE' | 'FROZEN' | 'NONE';

export interface StockLeg {
  symbol: string;
  phase: MarketPhase;
  source: SourceMode;
  /** age of the active input in seconds (LIVE) */
  ageSec: number | null;
  /** age of the close anchor in seconds (FROZEN) */
  anchorAgeSec: number | null;
}

export interface CurrencyBudget {
  symbol: string;
  decimals: number;
  /** T: normal per-trade cap (raw units) */
  perTrade: string;
  /** W: rolling 300s budget (raw units) */
  rolling: string;
  /** C: close-episode budget (raw units) */
  closure: string;
  rollingUsed: string;
  closureUsed: string;
}

export interface PoolPolicy {
  id: string;
  pair: [string, string];
  poolClass: PoolClass;
  liquidityMode: 'PUBLIC' | 'TREASURY_ONLY';
  lifecycle: Lifecycle;
  poolPhase: MarketPhase | 'HALTED';
  legs: StockLeg[];
  baseFeeUnits: number;
  effectiveFeeUnits: number;
  flags: Array<'BELL' | 'CORPORATE' | 'REPRICING' | 'RECOVERY'>;
  bellRemainingSec: number | null;
  corporateRemainingSec: number | null;
  recoveryRemainingSec: number | null;
  closureNonce: number | null;
  budgets: [CurrencyBudget, CurrencyBudget];
  /** PRICE_GUARDED only. SESSION_ONLY never shows a USD reference. */
  referenceNote: string | null;
  bandBps: number | null;
  canSwap: boolean;
  reasons: string[];
  /** reference valuation label; null for SESSION_ONLY */
  referenceValuationUsd: string | null;
  referenceValuationLabel: 'live' | 'frozen close' | null;
  sessionOnlyInventory: string | null;
}

const e6 = (n: number) => String(BigInt(n) * 1_000_000n);
const e18 = (n: number) => String(BigInt(n) * 10n ** 18n);

export const POOLS: PoolPolicy[] = [
  {
    id: 'usdg-aapl',
    pair: ['USDG', 'AAPL'],
    poolClass: 'PRICE_GUARDED',
    liquidityMode: 'PUBLIC',
    lifecycle: 'LIVE',
    poolPhase: 'REGULAR',
    legs: [{ symbol: 'AAPL', phase: 'REGULAR', source: 'LIVE', ageSec: 11, anchorAgeSec: null }],
    baseFeeUnits: 500,
    effectiveFeeUnits: 500,
    flags: [],
    bellRemainingSec: null,
    corporateRemainingSec: null,
    recoveryRemainingSec: null,
    closureNonce: 41,
    budgets: [
      { symbol: 'USDG', decimals: 6, perTrade: e6(250), rolling: e6(1000), closure: e6(500), rollingUsed: e6(310), closureUsed: '0' },
      { symbol: 'AAPL', decimals: 18, perTrade: String(1_100_000_000_000_000_000n), rolling: String(4_400_000_000_000_000_000n), closure: String(2_200_000_000_000_000_000n), rollingUsed: String(1_020_000_000_000_000_000n), closureUsed: '0' },
    ],
    referenceNote: 'Reference: live stock stream × live multiplier, cross-checked against direct token feed (≤ 100 bps).',
    bandBps: 200,
    canSwap: true,
    reasons: [],
    referenceValuationUsd: '48,210.40',
    referenceValuationLabel: 'live',
    sessionOnlyInventory: null,
  },
  {
    id: 'weth-tsla',
    pair: ['WETH', 'TSLA'],
    poolClass: 'PRICE_GUARDED',
    liquidityMode: 'PUBLIC',
    lifecycle: 'LIVE',
    poolPhase: 'CLOSED',
    legs: [{ symbol: 'TSLA', phase: 'CLOSED', source: 'FROZEN', ageSec: null, anchorAgeSec: 71_400 }],
    baseFeeUnits: 10000,
    effectiveFeeUnits: 10000,
    flags: [],
    bellRemainingSec: null,
    corporateRemainingSec: null,
    recoveryRemainingSec: null,
    closureNonce: 58,
    budgets: [
      { symbol: 'WETH', decimals: 18, perTrade: String(80_000_000_000_000_000n), rolling: String(320_000_000_000_000_000n), closure: String(160_000_000_000_000_000n), rollingUsed: String(38_000_000_000_000_000n), closureUsed: String(97_000_000_000_000_000n) },
      { symbol: 'TSLA', decimals: 18, perTrade: String(1_000_000_000_000_000_000n), rolling: String(4_000_000_000_000_000_000n), closure: String(2_000_000_000_000_000_000n), rollingUsed: String(450_000_000_000_000_000n), closureUsed: String(1_240_000_000_000_000_000n) },
    ],
    referenceNote: 'Reference: frozen TSLA/USD close anchor ÷ live WETH/USD. Band ±500 bps from the frozen-stock reference.',
    bandBps: 500,
    canSwap: true,
    reasons: [],
    referenceValuationUsd: '31,775.12',
    referenceValuationLabel: 'frozen close',
    sessionOnlyInventory: null,
  },
  {
    id: 'meme-nvda',
    pair: ['MEME', 'NVDA'],
    poolClass: 'SESSION_ONLY',
    liquidityMode: 'PUBLIC',
    lifecycle: 'LIVE',
    poolPhase: 'OVERNIGHT',
    legs: [{ symbol: 'NVDA', phase: 'OVERNIGHT', source: 'LIVE', ageSec: 84, anchorAgeSec: null }],
    baseFeeUnits: 5000,
    effectiveFeeUnits: 5000,
    flags: [],
    bellRemainingSec: null,
    corporateRemainingSec: null,
    recoveryRemainingSec: null,
    closureNonce: 12,
    budgets: [
      { symbol: 'MEME', decimals: 18, perTrade: e18(50_000), rolling: e18(200_000), closure: e18(100_000), rollingUsed: e18(12_500), closureUsed: '0' },
      { symbol: 'NVDA', decimals: 18, perTrade: String(500_000_000_000_000_000n), rolling: String(2_000_000_000_000_000_000n), closure: String(1_000_000_000_000_000_000n), rollingUsed: String(95_000_000_000_000_000n), closureUsed: '0' },
    ],
    referenceNote: null,
    bandBps: null,
    canSwap: true,
    reasons: [],
    referenceValuationUsd: null,
    referenceValuationLabel: null,
    sessionOnlyInventory: '1,240,000 MEME · 7.84 NVDA',
  },
  {
    id: 'nvda-amzn',
    pair: ['NVDA', 'AMZN'],
    poolClass: 'PRICE_GUARDED',
    liquidityMode: 'PUBLIC',
    lifecycle: 'LIVE',
    poolPhase: 'PRE',
    legs: [
      { symbol: 'NVDA', phase: 'PRE', source: 'LIVE', ageSec: 42, anchorAgeSec: null },
      { symbol: 'AMZN', phase: 'PRE', source: 'LIVE', ageSec: 57, anchorAgeSec: null },
    ],
    baseFeeUnits: 3000,
    effectiveFeeUnits: 3000,
    flags: [],
    bellRemainingSec: null,
    corporateRemainingSec: null,
    recoveryRemainingSec: null,
    closureNonce: 27,
    budgets: [
      { symbol: 'NVDA', decimals: 18, perTrade: String(750_000_000_000_000_000n), rolling: String(3_000_000_000_000_000_000n), closure: String(1_500_000_000_000_000_000n), rollingUsed: String(410_000_000_000_000_000n), closureUsed: '0' },
      { symbol: 'AMZN', decimals: 18, perTrade: String(1_200_000_000_000_000_000n), rolling: String(4_800_000_000_000_000_000n), closure: String(2_400_000_000_000_000_000n), rollingUsed: String(660_000_000_000_000_000n), closureUsed: '0' },
    ],
    referenceNote: 'Reference: both legs live on the extended stream; the larger of the two active-session fees applies.',
    bandBps: 200,
    canSwap: true,
    reasons: [],
    referenceValuationUsd: '22,904.88',
    referenceValuationLabel: 'live',
    sessionOnlyInventory: null,
  },
  {
    id: 'usdg-msft',
    pair: ['USDG', 'MSFT'],
    poolClass: 'PRICE_GUARDED',
    liquidityMode: 'PUBLIC',
    lifecycle: 'HALTED',
    poolPhase: 'HALTED',
    legs: [{ symbol: 'MSFT', phase: 'UNKNOWN', source: 'NONE', ageSec: 391, anchorAgeSec: null }],
    baseFeeUnits: 500,
    effectiveFeeUnits: 500,
    flags: ['RECOVERY'],
    bellRemainingSec: null,
    corporateRemainingSec: null,
    recoveryRemainingSec: 60,
    closureNonce: 33,
    budgets: [
      { symbol: 'USDG', decimals: 6, perTrade: e6(250), rolling: e6(1000), closure: e6(500), rollingUsed: e6(0), closureUsed: '0' },
      { symbol: 'MSFT', decimals: 18, perTrade: String(600_000_000_000_000_000n), rolling: String(2_400_000_000_000_000_000n), closure: String(1_200_000_000_000_000_000n), rollingUsed: '0', closureUsed: '0' },
    ],
    referenceNote: 'Active-session stream is stale while the calendar says the market is open → UNEXPECTED_STALE. This is an outage, not a weekend.',
    bandBps: 200,
    canSwap: false,
    reasons: ['UNEXPECTED_STALE: stock report older than 120 s during REGULAR', 'Recovery needs two fresh checkpoints ≥ 60 s apart'],
    referenceValuationUsd: null,
    referenceValuationLabel: null,
    sessionOnlyInventory: null,
  },
  {
    id: 'pons-pltr',
    pair: ['PONS', 'PLTR'],
    poolClass: 'SESSION_ONLY',
    liquidityMode: 'PUBLIC',
    lifecycle: 'LIVE',
    poolPhase: 'CLOSED',
    legs: [{ symbol: 'PLTR', phase: 'CLOSED', source: 'FROZEN', ageSec: null, anchorAgeSec: 83_900 }],
    baseFeeUnits: 10000,
    effectiveFeeUnits: 10000,
    flags: [],
    bellRemainingSec: null,
    corporateRemainingSec: null,
    recoveryRemainingSec: null,
    closureNonce: 9,
    budgets: [
      { symbol: 'PONS', decimals: 18, perTrade: e18(40_000), rolling: e18(160_000), closure: e18(80_000), rollingUsed: e18(20_000), closureUsed: e18(80_000) },
      { symbol: 'PLTR', decimals: 18, perTrade: String(400_000_000_000_000_000n), rolling: String(1_600_000_000_000_000_000n), closure: String(800_000_000_000_000_000n), rollingUsed: String(60_000_000_000_000_000n), closureUsed: String(512_000_000_000_000_000n) },
    ],
    referenceNote: null,
    bandBps: null,
    canSwap: false,
    reasons: ['Closure budget for PONS is exhausted for this episode and never refills until a confirmed reopen'],
    referenceValuationUsd: null,
    referenceValuationLabel: null,
    sessionOnlyInventory: '640,000 PONS · 4.12 PLTR',
  },
];

export function getPool(id: string | null | undefined): PoolPolicy | undefined {
  return POOLS.find((p) => p.id === id);
}

export interface PositionPreview {
  id: string;
  poolId: string;
  range: string;
  liquidityShare: string;
  amounts: [string, string];
  feesAccrued: [string, string];
  note?: string;
}

export const POSITIONS: PositionPreview[] = [
  { id: '#10441', poolId: 'usdg-aapl', range: 'Full range · tick spacing 60', liquidityShare: '0.42%', amounts: ['1,250.00 USDG', '5.804 AAPL'], feesAccrued: ['3.214 USDG', '0.0149 AAPL'] },
  { id: '#10502', poolId: 'weth-tsla', range: '−12% … +12%', liquidityShare: '1.10%', amounts: ['0.482 WETH', '1.730 TSLA'], feesAccrued: ['0.0021 WETH', '0.0074 TSLA'], note: 'Closed episode in progress — exit in-kind is independent of the swap budget.' },
  { id: '#10560', poolId: 'pons-pltr', range: 'Full range · tick spacing 60', liquidityShare: '2.65%', amounts: ['16,980 PONS', '0.109 PLTR'], feesAccrued: ['402 PONS', '0.0026 PLTR'], note: 'Swaps paused by budget exhaustion. You can still remove or collect in-kind.' },
];
