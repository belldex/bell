import manifest from '../../../../evidence/deploy/mainnet-4663.json';

const contracts = Object.entries(manifest)
  .filter(([key, value]) => key !== 'status' && key !== 'note' && key !== 'chainId' && key !== 'deployer' && key !== 'treasury' && key !== 'serviceRecipient' && typeof value === 'string' && value.startsWith('0x')) as Array<[string, string]>;

const label = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export function MainnetStatusBanner() {
  return (
    <section className="app-mainnet-status" aria-label="Mainnet deployment status">
      <div className="app-mainnet-status__headline">
        <p>Robinhood Chain <span>·</span> Mainnet</p>
        <strong>Contracts and asset registry live <span>4663</span></strong>
      </div>
      <p className="app-mainnet-status__disclosure">AAPL, NVDA, TSLA, USDG, WETH and MEME are admitted; MEME is SESSION_ONLY only. Create, quote and wallet-position flows are connected, but the pool directory is empty, so no Mainnet swap can run yet. Yahoo data rights and an independent audit are unverified.</p>
      <a className="app-mainnet-status__explorer" href="https://robinhoodchain.blockscout.com/" target="_blank" rel="noreferrer noopener">Explorer ↗</a>
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
