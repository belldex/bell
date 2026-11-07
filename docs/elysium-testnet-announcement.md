**BELL on Elysium testnet: every contract, onchain.**
The same BELL contracts as Robinhood Chain, unchanged, deployed to Elysium testnet with test tokens that have no value. 31 addresses below, each with its deployment transaction.

Chain ID: 99801 (Elysium testnet)
Deployment Range: Blocks 25,660,592 to 25,675,405
Source published on the explorer: a partial match for every contract, see the note at the end
All of it, with the checks and the auction cycle: bellstocks.tech/elysium

**CORE INFRASTRUCTURE**

BellPoolFactory: creates, seeds and activates pools against an immutable dependency profile
testnet.elysium.kinetiq.xyz/address/0xafa3d9de6fec9535a94b4eebf193536de0b69b97
Deploy Tx, Block 25,660,739
testnet.elysium.kinetiq.xyz/tx/0x446a01f8c4ab5ec2e6e47d128adf89809342596bfb85aa30d7a5dff7f67ee9cf

BellRouter: single entry point for swaps, settling against onchain flow caps
testnet.elysium.kinetiq.xyz/address/0x03d957c8e5f391018254b73ee5100bc5efc3925a
Deploy Tx, Block 25,660,749
testnet.elysium.kinetiq.xyz/tx/0x5234bb3dddee2587642ce3e7d5f89a2c77d292ffd4dd850745f409c8284aa2ff

BellHookDeployerV2: deploys one immutable BellHookV2 per pool at a deterministic address, with the auction guard: swaps and liquidity adds pause during the auction window, LP exits are never blocked
testnet.elysium.kinetiq.xyz/address/0x6ca5c7a7c053207bd804f6a0f46f77df9ec301e3
Deploy Tx, Block 25,660,729
testnet.elysium.kinetiq.xyz/tx/0xcba2dd9a5d424ea7a0b18c8b4809a05a5035e156dd2b94aa325833327dba8bfb

BellPolicyOracle: aggregates every dependency reason into one policy answer, STATICCALL only
testnet.elysium.kinetiq.xyz/address/0x72843b9e5c173dd43c0c1a796c1a92356aee1666
Deploy Tx, Block 25,660,692
testnet.elysium.kinetiq.xyz/tx/0x474c3a02bf8ef664b98e6847a7546cd75267815bc247f07813ce7737f27b8f4f

BellModeEvaluator: derives trade, window and closure budgets from the pool principal itself
testnet.elysium.kinetiq.xyz/address/0x4189815227fb36a680ebc4ac84e25a4e5a2c469b
Deploy Tx, Block 25,660,701
testnet.elysium.kinetiq.xyz/tx/0x4c6a5aa92aca8347b58b5cb650bb17a639d9ae8cfa16d2757f1dc0f5555eff86

BellPolicyDependencyReader: bounded staticcalls: a failed read is a recorded reason, never a healthy default
testnet.elysium.kinetiq.xyz/address/0x2292644b9498ce8b1b8105080b18ad7a77ecac1b
Deploy Tx, Block 25,660,692
testnet.elysium.kinetiq.xyz/tx/0x474c3a02bf8ef664b98e6847a7546cd75267815bc247f07813ce7737f27b8f4f


**OPENING BELL AUCTION**

BellAuctionRegistry: write-once map from each pool to its auction, so a pool can never be rebound
testnet.elysium.kinetiq.xyz/address/0xd46488b38679058dcff1e9e0fcc4bf4c7f2567f5
Deploy Tx, Block 25,660,709
testnet.elysium.kinetiq.xyz/tx/0x067269084a1d8e433eb2117e59b804460bc304b7c1b112870102e020972a08f8

BellAuctionFactoryModule: deploys one reusable auction per USDG/stock pool, atomically with pool creation
testnet.elysium.kinetiq.xyz/address/0xab6ce8c893b14eadb4f1b77be33c5f5f7ae62af9
Deploy Tx, Block 25,660,718
testnet.elysium.kinetiq.xyz/tx/0xf80f3f8609100c8209c6a4f9ee6fa570d85dd86f4d2df349044157e60b2e7dd8


**REGISTRIES**

SafetyController: pause authority split across governance, guardian and treasury
testnet.elysium.kinetiq.xyz/address/0xb1f5b5e4f28b3004aa155cbdbe0ccaeeecb7515c
Deploy Tx, Block 25,660,616
testnet.elysium.kinetiq.xyz/tx/0xa86f1a3b94bdfbac15223fd5280a0f20adbc13f6bfe79ac4a09d5662fa1d5ace

AssetRegistry: admitted assets, code fingerprints, capability masks and evidence hashes
testnet.elysium.kinetiq.xyz/address/0x287c7d94be98cd200cc5afbf33ae7118df3e92f0
Deploy Tx, Block 25,660,623
testnet.elysium.kinetiq.xyz/tx/0x33ea0cc94dc1750f6f137996f7f8258e49a4306070bfd6dafeae629350cf5fe9

CalendarRegistry: Merkle-committed market sessions, advanced only with a valid proof
testnet.elysium.kinetiq.xyz/address/0x7904df8965033b28fdd9a409eb72c74afce794d9
Deploy Tx, Block 25,660,631
testnet.elysium.kinetiq.xyz/tx/0x24e0056230e42e19343ae8ee0a6499b26aaf45995ad20bf2afda23a7552a6f63

SessionRegistry: price health, close anchors and per-asset observation state
testnet.elysium.kinetiq.xyz/address/0xbb21638448c1c4500ffd386b2ee0ca2f5bb96696
Deploy Tx, Block 25,660,639
testnet.elysium.kinetiq.xyz/tx/0x2e005303525ecb9199022b09c66b6ac39c7244b81ca48f4d93403364551acc51


**POOL HOOKS (mask 0x2CC0, one immutable hook per pool)**

A hook and its auction are created by the factory inside the pool-creation transaction, so each one's deploy transaction is that pool's creation transaction.

BellHookV2, tAAPL / WETH: SESSION_ONLY pool, no auction
testnet.elysium.kinetiq.xyz/address/0x3F5d142Bb8a502e2608EB770Eb2c2E8d2519ecC0
Deploy Tx, Block 25,666,587
testnet.elysium.kinetiq.xyz/tx/0x023f47fbc90516641f377a6d9e0ce9e5394b6cab1ed163e11eb7c774edf65bc8

BellHookV2, tAAPL / tUSDG: SESSION_ONLY pool with its own Opening Bell Auction
testnet.elysium.kinetiq.xyz/address/0x44879463Ef804f935287f045457418dEf786eCc0
Deploy Tx, Block 25,666,596
testnet.elysium.kinetiq.xyz/tx/0x7801473a0649545944ff5ebe0736cb29bf8c678a5638fbf48fb16232e2ea5e96

BellHookV2, tNVDA / tUSDG: SESSION_ONLY pool with its own Opening Bell Auction
testnet.elysium.kinetiq.xyz/address/0x34A34A40d73155FcA22e05b53F06e23C09EC6Cc0
Deploy Tx, Block 25,675,405
testnet.elysium.kinetiq.xyz/tx/0x041a9513cf564600ba3d206a35af94db79ec38c8e0471f1339e9e65f066cd728


**AUCTIONS (one per USDG/stock pool, created with the pool)**

BellOpeningAuction, tAAPL / tUSDG: reusable per-pool auction, uniform-price clearing
testnet.elysium.kinetiq.xyz/address/0x14aF86C9C6EAB5F99174b14B55D01a89fE3912dB
Deploy Tx, Block 25,666,596
testnet.elysium.kinetiq.xyz/tx/0x7801473a0649545944ff5ebe0736cb29bf8c678a5638fbf48fb16232e2ea5e96

BellOpeningAuction, tNVDA / tUSDG: reusable per-pool auction, uniform-price clearing
testnet.elysium.kinetiq.xyz/address/0xBEA9E171aFB7122F325aADBF9EE39Da03446f931
Deploy Tx, Block 25,675,405
testnet.elysium.kinetiq.xyz/tx/0x041a9513cf564600ba3d206a35af94db79ec38c8e0471f1339e9e65f066cd728


**ATTESTATION ADAPTERS (rehearsal, for the test stocks)**

YahooSourceVerifier: checks the reporter signature on a quote
testnet.elysium.kinetiq.xyz/address/0xe6a37b439e1395aa727258c5b288372099bd2865
Deploy Tx, Block 25,662,366
testnet.elysium.kinetiq.xyz/tx/0x6308d51e12261d7542e2ed6fb02450436863e01c14e1b2b0f215cd0f2a36f977

tAAPL direct adapter: direct price source
testnet.elysium.kinetiq.xyz/address/0x87dd96d10c3ac4022b3fdf0ebf577b6e7a56cee2
Deploy Tx, Block 25,662,374
testnet.elysium.kinetiq.xyz/tx/0xa1aafe1e771f3f27a4825354e3ead8d875ad308d99574f8abdb5e1ff9dd0e2e7

tAAPL regular adapter: regular-session stream
testnet.elysium.kinetiq.xyz/address/0x046eaaf4ff343a44f50b4b8c73f600b692f59c50
Deploy Tx, Block 25,662,381
testnet.elysium.kinetiq.xyz/tx/0x4db460012aa7769b85be3c31062f48e90bca1a4abcecb392f5d357d5dd97a5c1

tAAPL extended adapter: extended-hours stream
testnet.elysium.kinetiq.xyz/address/0xa034c4063072332905fb5ec5444a55e89c6834aa
Deploy Tx, Block 25,662,404
testnet.elysium.kinetiq.xyz/tx/0x035aeaad23e5a552d0d1b62659a28b9e8f33529ed797042c7536ce6be0763576

tNVDA direct adapter: direct price source
testnet.elysium.kinetiq.xyz/address/0x8ff868679315542da29b30df205c8d59bd4ee0be
Deploy Tx, Block 25,671,938
testnet.elysium.kinetiq.xyz/tx/0x9522b80283f5d910a4530fcf2f0939410c7ce2c2e17e1aec71c63c458d4eb8dc

tNVDA regular adapter: regular-session stream
testnet.elysium.kinetiq.xyz/address/0x1979ee0496d102c99b71b7ca188c938bd4b9d798
Deploy Tx, Block 25,671,946
testnet.elysium.kinetiq.xyz/tx/0xa9764d11926e597fce903c71bfa4aab9c9d2995e79811c2eb517a89d1c071dae

tNVDA extended adapter: extended-hours stream
testnet.elysium.kinetiq.xyz/address/0xb2eb043eeb9987eb34c6673329d0f510a9546db1
Deploy Tx, Block 25,671,953
testnet.elysium.kinetiq.xyz/tx/0x8485098a3706d0213b743baf844f203b4616c1ad92ff6cab078e8dccd344a954


**TEST ASSETS (no value)**

tAAPL (BELL test): test stock token
testnet.elysium.kinetiq.xyz/address/0x4ed7166e5ffe57a1575eeae0d667d95bb8a81f1a
Deploy Tx, Block 25,660,608
testnet.elysium.kinetiq.xyz/tx/0x51fbef99a0c57ed214e3fa7606a180fb90ad4b20fff0c97cd409f2d0e099b2e2

tNVDA (BELL test): second test stock token for the compressed-session rehearsal
testnet.elysium.kinetiq.xyz/address/0x6f83f4ad84b0dd99dbdd5de366a0dfb23de0a4b1
Deploy Tx, Block 25,671,921
testnet.elysium.kinetiq.xyz/tx/0xf5118be0bcff04fe20d5c712c77ef01cf8b95c9316116f43bbdea74b25b325ca

tUSDG (BELL test): test quote token and factory fee token
testnet.elysium.kinetiq.xyz/address/0x61aaa348ea06cf6232dd41593d01a2f36ac1856e
Deploy Tx, Block 25,660,592
testnet.elysium.kinetiq.xyz/tx/0xe866dddd3def69cfbae7fa8da3147470e46a9755e2183715138c2ad4ff7204f9

WETH: wrapped HYPE for the WETH pool
testnet.elysium.kinetiq.xyz/address/0x049bf33b1512622dcc91757ccdc11a4ba135bb1f
Deploy Tx, Block 25,660,673
testnet.elysium.kinetiq.xyz/tx/0x377925edf1f0675a6d16f7a09926aa41890456a6496e5de5e8765b6af4dba20a


**UNISWAP V4 (deployed by BELL: no Uniswap address was published for Elysium testnet)**

PoolManager: Uniswap v4 core
testnet.elysium.kinetiq.xyz/address/0x6cbab0a9c85ad2ca9d451875360065d39d6f4f5e
Deploy Tx, Block 25,660,648
testnet.elysium.kinetiq.xyz/tx/0x6f30d1f7700e3b7b55ebb56522351819f34b03bd6460f6f4d24438313cb10f9a

PositionManager: Uniswap v4 periphery, holds the LP positions
testnet.elysium.kinetiq.xyz/address/0xb60cf56d2c14a2a070178c9954307c4132f9fc76
Deploy Tx, Block 25,660,682
testnet.elysium.kinetiq.xyz/tx/0x4441bb419deec726d7d47d92cb5d976297274e33f1b7a2fd9f767984eb47fe88


**REHEARSAL HELPER**

TestnetSwapExecutor: swaps straight on the PoolManager with empty hookData; holds no funds and no allowance
testnet.elysium.kinetiq.xyz/address/0x7603931a349310a433daf91de279fe31988204c8
Deploy Tx, Block 25,669,704
testnet.elysium.kinetiq.xyz/tx/0xf619e5f7bb7cf8c6c7e9a46fab049506b1b104516d2c22e3d9ddc7c0d909d3f2

**AUCTION PARAMETERS**

Order window: 10 minutes before the open, orders go into escrow
Settle timeout: 15 minutes after the open, then every order is refundable by anyone
Orders per cycle: 25
Cycles per auction: 512
Minimum order: 1% of the principal seeded into the pool
Clearing: one maximum-volume price chosen by the contract, no solver and no oracle
Unmatched orders: refunded in full, the AMM price does not move
Fee: none
Opens: every calendar transition from CLOSED to PRE or OVERNIGHT

**ONE CYCLE, SETTLED ONCHAIN**

On the tNVDA / tUSDG pool: ordinary swaps were refused with `AuctionActive()` while the window was open, orders collected, the book locked at the open, and every order cleared at one price of about 99 tUSDG per tNVDA. 5 tNVDA matched, and the buyer's unmatched 105 tUSDG was refunded.
Settlement Tx, Block 25,696,000
testnet.elysium.kinetiq.xyz/tx/0xc1fed537d9757417c9a576b7a59b9371efdb19e44c1fbb440fe640d6db849eda

**WHAT THIS IS, AND IS NOT**

Testnet only. The tokens are named "(BELL test)" and have no value. Elysium mainnet is not deployed.
The auction cycle ran on a compressed 90-minute rehearsal calendar for a test asset, not on a market calendar.
Source is published on the explorer as a partial match for every contract: the bytecode equals the compiled bytecode except for the metadata hash. None is a full match yet.
No keeper runs on Elysium yet. The open, the close and the auction need one before a real opening.
Independent audit in progress. Not financial advice.
