# Runbook: Keeper A/B, Nonce dan Watchdog (M09, M12-03/M12-04)

## Liveness
- Keeper B: satu alarm aktif per DO; cron per menit memanggil ensureAlarm ringan, pekerjaan berat di DO (M09-05).
- Alarm berikutnya dipersist SEBELUM I/O; constructor tidak menunda alarm yang lebih awal.
- Watchdog meter mencakup duration termasuk retry; backoff bounded, tanpa busy loop.

## Nonce & pending transactions (M09-03)
- Signed bytes/hash/nonce dicatat ke `pending_submissions` SEBELUM broadcast.
- Timeout TIDAK berarti gagal: retry mengirim bytes identik.
- Replacement memakai nonce sama + fee naik eksplisit; budget retry bounded — tanpa nonce gap.
- Reconcile pending/latest + receipts + reorg sebelum memilih nonce berikutnya.

## Lease (M07-03)
- Lease 25 detik, direnew setelah setiap await dan sebelum signing.
- Lease hilang = tidak boleh submit/sign; worker overlap ditolak (fence monotonic).

## Insiden (M12-04)
1. Deteksi: watchdog/alerts menandai liveness gagal atau lag > 120 dtk (INDEX_LAGGING).
2. Ack di `incident_records` (private ops), catat hash kode/config/source terdampak.
3. Guardian boleh pause; tidak boleh sweep dana atau reset budget.
4. Recovery: bukti dua checkpoint sehat berjarak >= 60 dtk sebelum resume normal.

## Wiring live (2026-10-25, project yaulnphhomzbfkpjeklh)
- Extensions aktif: pg_cron 1.6.4 + pg_net 0.20.4 (schema `extensions`).
- Job cron `keeper-a-tick` (jobid 1, `30 seconds`): `net.http_post` ke edge function `keeper-a`, header `x-cron-secret` dibaca dari `private.cron_secrets` (schema tidak terekspos PostgREST).
- `supabase_vault` DIPAKAI JANGAN untuk insert via role postgres: platform memblokir `_crypto_aead_det_noncegen` meski GRANT EXECUTE sudah diberikan. Secret cron disimpan di `private.cron_secrets`.
- Secret format: hex-only 64 char. Secret dengan karakter non-hex berisiko terpotong saat lewat shell (pernah 49-char env vs 48-char db).
- Rotasi secret: (1) `supabase secrets set CRON_SECRET=...`, (2) `UPDATE private.cron_secrets ...`. Keduanya harus sinkron.
- Edge function keeper-a: acquire lease 25s (fence monotonik) -> no-op jujur tanpa entitlement oracle (M01) -> release (`expires_at = now()`; row persist untuk audit, langsung reclaimable).
- Bukti live: `evidence/runtime/pg-cron-keeper-live-2026-10-25.json` (5 run cron `succeeded` interval 30s, fence s/d 10).

## Status keeper vs sumber harga (2026-10-27)

Keeper A masih **no-op**. Dia belum diarahkan ke jalur Yahoo: belum ada pemanggilan
`submitReports` maupun `refreshHealth` dari keeper ke SessionRegistry testnet, dan tidak ada
penjadwalan pengambilan quote. Keeper B (Cloudflare DO) juga belum menunjuk alamat testnet mana pun.

Ini penting supaya tidak salah paham: kesegaran sampel Yahoo saat ini **tidak** dijaga oleh keeper.
Sampel terakhir berumur 5500 detik saat trace, artinya memang tidak ada yang memperbaruinya. Lihat
`docs/CURRENT-STATE.md` §4.4.

Yang dibutuhkan sebelum keeper berguna untuk harga:

1. Deskriptor saham admitted + interval calendar valid (kalau tidak, `refreshHealth` akan menolak).
2. Keeper memegang akses ke reporter key atau memanggil layanan signing yang memegangnya — saat ini
   reporter key hanya dipakai manual lewat `scripts/deploy/publish-yahoo-direct.mjs`.
3. Anggaran RPC/kuota yang eksplisit untuk frekuensi tick; Yahoo tidak butuh API key, tapi RPC
   testnet tetap punya kuota free-tier.
