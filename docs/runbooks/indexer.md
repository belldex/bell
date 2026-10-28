# Runbook: Indexer, Reorg, and Finality (M10, M12-03)

## Budget (M10-05)
- Planner is locked: <= 24 calls/minute, chunks <= 10 blocks (Alchemy), max 2 filter shards.
- `measureHeadroom` determines whether the head rate fits; limits are NEVER increased silently.
- Backlog: `catchupPlan` predicts clearing; keeper reserve is protected from backfill.
- INDEX_LAGGING when lag > 120 seconds; admission fails instead of using a paid fallback.

## Reorg (M10-03)
1. Compare the checkpoint across two providers; find the LCA (`findCommonAncestor`).
2. Mark orphan events above the LCA and roll back projections in one transaction.
3. Replay a bounded canonical range (`planReplay`, maxRange per batch).
4. Unresolved provider disagreement STOPS signing that requires agreement.

## Finality (M10-04)
- A single receipt or local block count never produces FINALIZED.
- Without a finalized tag agreed upon by two providers: CONFIRMED_UNFINALIZED.
- Side effects requiring finality are held (`requiresFinality`).

## Health/alerts (M12-03)
- Metrics: lag in seconds, calls/minute, bytes, shard volume, ingest failures.
- Alerts: INDEX_LAGGING, stalled checkpoint, unresolved LCA, planner budget deficit.
