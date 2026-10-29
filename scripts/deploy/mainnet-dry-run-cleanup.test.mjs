import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupDryRunArtifacts } from './mainnet-dry-run-cleanup.mjs';
import { buildForgeArgs } from './mainnet-dry-run-cleanup.mjs';

test('dry-run forge arguments never contain the broadcast flag', () => {
  const args = buildForgeArgs({
    rpcUrl: 'https://rpc.example',
    outDir: 'C:/tmp/bell-out',
    cacheDir: 'C:/tmp/bell-cache',
    broadcast: false,
  });
  assert.equal(args.includes('--broadcast'), false);
  assert.ok(args.includes('--rpc-url'));
  assert.ok(args.includes('--out'));
  assert.ok(args.includes('--cache-path'));
});

test('broadcast flag appears only when the caller explicitly selects broadcast', () => {
  const args = buildForgeArgs({
    rpcUrl: 'https://rpc.example',
    outDir: 'C:/tmp/bell-out',
    cacheDir: 'C:/tmp/bell-cache',
    broadcast: true,
  });
  assert.equal(args.filter((arg) => arg === '--broadcast').length, 1);
});

test('cleanup removes a dry-run manifest when none existed before simulation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bell-mainnet-dry-run-'));
  try {
    const manifest = join(root, 'mainnet-4663.json');
    await writeFile(manifest, '{"status":"PRODUCTION","simulated":true}');
    await cleanupDryRunArtifacts({ manifestPath: manifest, previousManifest: null });
    await assert.rejects(stat(manifest), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cleanup restores the exact pre-existing manifest instead of deleting real evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bell-mainnet-dry-run-'));
  try {
    const manifest = join(root, 'mainnet-4663.json');
    const prior = Buffer.from('{"status":"REAL_BROADCAST","hash":"0xabc"}\n');
    await writeFile(manifest, prior);
    await writeFile(manifest, '{"status":"PRODUCTION","simulated":true}');
    await cleanupDryRunArtifacts({ manifestPath: manifest, previousManifest: prior });
    assert.deepEqual(await readFile(manifest), prior);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cleanup removes only the explicitly supplied Foundry dry-run output files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bell-foundry-dry-run-'));
  try {
    const broadcast = join(root, 'broadcast-dry-run.json');
    const cache = join(root, 'cache-dry-run.json');
    const realBroadcast = join(root, 'run-latest.json');
    await Promise.all([
      writeFile(broadcast, '{"simulated":true}'),
      writeFile(cache, '{"simulated":true}'),
      writeFile(realBroadcast, '{"receipts":["real"]}'),
    ]);
    await cleanupDryRunArtifacts({
      manifestPath: join(root, 'mainnet-4663.json'),
      previousManifest: null,
      foundryDryRunFiles: [broadcast, cache],
    });
    await assert.rejects(stat(broadcast), { code: 'ENOENT' });
    await assert.rejects(stat(cache), { code: 'ENOENT' });
    assert.equal(await readFile(realBroadcast, 'utf8'), '{"receipts":["real"]}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
