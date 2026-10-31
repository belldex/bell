import {
  formatUnits, parseAbi, parseAbiItem,
  type Abi, type Address,
} from 'viem';
import { makeClients } from './wallet';
import { getActiveWalletProvider, getInjectedWalletProvider } from './wallet-options';
import manifest from '../../../packages/protocol/generated/abi-manifest.json';
import deployment from '../../../evidence/deploy/mainnet-4663.json';
import verification from '../../../evidence/deploy/mainnet-4663-verification.json';

export const MAINNET = {
  chainId: deployment.chainId,
  factory: deployment.poolFactory as Address,
  router: deployment.router as Address,
  weth: deployment.weth as Address,
  assetRegistry: deployment.assetRegistry as Address,
  calendarRegistry: deployment.calendarRegistry as Address,
  sessionRegistry: deployment.sessionRegistry as Address,
  positionManager: deployment.positionManager as Address,
  quoteUrl: 'https://bell-keeper-b.asysyifaq25.workers.dev/quote',
  deploymentBlock: BigInt(verification.blocks.verifiedAtBlock),
} as const;

export const routerAbi = manifest.interfaces.IBellRouter as Abi;
export const hookAbi = manifest.interfaces.IBellHook as Abi;
export const tokenAbi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);

const erc20 = tokenAbi;
const poolCreated = parseAbiItem('event PoolCreated(address indexed hook, bytes32 indexed poolId, bytes32 configHash, address indexed creator, address recipient)');

export type LivePool = {
  hook: Address;
  poolId: `0x${string}`;
  lifecycle: number;
  token0: Address;
  token1: Address;
  asset0: `0x${string}`;
  asset1: `0x${string}`;
  configHash: `0x${string}`;
  poolClass: number;
  liquidityMode: number;
  tickSpacing: number;
  tradeCap: readonly [bigint, bigint];
  windowCap: readonly [bigint, bigint];
  policy: Record<string, unknown> & { canSwap: boolean; mode: number; phase: number; flags: number; lpFeeUnits: number; reasonBits: bigint; effectiveTradeCap: readonly [bigint, bigint]; effectiveWindowCap: readonly [bigint, bigint]; rollingRemaining: readonly [bigint, bigint]; closureRemaining: readonly [bigint, bigint]; validUntil: bigint };
  directoryBlockNumber?: bigint;
  createdAtBlock?: bigint;
  legs: readonly [{ address: Address; symbol: string; decimals: number }, { address: Address; symbol: string; decimals: number }];
};

export async function readLivePools(): Promise<LivePool[]> {
  const url = MAINNET.quoteUrl.replace(/\/quote$/, '/pools');
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error ?? `Pool directory returned HTTP ${response.status}`);
    if (Number(body.chainId) !== MAINNET.chainId || !Array.isArray(body.pools)) throw new Error('Pool directory returned an invalid Mainnet response');
    return body.pools.map((pool: any) => ({
      ...pool,
      lifecycle: Number(pool.lifecycle ?? 2),
      directoryBlockNumber: body.blockNumber === undefined ? undefined : BigInt(body.blockNumber),
      createdAtBlock: pool.createdAtBlock === undefined ? undefined : BigInt(pool.createdAtBlock),
      tradeCap: pool.tradeCap.map(BigInt), windowCap: pool.windowCap.map(BigInt),
      policy: {
        ...pool.policy,
        flags: Number(pool.policy.flags ?? 0),
        reasonBits: BigInt(pool.policy.reasonBits), validUntil: BigInt(pool.policy.validUntil),
        effectiveTradeCap: pool.policy.effectiveTradeCap.map(BigInt),
        effectiveWindowCap: pool.policy.effectiveWindowCap.map(BigInt),
        rollingRemaining: pool.policy.rollingRemaining.map(BigInt),
        closureRemaining: pool.policy.closureRemaining.map(BigInt),
      },
    })) as LivePool[];
  } catch (directoryError) {
    // A connected wallet may provide a working chain RPC even when the public directory index
    // cannot serve historical event logs. Keep the fallback read-only and verify each hook live.
    const provider = getActiveWalletProvider() ?? getInjectedWalletProvider();
    if (!provider) throw directoryError;
    const { publicClient: client } = makeClients(provider);
    if (await client.getChainId() !== MAINNET.chainId) throw directoryError;
    const logs = await client.getLogs({ address: MAINNET.factory, event: poolCreated, fromBlock: MAINNET.deploymentBlock, toBlock: 'latest' });
    const unique = [...new Map(logs.map((log) => [String(log.args.hook).toLowerCase(), log])).values()];
    const directoryBlockNumber = await client.getBlockNumber();
    return Promise.all(unique.map(async (log) => {
      const hook = log.args.hook as Address;
      const [config, policy, state] = await Promise.all([
        client.readContract({ address: hook, abi: hookAbi, functionName: 'config' }) as Promise<any>,
        client.readContract({ address: hook, abi: hookAbi, functionName: 'getPolicy' }) as Promise<any>,
        client.readContract({ address: hook, abi: hookAbi, functionName: 'state' }) as Promise<any>,
      ]);
      const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([
        client.readContract({ address: config.token0, abi: erc20, functionName: 'symbol' }),
        client.readContract({ address: config.token1, abi: erc20, functionName: 'symbol' }),
        client.readContract({ address: config.token0, abi: erc20, functionName: 'decimals' }),
        client.readContract({ address: config.token1, abi: erc20, functionName: 'decimals' }),
      ]);
      return {
        hook, poolId: log.args.poolId as `0x${string}`, lifecycle: Number(state.lifecycle), createdAtBlock: log.blockNumber, directoryBlockNumber, token0: config.token0, token1: config.token1,
        asset0: config.asset0, asset1: config.asset1, configHash: policy.configHash,
        poolClass: Number(config.poolClass), liquidityMode: Number(config.liquidityMode), tickSpacing: Number(config.tickSpacing),
        tradeCap: config.tradeCap, windowCap: config.windowCap,
        policy: { ...policy, canSwap: Boolean(policy.canSwap), mode: Number(policy.mode), phase: Number(policy.phase), lpFeeUnits: Number(policy.lpFeeUnits), reasonBits: BigInt(policy.reasonBits), validUntil: BigInt(policy.validUntil) },
        legs: [{ address: config.token0 as Address, symbol: String(symbol0), decimals: Number(decimals0) }, { address: config.token1 as Address, symbol: String(symbol1), decimals: Number(decimals1) }],
      } as LivePool;
    }));
  }
}

export function oracleUpdate(bundle: any) {
  return {
    assetId: bundle.assetId,
    directSample: Object.fromEntries(Object.entries(bundle.directSample).map(([key, value]) =>
      ['price18', 'observedAt', 'inputAt', 'validFrom', 'expiresAt', 'validUntil', 'phase'].includes(key)
        ? [key, BigInt(value as string)] : [key, value])),
    directSignature: bundle.directSignature,
    reports: bundle.reports,
    closeBoundaryHash: bundle.closeBoundaryHash,
  };
}

export function displayAmount(amount: bigint, decimals: number, digits = 6) {
  const parts = formatUnits(amount, decimals).split('.');
  return parts.length === 1 ? parts[0] : `${parts[0]}.${parts[1].slice(0, digits).replace(/0+$/, '')}`;
}

