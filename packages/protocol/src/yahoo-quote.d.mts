export type YahooTradingPhase = 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | 'UNKNOWN';
export interface YahooQuote {
  symbol: string;
  currency: string;
  /** Exact decimal token price scaled to 1e18, encoded as a decimal string. */
  priceRaw18: string;
  observedAt: number;
  inputAt: number;
  ageSeconds: number;
  phase: YahooTradingPhase;
  source: 'YAHOO_CHART_API';
  /** Yahoo does not cryptographically sign the source response. */
  sourceSigned: false;
}
export function parseYahooChartQuote(
  payload: unknown,
  options: { symbol: string; currency?: string; nowSeconds?: number; maxAgeSeconds?: number },
): YahooQuote;
export function fetchYahooChartQuote(
  symbol: string,
  options?: { fetchImpl?: typeof fetch; currency?: string; nowSeconds?: number; maxAgeSeconds?: number },
): Promise<YahooQuote>;
