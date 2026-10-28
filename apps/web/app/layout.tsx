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
  title: { default: 'BELL — Liquidity that knows the bell', template: '%s · BELL' },
  description:
    'BELL is a Uniswap v4 hook layer for Robinhood Stock Token pools: session-aware fees, bounded flow and weekend-safe closed-market controls.',
  icons: {
    icon: '/assets/emblem-guarded.jpg',
  },
  openGraph: {
    title: 'BELL — Bourse-Event Liquidity Layer',
    description: 'Session-aware fees, bounded flow and weekend-safe controls for tokenized-stock liquidity.',
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
