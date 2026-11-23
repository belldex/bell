# Launching ANT on BELL mainnet

Status: **blocked on a price source.** Chainlink's Robinhood mainnet feed directory has no ANT feed (checked 23 Nov 2026, 62 feeds), and BELL's `AssetRegistry` refuses a stock token without price adapters and session sources. A BELL-attested price is not workable: each report spends one HybridAuth leaf and reports must be at most 60 to 300 seconds old.

`node scripts/einstein/verify-einstein-ant.mjs --rpc <mainnet rpc> --online` prints `B1 PASS` the day Chainlink lists an ANT feed. Until then nothing below should be run on mainnet.

## The token
Robinhood's ANT is `0xbbB6c29bCc3a1028A2B54310DF73F4F7A3bcB373`, from [docs.robinhood.com/chain/contracts](https://docs.robinhood.com/chain/contracts) and `api.robinhood.com/rhj/assets`. `verify-einstein-ant.mjs` checks the code hash against AAPL, NVDA and TSLA.

## The path, proven on testnet
`scripts/einstein/ant-testnet-admit.mjs`, `scripts/deploy/testnet-einstein-calendar.mjs --asset=ANT`, `scripts/einstein/testnet-create-pool.mjs --asset ANT` and `scripts/einstein/ant-testnet-proofs.mjs` ran the whole sequence on Robinhood testnet with a test token and a fixture feed. Every transaction is on `/einstein/ant`.

The mainnet run is the same sequence with four changes:

| Step | Testnet rehearsal | Mainnet |
| --- | --- | --- |
| Token | `tANT` (TestToken) | Robinhood ANT above |
| Feed and adapters | `MockChainlinkFeed` and four adapters | Chainlink's ANT feed proxy; deploy with `scripts/deploy/mainnet-chainlink-session-stack.mjs` after adding ANT to `config/assets/candidates.mainnet.json` (`directAdjustedTokenUsd.proxy`, decimals, heartbeat) |
| Admission | `ant-testnet-admit.mjs` against the testnet stack | The same hybrid governance call against the mainnet `AssetRegistry` in `evidence/deploy/pq-hooks-mainnet.json`, GOVERNANCE role, profile `robinhood-4663`. Needs a mainnet variant of the script: stack addresses, chain id 4663, `RH_MAINNET_*` env |
| Calendar | `--asset=ANT` | `scripts/deploy/mainnet-calendar.mjs ... --asset=ANT` with `BELL_CALENDAR_STATE_PREFIX=evidence/deploy/pq-hooks-mainnet-calendar-state` |
| Pool | `testnet-create-pool.mjs --asset ANT` | `scripts/einstein/create-first-pool.mjs` generalised to the ANT token; pays 49 USDG plus the seed |

Check before sending anything: the deployer has ETH, the creator wallet has USDG for the seed plus the 49 USDG fee, a keeper activates calendar intervals (on testnet none runs, so the pool blocks at the next interval; see the v3 Evolve page), the opening price is a real Nasdaq quote, and ANT's own caps are half of NVDA's for the first 30 days as the brief asks.

## What the rehearsal showed
- Adding a stock token after genesis through hybrid governance works: queue, execute, activate.
- A new calendar interval opens with a bell fee that decays over 300 seconds. A swap right after an interval opens pays more than the session table; wait 5 minutes before reading a session fee (A5).
- A hook revert reaches the caller wrapped by the PoolManager as `WrappedError`; the inner error is `TradeCapExceeded` for A6.
- The hook can only reach a Sourcify "match", not "exact match" (A7), because the factory builds it without a metadata hash.
