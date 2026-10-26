# Review — hook address mask, factory TREASURY_ONLY, deploy tooling

Tanggal: 2026-10-26
Reviewer: lane non-kontrak (tests / tooling / evidence)
Target: `docs/superpowers/plans/2026-10-26-router-treasury-testnet.md` + implementasinya
(`BellRouter.sol`, `BellPoolFactory.sol` TREASURY_ONLY path, `scripts/deploy/*`)

Status verifikasi saat review ini ditulis: `forge build` bersih, 336 test forge lulus,
4 test `deploy-manifest.test.mjs` lulus, `deploy-testnet.mjs --dry-run` lulus.

---

## F1 — P1 (pre-audit blocker): mask permission hook tidak ditegakkan saat deploy

> **Status: DIPERBAIKI** di review ini. `BellHookDeployer` sekarang menolak salt yang mendarat di
> luar mask `0x2cc0`, plus dua test penjaga (lihat bagian "Patch yang sudah diterapkan" di bawah).

**Fakta**

- `BellHook.getHookPermissions()` (`contracts/src/BellHook.sol:257`) menyalakan 5 flag →
  mask normatif **0x2cc0** (beforeInitialize 0x2000, beforeAddLiquidity 0x800,
  afterAddLiquidity 0x400, beforeSwap 0x80, afterSwap 0x40).
- `BellHookDeployer.deploy` (`contracts/src/BellHookDeployer.sol:48-60`) hanya memanggil
  `Hooks.isValidHookAddress(...)`. Di v4-core (`lib/v4-core/src/libraries/Hooks.sol:109-127`)
  fungsi itu **bukan** pemeriksaan mask: ia hanya menolak kombinasi flag delta yang tidak
  konsisten dan mensyaratkan minimal satu bit flag menyala.
- Salt sepenuhnya milik pemanggil (`request.salt`, `BellPoolFactory.sol:154`), dan factory hanya
  membandingkan `hook == predicted` — prediksi itu diturunkan dari salt yang sama, jadi selalu cocok.
- Tidak ada `require(uint160(hook) & 0x3fff == 0x2cc0)` di `BellHook`, `BellHookDeployer`,
  maupun `BellPoolFactory`.

**Dampak.** Salt yang menghasilkan alamat dengan, misalnya, hanya bit `afterInitialize` tetap lolos
`isValidHookAddress` dan tetap di-*initialize* + *activate* oleh factory. Di alamat itu
`PoolManager` tidak pernah memanggil `beforeSwap`/`afterSwap`, sehingga seluruh guard swap
(trade cap, window cap, session gate, dan gate `SWAP_EXECUTION_READY`) **tidak pernah dieksekusi**
— pool tetap hidup dan terlihat normal. Ini kegagalan *fail-open*, bukan revert.

**Kenapa tidak tertangkap test.** Semua test menambang salt sendiri sampai
`uint160(h) & 0x3fff == 0x2cc0` (`BellPoolFactory.t.sol:605,626`, `TreasuryAdapter.t.sol:372`,
`TreasuryAdapterInvariants.t.sol:228`). Jadi invarian "alamat hook punya mask benar" hanya
dijaga oleh fixture test, bukan oleh kode produksi.

**Usulan patch** (di lane kontrak, bukan di sini):

```solidity
// BellHookDeployer.sol, sebelum create2
uint160 bits = uint160(predicted) & Hooks.ALL_HOOK_MASK;
if (bits != EXPECTED_MASK) revert InvalidHookAddress(predicted); // EXPECTED_MASK = 0x2cc0
```

Plus test negatif: salt yang menghasilkan alamat tanpa `beforeSwap` harus revert
`InvalidHookAddress`, bukan lolos.

---

## F2 — P2: dua jalur manifest di dokumen vs implementasi

Plan Task 3 menulis manifest ke `evidence/runtime/testnet-deploy-manifest.json`; implementasi
(`scripts/deploy/deploy-testnet.mjs:8`) membaca `evidence/deploy/testnet-46630.json`. Yang benar
adalah yang kedua (sudah dipakai deploy nyata). Plan perlu dikoreksi, kalau tidak akan ada dua
"sumber kebenaran alamat" saat handover.

Terkait: plan menjanjikan *"CREATE2 address prediction and salt mining"* + `mineHookSalt`, tetapi
yang diimplementasikan hanya prediksi (nonce CREATE untuk factory, CREATE2 untuk hook). Tidak ada
penambangan salt. Bersama F1, ini berarti **penambangan salt adalah kewajiban off-chain yang tidak
diverifikasi on-chain** — dua hal yang harus diselesaikan bersamaan.

---

## F3 — P2: jalur TREASURY_ONLY belum punya test negatif

Hanya ada satu test (`testTreasuryOnlyFactoryCanCreateAndSeedPool`, `BellPoolFactory.t.sol:633`).
Yang belum ada dan berisiko:

1. `TreasuryAdapter.seed` revert (mis. `SettlementMismatch`) → seluruh `createAndSeed` harus
   atomik batal: hook tidak `ACTIVE`, tidak ada `PoolActivated`, nonce tidak terpakai, saldo
   treasury utuh.
2. `principal` yang dilaporkan hook ≠ jumlah yang benar-benar di-settle adapter → factory harus
   revert, bukan mengaktifkan pool dengan principal palsu.
3. `request.config.treasuryAdapter` diganti ke kontrak lain → harus revert
   `InvalidConfiguration` lewat `_profileHash` (`BellPoolFactory.sol:177`). Ini sudah benar
   secara kode, tapi belum ada test yang mengunci perilakunya.

---

## F4 — P3: `_refund` masih bisa di-*grief* dengan donasi

`_refund` (`BellPoolFactory.sol:228-234`) membandingkan saldo absolut terhadap `start`.
Donasi 1 wei ke factory sebelum `createAndSeed` membuat `current - start != refund` → revert
`BalanceMismatch`. Tidak ada pencurian dana (perbaikan dari review sebelumnya sudah benar), tapi
penyerang bisa membatalkan create orang lain dengan biaya 1 wei. Untuk rehearsal masih dapat
diterima; untuk mainnet sebaiknya pakai akuntansi delta per-request, bukan kesetaraan saldo absolut.

---

## F5 — P3: runner Node butuh `forge` di `PATH`

`scripts/deploy/deploy-testnet.mjs:46` melakukan `spawn('forge', ...)`. Di mesin ini Foundry hanya
ada di `~/.foundry/bin`, jadi runner gagal tanpa `export PATH="$HOME/.foundry/bin:$PATH"`.
Sudah didokumentasikan di `docs/runbooks/testnet-deploy.md` §2. Alternatif: hormati
`process.env.FORGE_BIN`.

---

## Temuan lama yang sudah ditutup

- `serviceFee = 49 * 10**decimals` hard-coded → sekarang dari parameter konstruktor dengan batas
  desimal (`BellPoolFactory.sol:97`). **Tertutup.**
- `BellRouter` menerima `msg.value` pada jalur ERC20 → sekarang `msg.value != 0` revert
  `SettlementMismatch` (`BellRouter.sol:82`). **Tertutup.**
- `_refund` memungkinkan donasi masuk ke refund → sekarang kesetaraan saldo menolak, bukan
  membayar (lihat F4 untuk sisa griefing-nya). **Sebagian tertutup.**

---

## Patch yang sudah diterapkan

`contracts/src/BellHookDeployer.sol`
- konstanta `EXPECTED_HOOK_MASK = 0x2cc0` dengan komentar alasan;
- `deploy()` menolak `uint160(predicted) & Hooks.ALL_HOOK_MASK != EXPECTED_HOOK_MASK`
  **sebelum** `create2`, jadi tidak ada bytecode yang ter-deploy pada salt yang salah.

`contracts/test/unit/hook/BellHookDeployer.t.sol`
- `testDeployRejectsSaltOutsideNormativePermissionMask` — salt dengan bit flag lain (lolos
  `isValidHookAddress`) harus revert `InvalidHookAddress`;
- `testDeployAcceptsOnlyTheNormativeMask` — salt yang benar tetap deploy dan alamatnya bermask
  `0x2cc0`.

Suite forge: **339 test lulus, 0 gagal**.

## Kesimpulan

Jalur deploy sudah satu sumber (forge script) dan manifest-nya kini memenuhi skema validator Node
(14 field, termasuk `weth` + `router`). F1 sudah ditutup sehingga "hook aktif" kembali berarti
"guard jalan". Sisa temuan (F2–F5) bersifat polish/tooling dan tidak menghalangi rehearsal testnet.
