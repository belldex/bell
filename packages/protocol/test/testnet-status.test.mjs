import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, parseAbiParameters, decodeFunctionData, parseAbi } from 'viem';
import { TESTNET, readTestnetStatus, isUnusableRole } from '../src/testnet-status.mjs';

test('isUnusableRole identifies zero/dead addresses', () => {
  assert.equal(isUnusableRole('0x0000000000000000000000000000000000000000'), true);
  assert.equal(isUnusableRole('0x0000000000000000000000000000000000000001'), true);
  assert.equal(isUnusableRole('0x000000000000000000000000000000000000dead'), true);
  assert.equal(isUnusableRole('0x6C3659988bd5f9E94F927B3FD7d0Ee3746f8d399'), false);
});

test('readTestnetStatus rejects wrong chainId', async () => {
  const mockRequest = async ({ method }) => {
    if (method === 'eth_chainId') return '0x1';
    throw new Error('unexpected call');
  };
  await assert.rejects(
    () => readTestnetStatus(mockRequest),
    /WRONG_CHAIN/
  );
});

test('readTestnetStatus parses valid block-pinned testnet status', async () => {
  const encAddr = (a) => encodeAbiParameters(parseAbiParameters('address'), [a]);
  const encUint = (u) => encodeAbiParameters(parseAbiParameters('uint256'), [BigInt(u)]);

  const abi = parseAbi([
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

  const mockRequest = async ({ method, params }) => {
    if (method === 'eth_chainId') return '0xb626'; // 46630
    if (method === 'eth_getBlockByNumber') {
      return {
        number: '0x100',
        hash: '0x' + 'aa'.repeat(32),
        timestamp: '0x65432100'
      };
    }
    if (method === 'eth_getCode') {
      return '0x6080604052';
    }
    if (method === 'eth_getBalance') {
      return '0xde0b6b3a7640000'; // 1 ETH
    }
    if (method === 'eth_call') {
      const { to, data } = params[0];
      const decoded = decodeFunctionData({ abi, data });
      const fn = decoded.functionName;

      if (fn === 'poolManager') return encAddr(TESTNET.contracts.poolManager);
      if (fn === 'canonicalWeth' || fn === 'WETH9') return encAddr(TESTNET.contracts.weth);
      if (fn === 'permit2') return encAddr(TESTNET.contracts.permit2);
      if (fn === 'hookDeployer') return encAddr(TESTNET.contracts.hookDeployer);
      if (fn === 'positionManager') return encAddr(TESTNET.contracts.positionManager);
      if (fn === 'serviceToken') return encAddr(TESTNET.contracts.feeToken);
      if (fn === 'serviceRecipient') return encAddr('0x58cd82a008cb9a6c0c605991b40a09bd6aa1a6fc');
      if (fn === 'serviceFee') return encUint(49000000);
      if (fn === 'liquidityMode') return encUint(0);
      if (fn === 'factory') return encAddr(TESTNET.contracts.poolFactory);
      if (fn === 'assetRegistry') return encAddr(TESTNET.contracts.assetRegistry);
      if (fn === 'calendarRegistry') return encAddr(TESTNET.contracts.calendarRegistry);
      if (fn === 'sessionRegistry') return encAddr(TESTNET.contracts.sessionRegistry);
      if (fn === 'safetyController') return encAddr(TESTNET.contracts.safetyController);
      if (fn === 'governance') return encAddr('0x6C3659988bd5f9E94F927B3FD7d0Ee3746f8d399');
      if (fn === 'guardian') return encAddr('0x58Cd82a008cB9a6c0c605991b40a09BD6aa1a6fC');
      if (fn === 'treasury') return encAddr('0x000000000000000000000000000000000000dead');
      if (fn === 'decimals') {
        if (to === TESTNET.contracts.feeToken) return encUint(6);
        return encUint(18);
      }
      if (fn === 'balanceOf') return encUint(1000000);
      if (fn === 'nonces') return encUint(0);
      return encUint(0);
    }
    throw new Error(`Unexpected mock method ${method}`);
  };

  const status = await readTestnetStatus(mockRequest, {
    account: '0x6C3659988bd5f9E94F927B3FD7d0Ee3746f8d399'
  });

  assert.equal(status.chainId, 46630);
  assert.equal(status.blockNumber, '256');
  assert.equal(status.contracts.length, 12);
  assert.equal(status.feeDecimals, 6);
  assert.ok(status.issues.includes('UNUSABLE_ROLE_ADDRESS'), 'flags treasury dead address');
  assert.equal(status.wallet.account, '0x6C3659988bd5f9E94F927B3FD7d0Ee3746f8d399');
});
