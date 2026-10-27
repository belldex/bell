# M05-05 — swap execution: kenapa belum bisa, dan apa yang harus dikerjakan

Status: **BLOCKED_DEPENDENCY**. Dokumen ini hasil percobaan implementasi nyata pada 2026-10-27,
bukan rencana di atas kertas. `BellHook` tetap fail-closed.

---

## 1. Blocker yang baru ditemukan: EIP-170

`BellHook` runtime **24.571 byte**. Batas kontrak adalah **24.576 byte**. Sisa ruang: **5 byte**.

Ini bukan perkiraan. `forge build --sizes`:

```
| BellHook | 24,571 | 44,203 | 5 | 4,949 |
```

Artinya setiap byte logika swap baru harus dibayar dengan menghapus byte lain. Saya coba
menyambungkan glue swap langsung di hook (konteks + `prepare` di `_beforeSwap`, `settle` +
commit di `_afterSwap`, plus dua pembacaan `decimals`), dan hasilnya:

```
| BellHook | 30,128 | 49,865 | -5,552 | -713 |
```

**Kelebihan 5.552 byte.** Jadi menambah logika tanpa refactor bukan pilihan yang tersedia.

### Mengapa glue-nya sebesar itu

Bukan karena logikanya rumit, tapi karena `IBellSwapEvaluator.Context` punya 20 field dan
`Snapshot` membungkusnya. Membangun context di memory lalu meng-encode-nya untuk `prepare()`
saja sudah mahal. Ditambah `StateLibrary.getSlot0`, dua `staticcall` decimals, dan penyimpanan
`Snapshot` (20+ word) ke storage.

### Jalan keluar yang realistis

Urutannya, dari yang paling kecil risikonya:

1. **Pindahkan glue ke kontrak guard terpisah** yang dipanggil hook lewat `delegatecall`.
   Ini yang saya coba paling masuk akal: semua logika swap + context building pindah ke
   `BellSwapGuard`, `BellHook` hanya menyimpan pointer immutable dan satu blok `delegatecall`.
   Estimasi: hook turun ke ~24.200, guard ~6-7 KB (jauh di bawah batas).
   **Risiko:** `delegatecall` menambah permukaan serangan baru, dan brief menuntut hook tanpa
   delegatecall. Perlu keputusan eksplisit pemilik sebelum dipakai.

2. **Pindahkan evaluasi dependency ke luar hook.** `_evaluateDependencies` + `_readDescriptor` +
   `_readHealth` + `_readCalendar` + `_readAnchorStatus` + `_readLatestSample` adalah bagian
   terbesar hook. Kalau pindah ke kontrak `BellPolicyOracle` yang di-`staticcall`, hook bisa
   kehilangan beberapa KB. **Risiko:** oracle itu jadi titik kegagalan baru, dan dia harus
   tetap fail-closed saat tidak bisa dibaca.

3. **Perkecil `Context`.** Beberapa field bisa diturunkan di sisi evaluator (mis. `configHash`,
   `stateHash`) atau dipadatkan. **Risiko:** mengubah tipe normatif `SwapEvaluation.sol`.

Saya **tidak** memilih salah satu dari itu tanpa persetujuan, karena masing-masing mengubah
arsitektur keamanan yang sudah direview.

---

## 2. Blocker kedua: PRICE_GUARDED tidak punya referensi

`referenceMode` di-bind di konstruktor tapi **tidak diinterpretasi**:

```solidity
// BellHook.sol:1274
// referenceMode has no numeric enum in the pinned normative tables; M05-01 binds but does not interpret it.
```

`BellModeEvaluator.prepare` untuk `PRICE_GUARDED` membutuhkan `referencePrice18[0]` dan
`[1]` yang nonzero, plus pemeriksaan pita harga. Tidak ada yang mengisinya: `_evaluatePolicy`
secara eksplisit menulis `policy.referencePrice18 = [0, 0]`.

Jadi hanya **SESSION_ONLY** yang bisa diaktifkan secara jujur hari ini. Itu bukan kelalaian —
itu batas cakupan yang harus dinyatakan, bukan disembunyikan.

---

## 3. Yang sudah siap dan tidak perlu dibangun lagi

Ini penting supaya tidak ada yang mengerjakan ulang:

| Komponen | Status | Bukti |
|---|---|---|
| `BellModeEvaluator.prepare` | Lengkap: fee per sesi, cap efektif, deteksi repricing, guard corporate | `contracts/src/BellModeEvaluator.sol:23` |
| `BellModeEvaluator.settle` | Lengkap: validasi delta aktual, path harga, kandidat rolling + episode | `BellModeEvaluator.sol:78` |
| `FlowBudget` / `ClosureBudget` | Lengkap + invariant 100k run | `test/invariant/closure/…` |
| `validateActual` | Lengkap: exact-in/out, partial fill, fee termasuk | `BellModeEvaluator.sol:112` |
| Integrasi core nyata | Terbukti di PoolManager asli dengan `SnapshotFixtureHook` | `test/integration/swaps/CoreSwapPolicy.t.sol` (14 test) |
| Fixture hook pola pemakaian | Contoh lengkap `beforeSwap`/`afterSwap` yang benar | `CoreSwapPolicy.t.sol:37-83` |

`SnapshotFixtureHook` di test itu pada dasarnya adalah implementasi glue yang saya tulis, tapi
sebagai kontrak test terpisah — persis arsitektur opsi 1 di atas. Artinya polanya sudah terbukti
di core nyata, hanya belum dipindah ke hook produksi.

---

## 4. Langkah berikutnya, berurutan

1. **Keputusan pemilik:** pilih opsi 1, 2, atau 3 di §1. Tanpa ini, M05-05 tidak bisa bergerak.
2. Setelah itu, test RED dulu di `contracts/test/integration/swaps/` yang memakai `BellHook`
   sungguhan (bukan `SnapshotFixtureHook`), dengan `SESSION_ONLY` + kalender + health yang
   di-seed fixture.
3. Baru implementasi, dengan `forge build --sizes` dijalankan setiap langkah.
4. Gas benchmark hot-path, lalu update `evidence/swap-policy-integration.md`.

## 5. Yang tidak boleh dilakukan

- Menyalakan `SWAP_EXECUTION_READY = true` tanpa test di `BellHook` asli.
- Memakai `SnapshotFixtureHook` sebagai bukti produksi. Dia fixture test.
- Mengaktifkan `PRICE_GUARDED` dengan referensi palsu.
- Menurunkan `tickSpacing`/fee/limit hanya supaya muat EIP-170.
