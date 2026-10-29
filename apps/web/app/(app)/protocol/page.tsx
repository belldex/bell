import Link from 'next/link';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';

const sections = [
  ['sessions', 'Session fee', 'The hook applies the session base fee and takes the maximum of bell, corporate-action, and repricing guards. Unknown session or unhealthy source state fails closed.'],
  ['budgets', 'Flow budgets', 'Per-trade T, rolling W, and closure-episode C are raw token units per currency. Adding liquidity never raises caps or refills spent budgets.'],
  ['price-guarded', 'PRICE_GUARDED', 'Requires reviewed independent price references for both assets and enforces a reference band. Closed stock pricing uses a provenance-bound historical close anchor.'],
  ['session-only', 'SESSION_ONLY', 'Enforces session controls and raw-unit flow limits but does not provide independent counterasset price protection or USD valuation.'],
  ['closure', 'Recovery and exit', 'Trading resumes only after required fresh checkpoints and recovery delay. In-kind position removal/fee collection is not subject to swap guards, but live position transactions are not wired in this frontend.'],
];

export default function ProtocolPage() {
  return (
    <div className="mx-auto max-w-[1120px]">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-ion">Protocol · Robinhood Chain mainnet 4663</p>
      <h1 className="mt-3 max-w-[760px] font-display text-[36px] font-bold leading-[1.06] tracking-[-0.04em] text-ink sm:text-[48px]">Formulas, sessions, and explicit limits.</h1>
      <p className="mt-5 max-w-[620px] text-base leading-relaxed text-muted">BELL protocol contracts are deployed on Robinhood Chain mainnet. Asset admission and active pool state are not verified yet, so this page describes policy behavior rather than a live market.</p>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {sections.map(([id, title, body]) => (
          <section key={title} id={id} className="border border-line bg-surface/70 p-6">
            <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-ion">{title}</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">{body}</p>
          </section>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap gap-5 font-mono text-xs">
        <Link className="flex items-center gap-1 border-b border-current pb-0.5 text-ion" href="/pools">Pool preview <ArrowUpRight className="h-3 w-3" /></Link>
        <Link className="flex items-center gap-1 border-b border-current pb-0.5 text-ion" href="/positions">Exit policy <ArrowUpRight className="h-3 w-3" /></Link>
        <span className="inline-flex items-center gap-1 text-muted"><ShieldCheck className="h-3.5 w-3.5 text-ion" /> No preview transaction claims</span>
      </div>
    </div>
  );
}
