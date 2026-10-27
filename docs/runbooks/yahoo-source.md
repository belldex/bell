# Yahoo public quote source (jalur aktif)

Jalur ini **tidak** memakai `CANDLESTICK_API` dan tidak memakai Chainlink Data Streams. Sumbernya
adalah endpoint chart publik Yahoo Finance:

```text
https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?interval=1m&range=1d&includePrePost=true
```

`includePrePost=true` bukan opsional. Tanpa itu, di luar 09:30–16:00 ET tidak ada candle sama
sekali dan setiap fetch akan gagal kebijakan freshness 120 detik. Ini sudah pernah jadi bug nyata.

Catatan CDN: `query1` memberi data segar; `query2` pernah tertinggal sekitar 10 menit.

## Kontrak yang sudah hidup di testnet 46630

| Peran | Alamat |
|---|---|
| `YahooSourceVerifier` | `0x20a066123c260bc6c5253f75e261c5056fde4bea` |
| Adapter direct (scope 0) | `0xdcc4fa3e0fa29361616799a891cc1dd2eaf61806` |
| Adapter regular (scope 1) | `0x00a7e4845a25cbed8f15510d4b2ead9ec37c0ccd` |
| Adapter extended (scope 2) | `0x71ed9d187628fbd2bbd7f7c9d8aeb80b1b12f03c` |
| Adapter overnight (scope 3) | `0x86da1e4a1b2a20321ad7cd9eec5b99061ba4ccf6` |
| Reporter (EOA) | `0x6C8bAF28eA08DD00A1A64EE350167A70A7b3E98a` |

`AaplTestnetFacade` di `0x64a82eb01d7c7310ef1bc5f0055f758409d45c63` **bukan** token canonical.
Dia ada hanya karena konstruktor adapter mode stream menuntut `stockToken.code.length != 0` di chain
deployment, sedangkan AAPL Mainnet tidak punya kode di Testnet. Jangan pernah menyebutnya saham.

## Model atestasi

Yahoo tidak menandatangani respons HTTP. Yang diverifikasi onchain adalah tanda tangan EIP-712 dari
reporter yang dipilih BELL. `YahooAttestedSourceAdapter` mengikat setiap observasi ke chainId,
verifier, hash SourceWire, feedId turunan ticker, fase, harga, timestamp, dan report hash.

- Wire stream memakai custom schema 12; wire direct adjusted-token memakai source kind 1.
- Ditolak: sampel basi, sampel dari masa depan, fase/feed salah, reporter salah, replay.
- **Trust boundary:** reporter adalah signer tepercaya BELL, bukan verifikasi kriptografis Yahoo.
  Perlindungan kunci reporter adalah tanggung jawab baru yang tidak ada di jalur Chainlink.

Signature harus memakai chainId **verifier** (46630 di testnet), bukan chainId token canonical (4663).
Ini juga pernah jadi bug.

## Perintah

```powershell
# preview quote (tidak mengirim transaksi)
node scripts/deploy/yahoo-report.mjs --symbol=AAPL --scope=1

# preview + tanda tangan (butuh YAHOO_REPORTER_PRIVATE_KEY)
node scripts/deploy/yahoo-report.mjs --symbol=AAPL --scope=1 --sign

# publish harga direct ke adapter
node scripts/deploy/publish-yahoo-direct.mjs
```

`--sign` memerlukan `YAHOO_REPORTER_PRIVATE_KEY` terpisah, alamat verifier yang sudah dideploy, dan
hash SourceWire per-adapter di `.env`. CLI tidak pernah memakai kunci governance/treasury.

## Kondisi sampel saat ini — penting

Sampel direct terakhir:

| Field | Nilai |
|---|---|
| `price18` | `342944023940939432439` |
| `observedAt` | `1793089910` |
| umur saat trace 2026-10-27 | 5500 detik |
| `validUntil` | `1793090030` (sudah lewat) |

Jadi publish pertama memang berhasil, tapi **tidak ada harga valid sekarang**. Policy menolak
observasi lebih tua dari 120 detik, dan sampel ini 45× lipat di luar batas itu. Ketiga adapter
stream belum punya sampel sama sekali — `readCurrent()` revert `WrongAdapterMode()` karena mereka
mode stream, bukan direct.

## Batas cakupan

- Metadata chart publik Yahoo mengekspos PRE, REGULAR, POST. **Tidak** ada feed OVERNIGHT. Jangan
  menandai sesi overnight sehat tanpa sumber lain.
- Endpoint gratis ini input eksternal tanpa tanda tangan, bisa delay, throttle, berubah, atau basi.
  Cek freshness 120 detik tetap aktif; quote tidak tersedia/basi berarti health fail-closed.
- Fetch-nya data pasar nyata, tapi hak komersial/redistribusi belum ditinjau. Lihat
  `docs/runbooks/data-rights.md`. Tidak ada respons mentah yang disimpan di evidence publik.
- Token saham Robinhood resmi hanya ada di Mainnet 4663 menurut snapshot API resmi. Tidak ada
  AAPL/TSLA/NVDA resmi di 46630.
- Deploy adapter/verifier Mainnet, admission SourceWire, calendar/health sesi, cross-check harga,
  fork/gas test, dan review independen tetap gate rilis. Tidak ada transaksi Mainnet yang
  diotorisasi oleh runbook ini.

## Bukti

- `evidence/deploy/yahoo-verifier-adapter-testnet.json` — deploy + publish pertama
- `evidence/runtime/mainnet-readonly-price-source-review-2026-10-26.json` — sampel read-only Mainnet
- `docs/CURRENT-STATE.md` — kondisi terkini seluruh sistem
