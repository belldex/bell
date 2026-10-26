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

## 2. Deploy
```bash
cd contracts
set -a; source ../.env; set +a
forge script script/DeployTestnet.s.sol --rpc-url "$RH_TESTNET_RPC_PRIMARY" --broadcast -vv
```
Script gagal-closed bila: chainId ≠ 46630, treasury/recipient kosong, poolClass ≠ 1, atau
prediksi alamat factory tidak cocok.

Urutan deploy (satu transaksi per kontrak):
1. `SafetyController(treasury, treasury, treasury)`
2. `AssetRegistry(safety)`
3. `CalendarRegistry(safety)`
4. `SessionRegistry(assets, calendar)`
5. `PoolManager(deployer)`
6. `PositionManager(manager, permit2, 100000, descriptor=0, weth9=0)`
7. `BellHookDeployer(futureFactory, sessionRegistry, keccak256(BellHook.creationCode))`
8. `BellPoolFactory(profile, hookDeployer, feeToken, recipient)`

Manifest ditulis otomatis ke `evidence/deploy/testnet-46630.json`.

## 3. Verifikasi pasca-deploy
- `eth_getCode` semua alamat di manifest ≠ `0x`
- `factory.hookDeployer()` dan `factory.profileHash()` sesuai manifest
- `deployer.getNonce()` bertambah tepat 8
- `SessionRegistry.assetRegistry()`/`calendarRegistry()` menunjuk alamat manifest
- `PoolManager.owner()` = deployer (handover ownership saat rehearsal selesai)

## 4. Belum tercakup (jangan diklaim selesai)
- Pool create-and-seed end-to-end: butuh asset admission (`queueAsset` + 48 jam delay) + calendar root
  + health source yang nyata. Untuk rehearsal cepat: deploy token fixture testnet dan admit sebagai
  SESSION_ONLY dengan source mock — dicatat eksplisit sebagai fixture, bukan source produksi.
- Treasury path (TreasuryAdapter) belum dipanggil factory.
- Keeper A (Supabase) dan Keeper B (Cloudflare) belum diarahkan ke alamat testnet ini.
- PRICE_GUARDED, audit, mainnet readiness — tetap M14/M15.
