const REQUIRED_SYMBOLS = ['AAPL', 'NVDA', 'TSLA'];
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;

function requireAddress(value, label) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} is not a nonzero address`);
  }
  return value;
}

function validateWire(symbol, name, wire, expectedKind, expectedScope, tokenId) {
  if (!wire || wire.kind !== expectedKind || wire.phaseScope !== expectedScope) {
    throw new Error(`${symbol} ${name} wire has the wrong kind or phase scope`);
  }
  requireAddress(wire.endpoint, `${symbol} ${name} endpoint`);
  requireAddress(wire.expectedImplementation, `${symbol} ${name} implementation`);
  for (const key of ['feedId', 'expectedCodeHash', 'canonicalTokenId']) {
    if (typeof wire[key] !== 'string' || !BYTES32.test(wire[key])) throw new Error(`${symbol} ${name} wire has invalid ${key}`);
  }
  if (wire.canonicalTokenId.toLowerCase() !== tokenId.toLowerCase()) {
    throw new Error(`${symbol} ${name} wire is bound to another stock token`);
  }
  if (wire.priceBasis !== (expectedKind === 1 ? 2 : 1) || wire.decimals !== 8 || wire.heartbeatSec !== 86400) {
    throw new Error(`${symbol} ${name} wire has unexpected price basis, decimals, or heartbeat`);
  }
  if (expectedKind === 1 && (wire.schema !== 0 || !/^0x0{64}$/i.test(wire.feedId))) {
    throw new Error(`${symbol} direct wire has an unexpected schema or feed id`);
  }
  if (expectedKind === 5 && (wire.schema !== 1 || /^0x0{64}$/i.test(wire.feedId))) {
    throw new Error(`${symbol} ${name} wire has an unexpected Chainlink schema or feed id`);
  }
  return Object.freeze({ ...wire });
}

/** Validate the already deployed Robinhood Chain adapters before embedding them in the new registry. */
export function buildPQMainnetChainlinkGenesis(evidence) {
  if (Number(evidence?.chainId) !== 4663) throw new Error('Expected Robinhood Chain Mainnet (4663).');
  const symbols = Object.keys(evidence.assets ?? {}).sort();
  if (symbols.join(',') !== REQUIRED_SYMBOLS.join(',')) {
    throw new Error('Expected the complete AAPL, NVDA, and TSLA Mainnet stock set.');
  }

  const assets = REQUIRED_SYMBOLS.map((symbol) => {
    const source = evidence.assets[symbol];
    const token = requireAddress(source.stockToken, `${symbol} stock token`);
    const tokenId = canonicalTokenId(4663n, token);
    const tokenCodeHash = source.tokenCodeHash;
    if (typeof tokenCodeHash !== 'string' || !BYTES32.test(tokenCodeHash)) throw new Error(`${symbol} token code hash is missing`);
    const wires = [
      validateWire(symbol, 'direct', source.directWire, 1, 0, tokenId),
      validateWire(symbol, 'regular', source.regularWire, 5, 1, tokenId),
      validateWire(symbol, 'extended', source.extendedWire, 5, 2, tokenId),
      validateWire(symbol, 'overnight', source.overnightWire, 5, 3, tokenId),
    ];
    const shared = wires[0];
    if (shared.endpoint.toLowerCase() !== requireAddress(source.feed, `${symbol} Chainlink feed`).toLowerCase()
      || wires.some((wire) => wire.endpoint.toLowerCase() !== shared.endpoint.toLowerCase()
        || wire.expectedImplementation.toLowerCase() !== shared.expectedImplementation.toLowerCase()
        || wire.expectedCodeHash.toLowerCase() !== shared.expectedCodeHash.toLowerCase())) {
      throw new Error(`${symbol} Chainlink session wires disagree on their pinned feed identity`);
    }
    const adapters = [
      source.directAdapter,
      source.regularAdapter,
      source.extendedAdapter,
      source.overnightAdapter,
    ].map((address, index) => requireAddress(address, `${symbol} adapter ${index}`));
    return Object.freeze({
      symbol,
      token,
      decimals: 18,
      capabilityMask: Number(source.capabilityMask ?? 30),
      tokenCodeHash,
      adapters: Object.freeze(adapters),
      wires: Object.freeze(wires),
      secondaryAdapter: null,
    });
  });
  return Object.freeze({ chainId: 4663, source: 'existing Robinhood Chain onchain Chainlink AggregatorV3 adapters', assets: Object.freeze(assets) });
}
import { canonicalTokenId } from '../../packages/protocol/src/identity.mjs';

