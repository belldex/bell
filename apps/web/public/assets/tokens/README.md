# Token logo sources

`TokenLogo.tsx` pins every displayed mark to its Robinhood Chain mainnet (chain 4663) token address. Hover a mark to inspect its exact address. This avoids treating a ticker as a unique token identity.

## Mainnet identities

- Robinhood stock tokens and core assets use the addresses in Robinhood's [token contract registry](https://docs.robinhood.com/chain/contracts/).
- PONS uses the mainnet token represented by the PONS/WETH Uniswap listing on [DexScreener](https://dexscreener.com/robinhood/0x10cc6bd38112cac182db90b6a71d8bb5939526ba); its logo is the token metadata image shown there.
- MEME is pinned specifically to `A Meme Coin` at `0x385F4f8ae47651ce5F58F5265395a669f8281e18`, not to any other token that happens to use the same ticker. Its DEX metadata image is shown on the [MEME/USDG listing](https://dexscreener.com/robinhood/0x46525dc119850396470f132c4a989d7192cb692139db891b5a4cdcd684c11b17).
- AAPL, MSFT, NVDA, SPY, and TSLA reuse the matching marks from Veil's `public/tokens` assets.
- AMZN uses the [Amazon icon from Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Amazon_icon.svg).
- PLTR uses the [Palantir mark in Simple Icons](https://github.com/simple-icons/simple-icons/blob/develop/icons/palantir.svg). The Robinhood PLTR token's DEX pair metadata has no image URL, so the company mark is used for the canonical stock-token address.
- USDG uses the [official Global Dollar token logo](https://globaldollar.com/brand). WETH uses the canonical Robinhood mainnet WETH mark from [Trust Wallet assets](https://github.com/trustwallet/assets/blob/master/blockchains/ethereum/tokenlist.json); ETH is the native zero-address asset and reuses that mark.

Logo files preserve their source proportions and colors inside equal-sized token slots. Simple Icons' project license does not automatically apply to every icon; check the per-icon license and applicable brand guidelines.
