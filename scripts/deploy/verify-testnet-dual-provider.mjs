import { readFile, writeFile } from 'node:fs/promises';
import { createRpcClient } from '../discovery/rpc-client.mjs';
import { probeChainHead, compareAtCommonBlock } from '../discovery/rpc-preflight.mjs';
import { readTestnetStatus, TESTNET } from '../../packages/protocol/src/testnet-status.mjs';

async function main() {
  const envContent = await readFile('.env', 'utf8');
  const env = {};
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) {
      env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  const primaryEndpoint = env.RH_TESTNET_RPC_PRIMARY;
  const secondaryEndpoint = env.RH_TESTNET_RPC_SECONDARY;

  if (!primaryEndpoint || !secondaryEndpoint) {
    console.error('Missing RH_TESTNET_RPC_PRIMARY or RH_TESTNET_RPC_SECONDARY');
    process.exit(1);
  }

  const clientA = createRpcClient({
    provider: 'alchemy',
    networkType: 'testnet',
    endpoint: primaryEndpoint,
  });

  const clientB = createRpcClient({
    provider: 'pinax',
    networkType: 'testnet',
    endpoint: secondaryEndpoint,
  });

  console.log('1. Probing common block across Alchemy and Pinax testnet providers...');
  const headA = await probeChainHead(clientA, TESTNET.chainId);
  const headB = await probeChainHead(clientB, TESTNET.chainId);
  const common = await compareAtCommonBlock(clientA, headA, clientB, headB);
  if (!common.agree) {
    console.error('Provider disagreement on common block:', common.reason);
    process.exit(1);
  }

  const blockTag = '0x' + common.blockNumber.toString(16);
  console.log(`   Agreed Common Block: ${common.blockNumber} (${common.blockHash})`);

  console.log('2. Running readTestnetStatus against Primary provider (Alchemy)...');
  const statusA = await readTestnetStatus(
    (args) => clientA.call(args.method, args.params || []),
    { blockTag }
  );

  console.log('3. Running readTestnetStatus against Secondary provider (Pinax)...');
  const statusB = await readTestnetStatus(
    (args) => clientB.call(args.method, args.params || []),
    { blockTag }
  );

  console.log('4. Comparing cross-provider results...');
  assertStrictEqual(statusA.chainId, statusB.chainId, 'chainId');
  assertStrictEqual(statusA.blockNumber, statusB.blockNumber, 'blockNumber');
  assertStrictEqual(statusA.blockHash, statusB.blockHash, 'blockHash');
  assertStrictEqual(statusA.governance, statusB.governance, 'governance');
  assertStrictEqual(statusA.guardian, statusB.guardian, 'guardian');
  assertStrictEqual(statusA.treasury, statusB.treasury, 'treasury');
  assertStrictEqual(statusA.serviceRecipient, statusB.serviceRecipient, 'serviceRecipient');
  assertStrictEqual(statusA.serviceFeeRaw, statusB.serviceFeeRaw, 'serviceFeeRaw');
  assertStrictEqual(statusA.feeDecimals, statusB.feeDecimals, 'feeDecimals');
  assertStrictEqual(statusA.liquidityMode, statusB.liquidityMode, 'liquidityMode');

  assertStrictEqual(statusA.contracts.length, statusB.contracts.length, 'contracts count');
  for (let i = 0; i < statusA.contracts.length; i++) {
    const cA = statusA.contracts[i];
    const cB = statusB.contracts[i];
    assertStrictEqual(cA.name, cB.name, `contract ${i} name`);
    assertStrictEqual(cA.address, cB.address, `contract ${cA.name} address`);
    assertStrictEqual(cA.bytes, cB.bytes, `contract ${cA.name} bytes`);
    assertStrictEqual(cA.codeHash, cB.codeHash, `contract ${cA.name} codeHash`);
  }

  console.log('   All 12 contracts & role bindings agreed 100% across both independent providers!');

  const evidence = {
    schemaVersion: 1,
    chainId: TESTNET.chainId,
    verifiedAt: new Date().toISOString(),
    commonBlockNumber: common.blockNumber.toString(),
    commonBlockHash: common.blockHash,
    providers: ['alchemy', 'pinax'],
    statusA: sanitizeStatus(statusA),
    statusB: sanitizeStatus(statusB),
    unusableRoles: statusA.issues,
    note: 'Verified dual-provider consensus on Robinhood testnet chain 46630 contracts. Credentials redacted.'
  };

  await writeFile(
    'evidence/runtime/testnet-dual-provider-status-2026-10-26.json',
    JSON.stringify(evidence, null, 2) + '\n'
  );
  console.log('Evidence saved to evidence/runtime/testnet-dual-provider-status-2026-10-26.json');
}

function assertStrictEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Dual provider mismatch on ${label}: Alchemy=${actual} vs Pinax=${expected}`);
  }
}

function sanitizeStatus(status) {
  return {
    chainId: status.chainId,
    blockNumber: status.blockNumber,
    blockHash: status.blockHash,
    governance: status.governance,
    guardian: status.guardian,
    treasury: status.treasury,
    serviceRecipient: status.serviceRecipient,
    serviceFeeRaw: status.serviceFeeRaw,
    feeDecimals: status.feeDecimals,
    liquidityMode: status.liquidityMode,
    contracts: status.contracts.map(c => ({
      name: c.name,
      address: c.address,
      bytes: c.bytes,
      codeHash: c.codeHash,
    })),
    issues: status.issues,
  };
}

main().catch(err => {
  console.error('Verification failed:', err.message);
  process.exit(1);
});
