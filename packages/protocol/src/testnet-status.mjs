import { encodeFunctionData, decodeFunctionResult, keccak256, parseAbi } from 'viem';

// Public addresses only. Kept separate from deployment logs, constructor arguments and secrets.
export const TESTNET = Object.freeze({
  chainId: 46630,
  contracts: Object.freeze({
    safetyController: '0x47ac35f7edbc35b7e03c7c069e45a8f8113b7ee5',
    assetRegistry: '0x4d477a439b127fcac45bbbbd535ba9b0d0345488',
    calendarRegistry: '0xc59abadcb3c46d20a9638d986d5bfb5f59247cbd',
    sessionRegistry: '0xc54eb072f6322c0b7d869123bf226564cf302fdf',
    poolManager: '0x4ddb8673ad90d4d3508c61531a981bc1f22a850b',
    positionManager: '0xd7b88b6769b0a1aab9a63089bf6a01fa3dc6e254',
    hookDeployer: '0xbc985ec03935363d755506eed26fbd13c6a3c577',
    poolFactory: '0xbf77c974a61d0ee270a468ffcf49dfcb3fb3a86c',
    weth: '0x7bb4d894a9498c46abdb20e0adc6a08506d62fb9',
    router: '0xf5427ca12727aa85e2659df939d16ef0862944c7',
    feeToken: '0xe683f39fbaf9ced50c0ac2fd56c2032c58d82150',
    permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3',
  }),
});

const ABI = parseAbi([
  'function poolManager() view returns (address)',
  'function canonicalWeth() view returns (address)',
  'function WETH9() view returns (address)',
  'function permit2() view returns (address)',
  'function hookDeployer() view returns (address)',
  'function positionManager() view returns (address)',
  'function serviceToken() view returns (address)',
  'function serviceRecipient() view returns (address)',
  'function serviceFee() view returns (uint128)',
  'function liquidityMode() view returns (uint8)',
  'function factory() view returns (address)',
  'function assetRegistry() view returns (address)',
  'function calendarRegistry() view returns (address)',
  'function sessionRegistry() view returns (address)',
  'function safetyController() view returns (address)',
  'function governance() view returns (address)',
  'function guardian() view returns (address)',
  'function treasury() view returns (address)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function nonces(address) view returns (uint64)',
]);

const bindings = [
  ['router', 'poolManager', 'poolManager'], ['router', 'canonicalWeth', 'weth'],
  ['positionManager', 'poolManager', 'poolManager'], ['positionManager', 'WETH9', 'weth'],
  ['positionManager', 'permit2', 'permit2'], ['poolFactory', 'hookDeployer', 'hookDeployer'],
  ['poolFactory', 'positionManager', 'positionManager'], ['poolFactory', 'serviceToken', 'feeToken'],
  ['hookDeployer', 'factory', 'poolFactory'], ['hookDeployer', 'sessionRegistry', 'sessionRegistry'],
  ['sessionRegistry', 'assetRegistry', 'assetRegistry'], ['sessionRegistry', 'calendarRegistry', 'calendarRegistry'],
  ['assetRegistry', 'safetyController', 'safetyController'], ['calendarRegistry', 'safetyController', 'safetyController'],
];

export function isUnusableRole(address) {
  return /^0x0{36}(0000|0001|0002|dead)$/i.test(address);
}

/** All state reads use one block. No transaction/signature method is called. */
export async function readTestnetStatus(request, { account, blockTag = 'latest' } = {}) {
  if (Number(BigInt(await request({ method: 'eth_chainId' }))) !== TESTNET.chainId) throw new Error('WRONG_CHAIN');
  if (account && !/^0x[0-9a-f]{40}$/i.test(account)) throw new Error('INVALID_ACCOUNT');
  const block = await request({ method: 'eth_getBlockByNumber', params: [blockTag, false] });
  if (!block?.hash || !block?.number) throw new Error('BLOCK_UNAVAILABLE');
  const tag = block.number;
  const read = async (name, functionName, args = []) => {
    const data = encodeFunctionData({ abi: ABI, functionName, args });
    const result = await request({ method: 'eth_call', params: [{ to: TESTNET.contracts[name], data }, tag] });
    return decodeFunctionResult({ abi: ABI, functionName, data: result });
  };
  const contracts = [];
  // Bounded sequential requests avoid overwhelming an injected wallet/provider.
  for (const [name, address] of Object.entries(TESTNET.contracts)) {
    const code = await request({ method: 'eth_getCode', params: [address, tag] });
    if (!/^0x(?:[0-9a-f]{2})+$/i.test(code ?? '')) throw new Error(`CODE_MISSING:${name}`);
    contracts.push({ name, address, bytes: (code.length - 2) / 2, codeHash: keccak256(code) });
  }
  for (const [name, method, expected] of bindings) {
    if ((await read(name, method)).toLowerCase() !== TESTNET.contracts[expected]) throw new Error(`BINDING_MISMATCH:${name}.${method}`);
  }
  const governance = await read('safetyController', 'governance');
  const guardian = await read('safetyController', 'guardian');
  const treasury = await read('safetyController', 'treasury');
  const issues = [];
  if ([governance, guardian, treasury].some(isUnusableRole)) issues.push('UNUSABLE_ROLE_ADDRESS');
  if (new Set([governance, guardian, treasury].map(x => x.toLowerCase())).size !== 3) issues.push('ROLE_COLLISION');
  const serviceFeeRaw = (await read('poolFactory', 'serviceFee')).toString();
  const feeDecimals = Number(await read('feeToken', 'decimals'));
  const wethDecimals = Number(await read('weth', 'decimals'));
  if (feeDecimals > 18 || wethDecimals !== 18) throw new Error('TOKEN_DECIMALS_MISMATCH');
  const serviceRecipient = await read('poolFactory', 'serviceRecipient');
  const liquidityMode = Number(await read('poolFactory', 'liquidityMode'));
  let wallet = null;
  if (account) {
    wallet = {
      account,
      nativeRaw: BigInt(await request({ method: 'eth_getBalance', params: [account, tag] })).toString(),
      wethRaw: (await read('weth', 'balanceOf', [account])).toString(),
      feeTokenRaw: (await read('feeToken', 'balanceOf', [account])).toString(),
      routerNonce: (await read('router', 'nonces', [account])).toString(),
      factoryNonce: (await read('poolFactory', 'nonces', [account])).toString(),
    };
  }
  const end = await request({ method: 'eth_getBlockByNumber', params: [tag, false] });
  if (end?.hash !== block.hash) throw new Error('BLOCK_REORG');
  if (Number(BigInt(await request({ method: 'eth_chainId' }))) !== TESTNET.chainId) throw new Error('CHAIN_CHANGED');
  return {
    chainId: TESTNET.chainId, blockNumber: BigInt(tag).toString(), blockHash: block.hash,
    blockTimestamp: BigInt(block.timestamp).toString(), contracts, governance, guardian, treasury,
    serviceRecipient, serviceFeeRaw, feeDecimals, liquidityMode, issues, wallet,
    executionReady: false,
  };
}
