import { readFileSync, writeFileSync } from 'node:fs';
const f = 'evidence/deploy/yahoo-verifier-adapter-testnet.json';
const j = JSON.parse(readFileSync(f, 'utf8'));
j.nextSteps = [
  'BLOCKED: a stock descriptor cannot be queued usefully yet. Three things must be true at once: a real stock token with code on 46630 (the official Robinhood assets API lists all 195 assets on chainId 4663 only), a committed CalendarRegistry root (currentInterval is all zeros), and a source sample inside the 120-second policy (the newest direct sample was already 5500 seconds old when traced on 2026-10-27).',
  'AaplTestnetFacade 0x64a82eb01d7c7310ef1bc5f0055f758409d45c63 must NOT be queued as a stock descriptor. It exists only to satisfy the stream adapter constructor stockToken.code.length check and is not a Robinhood Stock Token.',
  'Refresh the Yahoo direct sample and then submit a stream-scope report to SessionRegistry once an admitted stock descriptor and calendar interval exist.',
  'createAndSeed the first pool only after swap enforcement M05-05 lands; BellHook SWAP_EXECUTION_READY is false and every swap callback reverts HookNotImplemented().',
  'Mainnet deployment requires owner-approved funding and is not covered by this rehearsal. No Mainnet Yahoo adapter has ever been deployed; mainnet-yahoo-preflight.mjs no longer accepts placeholder addresses.',
  'See docs/CURRENT-STATE.md for the full traced state.',
];
j.tracedAt = '2026-10-27';
j.traceNotes = {
  directSampleAtTrace: { price18: '342944023940939432439', observedAt: 1793089910, ageSeconds: 5500, validUntil: 1793090030, expired: true },
  streamAdaptersHaveNoSample: 'readCurrent() reverts WrongAdapterMode() on scope 1/2/3 because they are not direct mode',
  descriptorStatus: 'descriptorIdForToken returns zero for the AAPL facade and for mBELL; only WETH counterasset is ACTIVE',
  calendarStatus: 'CalendarRegistry.currentInterval(WETH) returns session=0, startAt=0, endAt=0, leafHash=0x0',
  sessionHealth: 'SessionRegistry.health(WETH) ready=false, refreshedAt=0 (refreshHealth has never succeeded)',
};
writeFileSync(f, JSON.stringify(j, null, 2) + '\n', 'utf8');
console.log('updated nextSteps + trace notes');
