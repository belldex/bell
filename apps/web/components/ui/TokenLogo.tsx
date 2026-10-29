const TOKEN_MARKS: Record<string, string> = {
  AAPL: '/assets/tokens/aapl.svg',
  TSLA: '/assets/tokens/tsla.svg',
  NVDA: '/assets/tokens/nvda.svg',
  MSFT: '/assets/tokens/msft.svg',
  AMZN: '/assets/tokens/amazon.svg',
  PLTR: '/assets/tokens/palantir.svg',
  SPY: '/assets/tokens/spy.svg',
  PONS: '/assets/tokens/pons.png',
  ETH: '/assets/tokens/weth.png',
  WETH: '/assets/tokens/weth.png',
  USDG: '/assets/tokens/usdg.png',
};

export function TokenLogo({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const normalized = symbol.toUpperCase();
  const src = TOKEN_MARKS[normalized];
  const isNativeAsset = normalized === 'ETH' || normalized === 'WETH' || normalized === 'USDG';

  if (!src) {
    return (
      <span className="app-token-logo" style={{ width: size, height: size }} aria-hidden="true">
        <span className="app-token-fallback">{normalized}</span>
      </span>
    );
  }

  return (
    <span className={`app-token-logo${isNativeAsset ? ' app-token-logo--native' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <img src={src} alt="" decoding="async" />
    </span>
  );
}

export function TokenPair({ symbols, size = 30 }: { symbols: [string, string]; size?: number }) {
  return (
    <span className="app-token-pair" role="img" aria-label={symbols.join(' / ')}>
      <TokenLogo symbol={symbols[0]} size={size} />
      <TokenLogo symbol={symbols[1]} size={size} />
    </span>
  );
}
