-- BELL RLS and Storage access (plan M07-02, brief D04/D10/E03).
-- Default-deny on every exposed table; the publishable client reads only the
-- sanitized public views. Service tables (leases, pending submissions, quota,
-- incidents, source samples with licensed payloads) are never user-readable.

alter table chains                  enable row level security;
alter table asset_descriptors       enable row level security;
alter table source_catalog_snapshots enable row level security;
alter table pool_configs            enable row level security;
alter table pool_snapshots          enable row level security;
alter table chain_blocks            enable row level security;
alter table chain_events            enable row level security;
alter table indexer_checkpoints     enable row level security;
alter table positions               enable row level security;
alter table transactions            enable row level security;
alter table source_samples          enable row level security;
alter table calendar_commitments    enable row level security;
alter table calendar_intervals      enable row level security;
alter table job_leases              enable row level security;
alter table pending_submissions     enable row level security;
alter table quota_counters          enable row level security;
alter table service_metrics         enable row level security;
alter table incident_records        enable row level security;
alter table backup_manifests        enable row level security;

-- No anonymous or authenticated policy grants writes on any table: the
-- indexer, source jobs and backup jobs run under service_role paths only.
-- Everything below is deliberately absent by design:
--   * create policy ... for insert to authenticated
--   * create policy ... for update to anon/authenticated
--   * create policy ... for delete to anon/authenticated

-- Sanitized public projections: the only shapes exposed to the publishable
-- client. They must not join to licensed payloads or service metadata.
create view if not exists public_assets as
  select chain_id, descriptor_id, token_address, class, capabilities, canonical_state
  from asset_descriptors;

create view if not exists public_pools as
  select c.chain_id, c.pool_id, c.hook_address, c.class, c.immutable_caps,
         c.reference_mode, c.policy_hash, c.config_hash
  from pool_configs c;

create view if not exists public_status as
  select b.chain_id, b.block_number, b.block_hash, b.finality_state
  from chain_blocks b
  where b.canonical;

grant select on public_assets, public_pools, public_status to anon, authenticated;
revoke all on asset_descriptors, pool_configs, chain_blocks from anon, authenticated;

-- Private buckets only; signed URLs are issued by the service path with a TTL
-- and per-object rights check (license_scope), never by a client-supplied path.
