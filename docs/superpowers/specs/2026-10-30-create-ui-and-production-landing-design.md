# Mainnet Pool Creation UI and Production Landing

## Goal

Make the existing pool wizard create a real Robinhood Chain Mainnet pool from the connected wallet, and make the public landing accurately describe the deployed protocol and its current empty-pool state.

## Current state

- `/create` is a static preview with illustrative token prices and disables its submit button.
- The deployed factory creates and seeds a PUBLIC position atomically through `createAndSeed`.
- Mainnet only has admitted AAPL, NVDA, TSLA, USDG, and WETH assets. All other displayed stock/custom choices are not eligible.
- Pull-mode quotes are available from the Cloudflare Worker. SessionRegistry health must be refreshed onchain from signed quote bundles before pool creation; freshness is short lived.
- The create script contains the canonical preflight, config, salt, funding, approval, simulation, and receipt behavior. The browser flow must preserve the contract's checks without using a private key or guessing prices.
- The served Gyevo landing still reports testnet-only, no Mainnet deployment, and sample pools, which contradicts current deployment evidence.

## Design

### Create flow

Use only admitted Mainnet assets and live onchain metadata. A creator chooses one admitted stock plus USDG, WETH, or another admitted stock. SESSION_ONLY is offered for eligible pairs; PRICE_GUARDED is offered only when both live reference adapters pass their reads. No custom token or unadmitted ticker may proceed.

The wizard collects seed maxima and caps, derives token ordering from addresses, and displays exact token amounts, the live factory service fee, the user's recipient address, the initial price source, required token/native balances, and estimated gas. Guarded prices come from the configured onchain reference adapters; SESSION_ONLY price comes from the entered seed ratio. No illustrative USD prices are used.

Before spending, the app validates chain ID, live calendars, active descriptors, the deployed factory profile hash, pair/class support, wallet balances, fee-token balance, native gas reserve, and all cap/price rules. It prepares all immutable request fields and mines the hook salt before refreshing short-lived health. The user explicitly approves only the required tokens for the factory. For a WETH seed, the app may offer to wrap only the shortfall after clearly displaying the ETH amount and wallet confirmation.

After approvals/funding, the app fetches one fresh signed quote bundle per stock leg and calls `SessionRegistry.applyPoolOracleUpdates` from the user's wallet. On confirmation, it rereads health and immediately simulates the exact `createAndSeed` request. It then submits that request from the same wallet and verifies `PoolCreated`, `PoolActivated`, and the minted position recipient in the receipt. Any stale quote, changed account/chain, insufficient balance, simulation failure, or reverted receipt stops the flow with the exact stage and transaction link. No server receives a wallet key.

The app never automatically broadcasts on page load. Each approval, wrap, health refresh, and final pool creation is an explicit wallet transaction. The review step states that pool class is immutable, seed amounts can be spent, the factory fee is paid separately from the seed, and the position NFT goes to the connected wallet.

### Landing and public status

Update the landing page actually served by `app/page.tsx` (`components/landing/gyevo/*`). Replace testnet-only milestone and facts with evidence-aligned Mainnet status: contracts and admitted assets are deployed; the pull quote and pool-discovery Worker is live; no pool, seeded liquidity, or Mainnet swap exists yet; Yahoo source rights are not verified; independent audit is not complete. Show a status timestamp as an explicit static snapshot. Make the active paths to live pools, pool creation, and swap clear. Avoid presenting stale/sample prices or implying that an empty pool directory has liquidity.

Update legal/product copy that says all transactions are disabled so it describes the enabled wallet swap and pool-create flows, and keep risk and no-financial-advice statements.

## Architecture and interfaces

- Add a browser-safe Mainnet create module in `apps/web/lib/` for live contract reads, pair resolution, config/request construction, salt mining, health preparation, approvals, simulation, and receipt validation.
- Reuse the generated protocol ABI and shared oracle-pull codec. Keep all signing and transactions in the connected EIP-1193 wallet; the Worker is quote-only.
- Keep the page as a reviewable, staged wizard. The UI consumes structured preflight results rather than directly embedding RPC plumbing in presentation components.
- Keep the landing presentation changes within the currently routed Gyevo landing components and update stale legal copy in the app routes.

## Error handling

Every preflight failure is shown before approvals. Every submitted transaction shows its stage, hash, confirmation state, and explorer link. If the 120-second health window expires before factory creation, the app reports expiry and requires fresh quote/health preparation; it must not retry a spend automatically. Re-read creator nonce and balances before creating so a stale plan cannot be submitted.

## Verification

Add tests for pair eligibility, sorting, fresh quote bundle completeness, fee/seed accounting, and expiry/receipt failures. Run focused web checks and the production build. Verify the landed app text contains no testnet-only/no-Mainnet/sample-pool claims and verify live quote/pool endpoints still work. Do not create or seed a Mainnet pool as part of implementation.
