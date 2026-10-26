export type Address = `0x${string}`;
export const TESTNET: { readonly chainId: 46630; readonly contracts: Readonly<Record<string, Address>> };
export interface TestnetStatus {
  chainId: number;
  blockNumber: string;
  blockHash: string;
  blockTimestamp: string;
  contracts: { name: string; address: Address; bytes: number; codeHash: string }[];
  governance: Address;
  guardian: Address;
  treasury: Address;
  serviceRecipient: Address;
  serviceFeeRaw: string;
  feeDecimals: number;
  liquidityMode: number;
  issues: string[];
  executionReady: false;
  wallet: null | { account: Address; nativeRaw: string; wethRaw: string; feeTokenRaw: string; routerNonce: string; factoryNonce: string };
}
export function isUnusableRole(address: string): boolean;
export function readTestnetStatus(
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>,
  options?: { account?: Address; blockTag?: string },
): Promise<TestnetStatus>;
