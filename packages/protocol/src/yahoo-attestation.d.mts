import type { YahooQuote } from './yahoo-quote.mjs';
export const YAHOO_REPORT_SCHEMA: 12;
export const BELL_MAX_YAHOO_AGE_SECONDS: 120;
export function yahooFeedId(symbol: string, phaseScope: 1 | 2 | 3): `0x${string}`;
export function buildYahooSourceWire(options: {
  chainId: number;
  token: `0x${string}`;
  verifier: `0x${string}`;
  verifierCodeHash: `0x${string}`;
  phaseScope: 0 | 1 | 2 | 3;
  symbol?: string;
}): {
  wire: {
    kind: number; phaseScope: number; endpoint: `0x${string}`; feedId: `0x${string}`; schema: number;
    decimals: number; priceBasis: number; heartbeatSec: number; expectedCodeHash: `0x${string}`;
    expectedImplementation: `0x${string}`; canonicalTokenId: `0x${string}`;
  };
  canonicalTokenId: `0x${string}`;
  sourceConfigHash: `0x${string}`;
};
export interface YahooSourceSample {
  descriptorId: `0x${string}`;
  feedId: `0x${string}`;
  phase: number;
  price18: bigint;
  observedAt: bigint;
  inputAt: bigint;
  validFrom: bigint;
  expiresAt: bigint;
  validUntil: bigint;
  reportHash: `0x${string}`;
  symbol: string;
  tokenMultiplier18: bigint;
  source: 'BELL_YAHOO_REPORT_V1';
}
export function buildYahooSourceSample(
  quote: YahooQuote,
  options: { feedId: `0x${string}`; phaseScope: 0 | 1 | 2 | 3; nowSeconds?: number; tokenMultiplier18?: string | bigint },
): YahooSourceSample;
export function signYahooSourceSample(
  sample: YahooSourceSample,
  options: { sourceConfigHash: `0x${string}`; chainId: number; verifier: `0x${string}`; privateKey: `0x${string}` },
): Promise<{ reporter: `0x${string}`; signature: `0x${string}`; report: `0x${string}`; typedData: unknown }>;
export function signYahooTokenStatus(
  status: { token: `0x${string}`; multiplier18: string | bigint; pendingMultiplier18: string | bigint; effectiveAt: string | bigint; observedAt: string | bigint; oraclePaused: boolean; codeHash: `0x${string}` },
  options: { chainId: number; verifier: `0x${string}`; privateKey: `0x${string}` },
): Promise<{ reporter: `0x${string}`; signature: `0x${string}`; typedData: unknown; digest: `0x${string}` }>;
export function preflightYahooMainnet(options: {
  symbol: 'AAPL' | 'NVDA' | 'TSLA'; token: `0x${string}`; adapterAddress: `0x${string}`;
  publicRpcUrl: string; reporterPrivateKey: `0x${string}`; verifierAddress: `0x${string}`;
  sourceConfigHash: `0x${string}`; expectedReporter: `0x${string}`; phaseScope?: 0 | 1 | 2 | 3;
  nowSeconds?: number; fetchImpl?: typeof fetch; client?: unknown;
}): Promise<Readonly<Record<string, unknown>>>;
