import { fileURLToPath } from 'node:url';
import { hashEvmCode } from '../../packages/protocol/src/identity.mjs';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const HOOK_FLAG_MASK = 0x3fffn;
const EXPECTED_HOOK_FLAGS = 0x2cc0n;
const MAX_ATTEMPTS_LIMIT = 1_000_000;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;

function checkedUint(value, name, maximum = MAX_UINT256) {
  if (typeof value !== 'bigint' && !(typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value))) {
    throw new TypeError(`${name} must be bigint or canonical decimal string`);
  }
  let parsed;
  try { parsed = BigInt(value); } catch { throw new TypeError(`${name} must be an integer`); }
  if (parsed < 0n || parsed > maximum) throw new RangeError(`${name} is out of range`);
  return parsed;
}

function uintWord(value, name, maximum = MAX_UINT256) {
  return checkedUint(value, name, maximum).toString(16).padStart(64, '0');
}

function checkedAddress(value, name) {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw new TypeError(`${name} must be a 20-byte address`);
  return value.toLowerCase();
}

function checkedHash(value, name) {
  if (typeof value !== 'string' || !HASH.test(value)) throw new TypeError(`${name} must be a 32-byte hash`);
  return value.toLowerCase();
}

function addressWord(address) {
  return address.slice(2).padStart(64, '0');
}

function asBytes32(hash) {
  return hash.slice(2);
}

function create2Address(deployer, salt, initCodeHash) {
  const digest = hashEvmCode(`0xff${deployer.slice(2)}${asBytes32(salt)}${asBytes32(initCodeHash)}`);
  return `0x${digest.slice(-40)}`;
}

/// Mines `CreateRequest.salt` candidates for BellPoolFactory's exact namespace:
/// `CREATE2 salt = keccak256(abi.encode(chainId, factory, creator, nonce, request.salt))`.
/// The EIP-1014 deployer is BellHookDeployer, not BellPoolFactory.
export function mineHookSalt({ chainId, factory, creator, deployer, nonce, baseSalt, initCodeHash, maxAttempts = 100_000 } = {}) {
  const chainValue = checkedUint(chainId, 'chainId');
  if (chainValue <= 0n) throw new RangeError('chainId must be positive');
  const chainWord = uintWord(chainValue, 'chainId');
  const nonceWord = uintWord(nonce, 'nonce', MAX_UINT64);
  const factoryAddress = checkedAddress(factory, 'factory');
  const creatorAddress = checkedAddress(creator, 'creator');
  const deployerAddress = checkedAddress(deployer, 'deployer');
  const initialSalt = checkedHash(baseSalt, 'baseSalt');
  const initHash = checkedHash(initCodeHash, 'initCodeHash');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS_LIMIT) {
    throw new RangeError(`maxAttempts must be an integer between 1 and ${MAX_ATTEMPTS_LIMIT}`);
  }

  const baseWord = asBytes32(initialSalt);
  const factoryPart = `${chainWord}${addressWord(factoryAddress)}${addressWord(creatorAddress)}${nonceWord}`;
  for (let counter = 0; counter < maxAttempts; counter += 1) {
    // Domain-separate the caller's base salt from the search counter; both are ABI words.
    const requestSalt = hashEvmCode(`0x${baseWord}${uintWord(BigInt(counter), 'counter')}`);
    const create2Salt = hashEvmCode(`0x${factoryPart}${asBytes32(requestSalt)}`);
    const hook = create2Address(deployerAddress, create2Salt, initHash);
    if ((BigInt(hook) & HOOK_FLAG_MASK) === EXPECTED_HOOK_FLAGS) {
      return Object.freeze({
        requestSalt,
        create2Salt,
        hook,
        counter,
        attempts: counter + 1,
        hookFlags: `0x${EXPECTED_HOOK_FLAGS.toString(16)}`,
        initCodeHash: initHash,
      });
    }
  }
  throw new Error(`No hook salt found within ${maxAttempts} attempts`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , chainId, factory, creator, deployer, nonce, baseSalt, initCodeHash, maxAttemptsArg] = process.argv;
  if (!initCodeHash) {
    throw new Error('Usage: node mine-hook-salt.mjs <chainId> <factory> <creator> <deployer> <nonce> <baseSalt32> <initCodeHash32> [maxAttempts]');
  }
  const result = mineHookSalt({
    chainId, factory, creator, deployer, nonce, baseSalt, initCodeHash,
    ...(maxAttemptsArg === undefined ? {} : { maxAttempts: Number(maxAttemptsArg) }),
  });
  console.log(JSON.stringify(result, null, 2));
}
