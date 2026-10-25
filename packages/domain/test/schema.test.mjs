import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sql = readFileSync(new URL('../../../supabase/migrations/20261025000000_derived_state.sql', import.meta.url), 'utf8');
// Strip SQL comment lines so comment prose cannot satisfy or fail checks.
const statements = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

const REQUIRED_TABLES = [
  'chains', 'asset_descriptors', 'source_catalog_snapshots', 'pool_configs', 'pool_snapshots',
  'chain_blocks', 'chain_events', 'indexer_checkpoints', 'positions', 'transactions',
  'source_samples', 'calendar_commitments', 'calendar_intervals', 'job_leases',
  'pending_submissions', 'quota_counters', 'service_metrics', 'incident_records', 'backup_manifests',
];

const REQUIRED_IDENTITIES = [
  ['chains', ['chain_id']],
  ['asset_descriptors', ['chain_id', 'descriptor_id']],
  ['source_catalog_snapshots', ['snapshot_hash']],
  ['pool_configs', ['chain_id', 'pool_id']],
  ['pool_snapshots', ['chain_id', 'pool_id', 'block_hash']],
  ['chain_blocks', ['chain_id', 'block_hash']],
  ['chain_events', ['chain_id', 'block_hash', 'tx_hash', 'log_index']],
  ['indexer_checkpoints', ['chain_id', 'shard_id']],
  ['positions', ['chain_id', 'position_manager', 'token_id']],
  ['transactions', ['chain_id', 'tx_hash']],
  ['source_samples', ['chain_id', 'feed_id', 'report_hash']],
  ['calendar_commitments', ['chain_id', 'asset_id', 'root']],
  ['calendar_intervals', ['chain_id', 'asset_id', 'root', 'interval_index']],
  ['job_leases', ['chain_id', 'job_kind']],
  ['pending_submissions', ['chain_id', 'signer', 'nonce']],
  ['quota_counters', ['account_scope', 'resource', 'period']],
  ['service_metrics', ['metric_name', 'runtime', 'bucket']],
  ['incident_records', ['incident_id']],
  ['backup_manifests', ['backup_id']],
];

function tableBody(name) {
  const start = statements.indexOf(`create table if not exists ${name} (`);
  assert.ok(start >= 0, `table ${name} must be declared`);
  const end = statements.indexOf(');', start);
  assert.ok(end > start, `table ${name} must be closed`);
  return statements.slice(start, end);
}

test('every plan §8.2 table is declared', () => {
  for (const name of REQUIRED_TABLES) tableBody(name);
});

test('primary keys carry the plan identity for idempotent ingest and reorg rollback', () => {
  for (const [name, columns] of REQUIRED_IDENTITIES) {
    const body = tableBody(name);
    const pk = body.match(/primary key \(([^)]+)\)/);
    assert.ok(pk, `table ${name} must declare a primary key`);
    const declared = pk[1].split(',').map((c) => c.trim());
    assert.deepEqual(declared, columns, `table ${name} identity mismatch`);
  }
});

test('hash/address columns are bytea with strict length checks, not free strings', () => {
  const body = tableBody('chain_events');
  assert.match(body, /block_hash\s+bytea not null check \(octet_length\(block_hash\) = 32\)/);
  assert.match(body, /address\s+bytea not null check \(octet_length\(address\) = 20\)/);
  const tx = tableBody('transactions');
  assert.match(tx, /tx_hash\s+bytea not null check \(octet_length\(tx_hash\) = 32\)/);
});

test('uint256 uses numeric(78,0) and uint64-ish counters use bounded numerics, never float', () => {
  assert.doesNotMatch(statements, /double precision|real|float/i);
  const positions = tableBody('positions');
  assert.match(positions, /liquidity\s+numeric\(78, 0\)/);
  const blocks = tableBody('chain_blocks');
  assert.match(blocks, /block_number\s+numeric\(39, 0\)/);
});

test('chain_blocks enforces one canonical block per height', () => {
  assert.match(statements, /create unique index if not exists chain_blocks_canonical_number_idx[\s\S]*?where canonical/);
});

test('canonical events support orphaning without deleting history', () => {
  const events = tableBody('chain_events');
  assert.match(events, /canonical_state text not null default 'CANONICAL' check \(canonical_state in \('CANONICAL', 'ORPHANED', 'REPLAYED'\)\)/);
});

test('finality states match the honest projection set, including CONFIRMED_UNFINALIZED', () => {
  const tx = tableBody('transactions');
  for (const state of ['PENDING', 'PROVISIONAL', 'CONFIRMED_UNFINALIZED', 'FINALIZED', 'REPLACED', 'REVERTED', 'ORPHANED']) {
    assert.ok(tx.includes(`'${state}'`), `finality state ${state} missing`);
  }
});

test('pending submissions are service-only and never user-readable rows', () => {
  const pending = tableBody('pending_submissions');
  assert.match(pending, /service_only\s+boolean not null default true/);
  assert.match(pending, /signed_bytes\s+bytea not null/);
});

test('query paths are indexed: sender+nonce, owner, feed observations, job expiry', () => {
  for (const index of [
    'transactions_sender_nonce_idx',
    'positions_owner_idx',
    'source_samples_feed_time_idx',
    'pending_submissions_expiry_idx',
    'chain_events_address_topic_idx',
  ]) {
    assert.ok(statements.includes(index), `index ${index} missing`);
  }
});
