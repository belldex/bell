# Testnet UI and governance rehearsal execution

Approved direction: connect the frontend to the existing Robinhood testnet deployment and prepare asset admission rehearsal. Execute inline; preserve the current deployment evidence.

## Constraints
- Chain 46630 only for the deployment bindings. Wallet transport for browser reads; no authenticated RPC URLs or private keys bundled in the static app.
- Existing pool/create/swap screens use sample data. Live deployment reads do not make sample pools executable.
- User selected testnet-only behavioral verification. Use compilation/typechecking plus authenticated read-only testnet checks; do not run local EVM suites.
- Treasury currently bound to burn address; no new treasury funding or admission broadcast until replacement identity is supplied.

## Tasks

Status as of 2026-10-27: all five items below are complete. A checkmark means the artifact exists
and can be inspected, not that it is release-ready—see `docs/CURRENT-STATE.md`.

- [x] Add an explicit public deployment binding and block-pinned read adapter for code presence, contract dependencies, role addresses, balances and nonces.
      → `packages/protocol/src/testnet-status.mjs` (`readTestnetStatus`, all reads pinned to one block, block hash + chainId re-verified at the end).
- [x] Connect read adapter to the app with loading/error/network/disconnect states and an address details panel; correct outdated deployment copy.
      → `apps/web/lib/use-testnet.ts`, `apps/web/components/app/TestnetBanner.tsx`, `apps/web/components/app/AppShell.tsx`. The banner states rehearsal-only and fails closed.
- [x] Verify the same adapter against both authenticated testnet providers at one common block; record redacted results, not provider credentials.
      → `scripts/deploy/verify-testnet-dual-provider.mjs`, `evidence/runtime/testnet-dual-provider-status-2026-10-26.json` (12 addresses match at a common block; no credentials are stored).
- [x] Prepare a chain-bound governance queue tool consuming an explicit asset descriptor/source-wire file; preview by eth_call, broadcast only with explicit flag; persist actual operation ETA and receipt. Do not fabricate stock/source evidence.
      → `scripts/deploy/queue-testnet-asset.mjs` + `activate-testnet-asset.mjs`; evidence `evidence/deploy/testnet-46630-asset-queue.json`. Only the WETH counterasset was queued; no stock descriptor was fabricated.
- [x] Build/typecheck and update evidence with limitations and remaining owner input.
      → `next build` + `tsc` passed; limitations are recorded in `docs/CURRENT-STATE.md` §4 and §8.

## Awaiting owner input

- Replacement treasury identity (currently the burn address `0x...dEaD`) so exit/handover can be rehearsed.
- Decision on Yahoo data-rights scope (indicative only vs. derived product).
- A real market schedule source for `CalendarRegistry`.
