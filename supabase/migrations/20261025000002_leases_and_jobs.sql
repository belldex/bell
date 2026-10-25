-- BELL atomic leases, fencing and job state (plan M07-03, brief D09).
-- SECURITY DEFINER functions carry explicit search_path and minimal grants.
-- A lease is the only permission to work: an expired or fenced-out worker
-- must not submit new work, and losing a lease is never permission to sign.

create extension if not exists pgcrypto;

create table if not exists job_lease_history (
  chain_id    integer not null references chains(chain_id),
  job_kind    text not null,
  fence       numeric(39, 0) not null check (fence >= 0),
  owner_token bytea not null check (octet_length(owner_token) = 32),
  acquired_at timestamptz not null,
  released_at timestamptz,
  outcome     text check (outcome in ('COMPLETED', 'EXPIRED', 'FENCED')),
  primary key (chain_id, job_kind, fence)
);

-- Acquire or take over an expired lease in one atomic statement. Fence is
-- monotonic per (chain_id, job_kind): a stale worker holding an old fence is
-- rejected by any newer generation.
create or replace function acquire_job_lease(
  p_chain_id integer,
  p_job_kind text,
  p_owner_token bytea,
  p_ttl_seconds integer
)
returns table (fence numeric(39,0), expires_at timestamptz)
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_fence numeric(39,0);
  v_expires timestamptz;
begin
  if p_owner_token is null or octet_length(p_owner_token) <> 32 then
    raise exception 'OWNER_TOKEN';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 3600 then
    raise exception 'TTL_RANGE';
  end if;
  select coalesce(max(l.fence), 0) + 1 into v_fence
  from job_lease_history l
  where l.chain_id = p_chain_id and l.job_kind = p_job_kind;

  insert into job_leases (chain_id, job_kind, owner_token, fence, expires_at)
  values (p_chain_id, p_job_kind, p_owner_token, v_fence, v_now + make_interval(secs => p_ttl_seconds))
  on conflict (chain_id, job_kind) do update
    set owner_token = excluded.owner_token,
        fence = excluded.fence,
        expires_at = excluded.expires_at,
        updated_at = v_now
    where job_leases.expires_at <= v_now
       or job_leases.owner_token = excluded.owner_token
    returning job_leases.fence, job_leases.expires_at into v_fence, v_expires;

  if not found then
    raise exception 'LEASE_HELD';
  end if;

  insert into job_lease_history (chain_id, job_kind, fence, owner_token, acquired_at)
  values (p_chain_id, p_job_kind, v_fence, p_owner_token, v_now);
  return query select v_fence, v_expires;
end;
$$;
revoke all on function acquire_job_lease(integer, text, bytea, integer) from anon, authenticated;

-- Renew only while the caller still owns the current generation. The result
-- must be re-checked after every await and before any signing decision.
create or replace function renew_job_lease(
  p_chain_id integer,
  p_job_kind text,
  p_owner_token bytea,
  p_fence numeric(39,0),
  p_ttl_seconds integer
)
returns boolean
language sql
as $$
  update job_leases
     set expires_at = now() + make_interval(secs => p_ttl_seconds),
         updated_at = now()
   where chain_id = p_chain_id
     and job_kind = p_job_kind
     and owner_token = p_owner_token
     and fence = p_fence
     and expires_at > now()
   returning true;
$$;
revoke all on function renew_job_lease(integer, text, numeric(39,0), bytea, integer) from anon, authenticated;

create or replace function release_job_lease(
  p_chain_id integer,
  p_job_kind text,
  p_owner_token bytea,
  p_fence numeric(39,0)
)
returns void
language sql
as $$
  update job_leases
     set expires_at = now()
   where chain_id = p_chain_id
     and job_kind = p_job_kind
     and owner_token = p_owner_token
     and fence = p_fence;
$$;
revoke all on function release_job_lease(integer, text, bytea, numeric(39,0)) from anon, authenticated;

-- Pending signed submissions are written BEFORE broadcast (service-only).
create or replace function record_pending_submission(
  p_chain_id integer,
  p_signer bytea,
  p_nonce numeric(39,0),
  p_signed_bytes bytea,
  p_tx_hash bytea,
  p_report_identity jsonb
)
returns void
language sql
as $$
  insert into pending_submissions
    (chain_id, signer, nonce, signed_bytes, tx_hash, report_identity, attempts)
  values (p_chain_id, p_signer, p_nonce, p_signed_bytes, p_tx_hash, p_report_identity, 0)
  on conflict (chain_id, signer, nonce) do nothing;
$$;
revoke all on function record_pending_submission(integer, bytea, numeric(39,0), bytea, bytea, jsonb) from anon, authenticated;
