# Automatic On-Chain Wallet Discovery and Live Copy Trading

Date: 2026-10-23  
Status: Concept approved; awaiting user review of this written specification.  
Scope: Solana/Pump and Robinhood Chain, automatic wallet discovery, wallet-performance accounting, and separately gated live-copy execution.

## 1. Goal

Replace the current paper-first implementation with a new, auditable system that discovers potentially profitable wallets from on-chain activity, calculates its own wallet-performance evidence, and can eventually copy eligible wallets on Solana and Robinhood Chain.

“Automatic” means wallet discovery, scoring, promotion, suspension, and removal are driven by on-chain data and explicit rules. The operator does not manually maintain the source-wallet list. It does **not** mean every observed wallet is immediately eligible to trigger a real order.

This design is not an authorization to sign or broadcast live transactions. The current VPS process remains paper-only until the design is implemented, reviewed, independently validated, and a separate go-live approval is given.

## 2. User decisions recorded

- Strategy: copy wallets discovered automatically; no manual source-wallet input.
- Both chains are in scope.
- Wallet eligibility uses closed, realized, net PnL from on-chain history. Unrealized PnL is reported separately and does not qualify a wallet.
- Activity from venues without complete, validated coverage makes a wallet ineligible for automatic live-copy.
- Copy signals are acted on at Solana `confirmed` and Robinhood Chain sequencer soft-confirmation after validating the swap evidence. The bot then reconciles its own transaction status; it does not treat RPC acceptance as success.
- Initial capital cap: USD $20 per chain. Increase a chain’s cap by $20 only after an additional $20 of net realized profit on that chain.
- The operator accepts high strategy risk, but requires nonzero spendable balance for fees and future operation.

## 3. Research findings and implications

### 3.1 Existing wallet-copy products

Products such as GMGN expose wallet PnL, win rate, holding period, wallet classifications, and token-based discovery. Cielo documents automatic wallet-copy agents on Solana and Robinhood Chain, with token filters, sizing, exits, and historical simulation. Maestro documents that most non-Ethereum/BSC copy signals are detected after the target transaction is mined, so the copier may enter later. These are useful product patterns, not independent proof that a ranked wallet is profitable or copyable.

Birdeye’s PnL documentation warns that trade data for some protocols are not fully backfilled. Vendor PnL/labels may be used as a cross-check or candidate-discovery hint, but never as the source of live eligibility. The strategy’s eligibility ledger must be reconstructed from the project’s own validated on-chain venue coverage.

Research on memecoin copy-trading identifies bundled wallets, coordinated buys, wash activity, wallet-controlled supply, and the delay between a source trade and the copier’s fill as material sources of false profitability and copier losses. The system therefore scores the follower’s achievable entry/exit, not just the source wallet’s historical return.

### 3.2 Solana and Pump/PumpSwap

- Solana standard `logsSubscribe` mentions filters accept one address per subscription. RPC rate limits therefore matter when following many wallets; the current VPS experienced HTTP 429 responses during baseline backfills. Production ingestion must use a provider and request pacing/replay strategy sized for the monitored set.
- Solana transaction fetch supports legacy and versioned transaction formats; request the highest version the parser supports and retain account-key/lookup-table ordering, signers, raw token balances, lamport balances, logs, slot, and signature.
- Pump bonding-curve trades and PumpSwap pool trades use different instruction accounts, quote state, and fee handling. The initial live venue universe is limited to Pump bonding curves and PumpSwap pools whose program/account/instruction layouts are explicitly supported.
- Pump’s public docs describe v3 bonding-curve and v2 PumpSwap instruction families and dynamic fee behavior. A public issue in the official Pump docs repo reports an unresolved event serialization/IDL mismatch. Treat event decoding as untrusted until instruction data and aggregate token/quote balance deltas agree; unknown or contradictory evidence blocks copying.
- PumpPortal offers free token creation/migration streams and metered account/token trade streams. Any paid subscription must use one multiplexed socket and an explicit cost budget. It is an optional transport, not a source of PnL truth.

### 3.3 Robinhood Chain

- Robinhood Chain is EVM-compatible, chain ID `4663`, with ETH as native gas. Robinhood recommends a production RPC provider; the public endpoints are rate-limited. The primary sequencer feed is best-effort and a delayed fallback is documented. Feed protocol/compression changes require an actively maintained client.
- Uniswap v2/v3/v4 are available on Robinhood Chain. Official Uniswap deployment docs publish chain-specific factory/router/quoter addresses and warn not to reuse addresses from other chains. The initial live venue set is restricted to verified Uniswap deployments; other launchpads/DEXs require their own explicit address, event, and swap-decoder verification.
- ERC-20 `Transfer` events alone are not swaps. A copied trade requires a recognized pool/router swap event plus token/native balance-flow evidence for the tracked wallet and relevant pool/route.
- Robinhood confirmation is staged: sequencer soft-confirmation is fast; posting to Ethereum and Ethereum finality are later. Copying after soft confirmation accepts a bounded reorg/order risk; the bot must separately report soft-confirmed, L1-posted, and finalized status.

## 4. Architecture

The product is divided into four bounded subsystems. They communicate using normalized on-chain facts and durable trade/order identifiers.

### A. On-chain ingestion and reconciliation

**Solana adapter**

- Use a production streaming RPC (Yellowstone gRPC/LaserStream or equivalent with documented limits, replay, and support) plus archival HTTP RPC for backfill and transaction/account reads.
- Subscribe to supported Pump/PumpSwap program activity and one-address wallet filters as required. Reconnects are checkpointed by signature/slot; unresolved gaps block new entries.
- Normalize versioned transactions, loaded addresses, fee payer versus actual trader, inner instructions, transaction success, Pump/PumpSwap venue, mint/quote mint, raw token amounts, and balance deltas.
- Deduplicate by signature plus instruction/event identity. Reconcile event amounts against all token accounts owned by the trader/mint; uncertain quote or sell fractions cannot create an entry/exit order.

**Robinhood Chain adapter**

- Use a paid production JSON-RPC/WebSocket or indexed provider with bounded `eth_getLogs`, backfill, and rate-limit contracts. The public RPC is a development fallback only.
- Bootstrap verified Uniswap factory/pool identities from official deployment addresses and on-chain creation logs; pin chain ID and verify code before use.
- Decode recognized v2/v3 swap logs and v4 PoolManager swap events separately. Associate token transfers/native flows with the actual tracked wallet and pool; a transfer without a valid swap event is not a copy signal.
- Persist a block cursor only after every log in the range is reconciled. Use transaction receipts and a configurable reorg/confirmation window; retry the same range on provider failure.

**Normalized fact**

Every fact carries chain, block/slot, transaction signature/hash, instruction/log index, trader, venue, mint(s), raw amounts/decimals, fee/gas data, confirmation state, decoder version, provenance, and completeness/confidence. Facts that cannot meet this schema are stored as diagnostics but do not affect eligibility or trigger live orders.

### B. Automatic wallet discovery and profitability ledger

- Discover candidate wallets as a side effect of validated swaps on supported venues. No manually supplied wallet list is required.
- For each `(chain, wallet, token, venue)`, maintain an append-only position ledger: buys, partial sells, transfers, fees, current holdings, and cost basis. A transfer, mint, airdrop, unknown venue, or missing prior history marks the position basis incomplete; it cannot be presented as a profitable closed trade.
- Compute realized net PnL only on closed quantities after protocol fees, network fees, tips, and supported transfer costs. Keep unrealized PnL and mark source separate from realized qualification.
- For each wallet, publish rolling 30-day and 90-day realized net PnL, number of fully closed positions, distinct tokens, ROI on capital deployed, win/loss distribution, drawdown, median hold, venue coverage, source-copy delay estimate, and concentration of profits by token.
- Candidate statuses are automatic: `observing → eligible → suspended/excluded`. Unknown or incomplete data cannot promote a wallet. Promotion/demotion is deterministic and logged with reason codes; recovered data can restore eligibility only after the missing range is reconciled.
- Default initial qualification rule, subject to historical replay before activation: at least 30 fully closed positions across at least 10 distinct tokens; positive net realized PnL on both 30-day and 90-day windows; maximum drawdown no greater than 50%; no single token responsible for more than 50% of realized profit; complete accounting for the qualifying venue history. These thresholds indicate sample/risk filters, not expected profitability.
- Exclude creator/deployer wallets, bundled/closely coordinated launch wallets, apparent wash/round-trip patterns, source wallets with non-swap inflows that distort cost basis, and traders whose apparent advantage disappears after measured copy latency/fees.
- External services such as Birdeye, Nansen, and GMGN may be used to cross-check or prioritize backfill, but their scores never promote a wallet on their own.

### C. Copy decision and live execution

- A copy decision is emitted only from a validated target swap and eligible wallet state. The copier checks whether its own position already exists, whether the signal is stale, whether the target is opening/adding/reducing/closing, and whether the follower’s quote remains within bounds.
- Entry sizing is fixed from the follower’s own equity/cap, never blindly proportional to the target wallet’s amount. Partial target sells apply to the follower’s remaining quantity; an unknown fraction cannot become a full exit.
- Obtain a fresh venue-native quote and calculate minimum output from that quote. Aggregator/market-data prices are discovery/monitoring inputs, not execution guarantees.
- **Solana executor:** build Pump curve or PumpSwap instructions from current on-chain state and current supported IDL/SDK; estimate compute, simulate/preflight, apply bounded compute/priority/tip fees, sign through an isolated signer, submit through a configured sender, then reconcile the signature with `getSignatureStatuses` and transaction data. RPC `sendTransaction` acceptance alone is not success. On timeout, query signature/status before any retry.
- **Robinhood executor:** verify chain ID 4663, pool/router bytecode/address allowlist, token decimals, quote/minimum output, native gas reserve, and approved venue. Simulate/call before signing; obtain an EVM nonce with a single-writer nonce manager; submit and reconcile transaction receipt/status. Do not interpret a successful `eth_sendRawTransaction` response as a confirmed swap.
- Keep order journal states `intent → signed → submitted → soft/confirmed → finalized`, plus `failed` and `unknown`. `unknown` is never blindly resubmitted.
- Live signals use the approved policy: Solana `confirmed`; Robinhood validated sequencer soft-confirmation. Report later L1-posted/finalized status and retain the ability to pause entries if the chain/provider is unhealthy.

### D. Signer, capital, risk, and operations

- One dedicated execution wallet per chain, funded separately from the user’s primary wallet. Do not reuse any private key from the legacy VPS `.env` without a separate security review. Do not send keys in chat or commit them.
- Prefer an external signer/KMS or isolated signing service. The trading process sends typed, policy-checked intents to the signer and cannot export key material.
- Initial capital cap is $20 equivalent per chain. Only net realized profits increase that chain’s cap, by $20 per increment; unrealized profit does not raise the cap and external top-ups require explicit operator action.
- Keep at least the greater of 15% of current equity or a dynamic chain fee/close reserve unspent. Maximum single entry is 25% of spendable equity; maximum 3 open positions per chain. Recompute limits as equity compounds. These defaults require user review and must be enforced at both decision and signing boundaries.
- Circuit breakers block new buys on stale quotes, decoder mismatch, unresolved data gaps, rate-limit/backfill failure, excessive slippage/impact, low liquidity, high loss/drawdown, signer/nonce/order-journal failure, or unexpected chain/router deployment. Sells/closures must have a separately reviewed emergency policy.
- Logs and Telegram status disclose mode, health, candidates’ evidence/coverage, signal/fill latency, fee estimates, and transaction state without disclosing private keys, bot tokens, RPC credentials, or full secret-bearing URLs.

## 5. Rollout and implementation decomposition

This is too broad for one safe live-trading change. Implementation is split into dependent plans:

1. **On-chain wallet indexer and accounting core:** supported-venue decoders, history backfill, ledger, PnL coverage, candidate scoring, automatic promotion tests. No signing.
2. **Solana live pipeline:** Pump/PumpSwap decoding and quote tests, read-only replay, signer interface, simulation/preflight, durable order journal, status reconciliation, capped canary gates.
3. **Robinhood live pipeline:** official deployment verification, Uniswap v2/v3 first (v4 only when its deployment/decoder is separately validated), pool indexing, copy signals, quote/simulation, nonce/receipt reconciliation, capped canary gates.
4. **Shared risk/custody/operations:** external signer, separate wallets, policy enforcement, kill switch, monitoring, rollback, post-trade PnL and compounding caps.

Activation is one chain at a time even though discovery runs for both. Each chain needs a separate explicit go-live approval after its own read-only coverage and test gates pass. No automatic switching to live based on the presence of keys.

## 6. Validation and acceptance criteria

- Deterministic fixture/replay tests cover swaps, multi-account balances, partial sells, source identity, venue and quote identification, failed/reordered/reorged transactions, token transfers, migrations, fees, and dedupe. No live signing key or broadcast is used in tests.
- Historical wallet score replay is timestamp-correct: candidate decisions use only facts available at the decision time; follower fills are valued at the copier’s achievable later quote, not the source’s price.
- Data gaps, unknown token basis, unknown venue, stale quote, RPC 429, and ambiguous events block live entries and produce reason codes.
- Fuzz/property tests cover token decimals, partial fills, amounts, min-output, fee bounds, malformed RPC logs, large/future timestamps, and duplicate event delivery.
- Transaction adapter tests use fake signers/senders and local/testnet/forked deployment fixtures; tests prove no paper path can reach a signer or sender and no live intent can bypass the policy gate.
- The candidate selector is evaluated against held-out time periods and reports net copy PnL after observed delay, fees, gas, failed fills, and missed sells. No profit claim is an acceptance condition.
- Live readiness requires a separate operator checklist: dedicated funded wallet per chain, verified router/program deployments, paid RPC capacity with measured headroom, recovery/rollback, loss limits, and explicit signed approval. Until then, remain read-only/paper.

## 7. Explicit non-goals

- No manual source-wallet allowlist as the strategy’s normal operation.
- No use of third-party PnL/labels as the sole eligibility rule.
- No mempool frontrunning, sandwiching, wash trading, or manipulative bundling.
- No promise of profitability, alpha, or successful copying of past performance.
- No real signer, wallet funding, or live transaction in this design/research phase.

## 8. Research sources

### Protocols and infrastructure

- Solana [`logsSubscribe`](https://solana.com/docs/rpc/websocket/logssubscribe), [`getTransaction`](https://solana.com/docs/rpc/http/gettransaction), [`sendTransaction`](https://solana.com/docs/rpc/http/sendtransaction), [`simulateTransaction`](https://solana.com/docs/rpc/http/simulatetransaction), and [`getSignatureStatuses`](https://solana.com/docs/rpc/http/getsignaturestatuses).
- Helius [Yellowstone gRPC](https://www.helius.dev/docs/grpc), [data streaming](https://www.helius.dev/docs/data-streaming), and [plans/limits](https://www.helius.dev/docs/billing/plans).
- Pump [bonding-curve v3 instructions](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/TRADE_V3.md), [PumpSwap v2](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/PUMP_SWAP_TRADE_V2.md), [fees](https://pump.fun/docs/fees), [PumpPortal data API](https://pumpportal.fun/data-api/real-time), and the open [TradeEvent layout report](https://github.com/pump-fun/pump-public-docs/issues/54).
- Robinhood Chain [connecting/RPC providers](https://docs.robinhood.com/chain/connecting), [feed notices](https://docs.robinhood.com/chain/notices-and-upgrades), [transaction finality](https://docs.robinhood.com/chain/transaction-finality), and [protocol contracts](https://docs.robinhood.com/chain/protocol-contracts).
- Uniswap [Robinhood Chain v3 deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments) and [supported trading chains/router versions](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains).

### Wallet discovery and copy-trading product patterns

- [GMGN wallet detail](https://docs.gmgn.ai/index/wallet-detail-page) and [Wallet Radar](https://docs.gmgn.ai/index/wallet-radar).
- [Cielo trading agents](https://docs.cielo.finance/trading-agents/copy-trading) and [Cielo agent overview](https://docs.cielo.finance/trading-agents/overview).
- [Maestro copytrade](https://docs.maestrobots.com/sniper/copytrade).
- [Birdeye wallet PnL](https://docs.birdeye.so/reference/get-wallet-v2-pnl) and [PnL summary](https://docs.birdeye.so/reference/get-wallet-v2-pnl-summary).
- [Nansen copytrading workflow](https://docs.nansen.ai/guides/templates/complex-use-cases/use-case-4-copytrading-top-performing-wallets).
- [Research: Resisting Manipulative Bots in Meme Coin Copy Trading](https://arxiv.org/abs/2601.08641).
