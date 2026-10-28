# BELL

Session-aware AMM untuk token saham Robinhood Chain. Fee dan batas flow berubah mengikuti sesi
pasar (regular, extended, overnight, planned closure); kalau calendar, sumber harga, atau health
tidak jelas, swap berhenti daripada menebak.

## Mulai dari sini

| Dokumen | Isi |
|---|---|
| **`docs/CURRENT-STATE.md`** | Kondisi aktual: apa yang hidup onchain, apa yang tidak, dan buktinya. **Baca ini dulu.** |
| `docs/BELL-Developer-Brief-Final.md` | Spesifikasi normatif (hash-pinned; jangan diubah) |
| `docs/BELL-Implementation-Plan-Final.md` | Rencana 16 milestone / 80 task (hash-pinned) |
| `evidence/task-status.json` | Ledger status per task |
| `evidence/release-index.json` | Index evidence rilis (E01–E06) |
| `docs/runbooks/` | Deploy testnet, sumber Yahoo, hak data, keeper, indexer, migrasi, recovery |

Kalau dokumen mana pun bertentangan dengan `docs/CURRENT-STATE.md`, dokumen itu yang basi.

## Status singkat

- **End-to-end sudah jalan di Robinhood Testnet (46630).** Pool pertama live, swap pertama berhasil
  onchain: 5 token0 → 3 token1, budget commit `[5, 3]`, rolling cap turun `[100,100] → [95,97]`.
- Protokol lengkap secara kode dan seluruh suite hijau: 351 forge test (27 suite, termasuk 2 suite
  invariant 100k run), 297 node:test, 45+18 reference Python, 15 Deno, 6 keeper-b.
- Jalur harga: **Yahoo Finance + reporter EIP-712 BELL**. Chainlink tidak dipakai (berbayar).
- **Swap enforcement aktif untuk SESSION_ONLY.** `BellHook` menyiapkan dan menyelesaikan swap;
  evaluasi policy pindah ke `BellPolicyOracle` agar muat EIP-170.
- **PRICE_GUARDED masih tertutup** (belum ada referensi yang diadmit).
- **Mainnet belum disentuh.** Tidak ada transaksi di chainId 4663.
- Frontend belum mengirim transaksi; keeper harga masih no-op.

## Struktur

```text
contracts/          Solidity: hook, registry, factory, router, adapter, treasury, library
packages/domain/    State machine, budget, policy, indexing, keeper logic (runtime-neutral)
packages/protocol/  Codec, ABI, kalender, atestasi Yahoo, status testnet
apps/web/           Next.js UI (read-only terhadap testnet; belum mengirim transaksi)
workers/keeper-b/   Cloudflare Durable Object keeper
supabase/           Migrasi, RLS, edge functions
scripts/            discovery / deploy / evidence / calendar / tooling
evidence/           Manifest deploy, bukti runtime, ledger task, index rilis
docs/               Brief, plan, runbook, review, CURRENT-STATE
```

## Perintah

```bash
pnpm install
pnpm check                                  # seluruh gate: test, compile, abi, evidence, secret

pnpm test:contracts                         # forge test
pnpm test:unit                              # node:test
pnpm test:runtime                           # node portable + deno + keeper-b

pnpm compile:solidity
pnpm abi:check
pnpm evidence:check

node scripts/deploy/check-testnet-addresses.mjs --rpc      # state onchain vs manifest
node scripts/deploy/verify-testnet-deployment.mjs --check  # evidence deploy masih valid?
```

Perintah yang masih scaffold dan sengaja gagal dengan pesan `BLOCKED`: `test:e2e`, `test:fork`,
`test:invariants`, `preflight:sources`, `preflight:rpc`, `release:dry-run`. Kegagalannya jujur,
bukan bug.

## Peringatan

- `.env` tidak pernah di-commit. `YAHOO_REPORTER_PRIVATE_KEY` harus kunci terpisah dari
  governance/treasury.
- Reporter EIP-712 adalah trust boundary: Yahoo tidak menandatangani responsnya.
- `AaplTestnetFacade` bukan token saham Robinhood. Dia fixture supaya konstruktor adapter lolos cek
  kode di testnet.
- Treasury SafetyController masih burn address; handover belum direhearsal.
