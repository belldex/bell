#!/usr/bin/env node
import { fetchYahooChartQuote } from '../../packages/protocol/src/yahoo-quote.mjs';

const symbol = (process.argv[2] ?? 'AAPL').toUpperCase();
try {
  const quote = await fetchYahooChartQuote(symbol);
  console.log(JSON.stringify({
    ...quote,
    price: (BigInt(quote.priceRaw18) / 10n ** 18n).toString()
      + (BigInt(quote.priceRaw18) % 10n ** 18n === 0n ? '' : `.${(BigInt(quote.priceRaw18) % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')}`),
    sourceAttestation: 'NOT_SIGNED',
  }, null, 2));
} catch (error) {
  console.error(`Yahoo quote unavailable: ${error.message}`);
  process.exit(1);
}
