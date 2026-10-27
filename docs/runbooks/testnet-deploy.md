# Runbook — deploy rehearsal ke Robinhood testnet (chainId 46630)

Status: **REHEARSAL**, bukan mainnet. PRICE_GUARDED tetap diblokir; factory rehearsal hanya
SESSION_ONLY. Treasury path produksi belum terintegrasi ke factory (lihat evidence/treasury-adapter-results.md).

Kondisi terkini seluruh sistem: **`docs/CURRENT-STATE.md`**. Runbook ini hanya menjelaskan cara
mengulang deploy; kalau keduanya berbeda, `docs/CURRENT-STATE.md` yang benar.

## 0. Prasyarat yang sudah diverifikasi on-chain
- Permit2 canonical ada di testnet: `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- v4 PoolManager canonical **tidak ada** → script men-deploy PoolManager sendiri (owner = deployer)
- RPC testnet: `RH_TESTNET_RPC_PRIMARY` (Alchemy) + `RH_TESTNET_RPC_SECONDARY` (Pinax)

## 0b. State deployment saat ini (2026-10-27)

Manifest `evidence/deploy/testnet-46630.json`, hash `0x2ca2ec5aa5b2903ae0b1af2b9c8f11eb0635dc1a4b50128c7654ca8718e24a0b`,
sourceCommit `ee407db`, block `142881475`–`142881484`.

Sudah hidup dan terverifikasi: 10 kontrak rehearsal + mBELL fee token 6-desimal + Yahoo verifier
dan 4 adapter Yahoo (direct/regular/extended/overnight).

Belum ada: pool, swap, calendar root, deskriptor saham. Hanya WETH counterasset yang ACTIVE.

Verifikasi ulang kapan pun:

```bash
node scripts/deploy/check-testnet-addresses.mjs --rpc      # alamat + binding + ukuran kode
node scripts/deploy/verify-testnet-deployment.mjs --check  # evidence masih cocok dengan chain?
```


## 1. Isi environment
`.env` (root repo, tidak di-commit):
```
DEPLOYER_PRIVATE_KEY=            # wallet deployer testnet, 64-hex (0x opsional)
TESTNET_TREASURY_ADDRESS=        # governance + guardian + treasury SafetyController
TESTNET_SERVICE_RECIPIENT=       # penerima service fee (nonzero)
TESTNET_FEE_TOKEN_ADDRESS=       # kosong = FeeTokenNotBound (fail-closed)
TESTNET_POOL_CLASS=1             # SESSION_ONLY
```
Pastikan wallet deployer punya ETH testnet (faucet) — kebutuhan ±0.02 ETH untuk seluruh fase.

## 1b. (Opsional) Token fee rehearsal
Factory butuh token fee untuk createAndSeed; tanpa itu setiap create revert FeeTokenNotBound.
Untuk rehearsal, deploy mock 6-desimal sekali lalu isi alamatnya:

    cd contracts
    set -a; source ../.env; set +a
    forge script script/DeployFeeToken.s.sol --rpc-url "$RH_TESTNET_RPC_PRIMARY" --broadcast -vv
    # salin address dari evidence/deploy/testnet-46630-fee-token.json ke TESTNET_FEE_TOKEN_ADDRESS

Ini fixture (bukan USDG) dan hanya membuktikan jalur fee/desimal; identitas USDG tetap MISSING.

## 2. Deploy

Ada **dua entrypoint** untuk deployment yang sama. Pilih satu, jangan keduanya — keduanya
memanggil script Foundry yang sama dan menulis manifest yang sama.

**A. Langsung Foundry** (paling transparan, dipakai saat rehearsal pertama):
```bash
cd contracts
set -a; source ../.env; set +a
forge script script/DeployTestnet.s.sol --rpc-url "$RH_TESTNET_RPC_PRIMARY" --broadcast -vv
```

**B. Runner Node** (opsional; memvalidasi manifest dengan skema kanonik + mencetak hash):
```bash
set -a; source .env; set +a
node scripts/deploy/deploy-testnet.mjs --dry-run   # cek urutan tanpa broadcast
node scripts/deploy/deploy-testnet.mjs             # broadcast + validasi manifest
```
Runner Node memanggil binary `forge` dari `PATH`. Bila Foundry hanya ada di `~/.foundry/bin`,
tambahkan ke `PATH` lebih dulu (`export PATH="$HOME/.foundry/bin:$PATH"`).

Script gagal-closed bila: chainId ≠ 46630, treasury/guardian/recipient kosong, tiga role tidak
saling berbeda, poolClass ≠ 1, atau prediksi alamat factory tidak cocok.

Urutan deploy (satu transaksi per kontrak):
1. `SafetyController(governance, guardian, treasury)` — tiga alamat **wajib** berbeda
2. `AssetRegistry(safety)`
3. `CalendarRegistry(safety)`
4. `SessionRegistry(assets, calendar)`
5. `PoolManager(deployer)`
6. `WETH` fixture — hanya bila `TESTNET_WETH_ADDRESS` kosong (tidak ada WETH9 kanonik di chain ini)
7. `PositionManager(manager, permit2, 100000, descriptor=0, weth9=WETH)`
8. `BellHookDeployer(futureFactory, sessionRegistry, keccak256(BellHook.creationCode))`
9. `BellPoolFactory(profile, hookDeployer, feeToken, recipient)`
10. `BellRouter(poolManager, WETH)`

Manifest ditulis otomatis ke `evidence/deploy/testnet-46630.json` (14 field alamat wajib:
`deployer, treasury, serviceRecipient, permit2, safetyController, assetRegistry, calendarRegistry,
sessionRegistry, poolManager, positionManager, hookDeployer, poolFactory, weth, router`; plus
`feeToken`, `status`, `note` — total 18 key, 16 di antaranya alamat).

Jalur harga Yahoo **tidak** termasuk dalam script deploy ini dan dideploy terpisah:

```bash
node scripts/deploy/deploy-yahoo-verifier.mjs         # YahooSourceVerifier
node scripts/deploy/deploy-yahoo-adapter-weth.mjs     # adapter direct
node scripts/deploy/deploy-yahoo-stream-adapters.mjs  # adapter scope 1/2/3 + facade testnet
```

`deploy-yahoo-stream-adapters.mjs` juga men-deploy `AaplTestnetFacade` karena konstruktor adapter
mode stream menuntut `stockToken.code.length != 0` di chain deployment, sedangkan AAPL Mainnet tidak
punya kode di Testnet. Facade itu **bukan** token canonical dan dicatat sebagai
`isCanonicalToken: false` di evidence.

## 3. Verifikasi pasca-deploy
- `eth_getCode` semua alamat di manifest ≠ `0x`
- `factory.hookDeployer()` dan `factory.profileHash()` sesuai manifest
- `deployer.getNonce()` bertambah tepat 10
- `SessionRegistry.assetRegistry()`/`calendarRegistry()` menunjuk alamat manifest
- `BellRouter.poolManager()` = manifest `poolManager`, `BellRouter.canonicalWeth()` = manifest `weth`
- `PoolManager.owner()` = deployer (handover ownership saat rehearsal selesai)
- `factory.liquidityMode()` = `0` (PUBLIC) untuk rehearsal ini. Profile immutable, jadi factory ini
  **tidak bisa** membuat pool TREASURY_ONLY; jalur treasury butuh deployment factory kedua dengan
  `liquidityMode=1` + `treasuryAdapter` terisi.
- `router.poolManager()` / `router.canonicalWeth()` menunjuk manifest, `weth.symbol()` = `WETH`

Setelah deploy atau redeploy, jalankan **tiga** penjaga. Urutannya penting: verifikasi dulu, baru
bandingkan.

```bash
node scripts/deploy/verify-testnet-deployment.mjs        # tulis ulang evidence dari chain + manifest
node scripts/deploy/check-testnet-addresses.mjs          # offline: manifest vs evidence vs status module
node scripts/deploy/check-testnet-addresses.mjs --rpc    # + ukuran code on-chain
```

`verify-testnet-deployment.mjs` menurunkan seluruh isi `testnet-46630-verification.json` dari chain
dan manifest: alamat, ukuran kode, hash kode, 15 binding, role, gas dari broadcast log. Jangan pernah
mengedit file itu dengan tangan — itulah yang menyebabkan insiden drift 2026-10-27, ketika kesepuluh
alamat di file verifikasi masih milik deployment sebelumnya dan `check-testnet-addresses.mjs` gagal
dengan 11 error. Mode `--check` exit 1 kalau evidence basi, jadi bisa dipakai di CI.

Tiga tempat menyimpan alamat yang sama (manifest, `testnet-46630-verification.json`, dan
`packages/protocol/src/testnet-status.mjs` yang dipakai frontend). Tanpa penjaga ini, redeploy
meninggalkan dua dari tiga menunjuk kontrak lama.

## 4. Admission aset (testnet zero-delay, mainnet tetap 48 jam)

Pool tidak bisa dibuat sebelum `AssetRegistry` mengenal **kedua** token: `BellPoolFactory._admitted`
revert `InvalidConfiguration` bila `asset0/asset1` nol atau `descriptorIdForToken(token)` tidak cocok.

```bash
# Langkah 1 — queue. Pada chainId 46630, governance ETA testnet diset 0 detik sesuai keputusan owner.
node scripts/deploy/queue-testnet-asset.mjs --token=0x<TOKEN>          # preview (eth_call)
node scripts/deploy/queue-testnet-asset.mjs --token=0x<TOKEN> --broadcast

# Langkah 2 — activate segera setelah queue, tetap dalam jendela operasi 7 hari.
node scripts/deploy/activate-testnet-asset.mjs --operation-id=0x<ID> --token=0x<TOKEN> --eta=<UNIX>
node scripts/deploy/activate-testnet-asset.mjs --operation-id=0x<ID> --token=0x<TOKEN> --eta=<UNIX> --broadcast
```

Override zero-delay terbatas di kontrak pada `block.chainid == 46630`; chainId 4663 tetap memakai
`GOVERNANCE_MINIMUM_DELAY_SECONDS = 172800`. Jangan deploy/testnet override build ke mainnet.
WETH rehearsal counterasset sudah aktif di deployment saat ini (`descriptorId` di
`evidence/deploy/testnet-46630-asset-queue.json`); queue tool mendeteksi descriptor aktif dan tidak
mengirim transaksi duplikat.

`activate-testnet-asset.mjs` mensimulasikan `activateAsset` lewat `eth_call` sebelum broadcast,
memetakan revert menjadi `TIMELOCK` / `EXPIRED` / `ALREADY_DONE_OR_CANCELLED` / `TOKEN_CHANGED`, dan
setelah broadcast memverifikasi `descriptorIdForToken(token)` benar-benar terikat.

Sisi counterasset (WETH) cukup: `isStock=false`, `capabilityMask=0`, semua adapter nol, sourceConfig
kosong → `AssetPolicy.oraclelessCounterasset` melewati gate health. Sisi saham **tidak** cukup:
`_admitted` mensyaratkan `SessionRegistry.health(id)` dengan `ready`, `reasonBits == 0`, dan
`validUntil > now`, jadi butuh adapter + source yang benar-benar melaporkan.

### 4b. Kenapa belum ada deskriptor saham

`descriptorIdForToken` saat ini mengembalikan nol untuk `AaplTestnetFacade`
(`0x64a82eb01d7c7310ef1bc5f0055f758409d45c63`) dan untuk mBELL. Yang ACTIVE hanya WETH.
Tiga hal yang menghalangi, dan semuanya harus beres bersamaan:

1. **Token.** API resmi Robinhood mengembalikan 195 aset, semuanya hanya di chainId 4663. Tidak ada
   AAPL/TSLA/NVDA resmi di 46630. Facade hanya memenuhi cek `stockToken.code.length` di konstruktor
   adapter; dia bukan token canonical dan tidak boleh dipakai sebagai identitas saham.
2. **Calendar.** `CalendarRegistry.currentInterval(WETH)` mengembalikan semua nol. Belum ada root
   yang di-queue untuk aset mana pun. Tanpa interval, `refreshHealth` untuk saham tidak akan hijau.
3. **Sampel sumber.** Sampel direct terakhir berumur 5500 detik saat trace 2026-10-27, sementara
   policy menolak > 120 detik. Tiga adapter stream belum punya sampel sama sekali.

Jadi queue descriptor saham sekarang hanya akan menghasilkan revert atau health yang tetap tidak
siap. Jangan meng-queue sesuatu hanya untuk "terlihat ada progres".

## 5. Belum tercakup (jangan diklaim selesai)
- Pool create-and-seed end-to-end: WETH counterasset aktif, tetapi perlu pasangan token saham dengan
  descriptor, adapter bindings, source report sehat dan interval calendar yang valid. Data/mock
  adapter tidak boleh dilabeli sebagai saham/source produksi; fixture rehearsal harus dinyatakan eksplisit.
- Swap: `BellHook.SWAP_EXECUTION_READY = false`; `_beforeSwap`/`_afterSwap` revert
  `HookNotImplemented()`. Tidak ada satu pun swap yang pernah terjadi, dan itu disengaja sampai
  M05-05 selesai.
- Treasury path (TreasuryAdapter) belum dipanggil factory. Treasury SafetyController masih burn
  address `0x...dEaD`, jadi exit/handover belum bisa direhearsal.
- Keeper A (Supabase) dan Keeper B (Cloudflare) belum diarahkan ke alamat testnet ini.
- PoolManager ownership masih di deployer.
- PRICE_GUARDED, mainnet readiness — tetap M14/M15.
