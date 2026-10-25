-- BELL derived-state schema (plan M07-01, brief G36/G37/D07).
-- Canonical events, derived projections, source/license metadata, job state
-- and metrics are separated. Identities use bytea with strict length checks,
-- uint256 values use numeric(78,0) and uint128 uses numeric(39,0); floats are
-- never used for raw amounts. Every key carries chain identity.
-- Idempotent ingest and reorg rollback rely on the unique constraints below.

create table if not exists chains (
  chain_id        integer not null,
  name            text not null,
  deployment_boundary jsonb not null default '{}'::jsonb,
  source_manifest_hash bytea check (octet_length(source_manifest_hash) = 32),
  created_at      timestamptz not null default now(),
  primary key (chain_id)
);

create table if not exists asset_descriptors (
  chain_id        integer not null references chains(chain_id),
  descriptor_id   bytea not null check (octet_length(descriptor_id) = 32),
  token_address   bytea not null check (octet_length(token_address) = 20),
  class           text not null check (class in ('PRICE_GUARDED', 'SESSION_ONLY')),
  capabilities    jsonb not null,
  source_ids      jsonb not null,
  config_hash     bytea not null check (octet_length(config_hash) = 32),
  evidence_hash   bytea check (octet_length(evidence_hash) = 32),
  canonical_state text not null default 'ACTIVE' check (canonical_state in ('ACTIVE', 'ORPHANED')),
  created_at      timestamptz not null default now(),
  primary key (chain_id, descriptor_id)
);
-- append-only projection: no update path rewrites history
create index if not exists asset_descriptors_token_idx on asset_descriptors (chain_id, token_address);

create table if not exists source_catalog_snapshots (
  snapshot_hash   bytea not null check (octet_length(snapshot_hash) = 32),
  retrieved_at    timestamptz not null,
  url             text not null,
  status          text not null,
  metadata        jsonb not null default '{}'::jsonb,
  rights_visibility text not null check (rights_visibility in ('PUBLIC', 'ENTITLED')),
  created_at      timestamptz not null default now(),
  primary key (snapshot_hash)
);

create table if not exists pool_configs (
  chain_id        integer not null references chains(chain_id),
  pool_id         bytea not null check (octet_length(pool_id) = 32),
  hook_address    bytea not null check (octet_length(hook_address) = 20),
  pool_key        jsonb not null,
  class           text not null check (class in ('PRICE_GUARDED', 'SESSION_ONLY')),
  immutable_caps  jsonb not null,
  reference_mode  text not null,
  policy_hash     bytea not null check (octet_length(policy_hash) = 32),
  config_hash     bytea not null check (octet_length(config_hash) = 32),
  created_at      timestamptz not null default now(),
  primary key (chain_id, pool_id)
);

create table if not exists pool_snapshots (
  chain_id        integer not null references chains(chain_id),
  pool_id         bytea not null,
  block_hash      bytea not null check (octet_length(block_hash) = 32),
  block_number    numeric(39, 0) not null check (block_number >= 0),
  observed_state  jsonb not null,
  policy_state    jsonb not null,
  reasons         jsonb not null default '[]'::jsonb,
  budgets         jsonb not null,
  source_hashes   jsonb not null,
  created_at      timestamptz not null default now(),
  primary key (chain_id, pool_id, block_hash)
);

create table if not exists chain_blocks (
  chain_id        integer not null references chains(chain_id),
  block_hash      bytea not null check (octet_length(block_hash) = 32),
  block_number    numeric(39, 0) not null check (block_number >= 0),
  parent_hash     bytea check (octet_length(parent_hash) = 32),
  canonical       boolean not null default false,
  finality_state  text not null default 'UNFINALIZED' check (finality_state in ('UNFINALIZED', 'FINALIZED', 'ORPHANED')),
  created_at      timestamptz not null default now(),
  primary key (chain_id, block_hash)
);
-- one canonical block per height per chain
create unique index if not exists chain_blocks_canonical_number_idx
  on chain_blocks (chain_id, block_number) where canonical;
create index if not exists chain_blocks_number_idx on chain_blocks (chain_id, block_number);

create table if not exists chain_events (
  chain_id        integer not null references chains(chain_id),
  block_hash      bytea not null check (octet_length(block_hash) = 32),
  tx_hash         bytea not null check (octet_length(tx_hash) = 32),
  log_index       integer not null check (log_index >= 0),
  address         bytea not null check (octet_length(address) = 20),
  topic0          bytea check (octet_length(topic0) = 32),
  topics          jsonb not null,
  data            bytea,
  event_name      text,
  event_version   text,
  decoded         jsonb,
  canonical_state text not null default 'CANONICAL' check (canonical_state in ('CANONICAL', 'ORPHANED', 'REPLAYED')),
  created_at      timestamptz not null default now(),
  primary key (chain_id, block_hash, tx_hash, log_index)
);
create index if not exists chain_events_address_topic_idx on chain_events (chain_id, address, topic0);
create index if not exists chain_events_canonical_idx on chain_events (chain_id, canonical_state);

create table if not exists indexer_checkpoints (
  chain_id        integer not null references chains(chain_id),
  shard_id        text not null,
  last_block_number numeric(39, 0) not null check (last_block_number >= 0),
  last_block_hash bytea not null check (octet_length(last_block_hash) = 32),
  replay_boundary numeric(39, 0),
  lag_seconds     integer,
  lease_generation numeric(39, 0) not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (chain_id, shard_id)
);

create table if not exists positions (
  chain_id        integer not null references chains(chain_id),
  position_manager bytea not null check (octet_length(position_manager) = 20),
  token_id        numeric(78, 0) not null check (token_id >= 0),
  owner           bytea not null check (octet_length(owner) = 20),
  position_key    jsonb not null,
  tick_lower      integer not null,
  tick_upper      integer not null,
  liquidity       numeric(78, 0) not null check (liquidity >= 0),
  source_event_id bytea check (octet_length(source_event_id) = 32),
  projection_state text not null default 'CANONICAL' check (projection_state in ('CANONICAL', 'STALE', 'ORPHANED')),
  created_at      timestamptz not null default now(),
  primary key (chain_id, position_manager, token_id)
);
create index if not exists positions_owner_idx on positions (chain_id, owner);

create table if not exists transactions (
  chain_id        integer not null references chains(chain_id),
  tx_hash         bytea not null check (octet_length(tx_hash) = 32),
  sender          bytea not null check (octet_length(sender) = 20),
  nonce           numeric(39, 0) not null check (nonce >= 0),
  requested_action jsonb not null,
  receipt         jsonb,
  block_hash      bytea check (octet_length(block_hash) = 32),
  replaced_by     bytea check (octet_length(replaced_by) = 32),
  reorg_state     text not null default 'NONE' check (reorg_state in ('NONE', 'ORPHANED', 'REPLAYED')),
  finality_state  text not null default 'PENDING' check (finality_state in ('PENDING', 'PROVISIONAL', 'CONFIRMED_UNFINALIZED', 'FINALIZED', 'REPLACED', 'REVERTED', 'ORPHANED')),
  created_at      timestamptz not null default now(),
  primary key (chain_id, tx_hash)
);
create index if not exists transactions_sender_nonce_idx on transactions (chain_id, sender, nonce);

create table if not exists source_samples (
  chain_id        integer not null references chains(chain_id),
  feed_id         bytea not null check (octet_length(feed_id) = 32),
  report_hash     bytea not null check (octet_length(report_hash) = 32),
  provider_timestamp_ns numeric(78, 0) not null check (provider_timestamp_ns >= 0),
  normalized_fields jsonb not null,
  accepted_tx_hash bytea check (octet_length(accepted_tx_hash) = 32),
  accepted_block_hash bytea check (octet_length(accepted_block_hash) = 32),
  object_ref      text,
  license_scope   text not null default 'NONE' check (license_scope in ('NONE', 'PUBLIC', 'ENTITLED')),
  created_at      timestamptz not null default now(),
  primary key (chain_id, feed_id, report_hash)
);
create index if not exists source_samples_feed_time_idx on source_samples (chain_id, feed_id, provider_timestamp_ns);

create table if not exists calendar_commitments (
  chain_id        integer not null references chains(chain_id),
  asset_id        bytea not null check (octet_length(asset_id) = 32),
  root            bytea not null check (octet_length(root) = 32),
  coverage        jsonb not null,
  leaf_count      integer not null check (leaf_count >= 0),
  provenance      jsonb not null,
  queued_at       timestamptz,
  activated_at    timestamptz,
  created_at      timestamptz not null default now(),
  primary key (chain_id, asset_id, root)
);

create table if not exists calendar_intervals (
  chain_id        integer not null references chains(chain_id),
  asset_id        bytea not null,
  root            bytea not null,
  interval_index  integer not null check (interval_index >= 0),
  leaf            jsonb not null,
  neighbours      jsonb,
  proof_ref       text,
  coverage_state  text not null default 'SCHEDULED' check (coverage_state in ('SCHEDULED', 'ACTIVE', 'EXPIRED', 'SUPERSEDED')),
  created_at      timestamptz not null default now(),
  primary key (chain_id, asset_id, root, interval_index)
);

create table if not exists job_leases (
  chain_id        integer not null references chains(chain_id),
  job_kind        text not null,
  owner_token     bytea not null check (octet_length(owner_token) = 32),
  fence           numeric(39, 0) not null check (fence >= 0),
  expires_at      timestamptz not null,
  last_result     jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (chain_id, job_kind)
);

create table if not exists pending_submissions (
  chain_id        integer not null references chains(chain_id),
  signer          bytea not null check (octet_length(signer) = 20),
  nonce           numeric(39, 0) not null check (nonce >= 0),
  signed_bytes    bytea not null,
  tx_hash         bytea not null check (octet_length(tx_hash) = 32),
  report_identity jsonb,
  attempts        integer not null default 0 check (attempts >= 0),
  first_broadcast_at timestamptz,
  receipt         jsonb,
  replacement_of  bytea check (octet_length(replacement_of) = 32),
  service_only    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (chain_id, signer, nonce)
);
create index if not exists pending_submissions_expiry_idx on pending_submissions (chain_id, first_broadcast_at);

create table if not exists quota_counters (
  account_scope   text not null,
  resource        text not null,
  period          text not null,
  estimated_usage numeric(39, 0) not null default 0,
  observed_usage  numeric(39, 0) not null default 0,
  reserved_allowance numeric(39, 0) not null default 0,
  reconciled_at   timestamptz,
  created_at      timestamptz not null default now(),
  primary key (account_scope, resource, period)
);

create table if not exists service_metrics (
  metric_name     text not null,
  runtime         text not null,
  bucket          timestamptz not null,
  aggregate       jsonb not null,
  created_at      timestamptz not null default now(),
  primary key (metric_name, runtime, bucket)
);

create table if not exists incident_records (
  incident_id     text not null,
  detected_at     timestamptz not null,
  acknowledged_at timestamptz,
  actions         jsonb not null default '[]'::jsonb,
  recovery        jsonb,
  affected_hashes jsonb not null default '{}'::jsonb,
  access          text not null default 'PRIVATE_OPS' check (access in ('PRIVATE_OPS')),
  created_at      timestamptz not null default now(),
  primary key (incident_id)
);

create table if not exists backup_manifests (
  backup_id       text not null,
  object_hashes   jsonb not null,
  total_size      numeric(39, 0) not null check (total_size >= 0),
  encryption_recipient_id text,
  upload_verified boolean not null default false,
  restore_tested_at timestamptz,
  created_at      timestamptz not null default now(),
  primary key (backup_id)
);
