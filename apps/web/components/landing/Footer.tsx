import Link from 'next/link';

const GROUPS = [
  {
    title: 'Product',
    links: [
      { label: 'Pool preview', href: '/pools' },
      { label: 'Explore pools', href: '/create' },
      { label: 'Pool classes', href: '/pools' },
      { label: 'Risk policy', href: '/protocol' },
      { label: 'Exit policy', href: '/positions' },
    ],
  },
  {
    title: 'App',
    links: [
      { label: 'Pools', href: '/pools' },
      { label: 'Create', href: '/create' },
      { label: 'Positions', href: '/positions' },
      { label: 'Swap', href: '/swap' },
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

/**
 * Reference footer: gradient slab background, 4 mono link columns,
 * 350px content block with gdpr note, hairline top rule for the base row.
 * Colors follow BELL tokens (slab, dim, line).
 */
export default function LandingFooter() {
  return (
    <footer className="relative z-[1] bg-gradient-to-b from-transparent via-slab/60 to-slab px-10 pb-10 pt-[140px] max-md:px-[30px] max-md:pt-[120px]">
      <div className="flex items-start justify-between gap-10 max-lg:flex-col max-lg:gap-12">
        <nav className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-4" aria-label="Footer">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h4 className="mb-1.5 font-mono text-xs font-normal text-muted">{group.title}</h4>
              {group.links.map((link) =>
                link.ext ? (
                  <a
                    key={link.label}
                    className="block font-mono text-xs leading-[22px] text-dim hover:text-ink"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.label} href={link.href} className="block font-mono text-xs leading-[22px] text-dim hover:text-ink">
                    {link.label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </nav>

        <div className="flex w-[350px] max-lg:w-full flex-col gap-6">
          <div className="font-mono text-xs text-muted">
            <b className="font-normal text-ion">BELL</b> <span>TESTNET REHEARSAL</span>{' '}
            <Link href="/pools" className="border-b border-current pb-0.5 hover:text-ion">
              Pool preview
            </Link>
          </div>
          <p className="max-w-[350px] font-mono text-xs leading-[18px] text-dim">
            BELL is a testnet rehearsal. Sample data is illustrative; production swaps are not
            enabled and mainnet release has not been approved.
          </p>
        </div>
      </div>

      <div className="mt-20 flex flex-wrap justify-between gap-5 border-t border-white/10 pt-5 max-md:mt-12">
        <span className="font-mono text-xs text-dim">© 2026 BELL / BOURSE-EVENT LIQUIDITY LAYER</span>
        <span className="font-mono text-xs text-dim">
          Production swaps are not enabled. Mainnet release has not been approved.
        </span>
      </div>
    </footer>
  );
}
