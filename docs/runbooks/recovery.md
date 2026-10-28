# Runbook: Backup, Restore, RPO/RTO (M12-01/M12-02)

## Rotasi backup (M12-01)
- Rotasi time-based (`planRotation`): FULL/INCREMENTAL, generasi dibatasi (default 7).
- Encryption key: only `encryptionRecipientId` is included in the manifest—the private key must never touch the repo/manifest.
- Generations with an old recipient are marked for rotation; they are never re-encrypted in place.
- Object storage is private; a duplicate upload creates a new version instead of overwriting.

## RPO/RTO (M12-02)
- `checkRpo` fails hard if no restore test has ever been run (NEVER_RESTORE_TESTED) or the last restore test is older than the RPO.
- Target operasional: restore drill terjadwal; hasil dicatat di `backup_manifests.restore_tested_at` (M07-01 schema).
- Restore-verified-before-prune: archives are not deleted until the export is verified (`planPrune` in M07-04).

## Drill (BLOCKED offline)
The restore drill requires live storage. Evidence `restore/RPO/RTO` remains open until the first drill is recorded.
