import Link from 'next/link';

const GROUPS = [
  {
    title: 'Product',
    links: [
      { label: 'Pool preview', href: '/pools' },
      { label: 'Explore pools', href: '/create' },
      { label: 'BELL pool classes', href: '/pools' },
      { label: 'Risk policy', href: '/protocol' },
      { label: 'Exit policy', href: '/positions' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Protocol', href: '/protocol' },
      { label: 'Positions', href: '/positions' },
      { label: 'Swap', href: '/swap' },
      { label: 'Pool detail', href: '/pool' },
    ],
  },
  {
    title: 'Protocol',
    links: [
      { label: 'Parameters', href: '/protocol' },
      { label: 'Sessions', href: '/protocol#sessions' },
      { label: 'Planned closure', href: '/protocol#closure' },
      { label: 'X', href: 'https://x.com/bell_exchange', ext: true },
    ],
  },
  {
    title: 'BELL',
    links: [
      { label: 'Privacy policy', href: '/privacy' },
      { label: 'Terms of use', href: '/terms' },
      { label: 'Cookies', href: '/cookies' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="ftr">
      <div className="ftr-inner">
        <nav className="groups" aria-label="Footer">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h4>{group.title}</h4>
              {group.links.map((link) =>
                link.ext ? (
                  <a
                    className="ext"
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.label} href={link.href}>
                    {link.label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </nav>

        <div className="ftr-content">
          <div className="mono">
            BELL <span className="ftr-tag">TESTNET REHEARSAL</span>{' '}
            <Link className="ulink" href="/pools">
              Pool preview
            </Link>
          </div>
          <p className="gdpr">
            BELL is a testnet rehearsal. Sample data is illustrative; production swaps are not
            enabled and mainnet release has not been approved.
          </p>
        </div>
      </div>

      <div className="ftr-base copy">
        <span>© 2026 BELL / BOURSE-EVENT LIQUIDITY LAYER</span>
        <span>Production swaps are not enabled. Mainnet release has not been approved.</span>
      </div>
    </footer>
  );
}
