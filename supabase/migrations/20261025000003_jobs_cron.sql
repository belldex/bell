-- BELL scheduled jobs and retention (plan M07-05, brief D06/D11).
-- Cron A 30s (keeper tick), indexer 60s, maintenance hourly. Schedules are
-- installed idempotently: re-running the migration must not duplicate them.
-- Invocation auth lives in backend env/Vault, never as SQL plaintext here.

create table if not exists scheduled_jobs (
  job_kind      text primary key,
  interval_seconds integer not null check (interval_seconds > 0),
  enabled       boolean not null default true,
  installed_at  timestamptz not null default now()
);

insert into scheduled_jobs (job_kind, interval_seconds) values
  ('keeper-a-tick', 30),
  ('indexer-tick', 60),
  ('maintenance', 3600)
on conflict (job_kind) do nothing;

-- Cron history retention: keep successful invocations 2 days, failures 7 days.
create or replace function prune_cron_history()
returns void
language plpgsql
as $$
begin
  delete from service_metrics
   where metric_name = 'cron-invocation'
     and bucket < now() - interval '2 days'
     and aggregate->>'outcome' = 'success';
  delete from service_metrics
   where metric_name = 'cron-invocation'
     and bucket < now() - interval '7 days'
     and aggregate->>'outcome' = 'failure';
end;
$$;

-- Expand/contract migrations: additive first, contract after the running
-- workers are verified against the new shape. Downgrades must not destroy
-- canonical source data; drop views/policies before tables, never the reverse.
