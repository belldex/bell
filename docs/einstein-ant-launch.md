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
Done on 23 Nov 2026, replayed by `verify-einstein-ant.mjs` as M1 and M2:

1. Four delegated adapters deployed against Robinhood's ANT and the asset admitted through a hybrid-signed governance call (`ant-testnet-admit.mjs run --source delegated --network mainnet`). Governance leaf 5.
2. The ANT calendar root, 114 intervals to 1 Jan 2027, signed post-quantum and activated, then the first interval (`EINSTEIN_NETWORK=mainnet node scripts/deploy/testnet-einstein-calendar.mjs queue|execute-governance|activate-root|activate-interval --asset=ANT`). Governance leaf 6.

Still to do, in this order:

3. **Funds.** The pool needs the seed on both sides plus the 49 USDG service fee from the creator wallet (`LP_TEST`). At a 20 USDG seed that is about 69 USDG and about 0.23 ANT tokens, plus gas. ANT tokens are minted only by Robinhood's authorized participants, so the creator has to buy them on a Robinhood Chain market. Check with the dry run, which prints the exact shortfall:
   `node scripts/einstein/create-ant-pool.mjs --network mainnet --asset ANT --ant-usd live --usdg 20 --caps-factor 0.5`
4. **The delegate.** `ant-publish.mjs authorize --network mainnet --state evidence/deploy/mainnet-4663-ant.json --hours 24 --broadcast` (four REPORTER leaves). Do it just before the publisher starts: an authorized delegate that is not used wastes leaves and leaves a hot key open for a day.
5. **The publisher**, every 45 seconds while a session is open: `ant-publish.mjs loop --network mainnet --state evidence/deploy/mainnet-4663-ant.json --broadcast`. It reads Robinhood's pricing API, signs with the delegate, submits `refreshStockWithReports`, and activates each new calendar interval, so it is also the ANT interval keeper. It needs a machine or Worker that stays up, and the delegation must be renewed daily (one hybrid-signed call per adapter).
6. **The pool**, with `--broadcast --i-authorize-spend` once the dry run passes and the publisher is running (a pool whose price reports lapse blocks swaps).
7. A5 to A7 as sessions occur, then the page moves from admitted to live. The calendar ends 1 Jan 2027; a new root is needed before then.

## What the rehearsals showed
- Adding a stock token after genesis through hybrid governance works: queue, execute, activate.
- A new calendar interval opens with a bell fee that decays over 300 seconds. A swap right after an interval opens pays more than the session table; read a session fee (A5) after five minutes.
- A hook revert reaches the caller wrapped by the PoolManager as `WrappedError`; the inner error for A6 is `TradeCapExceeded`.
- A pool needs a keeper that activates calendar intervals. On testnet none runs, so the pool blocks at the next interval.
- The hook can only reach a Sourcify "match", not "exact match" (A7), because the factory builds it without a metadata hash.
