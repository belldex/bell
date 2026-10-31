import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChainlinkSessionPlan } from './mainnet-chainlink-session-plan.mjs';

const TOKEN = '0x322F0929c4625eD5bAd873c95208D54E1c003b2d';
const FEED = '0x4A1166a659A55625345e9515b32adECea5547C38';
const PROXY_HASH = `0x${'11'.repeat(32)}`;
const IMPLEMENTATION = '0x1234567890123456789012345678901234567890';
const IMPLEMENTATION_HASH = `0x${'22'.repeat(32)}`;

test('builds a total-return direct wire and three distinct calendar-bound Chainlink session wires', () => {
  const plan = buildChainlinkSessionPlan({
    token: TOKEN, feed: FEED, proxyCodeHash: PROXY_HASH,
    implementation: IMPLEMENTATION, implementationCodeHash: IMPLEMENTATION_HASH,
  });
  assert.equal(plan.directWire.kind, 1);
  assert.equal(plan.directWire.priceBasis, 2);
  assert.deepEqual(Object.keys(plan.sessions), ['1', '2', '3']);
  assert.deepEqual(Object.values(plan.sessions).map(({ wire }) => [wire.kind, wire.phaseScope, wire.schema, wire.priceBasis, wire.heartbeatSec]), [
    [5, 1, 1, 1, 86400], [5, 2, 1, 1, 86400], [5, 3, 1, 1, 86400],
  ]);
  assert.equal(new Set(Object.values(plan.sessions).map(({ feedId }) => feedId)).size, 3);
  assert.ok(Object.values(plan.sessions).every(({ wire }) => wire.canonicalTokenId === plan.directWire.canonicalTokenId));
});
