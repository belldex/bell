/* Everything the Einstein Hooks v2 page states as fact lives here, next to where it comes from:
   evidence/deploy/pq-hooks-mainnet.json, the three pq-hooks-mainnet-calendar-state files, and the Elysium testnet record in
   contracts/pq/deployments. The page test cross-checks the addresses against the manifest. */

export const MAINNET_EXPLORER = "https://robinhoodchain.blockscout.com";
export const TESTNET_EXPLORER = "https://explorer-elysium-testnet.t.conduit.xyz";

export const mainnetTx = (hash: string) => `${MAINNET_EXPLORER}/tx/${hash}`;
export const mainnetAddress = (address: string) => `${MAINNET_EXPLORER}/address/${address}`;
export const testnetTx = (hash: string) => `${TESTNET_EXPLORER}/tx/${hash}`;
export const testnetAddress = (address: string) => `${TESTNET_EXPLORER}/address/${address}`;

/** The governance key holds 4,096 one-time leaves. Three were spent on 14 November 2026, one per calendar root. */
export const LEAF_BUDGET = 4096;
export const SPENT_LEAVES = [
  { leaf: 1, asset: "AAPL", what: "the AAPL calendar root", tx: "0x4db79658537836856024d8a189ef227e027b14c7203f7ca116f4925b8c491351" },
  { leaf: 2, asset: "NVDA", what: "the NVDA calendar root", tx: "0x26363ed094c325ac5721f12c5697191069fdbb466e0ad822cc9746e7e552dcc3" },
  { leaf: 3, asset: "TSLA", what: "the TSLA calendar root", tx: "0x4eb08e8d739bfea14a43adf35b430daa48ffeb30940c86c7a1048605a53851dd" },
] as const;
export const NEXT_LEAF = SPENT_LEAVES.length + 1;

export type Deployed = { name: string; address: string; does: string };

export const MAINNET_CONTRACTS: readonly Deployed[] = [
  { name: "PQKeyRegistry", address: "0x190ca8f13e381d1E58211cc821226EF9161d3a57", does: "Holds one post-quantum key per role and counts every leaf spent." },
  { name: "HybridAuth", address: "0xBaab2DaE7fF472964eD0dac40CAB1e0e795009C7", does: "Checks both signatures before any privileged change goes through." },
  { name: "HashSigVerifier", address: "0x0A02a186b905C9905DbA5Bba53882199821F794e", does: "Hands a signature to the SHRINCS verifier and reads the leaf back." },
  { name: "BellSHRINCSStatefulVerifier", address: "0x0491db4e64856e94E1aD3c33f49C351530B83107", does: "Verifies SHRINCS signatures, from Quip Network's open implementation." },
  { name: "SafetyControllerV2", address: "0x5518541aA2D4b45531d7a2506FA81FFdFb4d505d", does: "Runs pauses and governance calls. Every one needs both signatures." },
  { name: "HybridAssetRegistry", address: "0xb02cD68bCB8D3C624b7E3AfD3a9F48a4C64D9b18", does: "Lists the admitted assets: AAPL, NVDA, TSLA and USDG." },
  { name: "CalendarRegistry", address: "0x77813F7A761bfa5722DC5ee1a6E5b4B849D49003", does: "Stores each asset's market-session calendar, one root per asset and year." },
  { name: "SessionRegistry", address: "0xC8E425140e0967AA07333946444C8A0611058Ae8", does: "Records session closes, checked against on-chain Chainlink feeds." },
  { name: "BellPolicyOracleV2", address: "0xCeE966D7172Cabde8356be41620c6Cf0086c92df", does: "Works out the fee and flow caps a pool applies in each session." },
  { name: "BellModeEvaluator", address: "0x9DBF787172DFBC4eAa4593768ddFD32F84C45882", does: "Decides whether a pool may swap right now." },
  { name: "BellAuctionRegistry", address: "0xE2CE18362eEC0a6f9166348aEbfF06182a183E6a", does: "Links each pool to its opening auction." },
  { name: "BellAuctionFactoryModule", address: "0xC2f0A0231a62B8BF9d679696ebD5806A76063b9d", does: "Creates the opening auction when a pool is created." },
  { name: "BellHookDeployerV3", address: "0xe95e9A0eb5cc6ef7CF20e80d4bdB51538A79102D", does: "Deploys each pool's hook at an address that forbids exit callbacks." },
  { name: "BellPoolFactoryV3", address: "0xF6b38e322Ce6d8F9F836921278e13aE55F525569", does: "Creates a pool and seeds it in one transaction." },
  { name: "BellSwapLensRegistry", address: "0xdbF6f9299Ed0186C0B4a53F66ca251872aFd1dC5", does: "Lets anyone read a pool's swap status in a single call." },
];

export const TESTNET_CONTRACTS: readonly Deployed[] = [
  { name: "BellSHRINCSStatefulVerifier", address: "0x158895a1fBabfA91Cae1264f1D959cBe6b7A4101", does: "The SHRINCS verifier." },
  { name: "HashSigVerifier", address: "0x52f8e77aaDFd1561fDa0Bc362805245ed57d7242", does: "The verifier adapter." },
  { name: "PQKeyRegistry", address: "0xb4C7cFb2F1b58AfE602249E24Ec0476e4F984A14", does: "One key and a leaf counter per role." },
  { name: "HybridAuth", address: "0xBc81138DfC3285287Fa15745524ef2f5A9192dC6", does: "Requires both signatures." },
  { name: "CalendarRegistryV2", address: "0x03C8354AAf83b394Fa39aC74Bf3340Ed1C4cFBD4", does: "Calendar roots, hybrid-signed." },
  { name: "SessionRegistryV2", address: "0x0f6573348C8Ae4fF07542568E765d2e0DcF405bF", does: "Close anchors, hybrid-signed." },
  { name: "PriceAttestationAdapter", address: "0x25FA61A31893C82b5a21BD70d3b2480133F2b019", does: "Price reports, hybrid-signed, with a synthetic test value." },
];

/** Measured on Elysium testnet. */
export const TESTNET_GAS = [
  { what: "Calendar root", gas: 324563, tx: "0xed149c5f89abf0f96bb25e85a15197a94e067a469638d631e09cf22bd1ae3361" },
  { what: "Close anchor", gas: 324662, tx: "0xfbd50be04b372be6e2962c4719f2d499aeb24ba0589d7a683795a99866bc6ad1" },
  { what: "Price attestation", gas: 302554, tx: "0xe773b0a95ae0eb14fcbe655afb484777f0fc583ecfda1bf7e7fe4c43318671a8" },
] as const;

/** Real rejected transactions on Elysium testnet, one per way of breaking the gate. */
export const REJECTION_PROOFS = {
  forgedEcdsa: "0x935e123e249fe60d62fa3094de9e1a8fc2bdce099453d69a062b05fc16353ece",
  reusedLeaf: "0x3bcf5a7d9f0ef7b54ce3fba9efd26bde1d72a97fcc27fb55a5ea8e6d0f0ef30f",
  forgedPq: "0x6b4696d282be4ceb4e5597de7792808ea4bd84285d21f6c5a6890e41d0d75032",
} as const;
