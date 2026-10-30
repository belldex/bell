import { encodeAbiParameters, keccak256 } from 'viem';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ZERO32 = `0x${'0'.repeat(64)}`;
const HOOK_FLAG_MASK = 0x3fffn;
const EXPECTED_HOOK_FLAGS = 0x2cc0n;

function requireAddress(value, label) {
  if (!ADDRESS.test(value ?? '') || value.toLowerCase() === ZERO_ADDRESS) throw new Error(`${label} is not an active admitted token`);
  return value.toLowerCase();
}

function requireAssetId(value, label) {
  if (!BYTES32.test(value ?? '') || value.toLowerCase() === ZERO32) throw new Error(`${label} has no admitted descriptor`);
  return value.toLowerCase();
}

export function resolveAdmittedPair({ stockSymbol, counterSymbol, assetQueue }) {
  const stock = String(stockSymbol ?? '').toUpperCase();
  const counter = String(counterSymbol ?? '').toUpperCase();
  if (assetQueue?.activationPending) throw new Error('Asset admission is still pending');
  const stockEntry = assetQueue?.stocks?.[stock];
  if (!stockEntry || stockEntry.isStock !== true) throw new Error(`Stock ${stock || '(empty)'} is not admitted on Mainnet`);
  const counterEntry = assetQueue?.stocks?.[counter]
    ?? assetQueue?.[counter.toLowerCase()]
    ?? Object.values(assetQueue?.counterassets ?? {}).find((entry) => String(entry?.symbol).toUpperCase() === counter);
  if (!counterEntry || counterEntry.isStock !== (Boolean(assetQueue?.stocks?.[counter]))) {
    throw new Error(`Counterasset ${counter || '(empty)'} is not admitted on Mainnet`);
  }
  const legs = [
    { symbol: stock, token: requireAddress(stockEntry.token, `${stock} token`), assetId: requireAssetId(stockEntry.descriptorId, stock), isStock: true },
    { symbol: counter, token: requireAddress(counterEntry.token, `${counter} token`), assetId: requireAssetId(counterEntry.descriptorId, counter), isStock: counterEntry.isStock === true },
  ];
  if (legs[0].token === legs[1].token || legs[0].assetId === legs[1].assetId) throw new Error('Pool assets must be distinct');
  legs.sort((a, b) => a.token.localeCompare(b.token));
  return Object.freeze({ stockSymbol: stock, counterSymbol: counter, legs: Object.freeze(legs) });
}

export function poolClassesForPair(pair, referenceAdapters) {
  const refs = pair.legs.map((leg) => referenceAdapters?.[`${leg.symbol}/USD`]?.adapter ?? referenceAdapters?.[leg.symbol]?.adapter ?? referenceAdapters?.[leg.symbol] ?? ZERO_ADDRESS);
  const hasReferences = refs.every((value) => ADDRESS.test(value ?? '') && value.toLowerCase() !== ZERO_ADDRESS);
  const stockCount = pair.legs.filter((leg) => leg.isStock).length;
  const classes = [];
  if (hasReferences) classes.push(0); // PRICE_GUARDED
  if (stockCount === 1) classes.push(1); // SESSION_ONLY requires exactly one stock leg
  return classes;
}

function uintWord(value, label, max = (1n << 256n) - 1n) {
  let parsed;
  try { parsed = BigInt(value); } catch { throw new TypeError(`${label} must be an integer`); }
  if (parsed < 0n || parsed > max) throw new RangeError(`${label} is out of range`);
  return `0x${parsed.toString(16).padStart(64, '0')}`;
}

function addressWord(address, label) {
  return `0x${requireAddress(address, label).slice(2).padStart(64, '0')}`;
}

function hashPackedWords(words) {
  return keccak256(`0x${words.map((word) => word.slice(2)).join('')}`);
}

/** Browser-safe mirror of scripts/tooling/mine-hook-salt.mjs. */
export function mineHookSalt({ chainId, factory, creator, deployer, nonce, baseSalt = `0x${'0'.repeat(63)}1`, initCodeHash, maxAttempts = 200_000 }) {
  const chainWord = uintWord(chainId, 'chainId');
  const nonceWord = uintWord(nonce, 'nonce', (1n << 64n) - 1n);
  if (!BYTES32.test(baseSalt ?? '') || baseSalt.toLowerCase() === ZERO32) throw new TypeError('baseSalt must be nonzero bytes32');
  if (!BYTES32.test(initCodeHash ?? '')) throw new TypeError('initCodeHash must be bytes32');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1_000_000) throw new RangeError('maxAttempts is invalid');
  const fixed = [chainWord, addressWord(factory, 'factory'), addressWord(creator, 'creator'), nonceWord];
  for (let counter = 0; counter < maxAttempts; counter += 1) {
    const requestSalt = hashPackedWords([baseSalt.toLowerCase(), uintWord(counter, 'counter')]);
    const create2Salt = hashPackedWords([...fixed, requestSalt]);
    const deployerAddress = requireAddress(deployer, 'deployer');
    const digest = keccak256(`0xff${deployerAddress.slice(2)}${create2Salt.slice(2)}${initCodeHash.slice(2).toLowerCase()}`);
    const hook = `0x${digest.slice(-40)}`;
    if ((BigInt(hook) & HOOK_FLAG_MASK) === EXPECTED_HOOK_FLAGS) {
      return Object.freeze({ requestSalt, create2Salt, hook, counter, attempts: counter + 1, hookFlags: `0x${EXPECTED_HOOK_FLAGS.toString(16)}`, initCodeHash: initCodeHash.toLowerCase() });
    }
  }
  throw new Error(`No hook salt found within ${maxAttempts} attempts`);
}

export function encodePairAsAssetWords(legs) {
  if (!Array.isArray(legs) || legs.length !== 2) throw new Error('exactly two pool legs are required');
  return encodeAbiParameters([{ type: 'bytes32[2]' }], [legs.map((leg) => requireAssetId(leg.assetId, leg.symbol))]);
}
