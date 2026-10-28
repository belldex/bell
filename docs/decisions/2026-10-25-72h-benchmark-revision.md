# Decision: Replace the 72-Hour RPC Benchmark with an Acceptance Snapshot

Date: 2026-10-25 · Decision: project owner · Applied in: Brief (§13, G35, §20.L, §20.M, evidence index) and Plan (critical path, M14-02, §11.2)

## Decision
The "at least 72 hours" wall-clock benchmark window for selecting the active RPC provider is replaced with a **documented acceptance snapshot**: capability matrices for both providers, preflight head agreement at a common block (mainnet + testnet), per-method latency samples, and getLogs/historical/fork probes at a pinned block. Revalidation is triggered by a provider plan/region change or provider incident.

## Alasan
The accelerated completion followed a direct project-owner decision. Available snapshots: `evidence/runtime/rpc-preflight-*.json`, `rpc-capability-matrix-2026-10-25.json`, `rpc-discovery-pinax-testnet-2026-10-25.json`.

## Remaining risks (acknowledged, not hidden)
1. One day of evidence does not cover overnight/weekend/traffic-spike behavior; periodic anomalies remain unobserved.
2. P95 statistics from short samples are more susceptible to bias than P95 statistics from a long window.
3. The Mainnet GO gate now depends on a snapshot rather than continuous observation.

## Compensating controls that remain in effect
- No public fallback; failover is only to an endpoint with the correct chainId and health (G35 remains in effect; only its method changed).
- Internal SLO thresholds remain unchanged (P95<=1s, success>=99.9%, head lag P95<=2s).
- Keeper A tetap berjalan tiap 30 detik via pg_cron — telemetri operasional terakumulasi alami sejak hari pertama.
- A provider plan/region change or incident triggers full revalidation.
- Criterion 20.M (four weekends + sessions) for mainnet availability is NOT changed.

## Implikasi board
No task was opened by this change (the benchmark had not yet begun as a separate task); M14-02 can now be executed using the snapshot without waiting for the time window.
