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
            <p className="app-mainnet-status__disclosure">BELL admits Robinhood Stock Tokens AAPL, NVDA and TSLA, USDG, WETH, and MEME. PRICE_GUARDED pools apply an independent price band while references are valid, then use an explicitly flagged AMM-only fallback with a 1% fee and strict flow caps when those inputs are unavailable. SESSION_ONLY pools always use the AMM price and have no independent price protection. Pool status is shown from the deployed hook. An independent security audit is not complete. BELL is independent and is not affiliated with Robinhood Markets, Inc.</p>
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
