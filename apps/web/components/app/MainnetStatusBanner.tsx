import manifest from '../../../../evidence/deploy/mainnet-4663.json';
import { MainnetSessionFeedStatus } from './MainnetSessionFeedStatus';

const contracts = Object.entries(manifest)
  .filter(([key, value]) => key !== 'status' && key !== 'note' && key !== 'chainId' && key !== 'deployer' && key !== 'treasury' && key !== 'serviceRecipient' && typeof value === 'string' && value.startsWith('0x')) as Array<[string, string]>;

const label = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export function MainnetStatusBanner() {
  return (
    <section className="app-mainnet-status" aria-label="Mainnet deployment status">
      <div className="app-mainnet-status__row">
        <div className="app-mainnet-status__network">
          <strong>Robinhood Chain</strong>
          <span>Mainnet · 4663</span>
        </div>
        <span className="app-mainnet-status__deployment">Contracts deployed</span>
        <MainnetSessionFeedStatus />
        <a className="app-mainnet-status__explorer" href="https://robinhoodchain.blockscout.com/" target="_blank" rel="noreferrer noopener">Explorer <span aria-hidden="true">↗</span></a>
        <details className="app-mainnet-status__details">
          <summary>Network details</summary>
          <div className="app-mainnet-status__details-panel">
            <p className="app-mainnet-status__disclosure">BELL admits Robinhood Stock Tokens AAPL, NVDA and TSLA, USDG, WETH, and MEME. A checked pool follows a live external price and steps aside to its own market price with a 1% fee and tight flow caps when that price is unavailable. A market-price pool always trades on its own liquidity and claims no outside price. Pool status is shown from the deployed hook. An independent security audit is not complete. BELL is independent and is not affiliated with Robinhood Markets, Inc.</p>
            <details className="app-mainnet-status__contracts">
              <summary>Contract addresses</summary>
              <dl>
                {contracts.map(([key, address]) => (
                  <div key={key} className="min-w-0">
                    <dt>{label(key)}</dt>
                    <dd><a href={`https://robinhoodchain.blockscout.com/address/${address}`} target="_blank" rel="noreferrer noopener">{address}</a></dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        </details>
      </div>
    </section>
  );
}
