import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem';
import { canonicalTokenId } from '../../packages/protocol/src/identity.mjs';

const ZERO32 = `0x${'0'.repeat(64)}`;
const wireTuple = '(uint8 kind,uint8 phaseScope,address endpoint,bytes32 feedId,uint16 schema,uint8 decimals,uint8 priceBasis,uint32 heartbeatSec,bytes32 expectedCodeHash,address expectedImplementation,bytes32 canonicalTokenId)';
const wireHashAbi = parseAbiParameters(`${wireTuple} wire`);

export function buildChainlinkSessionPlan({ chainId = 4663, token, feed, proxyCodeHash, implementation, implementationCodeHash, decimals = 8, scopes = [1, 2, 3] }) {
  const tokenId = canonicalTokenId(BigInt(chainId), token);
  const makeWire = (kind, phaseScope, feedId, schema, priceBasis, heartbeatSec, endpoint, codeHash, expectedImplementation) => ({
    kind, phaseScope, endpoint, feedId, schema, decimals, priceBasis, heartbeatSec,
    expectedCodeHash: codeHash, expectedImplementation, canonicalTokenId: tokenId,
  });
  const directWire = makeWire(1, 0, ZERO32, 0, 2, 86400, feed, proxyCodeHash, implementation);
  const directWireHash = keccak256(encodeAbiParameters(wireHashAbi, [directWire]));
  const sessions = {};
  for (const scope of scopes) {
    const feedId = keccak256(encodeAbiParameters(parseAbiParameters('string label,address feed,uint8 scope'), ['BELL:CHAINLINK:SESSION', feed, scope]));
    const wire = makeWire(5, scope, feedId, 1, 1, 86400, feed, proxyCodeHash, implementation);
    const wireHash = keccak256(encodeAbiParameters(wireHashAbi, [wire]));
    sessions[scope] = { feedId, wire, wireHash };
  }
  return Object.freeze({ directWire, directWireHash, sessions });
}
