# BELL on Elysium: testnet rehearsal and roadmap decisions

Written 7 Nov 2026 from `ElysiumBELL.md` (Dev Brief, 6 Nov). Everything under "Verified" was checked against the live
testnet RPC on the day it was written. Everything under "Not confirmed" was not.

## Verified (live RPC `https://testnet-rpc.elysium.kinetiq.xyz`)

| Fact | Result |
| --- | --- |
| Chain id | `99801` (`0x185d9`), Arbitrum Nitro client, gas in HYPE, parent HyperEVM testnet (998) |
| Permit2 at `0x000000000022D473030F116dDEE9F6B43aC78BA3` | code present |
| CREATE2 deterministic proxy `0x4e59b448…956C`, Multicall3 `0xcA11bde0…CA11` | code present |
| Cancun opcodes (TSTORE, MCOPY) | both execute, so Uniswap v4 core runs unchanged |
| HyperCore read precompile at `0x…0800` | no code on testnet today |

A dry run of `script/DeployTestnet.s.sol` against a fork of this chain succeeds: all twelve BELL contracts plus
PoolManager, PositionManager, WETH and the two test tokens, about 63M gas (estimate 0.0126 HYPE at 0.2 gwei).

## Not confirmed

- **Uniswap v4 on Elysium.** The press says Uniswap will support v4 hooks and mainnet is planned for 9 Nov; no address
  for PoolManager or PositionManager was found for the testnet. Decision: deploy our own pinned PoolManager and
  PositionManager on the testnet (the script already does). On mainnet use Uniswap's only if it is deployed and its
  commit matches ours; otherwise deploy ours and say so publicly.
- **Explorer verification.** Elysium's explorer is a Conduit-hosted app (`explorer-elysium-testnet.t.conduit.xyz`).
  It does not answer Blockscout's `/api/v2` or Etherscan-style `/api` routes, so `forge verify-contract` has no known
  endpoint. Until Elysium or Conduit documents one, save the standard-JSON input per contract and submit it through the
  explorer's own UI. The rule "verified before announced" stays.
- **"EL1Read".** No such name appears in any Elysium or Kinetiq source. Kinetiq announces a HyperCore read capability
  about four weeks after mainnet. Stage 4 is blocked on a published interface and must not be promised on a date.
- **Mainnet chain id, RPC and date.** The 9 Nov date is a teaser, not documentation. The script keeps mainnet blocked
  on Elysium: only chain 99801 is accepted.

## Decisions

1. **Stage 1 (testnet): same script, new chain.** `DeployTestnet.s.sol` accepts 99801 and writes
   `deployments/elysium-testnet.json`. Nothing in the contracts changed, and the Robinhood paths behave as before.
2. **Test tokens are deployed by the script.** The auction module refuses a zero fee token, so on 99801 the script
   deploys `tUSDG (BELL test)` (6 decimals, also the fee token) and `tAAPL (BELL test)` (18). `TestToken` refuses any
   name that does not end in `(BELL test)`. Both have an owner mint and a once-a-day public faucet.
3. **Stage 3 (fee split): contract written, not deployed.** `ElysiumFeeSplitter` is immutable, has no owner and no
   setter, sends the rounding remainder to the treasury, and never touches swap fees. Proposed split, to be fixed at
   deploy time: **40% $BELL buyback, 30% $KNTQ buyback, 30% treasury**. BELL is the protocol's own token, KNTQ is the
   chain partner, and the treasury pays for operations. These are proposals; the constructor takes any split.
4. **Stages 4 and 5 are not started.** They depend on a read interface that does not exist yet and, for the vault, on an
   audit.
5. **Rules kept.** The hook mask stays `0x2CC0`, no proxies, nothing that can hold back a withdraw.

## Run it

```bash
cd contracts
export FOUNDRY_PROFILE=elysium_testnet
export DEPLOYER_PRIVATE_KEY=0x...            # a testnet wallet funded with HYPE from the faucet
export TESTNET_GUARDIAN_ADDRESS=0x...        # three different addresses, none of them the deployer
export TESTNET_TREASURY_ADDRESS=0x...
export TESTNET_SERVICE_RECIPIENT=0x...
forge script script/DeployTestnet.s.sol                        # dry run: simulates, sends nothing
forge script script/DeployTestnet.s.sol --broadcast --skip-simulation
```

`--skip-simulation` is for Nitro chains, where local gas estimates differ from the sequencer's.

## Still to do for Stage 1

Admit the two test tokens in the AssetRegistry and publish a calendar root (the same one as on Robinhood Chain), create
one SESSION_ONLY pool and one with the Opening Bell Auction, run the swap, cap-revert, closed-market withdraw and full
auction cycle, then record the transactions and run the BELL v4 CLI with `--chain elysium-testnet`. All of that needs a
funded testnet wallet.
