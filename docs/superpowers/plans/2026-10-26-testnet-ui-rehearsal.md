# Testnet UI and governance rehearsal execution

Approved direction: connect the frontend to the existing Robinhood testnet deployment and prepare asset admission rehearsal. Execute inline; preserve the current deployment evidence.

## Constraints
- Chain 46630 only for the deployment bindings. Wallet transport for browser reads; no authenticated RPC URLs or private keys bundled in the static app.
- Existing pool/create/swap screens use sample data. Live deployment reads do not make sample pools executable.
- User selected testnet-only behavioral verification. Use compilation/typechecking plus authenticated read-only testnet checks; do not run local EVM suites.
- Treasury currently bound to burn address; no new treasury funding or admission broadcast until replacement identity is supplied.

## Tasks
- [ ] Add an explicit public deployment binding and block-pinned read adapter for code presence, contract dependencies, role addresses, balances and nonces.
- [ ] Connect read adapter to the app with loading/error/network/disconnect states and an address details panel; correct outdated deployment copy.
- [ ] Verify the same adapter against both authenticated testnet providers at one common block; record redacted results, not provider credentials.
- [ ] Prepare a chain-bound governance queue tool consuming an explicit asset descriptor/source-wire file; preview by eth_call, broadcast only with explicit flag; persist actual operation ETA and receipt. Do not fabricate stock/source evidence.
- [ ] Build/typecheck and update evidence with limitations and remaining owner input.
