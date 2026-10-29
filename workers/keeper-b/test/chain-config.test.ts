import { describe, expect, it, vi } from 'vitest';

/**
 * The keeper used to hardcode testnet 46630 and RH_TESTNET_RPC_PRIMARY. That made a mainnet
 * deployment unpublishable no matter how the vars were set: every tick returned
 * "wrong chain 4663" before it ever read a contract.
 *
 * These tests exercise the configuration surface without touching the network. viem is mocked so
 * the client reports whatever chain id the test chooses.
 */
const rpcUrl = vi.hoisted(() => ({ value: '' }));

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: (config) => {
      rpcUrl.value = config.transport?.url ?? String(config.transport ?? '');
      return {
        getChainId: async () => Number(globalThis.__bellTestChainId ?? 46630),
        readContract: async () => {
          throw new Error('readContract must not be reached in these tests');
        },
      };
    },
    createWalletClient: () => ({ writeContract: async () => '0x' }),
    http: (url) => ({ url }),
  };
});

const { runTick } = await import('../src/index');

const BASE_ENV = {
  YAHOO_REPORTER_PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  BELL_STOCK_ASSET_ID: `0x${'11'.repeat(32)}`,
  BELL_CALENDAR_REGISTRY: '0x00000000000000000000000000000000000000a1',
  BELL_SESSION_REGISTRY: '0x00000000000000000000000000000000000000a2',
  BELL_DIRECT_ADAPTER: '0x00000000000000000000000000000000000000a3',
  BELL_DIRECT_WIRE_HASH: `0x${'22'.repeat(32)}`,
  YAHOO_SOURCE_VERIFIER_ADDRESS: '0x00000000000000000000000000000000000000a4',
};

function setChain(chainId) {
  globalThis.__bellTestChainId = chainId;
}

describe('keeper chain and RPC configuration', () => {
  /**
   * Reaching the contract read is exactly the proof we want: the chain guard passed. Before the
   * fix, chain 4663 returned "wrong chain" and never got this far.
   */
  async function expectReachedContractRead(env) {
    let message = null;
    try {
      await runTick(env, { nowSeconds: 1_800_000_000 });
    } catch (error) {
      message = String(error?.message ?? error);
    }
    expect(message).toBe('readContract must not be reached in these tests');
  }

  it('defaults the expected chain to testnet so an existing deployment is unchanged', async () => {
    setChain(46630);
    await expectReachedContractRead({ ...BASE_ENV, BELL_RPC_URL: 'https://rpc.test' });
  });

  it('accepts chain 4663 when BELL_EXPECTED_CHAIN_ID says so', async () => {
    setChain(4663);
    await expectReachedContractRead({
      ...BASE_ENV,
      BELL_RPC_URL: 'https://rpc.test',
      BELL_EXPECTED_CHAIN_ID: '4663',
    });
  });

  it('still rejects a chain that does not match the configured expectation', async () => {
    setChain(4663);
    const result = await runTick(
      { ...BASE_ENV, BELL_RPC_URL: 'https://rpc.test', BELL_EXPECTED_CHAIN_ID: '46630' },
      { nowSeconds: 1_800_000_000 },
    );
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/wrong chain 4663, expected 46630/);
  });

  it('prefers BELL_RPC_URL over the legacy testnet variable', async () => {
    setChain(46630);
    rpcUrl.value = '';
    await expectReachedContractRead({
      ...BASE_ENV,
      BELL_RPC_URL: 'https://rpc.mainnet',
      RH_TESTNET_RPC_PRIMARY: 'https://rpc.testnet',
    });
    expect(rpcUrl.value).toBe('https://rpc.mainnet');
  });

  it('falls back to the legacy testnet variable when BELL_RPC_URL is absent', async () => {
    setChain(46630);
    rpcUrl.value = '';
    await expectReachedContractRead({ ...BASE_ENV, RH_TESTNET_RPC_PRIMARY: 'https://rpc.testnet' });
    expect(rpcUrl.value).toBe('https://rpc.testnet');
  });

  it('skips cleanly when no RPC is configured at all', async () => {
    const result = await runTick({ ...BASE_ENV }, { nowSeconds: 1_800_000_000 });
    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/BELL_RPC_URL is not configured/);
  });
});
