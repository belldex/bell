import manifest from '../../../../evidence/deploy/mainnet-4663.json';
import Link from 'next/link';

const contracts = Object.entries(manifest)
  .filter(([key, value]) => key !== 'status' && key !== 'note' && key !== 'chainId' && key !== 'deployer' && key !== 'treasury' && key !== 'serviceRecipient' && typeof value === 'string' && value.startsWith('0x')) as Array<[string, string]>;

const label = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export function MainnetStatusBanner() {
  return (
    <section className="app-mainnet-status" aria-label="Mainnet deployment status">
      <div className="app-mainnet-status__headline">
        <p>Network status</p>
        <strong>Robinhood Chain Mainnet</strong>
        <span className="app-mainnet-status__chain">Chain 4663 · contracts live</span>
      </div>
      <div className="app-mainnet-status__assets">
        <span className="app-mainnet-status__label">Admitted assets</span>
        <div className="app-mainnet-status__asset-list" aria-label="Admitted assets: AAPL, NVDA, TSLA, USDG, WETH, and MEME">
          {['AAPL', 'NVDA', 'TSLA', 'USDG', 'WETH', 'MEME'].map((asset) => <span key={asset}>{asset}</span>)}
        </div>
        <p>MEME is available for SESSION_ONLY pools only.</p>
      </div>
      <div className="app-mainnet-status__availability">
        <span className="app-mainnet-status__state">Live factory directory</span>
        <Link href="/pools">View live directory <span aria-hidden="true">↗</span></Link>
        <a href="https://robinhoodchain.blockscout.com/" target="_blank" rel="noreferrer noopener">Block explorer <span aria-hidden="true">↗</span></a>
      </div>
      <p className="app-mainnet-status__disclosure">Yahoo data rights and an independent audit are not verified.</p>
      <details className="app-mainnet-status__contracts">
        <summary>Contract addresses</summary>
        <dl>
          {contracts.map(([key, address]) => (
            <div key={key} className="min-w-0">
              <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-dim">{label(key)}</dt>
              <dd className="mt-0.5 flex min-w-0 items-center gap-2 font-mono text-[10px] text-muted">
                <a className="truncate underline-offset-2 hover:text-ink hover:underline" href={`https://robinhoodchain.blockscout.com/address/${address}`} target="_blank" rel="noreferrer noopener">{address}</a>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
