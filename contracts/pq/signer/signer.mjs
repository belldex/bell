import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { open, readFile, rename, unlink, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHashSigs, shrincsKeysToSecretBytes } from '@quip.network/hashsigs-wasm/256s-keccak';

const here = path.dirname(fileURLToPath(import.meta.url));
const keyDir = path.resolve(here, '..', 'keys', 'elysium-99801');
const localEnv = path.resolve(here, '..', '.env.local');

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    return match ? [match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')] : null;
  }).filter(Boolean));
}

async function encryptionKey(create = false) {
  let values = {};
  try { values = parseEnv(await readFile(localEnv, 'utf8')); } catch {}
  let secret = process.env.BELL_PQ_ENCRYPTION_KEY || values.BELL_PQ_ENCRYPTION_KEY;
  if (!secret && create) {
    secret = randomBytes(32).toString('hex');
    await mkdir(path.dirname(localEnv), { recursive: true });
    await writeFile(localEnv, `BELL_PQ_ENCRYPTION_KEY=${secret}\n`, { flag: 'wx', mode: 0o600 });
  }
  if (!secret || !/^[0-9a-fA-F]{64}$/.test(secret)) throw new Error('PQ signer encryption key is missing or malformed.');
  return Buffer.from(secret, 'hex');
}

function seal(plain, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.from(JSON.stringify({ v: 1, nonce: nonce.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('hex') }));
}

function unseal(serialized, key) {
  const box = JSON.parse(serialized.toString('utf8'));
  if (box.v !== 1) throw new Error('Unknown PQ signer state format.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.nonce, 'hex'));
  decipher.setAuthTag(Buffer.from(box.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(box.ciphertext, 'hex')), decipher.final()]);
}

async function atomicWrite(file, data) {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, file);
}

async function withRoleLock(role, task) {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(role)) throw new Error('Invalid role name.');
  await mkdir(keyDir, { recursive: true });
  const statePath = path.join(keyDir, `${role}.enc`);
  const lockPath = `${statePath}.lock`;
  const lock = await open(lockPath, 'wx', 0o600).catch(() => null);
  if (!lock) throw new Error(`Signer for ${role} is locked by another or interrupted process; inspect lock before retrying.`);
  try { await lock.writeFile(`${process.pid}\n`); await lock.sync(); } finally { await lock.close(); }
  try { return await task(statePath); } finally { await unlink(lockPath).catch(() => {}); }
}

async function main() {
  const [command, role, arg] = process.argv.slice(2);
  const { shrincs, shrincsImportSigningKey } = await loadHashSigs();
  if (command === 'init') {
    const budget = Number(arg ?? 64);
    if (!Number.isInteger(budget) || budget < 1 || budget > 4096) throw new Error('Leaf budget must be 1..4096.');
    await withRoleLock(role, async (statePath) => {
      const seed = randomBytes(32);
      const keys = shrincs.keygen(seed, budget);
      seed.fill(0);
      const secret = shrincsKeysToSecretBytes(keys);
      await atomicWrite(statePath, seal(secret, await encryptionKey(true)));
      secret.fill(0);
      const metadataPath = path.join(keyDir, `${role}.public.json`);
      await atomicWrite(metadataPath, JSON.stringify({
        scheme: 'shrincs-256s-keccak', role, maxSignatures: budget,
        publicKeyCommitment: `0x${Buffer.from(keys.publicKeyCommitment).toString('hex')}`,
        nextLeafIndex: 1,
      }, null, 2));
      process.stdout.write(`${JSON.stringify({ role, maxSignatures: budget, publicKeyCommitment: `0x${Buffer.from(keys.publicKeyCommitment).toString('hex')}` })}\n`);
    });
    return;
  }
  if (command === 'sign') {
    const digest = arg;
    if (!/^0x[0-9a-fA-F]{64}$/.test(digest ?? '')) throw new Error('Digest must be 32-byte hex.');
    await withRoleLock(role, async (statePath) => {
      const key = await encryptionKey();
      const encrypted = await readFile(statePath);
      const secret = unseal(encrypted, key);
      let keys;
      try { keys = shrincsImportSigningKey(new Uint8Array(secret)); } finally { secret.fill(0); }
      const leafIndex = keys.stateful.nextLeafIndex;
      if (leafIndex > keys.stateful.publicKey.maxSignatures) throw new Error('Stateful leaf budget exhausted; rotate key under HybridAuth.');
      const message = Uint8Array.from(Buffer.from(digest.slice(2), 'hex'));
      const signature = shrincs.sign(message, keys);
      if (!shrincs.verify(signature, message, keys.publicKeyCommitment)) throw new Error('Local SHRINCS self-verification failed.');
      const nextSecret = shrincsKeysToSecretBytes(keys);
      await atomicWrite(statePath, seal(nextSecret, key));
      nextSecret.fill(0);
      process.stdout.write(`${JSON.stringify({ role, leafIndex, signature: `0x${Buffer.from(signature).toString('hex')}` })}\n`);
    });
    return;
  }
  if (command === 'preview') {
    const digest = arg;
    if (!/^0x[0-9a-fA-F]{64}$/.test(digest ?? '')) throw new Error('Digest must be 32-byte hex.');
    await withRoleLock(role, async (statePath) => {
      const secret = unseal(await readFile(statePath), await encryptionKey());
      let keys;
      try { keys = shrincsImportSigningKey(new Uint8Array(secret)); } finally { secret.fill(0); }
      const leafIndex = keys.stateful.nextLeafIndex;
      if (leafIndex > keys.stateful.publicKey.maxSignatures) throw new Error('Stateful leaf budget exhausted; rotate key under HybridAuth.');
      const message = Uint8Array.from(Buffer.from(digest.slice(2), 'hex'));
      const signature = shrincs.signAtLeaf(message, keys, leafIndex);
      if (!shrincs.verify(signature, message, keys.publicKeyCommitment)) throw new Error('Local SHRINCS preview self-verification failed.');
      process.stdout.write(`${JSON.stringify({ role, leafIndex, signature: `0x${Buffer.from(signature).toString('hex')}` })}\n`);
    });
    return;
  }
  if (command === 'preview-reuse') {
    if (process.env.BELL_PQ_ALLOW_REUSE_PROOF !== '1') {
      throw new Error('Unsafe reused-leaf proof is disabled; set BELL_PQ_ALLOW_REUSE_PROOF=1 only for the dedicated testnet rejection exercise.');
    }
    const digest = arg;
    const leafIndex = Number(process.argv[5]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(digest ?? '') || !Number.isInteger(leafIndex) || leafIndex < 1) {
      throw new Error('Usage: preview-reuse <role> <digest-hex> <previous-leaf-index>');
    }
    await withRoleLock(role, async (statePath) => {
      const secret = unseal(await readFile(statePath), await encryptionKey());
      let keys;
      try { keys = shrincsImportSigningKey(new Uint8Array(secret)); } finally { secret.fill(0); }
      if (leafIndex >= keys.stateful.nextLeafIndex) throw new Error('The proof leaf is not already consumed by the local signer.');
      const message = Uint8Array.from(Buffer.from(digest.slice(2), 'hex'));
      const signature = shrincs.signAtLeaf(message, keys, leafIndex);
      if (!shrincs.verify(signature, message, keys.publicKeyCommitment)) throw new Error('Local reused-leaf proof self-verification failed.');
      process.stdout.write(`${JSON.stringify({ role, leafIndex, warning: 'testnet rejection proof only', signature: `0x${Buffer.from(signature).toString('hex')}` })}\n`);
    });
    return;
  }
  if (command === 'status') {
    const metadataPath = path.join(keyDir, `${role}.public.json`);
    const meta = JSON.parse(await readFile(metadataPath, 'utf8'));
    const key = await encryptionKey();
    const secret = unseal(await readFile(path.join(keyDir, `${role}.enc`)), key);
    try {
      const keys = shrincsImportSigningKey(new Uint8Array(secret));
      process.stdout.write(`${JSON.stringify({ ...meta, nextLeafIndex: keys.stateful.nextLeafIndex, remaining: keys.stateful.remaining })}\n`);
    } finally { secret.fill(0); }
    return;
  }
  throw new Error('Usage: node signer.mjs init <role> [leaf-budget] | preview <role> <digest-hex> | sign <role> <digest-hex> | status <role>');
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
