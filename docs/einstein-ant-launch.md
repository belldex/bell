# Launching ANT on BELL mainnet

Status: **the path is built and rehearsed on testnet; the mainnet steps are next.** Chainlink's Robinhood mainnet feed directory has no ANT feed (checked 23 Nov 2026, 62 feeds), and BELL's `AssetRegistry` refuses a stock token without price adapters and session sources. So ANT uses a BELL-attested price source built to last: `contracts/src/adapters/DelegatedAttestedSourceAdapter.sol`.

## The token
Robinhood's ANT is `0xbbB6c29bCc3a1028A2B54310DF73F4F7A3bcB373`, from [docs.robinhood.com/chain/contracts](https://docs.robinhood.com/chain/contracts) and `api.robinhood.com/rhj/assets`. `scripts/einstein/verify-einstein-ant.mjs` checks the code hash against AAPL, NVDA and TSLA.

## Why a delegated source
The Yahoo-style adapter spends one HybridAuth leaf per report, and reports must be 60 to 300 seconds old, so a 4,096-leaf key lasts three to six days. The delegated adapter spends one leaf per adapter per delegation (at most a day and an hour); the delegate then signs each report with ECDSA only. Four adapters mean four leaves a day, about two and a half years of REPORTER leaves.

What it costs in trust, plainly: inside a delegation window one ECDSA key can publish prices, and BELL is the oracle for ANT. Limits: a report may move the price at most 3 percent from the last one (25 percent after a quiet gap; larger needs a hybrid-signed `rebase`), the delegation expires on its own and `revokeDelegate` is hybrid-signed, and the delegate cannot touch the token's corporate-action status (the registry reads that from the token). The pool is SESSION_ONLY, so the price never sets a swap price. If Chainlink lists an ANT feed later, the source can be replaced.

The price comes from Robinhood's own REST pricing API, `GET https://api.robinhood.com/rhj/prices/ANT` (`tokenBid` and `tokenAsk`, already multiplier-adjusted). `scripts/einstein/ant-publish.mjs` refuses to publish when the API says `isTradingHalt`, when the spread is wider than 2 percent, or when the quote is older than a minute.

## What ran on testnet
Rehearsal 2 on `/einstein/ant` (token without a feed): admit after genesis through hybrid governance, four delegate authorizations (4 REPORTER leaves), a delegate-signed report that read healthy, the calendar root signed post-quantum, the pool, a session fee of 5000 pips in OVERNIGHT, and a swap above the cap refused with `TradeCapExceeded`. Rehearsal 1 did the same with a fixture feed. Every transaction is linked and `verify-einstein-ant.mjs --testnet-rpc` replays them.

## The mainnet sequence
Admission already supports mainnet, read-only until told otherwise:

```powershell
node scripts/einstein/ant-testnet-admit.mjs plan --source delegated --network mainnet
```

That prints the four adapters' gas (about 0.00016 ETH at 0.02 gwei) against the deployer's balance. The steps, in order, each one irreversible once sent:

1. `ant-testnet-admit.mjs run --source delegated --network mainnet --broadcast --i-authorize-spend` deploys the four adapters against the real ANT and the mainnet HybridAuth, then queues, executes and activates the asset through a hybrid-signed governance call (GOVERNANCE role, profile `robinhood-4663`, one governance leaf).
2. `ant-publish.mjs authorize --network mainnet --state evidence/deploy/mainnet-4663-ant.json --hours 24 --broadcast` authorizes the delegate (four REPORTER leaves).
3. The calendar root for ANT: the same hybrid-signed queue, execute, activate-root, activate-interval sequence as NVDA. `scripts/deploy/testnet-einstein-calendar.mjs` is the testnet version; the mainnet one needs the same constants as `mainnet-calendar.mjs` and the ANT asset id from step 1. Not written yet.
4. `ant-publish.mjs loop --network mainnet` every 45 seconds while a session is open. Needs a machine or Worker that stays up; the loop is 20 transactions a minute at most, a few cents a day.
5. The pool: `scripts/einstein/create-first-pool.mjs` generalized to ANT, opening at the live quote and with caps at half of NVDA's for 30 days. Pays 49 USDG plus the seed from the creator wallet. Not written yet.
6. A5 to A7 as sessions occur, then the page moves from Blocked to live.

## What the rehearsals showed
- Adding a stock token after genesis through hybrid governance works: queue, execute, activate.
- A new calendar interval opens with a bell fee that decays over 300 seconds. A swap right after an interval opens pays more than the session table; read a session fee (A5) after five minutes.
- A hook revert reaches the caller wrapped by the PoolManager as `WrappedError`; the inner error for A6 is `TradeCapExceeded`.
- A pool needs a keeper that activates calendar intervals. On testnet none runs, so the pool blocks at the next interval.
- The hook can only reach a Sourcify "match", not "exact match" (A7), because the factory builds it without a metadata hash.
