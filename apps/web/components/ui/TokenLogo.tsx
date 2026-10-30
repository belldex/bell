const MAINNET_TOKEN_MARKS: Record<string, { src: string; address: `0x${string}` }> = {
  AAPL: { src: '/assets/tokens/aapl.svg', address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9' },
  TSLA: { src: '/assets/tokens/tsla.svg', address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d' },
  NVDA: { src: '/assets/tokens/nvda.svg', address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC' },
  MSFT: { src: '/assets/tokens/msft.svg', address: '0xe93237C50D904957Cf27E7B1133b510C669c2e74' },
  AMZN: { src: '/assets/tokens/amazon.svg', address: '0x12f190a9F9d7D37a250758b26824B97CE941bF54' },
  PLTR: { src: '/assets/tokens/palantir.svg', address: '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A' },
  SPY: { src: '/assets/tokens/spy.svg', address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C' },
  PONS: { src: '/assets/tokens/pons.png', address: '0x39dBED3a2bd333467115dE45665cC57F813C4571' },
  MEME: { src: '/assets/tokens/meme.png', address: '0x385F4f8ae47651ce5F58F5265395a669f8281e18' },
  ETH: { src: '/assets/tokens/weth.png', address: '0x0000000000000000000000000000000000000000' },
  WETH: { src: '/assets/tokens/weth.png', address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' },
  USDG: { src: '/assets/tokens/usdg.png', address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' },
};

export function TokenLogo({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const normalized = symbol.toUpperCase();
  const token = MAINNET_TOKEN_MARKS[normalized];
  const src = token?.src;
  const isNativeAsset = normalized === 'ETH' || normalized === 'WETH' || normalized === 'USDG';

  if (!src) {
    return (
      <span className="app-token-logo" style={{ width: size, height: size }} aria-hidden="true">
        <span className="app-token-fallback">{normalized}</span>
      </span>
    );
  }

  return (
    <span
      className={`app-token-logo${isNativeAsset ? ' app-token-logo--native' : ''}`}
      style={{ width: size, height: size }}
      data-chain-id="4663"
      data-token-address={token.address}
      title={`${normalized} · Robinhood Chain mainnet · ${token.address}`}
      aria-hidden="true"
    >
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
