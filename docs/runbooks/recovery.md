# Runbook: Backup, Restore, RPO/RTO (M12-01/M12-02)

## Rotasi backup (M12-01)
- Rotasi time-based (`planRotation`): FULL/INCREMENTAL, generasi dibatasi (default 7).
- Kunci enkripsi: hanya `encryptionRecipientId` yang masuk manifest — kunci privat tidak pernah menyentuh repo/manifest.
- Generasi dengan recipient lama ditandai rotate; tidak pernah dienkripsi-ulang in place.
- Object storage private; duplicate upload = versi baru, bukan overwrite.

## RPO/RTO (M12-02)
- `checkRpo` gagal keras jika belum pernah restore test (NEVER_RESTORE_TESTED) atau restore test terakhir lebih tua dari RPO.
- Target operasional: restore drill terjadwal; hasil dicatat di `backup_manifests.restore_tested_at` (M07-01 schema).
- Restore-verified-before-prune: arsip tidak dihapus sebelum export terverifikasi (`planPrune` di M07-04).

## Drill (BLOCKED offline)
Restore drill butuh storage live. Evidence `restore/RPO/RTO` tetap terbuka sampai drill pertama tercatat.
