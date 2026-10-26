# Runbook — deploy rehearsal ke Robinhood testnet (chainId 46630)

Status: **REHEARSAL**, bukan mainnet. PRICE_GUARDED tetap diblokir; factory rehearsal hanya
SESSION_ONLY. Treasury path produksi belum terintegrasi ke factory (lihat evidence/treasury-adapter-results.md).

## 0. Prasyarat yang sudah diverifikasi on-chain
- Permit2 canonical ada di testnet: `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- v4 PoolManager canonical **tidak ada** → script men-deploy PoolManager sendiri (owner = deployer)
- RPC testnet: `RH_TESTNET_RPC_PRIMARY` (Alchemy) + `RH_TESTNET_RPC_SECONDARY` (Pinax)

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
sessionRegistry, poolManager, positionManager, hookDeployer, poolFactory, weth, router`).

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

## 4. Belum tercakup (jangan diklaim selesai)
- Pool create-and-seed end-to-end: butuh asset admission (`queueAsset` + 48 jam delay) + calendar root
  + health source yang nyata. Untuk rehearsal cepat: deploy token fixture testnet dan admit sebagai
  SESSION_ONLY dengan source mock — dicatat eksplisit sebagai fixture, bukan source produksi.
- Treasury path (TreasuryAdapter) belum dipanggil factory.
- Keeper A (Supabase) dan Keeper B (Cloudflare) belum diarahkan ke alamat testnet ini.
- PRICE_GUARDED, audit, mainnet readiness — tetap M14/M15.
