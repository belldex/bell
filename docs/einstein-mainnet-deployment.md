The post-quantum layer of Einstein Hooks v2 is live on Robinhood Chain Mainnet. Its five contracts are deployed and publicly verifiable.

From now on a calendar root or a governance call goes through only with two valid signatures: ECDSA and SHRINCS, a hash-based post-quantum scheme. Each role holds a fixed budget of 4,096 one-time signatures, and the key registry refuses any leaf that is spent or out of order. Liquidity exits never ask for either signature.

Chain ID: 4663
Deployment Range: Blocks 113,918,086–113,918,144
Contracts Deployed: 5, in 11 transactions with the role keys installed
Role Keys: KEEPER, REPORTER, GOVERNANCE and GUARDIAN, installed and sealed
Calendar Roots: AAPL, NVDA and TSLA, signed with both keys and active through 31 December 2026
Source Verification: Sourcify match for creation and runtime bytecode on all five contracts. It is a match, not an exact match, because the build embeds no metadata hash.

DEPLOYMENTS

BellSHRINCSStatefulVerifier
Verifies SHRINCS signatures, from Quip Network's open implementation.
Contract: https://robinhoodchain.blockscout.com/address/0x0491db4e64856e94e1ad3c33f49c351530b83107
Deploy Tx · Block 113,918,086: https://robinhoodchain.blockscout.com/tx/0x5972e9deef030d5b33a24bbed63bdee5e2a7ca589f9af0d7e06c0bc8b5f6268a
Verified Source: https://sourcify.dev/server/v2/contract/4663/0x0491db4e64856e94e1ad3c33f49c351530b83107

HashSigVerifier
Hands a signature to the SHRINCS verifier and reads the leaf back.
Contract: https://robinhoodchain.blockscout.com/address/0x0a02a186b905c9905dba5bba53882199821f794e
Deploy Tx · Block 113,918,097: https://robinhoodchain.blockscout.com/tx/0x7e2a41ab661531c76bc882e8da323c02e599e263b638c0b35295f1b895f78903
Verified Source: https://sourcify.dev/server/v2/contract/4663/0x0a02a186b905c9905dba5bba53882199821f794e

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

SafetyControllerV2
Runs pauses and governance calls. Every one needs both signatures.
Contract: https://robinhoodchain.blockscout.com/address/0x5518541aa2d4b45531d7a2506fa81ffdfb4d505d
Deploy Tx · Block 113,918,144: https://robinhoodchain.blockscout.com/tx/0xeb034ebd625742edb5a9dc1f76c2dbeabcce5996daf90e769bb36bf323a526a3
Verified Source: https://sourcify.dev/server/v2/contract/4663/0x5518541aa2d4b45531d7a2506fa81ffdfb4d505d

ROLE KEYS

Four roles each have one ECDSA signer and one post-quantum key. Once installed, the key registry was sealed: from that point a role key can change only through HybridAuth, with both signatures.

KEEPER role key
Post-quantum key commitment: 0xfb7f4d2bd549c145832cca3f8df853783c56f26b86f8b27ddd0698434980b6f1
Signature budget: 4,096 one-time leaves
Installed Tx · Block 113,918,112: https://robinhoodchain.blockscout.com/tx/0x27fdb3de25001516c8de6c1b28c4539a09dad9615b57cdeff7b6096055a9b9e8

REPORTER role key
Post-quantum key commitment: 0xf221c425822bcf139643bd6c40c0f1504f772b62b6abf689e96a54df1670c25e
Signature budget: 4,096 one-time leaves
Installed Tx · Block 113,918,118: https://robinhoodchain.blockscout.com/tx/0x7927f2711d21792879c73b5bf59edd05dc99ac809e7f06a2ed3f38d041590d7e

GOVERNANCE role key
Post-quantum key commitment: 0x98c3d63d44fc085ec232cdc58d16bd43f55e4c11a95eb4036809fe21eb094b7c
Signature budget: 4,096 one-time leaves
Installed Tx · Block 113,918,123: https://robinhoodchain.blockscout.com/tx/0xa33c3bcfd3ec1373644002599dec4fea2f937c746814f55487eff7bd5588c42a

GUARDIAN role key
Post-quantum key commitment: 0x752b6371bb71ca67560b5af4eaa0af44b6b6480cdd65374880bc1b371ad16f86
Signature budget: 4,096 one-time leaves
Installed Tx · Block 113,918,129: https://robinhoodchain.blockscout.com/tx/0x5d9ba27e22b95ec819dc567c0a3c19e850807a2bc7eefd9cf8917d464fa31c30

Hybrid authority set: https://robinhoodchain.blockscout.com/tx/0x2d89a25e1a38df50024e272dc8cb2713b1ea645705f358a1dd2423beabbc8cba
Bootstrap sealed: https://robinhoodchain.blockscout.com/tx/0x23f456e131dae971569759d58b56d7e682be7f999672348d7c9a6e632a418a97

CALENDAR ROOTS

The first actions through the new governance path were the market calendars for AAPL, NVDA and TSLA. Each one was queued with an ECDSA signature and a SHRINCS signature, executed, activated, and then its first interval was activated.

AAPL calendar root: signed with governance leaf 1
Queued Tx: https://robinhoodchain.blockscout.com/tx/0x4db79658537836856024d8a189ef227e027b14c7203f7ca116f4925b8c491351
Executed Tx: https://robinhoodchain.blockscout.com/tx/0xefaac3a8d48794801db88acfe7f334a183995a4024f15afd203adb183dc933a1
Activated Tx: https://robinhoodchain.blockscout.com/tx/0x9546acbd330c0ac8a77b9d51e630f992f28db338f150c1f7520a2f4028336cc6
First Interval Tx: https://robinhoodchain.blockscout.com/tx/0xd770fbfc30776e5992d3be4dc150bb1262e15501dc5ba97c651230fa7c7f2a3b

NVDA calendar root: signed with governance leaf 2
Queued Tx: https://robinhoodchain.blockscout.com/tx/0x26363ed094c325ac5721f12c5697191069fdbb466e0ad822cc9746e7e552dcc3
Executed Tx: https://robinhoodchain.blockscout.com/tx/0x6f99fc55be28a70ee2f99ae0ea16971bccf9b793d1fea603e54ea212167dace8
Activated Tx: https://robinhoodchain.blockscout.com/tx/0xb39feddc4a556354b4e5fa997688f2bcc943f768b44d87df72ea383f586205d4
First Interval Tx: https://robinhoodchain.blockscout.com/tx/0x14e1259131f0ed2519f64f1e48ffb75cbfb9c144e1ff05e5166e4b0d40e305cb

TSLA calendar root: signed with governance leaf 3
Queued Tx: https://robinhoodchain.blockscout.com/tx/0x4eb08e8d739bfea14a43adf35b430daa48ffeb30940c86c7a1048605a53851dd
Executed Tx: https://robinhoodchain.blockscout.com/tx/0xb45900d499c0a1f2cb41903a7d0138c2ee1ba8841d5868fefb4506b85c5d24d7
Activated Tx: https://robinhoodchain.blockscout.com/tx/0xb99ae9eecdd0065fbb6ae851442a5926273b40086082c68504ea5016bdefcc67
First Interval Tx: https://robinhoodchain.blockscout.com/tx/0xd3e7bc9f9493d2638b6c7bd6ade95a2f094faf774cfcf8d6cf4491e58c192231

WHAT IS NOT LIVE YET

No pool uses this layer yet. The governance delay is zero seconds and is fixed in the contract. Independent cryptographic review has not been done. On Mainnet, close anchors and prices are checked against on-chain Chainlink feeds and are not signed with SHRINCS.

The pool contracts deployed in the same run, and every address and result, are on the page: https://www.bellstocks.tech/einstein
