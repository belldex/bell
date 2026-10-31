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
  metadataBase: new URL('https://bell-black.vercel.app'),
  title: { default: 'BELL: Session-aware Robinhood Stock Token liquidity', template: '%s · BELL' },
  description:
    'BELL is an independent Uniswap v4 liquidity protocol for Robinhood Stock Tokens on Robinhood Chain Mainnet. PRICE_GUARDED uses independent references while valid and a 1% AMM fallback when unavailable; SESSION_ONLY always uses the AMM price.',
  icons: {
    icon: [{ url: '/assets/bell-logo-transparent.png', type: 'image/png' }],
    apple: [{ url: '/assets/bell-logo-transparent.png', type: 'image/png' }],
  },
  openGraph: {
    title: 'BELL: Session-aware Robinhood Stock Token liquidity',
    description: 'An independent Uniswap v4 protocol for Robinhood Stock Token pools on Robinhood Chain Mainnet. PRICE_GUARDED uses independent references while valid and a 1% AMM fallback when unavailable; SESSION_ONLY always uses the AMM price.',
    images: ['/assets/hero-bell.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BELL: Session-aware Robinhood Stock Token liquidity',
    description: 'An independent Uniswap v4 protocol for Robinhood Stock Token pools on Robinhood Chain Mainnet. PRICE_GUARDED uses independent references while valid and a 1% AMM fallback when unavailable; SESSION_ONLY always uses the AMM price.',
    images: ['/assets/hero-bell.jpg'],
  },
};

export const viewport: Viewport = {
  themeColor: '#171717',
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
