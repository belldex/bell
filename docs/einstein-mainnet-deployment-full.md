Einstein Hooks v2 is live on Robinhood Chain Mainnet, and every contract behind it is deployed and publicly verifiable.

Fifteen contracts now guard who can change BELL's rules. A calendar root or a governance call goes through only with two valid signatures: ECDSA and SHRINCS, a hash-based post-quantum scheme. Liquidity exits never ask for either.

Chain ID: 4663
Deployment Range: Blocks 113,918,086–113,918,228
Contracts Deployed: 15, in 21 transactions
Calendar Roots: AAPL, NVDA and TSLA, signed with both keys and active through 31 December 2026
Source Verification: Sourcify match for creation and runtime bytecode on all fifteen contracts. It is a match, not an exact match, because the build embeds no metadata hash.

DEPLOYMENTS

PQKeyRegistry
Holds one post-quantum key per role and counts every leaf spent.
Contract: https://robinhoodchain.blockscout.com/address/0x190ca8f13e381d1e58211cc821226ef9161d3a57
Deploy Tx · Block 113,918,102: https://robinhoodchain.blockscout.com/tx/0xa2253975b65181f27ad1aabd0e2ab300274770f3ef57f371ab3fdec151ea57b8
Verified Source: https://sourcify.dev/server/v2/contract/4663/0x190ca8f13e381d1e58211cc821226ef9161d3a57

HybridAuth
Checks both signatures before any privileged change goes through.
Contract: https://robinhoodchain.blockscout.com/address/0xbaab2dae7ff472964ed0dac40cab1e0e795009c7
Deploy Tx · Block 113,918,107: https://robinhoodchain.blockscout.com/tx/0x16f0c665759f86896b8b3422da2d4abd26f9c46c386d9386d63b35983b6cb878
Verified Source: https://sourcify.dev/server/v2/contract/4663/0xbaab2dae7ff472964ed0dac40cab1e0e795009c7

HashSigVerifier
Hands a signature to the SHRINCS verifier and reads the leaf back.
Contract: https://robinhoodchain.blockscout.com/address/0x0a02a186b905c9905dba5bba53882199821f794e
Deploy Tx · Block 113,918,097: https://robinhoodchain.blockscout.com/tx/0x7e2a41ab661531c76bc882e8da323c02e599e263b638c0b35295f1b895f78903
Verified Source: https://sourcify.dev/server/v2/contract/4663/0x0a02a186b905c9905dba5bba53882199821f794e

BellSHRINCSStatefulVerifier
Verifies SHRINCS signatures, from Quip Network's open implementation.
Contract: https://robinhoodchain.blockscout.com/address/0x0491db4e64856e94e1ad3c33f49c351530b83107
Deploy Tx · Block 113,918,086: https://robinhoodchain.blockscout.com/tx/0x5972e9deef030d5b33a24bbed63bdee5e2a7ca589f9af0d7e06c0bc8b5f6268a
Verified Source: https://sourcify.dev/server/v2/contract/4663/0x0491db4e64856e94e1ad3c33f49c351530b83107

SafetyControllerV2
Runs pauses and governance calls. Every one needs both signatures.
Contract: https://robinhoodchain.blockscout.com/address/0x5518541aa2d4b45531d7a2506fa81ffdfb4d505d
Deploy Tx · Block 113,918,144: https://robinhoodchain.blockscout.com/tx/0xeb034ebd625742edb5a9dc1f76c2dbeabcce5996daf90e769bb36bf323a526a3
Verified Source: https://sourcify.dev/server/v2/contract/4663/0x5518541aa2d4b45531d7a2506fa81ffdfb4d505d

HybridAssetRegistry
Lists the admitted assets: AAPL, NVDA, TSLA and USDG.
Contract: https://robinhoodchain.blockscout.com/address/0xb02cd68bcb8d3c624b7e3afd3a9f48a4c64d9b18
Deploy Tx · Block 113,918,161: https://robinhoodchain.blockscout.com/tx/0xd24a1102ddbc7eaed8469b6497932594509b21fc35e1593b2dffdde197cdad71
Verified Source: https://sourcify.dev/server/v2/contract/4663/0xb02cd68bcb8d3c624b7e3afd3a9f48a4c64d9b18

CalendarRegistry
Stores each asset's market-session calendar, one root per asset and year.
Contract: https://robinhoodchain.blockscout.com/address/0x77813f7a761bfa5722dc5ee1a6e5b4b849d49003
Deploy Tx · Block 113,918,152: https://robinhoodchain.blockscout.com/tx/0xff4ae4f09750027d4ce8e1de689b0848766e34229f9035829055e266a2961df0
Verified Source: https://sourcify.dev/server/v2/contract/4663/0x77813f7a761bfa5722dc5ee1a6e5b4b849d49003

SessionRegistry
Records session closes, checked against on-chain Chainlink feeds.
Contract: https://robinhoodchain.blockscout.com/address/0xc8e425140e0967aa07333946444c8a0611058ae8
Deploy Tx · Block 113,918,172: https://robinhoodchain.blockscout.com/tx/0x50eff9e734b282c533efa9fd5c34114f9b66e92d946bbf31dae2de692e0c2b37
Verified Source: https://sourcify.dev/server/v2/contract/4663/0xc8e425140e0967aa07333946444c8a0611058ae8

BellPolicyOracleV2
Works out the fee and flow caps a pool applies in each session.
Contract: https://robinhoodchain.blockscout.com/address/0xcee966d7172cabde8356be41620c6cf0086c92df
Deploy Tx · Block 113,918,181: https://robinhoodchain.blockscout.com/tx/0x3e583c48a6cb7316bacf0ab2f1b9cf92f2e1282cc9c27f6fbad328bcc9513321
Verified Source: https://sourcify.dev/server/v2/contract/4663/0xcee966d7172cabde8356be41620c6cf0086c92df

BellModeEvaluator
Decides whether a pool may swap right now.
Contract: https://robinhoodchain.blockscout.com/address/0x9dbf787172dfbc4eaa4593768ddfd32f84c45882
Deploy Tx · Block 113,918,190: https://robinhoodchain.blockscout.com/tx/0xab3537cbb318fd7ac5b3ae246102d3ebe730aff9c59acf29aea67f457a88159d
Verified Source: https://sourcify.dev/server/v2/contract/4663/0x9dbf787172dfbc4eaa4593768ddfd32f84c45882

BellAuctionRegistry
Links each pool to its opening auction.
Contract: https://robinhoodchain.blockscout.com/address/0xe2ce18362eec0a6f9166348aebff06182a183e6a
Deploy Tx · Block 113,918,196: https://robinhoodchain.blockscout.com/tx/0xe9fb1773e57e95a2675f13bf23c8e1d9aa9e8cc3757336b51b1f5b6df6e7deb2
Verified Source: https://sourcify.dev/server/v2/contract/4663/0xe2ce18362eec0a6f9166348aebff06182a183e6a

BellAuctionFactoryModule
Creates the opening auction when a pool is created.
Contract: https://robinhoodchain.blockscout.com/address/0xc2f0a0231a62b8bf9d679696ebd5806a76063b9d
Deploy Tx · Block 113,918,202: https://robinhoodchain.blockscout.com/tx/0x562686ae0b7b98e003d8033aed59399287e147e796bcdfc98e80073624e3ab84
Verified Source: https://sourcify.dev/server/v2/contract/4663/0xc2f0a0231a62b8bf9d679696ebd5806a76063b9d

BellHookDeployerV3
Deploys each pool's hook at an address that forbids exit callbacks.
Contract: https://robinhoodchain.blockscout.com/address/0xe95e9a0eb5cc6ef7cf20e80d4bdb51538a79102d
Deploy Tx · Block 113,918,211: https://robinhoodchain.blockscout.com/tx/0x94c156a49ae5ae6a8655e709ffa0941b78a2cd7013010fd8ab69d1befb21791e
Verified Source: https://sourcify.dev/server/v2/contract/4663/0xe95e9a0eb5cc6ef7cf20e80d4bdb51538a79102d

BellPoolFactoryV3
Creates a pool and seeds it in one transaction.
Contract: https://robinhoodchain.blockscout.com/address/0xf6b38e322ce6d8f9f836921278e13ae55f525569
Deploy Tx · Block 113,918,220: https://robinhoodchain.blockscout.com/tx/0xc59241de44a490cc1193efbc96fd64b23f6e61bc72f93c270c057f686c99f21d
Verified Source: https://sourcify.dev/server/v2/contract/4663/0xf6b38e322ce6d8f9f836921278e13ae55f525569

BellSwapLensRegistry
Lets anyone read a pool's swap status in a single call.
Contract: https://robinhoodchain.blockscout.com/address/0xdbf6f9299ed0186c0b4a53f66ca251872afd1dc5
Deploy Tx · Block 113,918,228: https://robinhoodchain.blockscout.com/tx/0x2f00e7d06185638471797b789e67fa6ba69f84983c308ab4ae56f898556c299c
Verified Source: https://sourcify.dev/server/v2/contract/4663/0xdbf6f9299ed0186c0b4a53f66ca251872afd1dc5

CALENDAR ROOTS

The first actions through the new governance path were the market calendars for AAPL, NVDA and TSLA. Each one was queued with an ECDSA signature and a SHRINCS signature, executed, activated, and then its first interval was activated.

AAPL calendar root: signed with governance leaf 1
Queued Tx: https://robinhoodchain.blockscout.com/tx/0x4db79658537836856024d8a189ef227e027b14c7203f7ca116f4925b8c491351
Executed Tx: https://robinhoodchain.blockscout.com/tx/0xefaac3a8d48794801db88acfe7f334a183995a4024f15afd203adb183dc933a1
Activated Tx: https://robinhoodchain.blockscout.com/tx/0x9546acbd330c0ac8a77b9d51e630f992f28db338f150c1f7520a2f4028336cc6
First Interval Tx: https://robinhoodchain.blockscout.com/tx/0xd770fbfc30776e5992d3be4dc150bb1262e15501dc5ba97c651230fa7c7f2a3b
Asset ID: 0x759a028b6eb3578ae6c3bb5968aa1ff01ef0e58bcdd934e09722de667b48a5dc

NVDA calendar root: signed with governance leaf 2
Queued Tx: https://robinhoodchain.blockscout.com/tx/0x26363ed094c325ac5721f12c5697191069fdbb466e0ad822cc9746e7e552dcc3
Executed Tx: https://robinhoodchain.blockscout.com/tx/0x6f99fc55be28a70ee2f99ae0ea16971bccf9b793d1fea603e54ea212167dace8
Activated Tx: https://robinhoodchain.blockscout.com/tx/0xb39feddc4a556354b4e5fa997688f2bcc943f768b44d87df72ea383f586205d4
First Interval Tx: https://robinhoodchain.blockscout.com/tx/0x14e1259131f0ed2519f64f1e48ffb75cbfb9c144e1ff05e5166e4b0d40e305cb
Asset ID: 0x9d718288c84e1620400de986e2d65853512a357734ffcfb2565e15de427f8fe7

TSLA calendar root: signed with governance leaf 3
Queued Tx: https://robinhoodchain.blockscout.com/tx/0x4eb08e8d739bfea14a43adf35b430daa48ffeb30940c86c7a1048605a53851dd
Executed Tx: https://robinhoodchain.blockscout.com/tx/0xb45900d499c0a1f2cb41903a7d0138c2ee1ba8841d5868fefb4506b85c5d24d7
Activated Tx: https://robinhoodchain.blockscout.com/tx/0xb99ae9eecdd0065fbb6ae851442a5926273b40086082c68504ea5016bdefcc67
First Interval Tx: https://robinhoodchain.blockscout.com/tx/0xd3e7bc9f9493d2638b6c7bd6ade95a2f094faf774cfcf8d6cf4491e58c192231
Asset ID: 0xfa1e411618d628d1c27918cbc4c9bc30ce675c1f4bd777ace690d4c7ff07ddae

WHAT IS NOT LIVE YET

No pool uses this stack yet. The governance delay is zero seconds and is fixed in the contract. Independent cryptographic review has not been done. On Mainnet, close anchors and prices are checked against on-chain Chainlink feeds and are not signed with SHRINCS.

Every address, transaction and result is on the page: https://www.bellstocks.tech/einstein
