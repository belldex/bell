import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

const GROUPS = [
  { title: 'Explore', links: [['Pool directory', '/pools'], ['Pool classes', '/pools'], ['Create a pool', '/create']] },
  { title: 'Protocol', links: [['Policy overview', '/protocol'], ['Market sessions', '/protocol#sessions'], ['Planned close', '/protocol#closure']] },
  { title: 'Your account', links: [['Positions', '/positions'], ['Swap preview', '/swap'], ['Documentation', '/protocol']] },
  { title: 'BELL', links: [['Privacy', '/privacy'], ['Terms', '/terms'], ['Cookies', '/cookies']] },
] as const;

export default function LandingFooter() {
  return (
    <footer className="bell-footer-curtain" aria-label="BELL footer" aria-hidden="true" inert>
      <div className="bell-footer-top">
        <Link href="/" className="bell-footer-brand"><span>B</span><b>BELL</b><small>Bourse-event liquidity layer</small></Link>
        <p>Liquidity that knows the bell.<br />Rules that stay visible.</p>
      </div>
      <nav className="bell-footer-groups" aria-label="Footer">
        {GROUPS.map((group) => <div key={group.title}><h2>{group.title}</h2>{group.links.map(([label, href]) => <Link key={label} href={href}>{label}<ArrowUpRight size={12} aria-hidden="true" /></Link>)}</div>)}
      </nav>
      <div className="bell-footer-note"><strong>Testnet rehearsal</strong><p>Sample values are illustrative. Production swaps are not enabled and mainnet release has not been approved.</p></div>
      <div className="bell-footer-bottom"><span>© 2026 BELL · BOURSE-EVENT LIQUIDITY LAYER</span><span>Policy first. Market aware.</span></div>
    </footer>
  );
}
