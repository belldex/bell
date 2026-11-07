# BELL on Elysium: testnet deployment, rehearsal and roadmap decisions

Written 7 Nov 2026 from `ElysiumBELL.md` (Dev Brief, 6 Nov). Everything below was run against the live Elysium testnet
(chain 99801) on that day, and every result has a transaction on the explorer. The evidence files under
`evidence/deploy/elysium-testnet-*.json` are the source for each table.

Explorer: https://testnet.elysium.kinetiq.xyz (address pages are `/address/<address>`, transactions `/tx/<hash>`).

## What is deployed

The same BELL contracts as Robinhood Chain, with no change to any contract. The only new contracts are test fixtures.
`deployments/elysium-testnet.json` holds every address.

| Group | Contracts |
| --- | --- |
| Registries | SafetyController, AssetRegistry, CalendarRegistry, SessionRegistry |
| Policy | BellPolicyOracle (creates its own BellPolicyDependencyReader), BellModeEvaluator |
| Auction | BellAuctionRegistry, BellAuctionFactoryModule |
| Pools | BellHookDeployerV2 (hook mask `0x2CC0`), BellPoolFactory, BellRouter |
| Dependencies | Uniswap v4 PoolManager and PositionManager (deployed by BELL, see below), WETH, canonical Permit2 (already on the chain) |
| Test tokens | `tUSDG (BELL test)`, `tAAPL (BELL test)`, and `tNVDA (BELL test)` for the compressed-session rehearsal |

Deploy cost: 18 transactions, about 0.0048 HYPE.

Roles: governance is the deployer, with distinct guardian, treasury and service-recipient wallets. Governance delay is 0 on
testnet. There are no proxies anywhere.

## Brief checklist

| Brief step | Status |
| --- | --- |
| `elysium_testnet` profile in `foundry.toml` | done (RPC and chain id; the verifier is passed on the command line, see Verification) |
| Run the same deploy script | done: `script/DeployTestnet.s.sol`, chain 99801 accepted, reads only `ELYSIUM_*` variables |
| Dependencies: check first, deploy if absent | Permit2 canonical present; no Uniswap v4 on Elysium testnet was found, so PoolManager and PositionManager are deployed from the pinned submodule |
| `TestToken` with names that cannot pass for real assets | done: the constructor refuses any name that does not end in `(BELL test)` |
| Calendar root | committed for `tAAPL`: 130 leaves of US-Eastern sessions, 7 Nov to 22 Dec 2026 |
| Admit the test tokens | done (tAAPL as a stock, tUSDG and WETH as quotes) |
| Verify every contract on the Elysium explorer | source published for 31 addresses; the explorer reports a **partial match** for every one, none a full match (see Verification) |
| Save addresses in `deployments/elysium-testnet.json` | done |
| Two pools: SESSION_ONLY, and with the Opening Bell Auction | done: three pools exist (one extra for the compressed rehearsal) |
| Swap per session | done for CLOSED, PRE and REGULAR, see Results |
| Swap above the cap reverts | done, recorded onchain |
| Withdraw while CLOSED succeeds | done |
| One full auction cycle | done on the compressed calendar, see Results |
| BELL v4 CLI with `--chain elysium-testnet` and a recorded video | CLI done; the recording is a manual step, see Recording |

## Decisions

1. **Same script, new chain.** `DeployTestnet.s.sol` accepts 99801 and writes `deployments/elysium-testnet.json`. On
   chain 99801 it reads only `ELYSIUM_*` names, so a Robinhood key can never be spent by an Elysium run.
2. **Test tokens are deployed by the script.** The auction module refuses a zero fee token, so the script deploys
   `tUSDG (BELL test)` (6 decimals, also the fee token) and `tAAPL (BELL test)` (18).
3. **PoolManager and PositionManager are ours.** The press says Uniswap supports v4 on Elysium and mainnet is planned for
   9 Nov, but no address was published for the testnet. On mainnet use Uniswap's only if it is deployed and its commit
   matches ours; otherwise deploy ours and say so.
4. **Stage 3 (fee split): contract written, not deployed.** `ElysiumFeeSplitter` is immutable, has no owner and no setter,
   sends the rounding remainder to the treasury and never touches swap fees. Proposed split 40% $BELL buyback, 30% $KNTQ
   buyback, 30% treasury, to be fixed by the team before deploy.
5. **Stages 4 and 5 are not started.** They need a read interface that does not exist yet ("EL1Read" appears in no Elysium or
   Kinetiq source) and, for the vault, an audit.
6. **Rules kept.** Hook mask `0x2CC0`, no proxies, no permission that can hold back a withdraw.

## Results

All rows below are in `evidence/deploy/elysium-testnet-tests.json` with their transaction hashes.

### Pools

| Pool | Hook | Kind |
| --- | --- | --- |
| tAAPL / WETH | `0x3F5d142Bb8a502e2608EB770Eb2c2E8d2519ecC0` | SESSION_ONLY |
| tAAPL / tUSDG | `0x44879463Ef804f935287f045457418dEf786eCc0` | SESSION_ONLY with the Opening Bell Auction |
| tNVDA / tUSDG | `0x34A34A40d73155FcA22e05b53F06e23C09EC6Cc0` | SESSION_ONLY with the Opening Bell Auction (compressed-session rehearsal) |

Every hook address ends in `cc0` and was checked against the permission mask. A pool carries an auction only when one of its
tokens is the factory's quote token (tUSDG), which is why the WETH pool has none.

### Behaviour while the market is CLOSED (the real US-Eastern calendar, a Saturday)

| Test | Result |
| --- | --- |
| Swap inside the cap | succeeds, spends the closure budget (0.8 to 0.6 of tAAPL) |
| Swap above the cap | reverts with `TradeCapExceeded`, transaction recorded with status reverted |
| Withdraw 10% of the seed position | succeeds, both tokens returned, no hook permission involved |
| Swap on the auction pool while closed | succeeds inside the closure budget |

### Compressed-session rehearsal (about ninety minutes)

The real calendar has no open market until Monday, so the sessions and the auction were exercised on a separate test asset
(`tNVDA`) with a rehearsal calendar: CLOSED 30 minutes, PRE 15, REGULAR 20, CLOSED 25. It is labelled as a rehearsal table in
the dataset provenance and it never replaces the US-Eastern calendar committed for `tAAPL`.

| Step | Result | Transaction |
| --- | --- | --- |
| Auction armed for the CLOSED to PRE transition | cycle 1, window opens 10 minutes before PRE | [0xa8968689…](https://testnet.elysium.kinetiq.xyz/tx/0xa8968689b7d8fc87dbe41fe92482476c21d1321ad67ee5bdf2584fd7a2200aef) |
| Swap while CLOSED, before the window | succeeds inside the closure budget | [0xd57b5add…](https://testnet.elysium.kinetiq.xyz/tx/0xd57b5addfcdb4075c9a8db61d249ba44b62ce26b9fb11ee63bc1304f7bb44ef1) |
| Swap while the window is open | reverts with `AuctionActive()` | [0xf72e2336…](https://testnet.elysium.kinetiq.xyz/tx/0xf72e2336ea9b451c19e31f72aae7e06226021870b677e8a83780c7d94a348e80) |
| Orders: sell 5 tNVDA (limit 99), buy with 600 tUSDG (limit 101) | both accepted in the open window | [0xe053816d…](https://testnet.elysium.kinetiq.xyz/tx/0xe053816dbbdafaaff1f7d2341cdd79dd22e3d8bef290f795973bec14ec390581), [0x96b8c196…](https://testnet.elysium.kinetiq.xyz/tx/0x96b8c1967311701e49adc62411bd5c320a3a2ac7a2147717a60c0fc377c8c843) |
| Settle at PRE | one uniform clearing price of about 99 tUSDG per tNVDA, 5 tNVDA matched, stage SETTLED | [0xc1fed537…](https://testnet.elysium.kinetiq.xyz/tx/0xc1fed537d9757417c9a576b7a59b9371efdb19e44c1fbb440fe640d6db849eda) |
| Claims | seller receives 495 tUSDG, buyer receives 5 tNVDA and a 105 tUSDG refund | [0xccf48e01…](https://testnet.elysium.kinetiq.xyz/tx/0xccf48e01bb8d5e35e5e21a3a581663995ec782f42365dcaee9f1090d5508e7cb), [0x44b5ec55…](https://testnet.elysium.kinetiq.xyz/tx/0x44b5ec55e7ce54cf71379c26584982d36543375a99ed48fc9bb9d629d0b9919a) |
| Swap in the PRE session | succeeds, mode ACTIVE | [0xad27484c…](https://testnet.elysium.kinetiq.xyz/tx/0xad27484c0f93da7835a4ea87458f68853f56c835beeb4bb51a48f77716d0faf0) |
| Swap in the REGULAR session | succeeds, mode ACTIVE | [0xc8819c35…](https://testnet.elysium.kinetiq.xyz/tx/0xc8819c356de2f79441200c84903acaedf42b114580db1d8b68414bc5e0a838ce) |
| Swap in CLOSED after the session | reverts with `PolicyBlocked(4096)`: no signed close anchor exists, so BELL fails closed | [0x5af596a6…](https://testnet.elysium.kinetiq.xyz/tx/0x5af596a6f31ff9fcce45cb8c6c1b117f8a07885285c4095663fbe20065c0289a) |
| Withdraw 10% of the position in that blocked state | succeeds: both tokens returned, the hook cannot stop it | [0x6bb168f0…](https://testnet.elysium.kinetiq.xyz/tx/0x6bb168f003b794c130bff52bddf45d5b9196cf30c3114e7f2e426882fe17fe42) |

Three things the rehearsal showed that the brief does not mention:

- **A keeper is part of the open.** After a closed market the hook stays in RECOVERING until it is checkpointed twice, at
  least 60 seconds apart (`refreshState()`, callable by anyone). Settlement requires the policy to allow swaps, so the first
  `settle()` at the open reverted with `PolicyHalted()` until two checkpoints had run. Calendar intervals also have to be
  activated at each boundary (`activateInterval`). On Elysium nobody runs these yet, so a keeper has to be set up before a
  real open.
- **A closed market after a live session needs a signed close anchor.** The test asset has no price keeper, so when its
  session ended no anchor was captured and BELL failed closed: swaps revert with `PolicyBlocked`, while the LP can still
  withdraw. This is the intended fail-closed behaviour, and it means a real Elysium deployment needs the same keeper that
  Robinhood Chain uses (signed quotes, `captureClose`, `refreshState`, `activateInterval`).
- **The router needs a fresh signed quote.** See the next section.

## Why swaps go straight to the PoolManager in the rehearsal

`BellRouter` always attaches a swap envelope. For a stock wired to Yahoo-attested sources the session registry then needs a
freshly signed quote inside that envelope, and Yahoo publishes no new candle on a Saturday. A router swap therefore cannot
exist while the market is closed. The rehearsal swaps through `TestnetSwapExecutor`, which calls the PoolManager with empty
hookData, so the hook's `beforeSwap` and `afterSwap` still run in full. The router path is exercised at the next real open
(see Next steps).

## Verification

The explorer documents a Blockscout-compatible API at `https://testnet.elysium.kinetiq.xyz/api/verify` and needs no key.
An earlier note here said no endpoint was known; that was wrong.

**Status, read back from the explorer:** 31 addresses (the 16 deploy contracts, the dependency reader, the Yahoo verifier,
six attestation adapters, the swap executor, tNVDA, three hooks and two auctions) have their source, ABI and constructor
arguments published. `GET /api/v2/smart-contracts/<address>` returns `is_fully_verified: false` and
`is_partially_verified: true` for all 31. A partial match means the deployed bytecode equals the compiled bytecode except
for the metadata hash. It is not a full match, and the explorer's own guidance says a partial match is not full verification,
so BELL does not call these contracts "verified" without that qualifier. The likely cause is that the contracts were built on
Windows; a full match probably needs a build whose metadata hash the explorer can reproduce (for example a Linux build, or a
redeploy with `bytecode_hash = "none"`). That has not been tried.

```bash
cd contracts
export FOUNDRY_PROFILE=elysium_testnet
# 16 contracts of the main deploy, from the broadcast record (every transaction already has a receipt)
forge script script/DeployTestnet.s.sol --broadcast --resume --verify --verifier blockscout \
  --verifier-url https://testnet.elysium.kinetiq.xyz/api/verify --skip-simulation --private-key "$ELYSIUM_DEPLOYER_PRIVATE_KEY"
# everything else: dependency reader, adapters, executor, tNVDA, the three hooks and the two auctions
node scripts/deploy/elysium-verify.mjs
```

`elysium-verify.mjs` reads every constructor argument back from the chain and writes
`evidence/deploy/elysium-testnet-verification.json`, which the v4 CLI reads.

## Run it

```bash
cd contracts
# contracts/.env (git-ignored) holds only ELYSIUM_* names:
#   ELYSIUM_DEPLOYER_PRIVATE_KEY, ELYSIUM_GUARDIAN_ADDRESS, ELYSIUM_TREASURY_ADDRESS, ELYSIUM_SERVICE_RECIPIENT
export FOUNDRY_PROFILE=elysium_testnet
forge script script/DeployTestnet.s.sol                                   # dry run, sends nothing
forge script script/DeployTestnet.s.sol --broadcast --skip-simulation     # the real deploy
cd ..
node scripts/deploy/elysium-rehearsal.mjs adapters   # attestation adapters for tAAPL
node scripts/deploy/elysium-rehearsal.mjs admit      # admit tAAPL, tUSDG, WETH
node scripts/deploy/elysium-rehearsal.mjs calendar   # US-Eastern calendar for tAAPL
# pools: forge script script/ElysiumPools.s.sol --broadcast --skip-simulation (needs the ELYSIUM_* addresses and asset ids in the environment)
node scripts/deploy/elysium-rehearsal.mjs pools      # record the pools from the factory events
node scripts/deploy/elysium-rehearsal.mjs swap | cap | withdraw
node scripts/deploy/elysium-session-rehearsal.mjs setup | drive
node scripts/auction-cli/bell-v4.mjs --chain elysium-testnet
```

`--skip-simulation` is for Nitro chains, where local gas estimates differ from the sequencer's. A dry run of `DeployTestnet`
writes `deployments/elysium-testnet.json` too, so delete it after a dry run: it would list addresses that do not exist yet.
Foundry also refuses to write there if the `deployments/` folder is missing, so keep the folder.

## Recording

`node scripts/auction-cli/bell-elysium.mjs` (or `node scripts/auction-cli/bell-v4.mjs --chain elysium-testnet`) is a paced walkthrough of
eight scenes. It reads the chain live: the latest block, the code at every one of the 31 addresses, each hook's permissions
drawn from its own address, each pool's current policy, the receipt of each of the 12 checks, and the settled auction.
Press Enter between scenes, which suits a recording. `--auto` advances on a timer and `--fast` shortens every pause. Without
`--chain` the v4 CLI behaves exactly as before.

## Next steps

- **Router swap at the next real open.** Monday 9 Nov, US-Eastern PRE at 09:00 UTC: swap through `BellRouter` with a signed
  Yahoo quote in the envelope, and settle the first real-calendar auction on the `tAAPL / tUSDG` pool.
- **Stage 2 (mainnet)** waits for the chain's launch, the Uniswap v4 and Permit2 check, a real asset to pair, and the team's
  approval of the deployer wallet.
- **Stage 3**: the team fixes the fee-split percentages, then deploy.
- **Stage 4**: blocked until Elysium publishes the HyperCore read interface.
- Faucet route for testnet HYPE: `docs/elysium-testnet-hype-guide.md` (and the PDF).
