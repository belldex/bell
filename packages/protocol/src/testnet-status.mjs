import { encodeFunctionData, decodeFunctionResult, keccak256, parseAbi } from 'viem';

// Public addresses only. Kept separate from deployment logs, constructor arguments and secrets.
export const TESTNET = Object.freeze({
  chainId: 46630,
  contracts: Object.freeze({
    safetyController: '0xcc73fc8265630a7b7873028f77584037273d70c2',
    assetRegistry: '0x3b71543bd71b9d4c9678216d338611236a37b380',
    calendarRegistry: '0x0c7a4044f2caf793b2062920c12baf8b33641e9c',
    sessionRegistry: '0x1de6199618ddb2b5fdb869113e4b906628db168e',
    poolManager: '0xc353daf2a37aca96ea468239d973a76020dea059',
    positionManager: '0x9116ff2aa7a41b60b478ae3ecd8b9b0466a97874',
    hookDeployer: '0xff8734ef77284d61e11a27146e939bc0bd8bf10a',
    poolFactory: '0x4b22251105e65d76366d27099ac7c5097b63faf5',
    weth: '0x45b4bf15c1cb91442a62620441dbc0b6486dfebe',
    router: '0x1b91eadba66747430188672bd7bce0cc3eef6c85',
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
