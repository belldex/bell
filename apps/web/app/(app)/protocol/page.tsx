import Link from 'next/link';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { DeployedContracts } from '@/components/protocol/DeployedContracts';

const sections = [
  { id: 'contracts', category: 'Deployment', title: 'Active Mainnet contracts', body: 'Authoritative smart contracts and token assets deployed on Robinhood Chain Mainnet (4663).', short: 'Active contracts' },
  { id: 'sessions', category: 'Fee engine', title: 'Session fee', body: 'The hook applies the session base fee and takes the maximum of bell, corporate-action, and repricing guards. Unknown calendar state fails closed. A checked pool steps aside when its external price is unavailable; a market-price pool is never affected.', short: 'Session fee' },
  { id: 'budgets', category: 'Flow control', title: 'Flow budgets', body: 'Per-trade T, rolling W, and closure-episode C are raw token units per currency. Adding liquidity never raises caps or refills spent budgets.', short: 'Flow budgets' },
  { id: 'auction-escrow', category: 'Opening Bell', title: 'Auction order escrow', body: 'During an Opening Bell cycle, a submitted quote or stock amount is held by the per-pool auction contract until the batch settles or refunds open. Matching orders clear peer-to-peer at one uniform price; unmatched amounts can be claimed by their owner. The escrow cannot be paused by the safety controller, but the assets are held in the contract while the cycle is active. This is separate from LP positions, which remain user-owned PositionManager NFTs and removable in-kind.', short: 'Auction escrow' },
  { id: 'checked-price', category: 'Pool type', code: 'Checked price', title: 'External price check', body: 'Both assets need an approved external price source. The pool keeps trading close to it while the source is available. When it is not, the pool steps aside to its own market price with a 1% fee and the tightest flow caps, bounded by the calendar interval and closure budget.', short: 'Checked price' },
  { id: 'market-price', category: 'Pool type', code: 'Market price', title: 'Own-market pricing', body: 'Prices come from the pool liquidity itself and never wait for an external feed. Session fees and raw-unit flow limits still apply, but no outside price is claimed and no USD valuation is shown.', short: 'Market price' },
  { id: 'closure', category: 'Recovery', title: 'Recovery and exit', body: 'Trading resumes only after required fresh checkpoints and recovery delay. The connected Positions page discovers wallet-owned BELL NFTs and offers direct add, minimum-output in-kind removal, and fee collection through PositionManager.', short: 'Recovery and exit' },
  { id: 'exit-liveness', category: 'Exit', title: 'Exit liveness', body: "A hook's permissions are the low 14 bits of its own address. BELL's mask 0x2CC0 sets five of them (beforeInitialize, beforeAddLiquidity, afterAddLiquidity, beforeSwap, afterSwap) and none of the three that touch removing liquidity, so no BELL policy can hold a withdraw back. That holds only while the Uniswap v4 PositionManager and Robinhood Chain run normally. Check every pool on the Exit proof page.", short: 'Exit liveness' },
];

export default function ProtocolPage() {
  return (
    <div className="app-content-frame app-protocol-page">
      <div className="app-protocol-header">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ion">Protocol / Robinhood Chain mainnet</p>
          <h1 className="mt-3 max-w-[900px] font-display text-[36px] font-bold leading-[1.04] tracking-[-0.05em] text-ink sm:text-[48px]">Policy rules, made explicit.</h1>
        </div>
        <p className="max-w-[560px] text-sm leading-relaxed text-muted">Active on Robinhood Chain Mainnet for admitted stock tokens and counterassets. Pricing modes, session fees, and flow limits are enforced directly onchain by the hook.</p>
      </div>

      <nav className="app-protocol-index" aria-label="Protocol topics">
        {sections.map((section) => <Link key={section.id} href={`#${section.id}`}>{section.short}<ArrowUpRight aria-hidden="true" /></Link>)}
      </nav>

      <div className="app-protocol-grid">
        {sections.filter((s) => s.id !== 'contracts').map((section) => (
          <section key={section.id} id={section.id} className={`app-protocol-card${section.id === 'closure' || section.id === 'exit-liveness' ? ' app-protocol-card--wide' : ''}`}>
            <div className="app-protocol-card__eyebrow">
              <span>{section.category}</span>
              {section.code && <code>{section.code}</code>}
            </div>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </section>
        ))}
      </div>

      <DeployedContracts />

      <div className="app-protocol-footer">
        <div className="flex flex-wrap gap-x-6 gap-y-3 font-mono text-xs">
          <Link href="/pools">Pool directory <ArrowUpRight aria-hidden="true" /></Link>
          <Link href="/positions">Exit policy <ArrowUpRight aria-hidden="true" /></Link>
          <Link href="/proof">Exit proof <ArrowUpRight aria-hidden="true" /></Link>
          <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noopener noreferrer">Explorer <ArrowUpRight aria-hidden="true" /></a>
        </div>
        <span><ShieldCheck aria-hidden="true" /> Verified Mainnet bytecode · chain 4663</span>
      </div>
    </div>
  );
}
