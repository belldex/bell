# Robinhood Chain Automatic Live Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build automatic on-chain wallet discovery and gated copy execution on Robinhood Chain, initially for verified Uniswap v2/v3 pools only.

**Architecture:** Use chainId-verified production RPC/WebSocket infrastructure and a durable block cursor. Discover pools from verified factories, decode actual protocol Swap events and wallet token/native balance changes, and produce normalized facts for the shared PnL ledger. Build swaps from fresh Quoter/pool state with strict min-output and gas caps, then reconcile soft confirmation, L1 posting, and finality separately.

**Tech Stack:** Node.js 22.23+, TypeScript strict, viem, Robinhood Chain JSON-RPC/WebSocket provider (Alchemy recommended by Robinhood), official Uniswap v2/v3 deployment data, Node test runner, fake signer/sender.

## Global Constraints

- Chain ID must be 4663 at runtime; testnet 46630 is used for integration checks where deployments exist.
- Production uses a provider contract with rate limits, receipts, history, and WebSocket support. The public endpoint is not a production dependency.
- Initial live scope is Uniswap v2/v3 on verified pool factories. Uniswap v4, Odyssey/NOXA, bridges, aggregators, and arbitrary routers are excluded until separately verified/planned.
- ERC-20 transfers alone are not swap signals. Require a recognized pool Swap event and reconcile its token deltas to the tracked wallet.
- Copy source is automatic and uses closed realized PnL only; incomplete history blocks eligibility.
- Automatic wallet criteria are 30 closed positions, 10 distinct tokens, positive realized net PnL on both 30d/90d, drawdown <=50%, <=50% concentration in one token, and complete on-chain venue history.
- Copy signal triggers at validated sequencer soft confirmation; L1 posting/finality are tracked as separate states.
- Seed capital cap $20 per chain, +$20 per $20 additional realized net profit; at least 15%/gas-to-close reserve, max 25% spendable per buy, max three open positions.
- Daily stop and session drawdown defaults are proposed at 50% of cap/high-water equity and must be approved before live activation.
- No private key in tests, PM2 config, repo, or application `.env`; fake signer/sender only.
- Production dependency graph must have no unreviewed critical/high advisories before a signer is enabled.

## File Map

- Create `src/robinhood/provider.ts` — HTTP/WSS provider interface, `eth_chainId`, block, receipt, bounded log, and balance methods.
- Create `src/robinhood/pool-index.ts` — verified factory/pool registry and cursor-based pool creation discovery.
- Replace/extend `src/providers/robinhood-rpc.ts` and `src/robinhood/transfer.ts` — validated RPC and decoded facts.
- Create `src/robinhood/swap-decoder.ts` — v2/v3 Swap event decoder plus wallet balance-flow reconciliation.
- Create `src/robinhood/quote.ts` — QuoterV2/known pool quote with fee, freshness, and impact.
- Create `src/execution/robinhood-builder.ts` — unsigned exact-input transaction builder.
- Create `src/execution/robinhood-sender.ts` — signer/sender/nonce/receipt adapter behind shared gate.
- Test root-level `test/robinhood-provider.test.ts`, `test/robinhood-pools.test.ts`, `test/robinhood-decoder.test.ts`, `test/robinhood-quote.test.ts`, and `test/robinhood-live-execution.test.ts`; fixtures under `test/fixtures/robinhood/`. Root-level test files are required by the current `npm test` script.

## Tasks

### Task 1: Verify network and provider capabilities

**Interfaces:** `RobinhoodProvider.getChainId(): Promise<number>`; `getBlockNumber()`; `getLogs(from,to,filters)`; `getTransactionReceipt(hash)`; `getTokenBalanceAt(token,wallet,block)`; WebSocket subscription with reconnect/cursor.

```typescript
interface RobinhoodProvider {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getLogs(fromBlock: bigint, toBlock: bigint, filters: LogFilter): Promise<RawLog[]>;
  getTransactionReceipt(hash: `0x${string}`): Promise<RawReceipt | null>;
  getTokenBalanceAt(token: `0x${string}`, wallet: `0x${string}`, block: bigint): Promise<bigint>;
}

interface RawLog {
  address: `0x${string}`;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
}

interface RawReceipt {
  transactionHash: `0x${string}`;
  blockNumber: bigint | null;
  status: "success" | "reverted" | null;
  logs: readonly RawLog[];
}

interface LogFilter {
  addresses: readonly `0x${string}`[];
  topics?: readonly (`0x${string}` | null)[];
}
```

- [ ] Test chainId mismatch, malformed block/log/receipt, JSON-RPC 429 with `Retry-After`, timeout, websocket reconnect, and wrong chain response.
- [ ] Test bounded `eth_getLogs` ranges; provider error must not advance the cursor.
- [ ] Verify the configured provider can return archive/balance-at-block and receipt data without printing credentials.
- [ ] Implement startup chain ID check and health breaker before enabling source subscriptions.
- [ ] Run targeted tests and commit `feat: add verified Robinhood RPC provider`.

### Task 2: Discover and verify supported Uniswap pools

**Interfaces:** `PoolRegistry.verify(routerOrPool): Promise<VerifiedPool>` returns chain ID, protocol version, factory, pool, ordered token0/token1, decimals, fee tier, and code/deployment hash.

```typescript
type UniswapVersion = "v2" | "v3";
interface VerifiedPool {
  chainId: 4663;
  version: UniswapVersion;
  factory: `0x${string}`;
  pool: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  decimals0: number;
  decimals1: number;
  feeBps: number;
  codeHash: `0x${string}`;
}
```

- [ ] Add fixtures for official v2/v3 deployment addresses, pool creation events, code mismatch, invalid token address, wrong factory, and wrong chain.
- [ ] Query pool metadata from chain, not DexScreener labels; compare official address source with on-chain code and store verification provenance.
- [ ] Scan factory `PairCreated`/`PoolCreated` logs with bounded cursor; persist cursor only after storing all verified creations.
- [ ] Explicitly reject v4 PoolManager logs until a separate v4 decoder/plan is approved.
- [ ] Run tests and commit `feat: index verified Robinhood Uniswap pools`.

### Task 3: Decode swap facts and wallet PnL events

**Interfaces:** `DecodedTradeFact` is the shared `OnchainSwapFact` type from the wallet-intelligence plan. `decodeRobinhoodSwap(receipt, verifiedPool, trackedWallet): DecodedTradeFact[]` returns the trader, exact asset deltas, direction, raw amounts, fees, tx hash, block, log index, and completeness.

```typescript
function decodeRobinhoodSwap(
  receipt: RawReceipt,
  pool: VerifiedPool,
  trackedWallet: `0x${string}`,
): DecodedTradeFact[];
```

- [ ] Test v2 Swap and v3 Swap logs, wallet buy/sell, multi-hop route, EOA transfer, airdrop, mint/burn, wallet-to-wallet transfer, pool not in registry, receipt revert, and multiple same-tx swaps.
- [ ] Require a matching supported pool Swap event and derive owner direction from token deltas; ERC-20 Transfer-only events must produce no copy signal.
- [ ] Reconcile pre/post wallet token balances at the relevant transaction/block; if the historical balance is unavailable, mark sell fraction/PnL unknown and block that copy action.
- [ ] Run tests and commit `feat: decode Robinhood Uniswap copy swaps`.

### Task 4: Quote, simulate and build unsigned swaps

**Interfaces:** `RobinhoodQuoteProvider.quote(pool, side, amountRaw, blockTag): QuoteResult`; `RobinhoodOrderBuilder.build(intent): EvmUnsignedTransaction`.

```typescript
interface RobinhoodQuoteResult {
  chainId: 4663;
  pool: `0x${string}`;
  inputToken: `0x${string}`;
  outputToken: `0x${string}`;
  inputRaw: bigint;
  minOutputRaw: bigint;
  blockNumber: bigint;
  feeBps: number;
  gasLimit: bigint;
  expiresAtMs: number;
}
```

- [ ] Test QuoterV2 quote, pool fee tier, stale block, wrong chain, token decimals, minimum output, slippage, gas, unsupported native-value route, and an allowlist miss.
- [ ] Pin official Robinhood v3 Factory/QuoterV2/SwapRouter02 deployment addresses from Uniswap’s chain page; verify runtime bytecode and `eth_chainId` at startup.
- [ ] Use `eth_call`/simulation and `eth_estimateGas` before signing. Keep native ETH fee reserve separate from quote spend. Never set unlimited ERC-20 allowance; if approval is needed, use an exact capped amount and a separate approved action.
- [ ] Use chain-specific deadline/min-out and reject when quote/provider data is stale or pool liquidity fails the risk floor.
- [ ] Run tests and commit `feat: quote and build Robinhood Uniswap swaps`.

### Task 5: Submit and reconcile EVM transactions

**Interfaces:** `EvmNonceManager.reserve(address): Promise<bigint>`; shared `SignerClient.sign({chain: "robinhood", unsignedPayloadBase64, policyProof, idempotencyKey}): Promise<Extract<SignedPayload, {chain: "robinhood"}>>`; `EvmSender.send(signedTx): Promise<hash>`; `EvmConfirmer.getState(hash): Promise<soft_confirmed|l1_posted|finalized|failed|unknown>`.

```typescript
type EvmConfirmation = "soft_confirmed" | "l1_posted" | "finalized" | "failed" | "unknown";
interface EvmUnsignedTransaction {
  chainId: 4663;
  nonce: bigint;
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
  gasLimit: bigint;
}
```

- [ ] Test concurrent nonce reservation, restart recovery, replacement/timeout, duplicate idempotency, receipt failure, and soft-confirmation vs L1-posted/finalized states.
- [ ] Implement single-writer nonce journal and receipt reconciliation; never retry an unknown transaction without checking hash/nonce state.
- [ ] Confirm the source signal uses a validated sequencer/RPC mechanism and report L1 posting/finality independently.
- [ ] Run full offline suite; commit `feat: add gated Robinhood live execution adapter`.

## Self-Review

- Token transfers are insufficient without recognized Swap event evidence.
- Robinhood v4 is explicitly deferred, consistent with the master spec.
- Public RPC fallback is never silently treated as a production provider.
