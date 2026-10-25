# Runbook: Indexer, Reorg dan Finality (M10, M12-03)

## Anggaran (M10-05)
- Planner terkunci: <= 24 calls/menit, chunk <= 10 blok (Alchemy), max 2 filter shards.
- `measureHeadroom` membuktikan muat/tidaknya head rate; TIDAK ada kenaikan limit diam-diam.
- Backlog: `catchupPlan` memprediksi clearing; keeper reserve dilindungi dari backfill.
- INDEX_LAGGING saat lag > 120 detik; admission gagal, bukan fallback berbayar.

## Reorg (M10-03)
1. Bandingkan checkpoint dengan dua provider; cari LCA (`findCommonAncestor`).
2. Tandai orphan events di atas LCA, rollback proyeksi dalam satu transaksi.
3. Replay range canonical bounded (`planReplay`, maxRange per batch).
4. Provider disagreement yang tidak selesai MENGHENTIKAN signing yang butuh agreement.

## Finality (M10-04)
- Satu receipt atau hitungan blok lokal tidak pernah menghasilkan FINALIZED.
- Tanpa finalized tag yang disepakati dua provider: CONFIRMED_UNFINALIZED.
- Side effect yang butuh finality ditahan (`requiresFinality`).

## Health/alerts (M12-03)
- Metrik: lag detik, calls/menit, bytes, shard volume, kegagalan ingest.
- Alert: INDEX_LAGGING, checkpoint tidak maju, LCA unresolved, budget planner deficit.
