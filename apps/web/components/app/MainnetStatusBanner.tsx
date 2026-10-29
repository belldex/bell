import manifest from '../../../../evidence/deploy/mainnet-4663.json';

const contracts = Object.entries(manifest)
  .filter(([key, value]) => key !== 'status' && key !== 'note' && key !== 'chainId' && key !== 'deployer' && key !== 'treasury' && key !== 'serviceRecipient' && typeof value === 'string' && value.startsWith('0x')) as Array<[string, string]>;

const label = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export function MainnetStatusBanner() {
  return (
    <section className="border border-line bg-surface/70 px-4 py-4 sm:px-5" aria-label="Mainnet deployment status">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Robinhood Chain · Mainnet</p>
          <p className="mt-1 text-sm text-ink">Protocol contracts are deployed on chain 4663.</p>
        </div>
        <a className="font-mono text-[10px] uppercase tracking-[0.1em] text-ion underline-offset-4 hover:underline" href="https://robinhoodchain.blockscout.com/" target="_blank" rel="noreferrer noopener">Open explorer ↗</a>
      </div>
      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted">Mainnet asset admission and an active pool are not verified yet. Swap execution and pool creation stay unavailable; preview values below are illustrative only.</p>
      <details className="group mt-3">
        <summary className="w-fit cursor-pointer font-mono text-[10px] uppercase tracking-[0.1em] text-dim hover:text-ink">Deployed contract addresses</summary>
        <dl className="mt-3 grid gap-x-5 gap-y-2 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-3">
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
