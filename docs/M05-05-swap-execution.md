# M05-05 — swap execution: SELESAI, dan bagaimana caranya

Status: **implemented**. `BellHook.SWAP_EXECUTION_READY = true`, `_beforeSwap`/`_afterSwap` benar-benar
menyiapkan dan menyelesaikan swap. Dokumen ini menggantikan versi sebelumnya yang menyatakan blocked.

---

## 1. Blocker lama: EIP-170

`BellHook` tadinya 24.571 byte dengan batas 24.576 — **sisa 5 byte**. Menyambungkan glue swap
langsung di hook menghasilkan 30.128 byte, kelebihan 5.552. Jadi logikanya tidak mungkin ditambah
tanpa lebih dulu membebaskan ruang.

## 2. Solusi: pindahkan evaluasi policy ke kontrak terpisah

Kontrak baru **`BellPolicyOracle`** menampung seluruh evaluasi:

- semua pembacaan dependency (`pauseState`, `descriptor`, `health`, `currentInterval`,
  `nextInterval`, `anchorStatus`, `latestSample`) dengan buffer tetap dan gas cap yang sama;
- agregasi reason per aset;
- keputusan `ModePolicy` (mode, latch, closure nonce, recovery vector);
- proyeksi `PolicyView` (cap efektif, rolling/closure remaining, validUntil).

Hook memanggilnya lewat **STATICCALL**, bukan delegatecall — jadi oracle hanya bisa menjawab, tidak
bisa menulis, mengubah, atau memberi otorisasi. Hook tetap pemilik seluruh state: `_state`,
`_buckets`, `_episodeGross`, dan semua checkpoint.

### Hasil ukuran

| Kontrak | Runtime | Margin EIP-170 |
|---|---:|---:|
| BellHook | 23.842 | 734 |
| BellPolicyOracle | 19.892 | 4.684 |
| BellHookDeployer | 3.116 | 21.460 |
| BellModeEvaluator | 14.115 | 10.461 |
| BellPoolFactory | 16.877 | 7.699 |

Oracle di-deploy **sekali per deployment**, bukan per hook, supaya initcode tiap hook tetap di bawah
batas EIP-3860 (sebelumnya 63.221 byte, sekarang 43.630).

## 3. Yang sekarang benar-benar terjadi saat swap

`_beforeSwap`:
1. `_requireBoundKey` — key harus persis pool ini.
2. `hookData` harus kosong; referensi/policy tidak pernah datang dari user.
3. `policyOracle.prepareSwap(...)` → evaluasi penuh, tolak bila `canSwap == false` dengan
   `PolicyBlocked(reasonBits)`.
4. Hanya `SESSION_ONLY` yang diizinkan; `PRICE_GUARDED` ditolak dengan
   `PRICE_INPUT_INVALID_OR_STALE` karena belum ada pasangan referensi yang diadmit.
5. `BellModeEvaluator.prepare` membangun snapshot: fee per sesi, cap efektif, deteksi repricing,
   guard corporate. Snapshot disimpan bersama callback hash.
6. Return `lpFeeUnits | OVERRIDE_FEE_FLAG` sehingga core memakai fee sesi, bukan fee statis.

`_afterSwap`:
1. Callback hash harus cocok; tanpa `beforeSwap` yang sukses → `ContextMismatch`.
2. `settleSwap` memvalidasi delta aktual (`validateActual`), path harga, dan menghitung kandidat
   rolling + episode **sebelum** ada yang ditulis.
3. Hook menulis `_buckets`, dan `_episodeGross` hanya bila pool sedang CLOSED.
4. Snapshot dihapus, callback hash dinolkan — tidak bisa dipakai ulang.

## 4. Bug nyata yang ditemukan saat mengerjakan ini

Bukan teori; semuanya tertangkap test dan sudah diperbaiki.

1. **`closureRemaining` dilaporkan penuh padahal belum ada episode.** Oracle mengembalikan sisa
   budget walau `closureNonce == 0`, yang berarti mengiklankan ruang belanja yang tidak ada.
2. **Pause nonce pool salah alamat.** Oracle memakai `poolId` sebagai alamat target
   `SafetyController`, padahal harus alamat hook. Akibatnya pause pool tidak pernah terbaca.
3. **`rollingRemaining` mengabaikan `previousGross`.** Hanya `currentGross` yang dikurangi, jadi
   budget terlihat lebih besar dari sebenarnya.
4. **Hash checkpoint tidak memakai `nextState` saat latch dilepas.** Hash yang dipublikasikan tidak
   cocok dengan state yang benar-benar ditulis.
5. **Fixture `_activate()` di test menulis `bellStart` ke slot yang salah.** Selama ini test
   "activated" sebenarnya tidak pernah aktif; mereka lolos hanya karena gate lama selalu menolak.

## 5. Cakupan yang jujur

Yang **sudah** terbukti:

- `testHealthySyntheticLiveAdvertisesExecutionAndPreparesSwap` — pool LIVE + sehat benar-benar
  menghasilkan snapshot swap dan fee override. Ini test positif pertama di repo.
- `testAfterSwapWithoutPreparedSnapshotIsRejected` — settlement tanpa snapshot ditolak.
- 351 forge test hijau, termasuk dua suite invariant 100k run.

Yang **belum**:

- `PRICE_GUARDED` masih tertutup. Butuh pasangan referensi yang diadmit, dan `referenceMode` belum
  punya pemetaan numerik. Menyalakannya sekarang berarti mengarang pita harga.
- Belum ada swap nyata di testnet. Untuk itu perlu pool yang benar-benar dibuat, dan itu menunggu
  deskriptor saham + calendar root.
- Belum ada benchmark gas hot-path terhadap target rilis.
