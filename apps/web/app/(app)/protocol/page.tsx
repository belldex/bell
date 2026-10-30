import Link from 'next/link';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';

const sections = [
  { id: 'sessions', category: 'Fee engine', title: 'Session fee', body: 'The hook applies the session base fee and takes the maximum of bell, corporate-action, and repricing guards. Unknown session or unhealthy source state fails closed.', short: 'Session fee' },
  { id: 'budgets', category: 'Flow control', title: 'Flow budgets', body: 'Per-trade T, rolling W, and closure-episode C are raw token units per currency. Adding liquidity never raises caps or refills spent budgets.', short: 'Flow budgets' },
  { id: 'price-guarded', category: 'Pool class', code: 'PRICE_GUARDED', title: 'Independent price guard', body: 'Requires reviewed independent price references for both assets and enforces a reference band. Closed stock pricing uses a provenance-bound historical close anchor.', short: 'Price guarded' },
  { id: 'session-only', category: 'Pool class', code: 'SESSION_ONLY', title: 'Session controls', body: 'Enforces session controls and raw-unit flow limits but does not provide independent counterasset price protection or USD valuation.', short: 'Session only' },
  { id: 'closure', category: 'Recovery', title: 'Recovery and exit', body: 'Trading resumes only after required fresh checkpoints and recovery delay. In-kind position removal and fee collection are not subject to swap guards, but live position transactions are not wired in this frontend.', short: 'Recovery and exit' },
];

export default function ProtocolPage() {
  return (
    <div className="app-protocol-page w-full">
      <div className="app-protocol-header">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ion">Protocol / Robinhood Chain mainnet</p>
          <h1 className="mt-3 max-w-[900px] font-display text-[36px] font-bold leading-[1.04] tracking-[-0.05em] text-ink sm:text-[48px]">Policy rules, made explicit.</h1>
        </div>
        <p className="max-w-[560px] text-sm leading-relaxed text-muted">Contracts are deployed on Robinhood Chain mainnet, but asset admission and active pool state are not verified. This page explains protocol policy, not live market state.</p>
      </div>

      <nav className="app-protocol-index" aria-label="Protocol topics">
        {sections.map((section) => <Link key={section.id} href={`#${section.id}`}>{section.short}<ArrowUpRight aria-hidden="true" /></Link>)}
      </nav>

      <div className="app-protocol-grid">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className={`app-protocol-card${section.id === 'closure' ? ' app-protocol-card--wide' : ''}`}>
            <div className="app-protocol-card__eyebrow">
              <span>{section.category}</span>
              {section.code && <code>{section.code}</code>}
            </div>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </section>
        ))}
      </div>

      <div className="app-protocol-footer">
        <div className="flex flex-wrap gap-x-6 gap-y-3 font-mono text-xs">
          <Link href="/pools">Pool preview <ArrowUpRight aria-hidden="true" /></Link>
          <Link href="/positions">Exit policy <ArrowUpRight aria-hidden="true" /></Link>
        </div>
        <span><ShieldCheck aria-hidden="true" /> No preview transaction claims</span>
      </div>
    </div>
  );
}
