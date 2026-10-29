import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const sans = localFont({
  src: '../public/assets/instrument-sans-v4.woff2',
  variable: '--font-instrument',
  display: 'swap',
});
const mono = localFont({
  src: '../public/assets/geist-mono-v4.woff2',
  variable: '--font-geist-mono',
  display: 'swap',
});
const pixel = localFont({
  src: '../public/assets/silkscreen-v4.woff2',
  variable: '--font-pixel',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://bell.exchange'),
  title: { default: 'BELL — Market-aware liquidity for tokenized stocks', template: '%s · BELL' },
  description:
    'BELL is a Uniswap v4 hook for tokenized-stock pools. Session-aware LP fees, bounded swap flow and fail-closed market-data checks. Testnet prototype; no mainnet deployment.',
  icons: {
    icon: '/assets/emblem-guarded.jpg',
  },
  openGraph: {
    title: 'BELL — Market-aware liquidity for tokenized stocks',
    description: 'A Uniswap v4 hook for tokenized-stock pools with session-aware LP fees, bounded swap flow and fail-closed data checks. Testnet prototype; no mainnet deployment.',
    images: ['/assets/hero-bell.jpg'],
  },
};

export const viewport: Viewport = {
  themeColor: '#05070a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${pixel.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-ion focus:px-4 focus:py-2 focus:text-bg-0"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
