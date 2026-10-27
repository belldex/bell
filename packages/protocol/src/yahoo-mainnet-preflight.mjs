import { createPublicClient, http, keccak256 } from 'viem';
import { parseYahooChartQuote } from './yahoo-quote.mjs';
import { buildYahooSourceSample, signYahooSourceSample, signYahooTokenStatus } from './yahoo-attestation.mjs';

const REPORTER_ABI = [
  { type: 'function', name: 'reporter', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'digest', stateMutability: 'view', inputs: [
    { name: 'sourceConfigHash', type: 'bytes32' },
    { name: 'sample', type: 'tuple', components: [
      { name: 'descriptorId', type: 'bytes32' }, { name: 'feedId', type: 'bytes32' }, { name: 'phase', type: 'uint8' },
      { name: 'price18', type: 'uint128' }, { name: 'observedAt', type: 'uint64' }, { name: 'inputAt', type: 'uint64' },
      { name: 'validFrom', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' }, { name: 'validUntil', type: 'uint64' },
      { name: 'reportHash', type: 'bytes32' },
    ] },
  ], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'recoverSigner', stateMutability: 'view', inputs: [
    { name: 'sourceConfigHash', type: 'bytes32' },
    { name: 'sample', type: 'tuple', components: [
      { name: 'descriptorId', type: 'bytes32' }, { name: 'feedId', type: 'bytes32' }, { name: 'phase', type: 'uint8' },
      { name: 'price18', type: 'uint128' }, { name: 'observedAt', type: 'uint64' }, { name: 'inputAt', type: 'uint64' },
      { name: 'validFrom', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' }, { name: 'validUntil', type: 'uint64' },
      { name: 'reportHash', type: 'bytes32' },
    ] },
    { name: 'signature', type: 'bytes' },
  ], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenSnapshotDigest', stateMutability: 'view', inputs: [
    { name: 'token', type: 'address' }, { name: 'multiplier18', type: 'uint128' },
    { name: 'pendingMultiplier18', type: 'uint128' }, { name: 'effectiveAt', type: 'uint64' },
    { name: 'observedAt', type: 'uint64' }, { name: 'oraclePaused', type: 'bool' }, { name: 'codeHash_', type: 'bytes32' },
  ], outputs: [{ type: 'bytes32' }] },
];
const ADAPTER_ABI = [
  { type: 'function', name: 'previewDirect', stateMutability: 'view', inputs: [
    { name: 'sample', type: 'tuple', components: [
      { name: 'descriptorId', type: 'bytes32' }, { name: 'feedId', type: 'bytes32' }, { name: 'phase', type: 'uint8' },
      { name: 'price18', type: 'uint128' }, { name: 'observedAt', type: 'uint64' }, { name: 'inputAt', type: 'uint64' },
      { name: 'validFrom', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' }, { name: 'validUntil', type: 'uint64' },
      { name: 'reportHash', type: 'bytes32' },
    ] }, { name: 'signature', type: 'bytes' },
  ], outputs: [{ type: 'bool' }, { type: 'uint64' }] },
];
export async function preflightYahooMainnet({
  symbol,
  token,
  adapterAddress,
  publicRpcUrl,
  reporterPrivateKey,
  verifierAddress,
  sourceConfigHash,
  expectedReporter,
  expectedReporterCodeHash,
  phaseScope = 0,
  nowSeconds = Math.floor(Date.now() / 1000),
  fetchImpl,
  client: suppliedClient,
}) {
  const ticker = symbol.toUpperCase();
  if (!/^0x[0-9a-f]{40}$/i.test(adapterAddress ?? '')) throw new Error('A deployed Yahoo Mainnet adapter address is required; none is registered in this workspace yet');
  if (!publicRpcUrl || !reporterPrivateKey || !verifierAddress || !sourceConfigHash || !expectedReporter) {
    throw new Error('Mainnet reporter preflight requires RPC, dedicated reporter key, deployed verifier, sourceConfigHash, and expected reporter address');
  }
  const client = suppliedClient ?? createPublicClient({ transport: http(publicRpcUrl) });
  const chainId = await client.getChainId();
  if (chainId !== 4663) throw new Error(`Wrong chain ${chainId}; Mainnet preflight only accepts 4663`);
  const block = await client.getBlock();
  const adapterCode = await client.getBytecode({ address: adapterAddress });
  if (!adapterCode || adapterCode === '0x') throw new Error('YAHOO_ADAPTER_NOT_DEPLOYED');
  const verifierCode = await client.getBytecode({ address: verifierAddress });
  if (!verifierCode || verifierCode === '0x') throw new Error('YAHOO_VERIFIER_NOT_DEPLOYED');
  const verifierCodeHash = keccak256(verifierCode);
  if (expectedReporterCodeHash && verifierCodeHash.toLowerCase() !== expectedReporterCodeHash.toLowerCase()) {
    throw new Error('YAHOO_VERIFIER_CODEHASH_MISMATCH');
  }
  const tokenCode = await client.getBytecode({ address: token });
  if (!tokenCode || tokenCode === '0x') throw new Error('CANONICAL_TOKEN_NOT_DEPLOYED');
  const statusAbi = ['uiMultiplier', 'newUIMultiplier', 'effectiveAt'].map((name) => ({
    type: 'function', name, stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }],
  }));
  statusAbi.push({ type: 'function', name: 'oraclePaused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] });
  const [multiplier, pendingMultiplier, effectiveAtValue, oraclePaused] = phaseScope === 0
    ? await Promise.all(['uiMultiplier', 'newUIMultiplier', 'effectiveAt', 'oraclePaused'].map((functionName) =>
      client.readContract({ address: token, abi: statusAbi, functionName })))
    : [10n ** 18n, 10n ** 18n, 0n, false];

  const quoteUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  quoteUrl.searchParams.set('interval', '1m');
  quoteUrl.searchParams.set('range', '1d');
  const response = await (fetchImpl ?? globalThis.fetch)(quoteUrl, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Yahoo chart HTTP ${response.status}`);
  const quote = parseYahooChartQuote(await response.json(), { symbol: ticker, nowSeconds, maxAgeSeconds: 120 });
  const sample = buildYahooSourceSample(quote, {
    feedId: phaseScope === 0 ? `0x${'00'.repeat(32)}` : undefined,
    phaseScope,
    nowSeconds,
    tokenMultiplier18: multiplier.toString(),
  });
  const signed = await signYahooSourceSample(sample, {
    sourceConfigHash,
    chainId,
    verifier: verifierAddress,
    privateKey: reporterPrivateKey,
  });
  if (signed.reporter.toLowerCase() !== expectedReporter.toLowerCase()) throw new Error('SIGNER_REPORTER_MISMATCH');

  // eth_call only: prove that source verifier, adapter signature/expiry rules and expected block account still accept it.
  const domainDigest = await client.readContract({
    address: verifierAddress,
    abi: REPORTER_ABI,
    functionName: 'digest',
    args: [sourceConfigHash, _soliditySample(sample)],
    blockNumber: block.number,
  });
  const recovered = await client.readContract({
    address: verifierAddress,
    abi: REPORTER_ABI,
    functionName: 'recoverSigner',
    args: [sourceConfigHash, _soliditySample(sample), signed.signature],
    blockNumber: block.number,
  });
  if (recovered.toLowerCase() !== expectedReporter.toLowerCase()) throw new Error('ONCHAIN_RECOVERED_SIGNER_MISMATCH');
  const [adapterValid, validUntil] = await client.readContract({
    address: adapterAddress,
    abi: ADAPTER_ABI,
    functionName: 'previewDirect',
    args: [_soliditySample(sample), signed.signature],
    blockNumber: block.number,
  });
  if (!adapterValid) throw new Error('ADAPTER_REJECTED_REPORT');
  const verify = await client.readContract({
    address: verifierAddress,
    abi: REPORTER_ABI,
    functionName: 'verify',
    args: [sourceConfigHash, _soliditySample(sample), signed.signature],
    blockNumber: block.number,
  });
  if (!verify) throw new Error('VERIFIER_REJECTED_REPORT');

  let tokenCorporateStatus = null;
  if (phaseScope === 0) {
    const statusNow = BigInt(nowSeconds);
    const updatedAt = statusNow;
    const codeHash = keccak256(tokenCode);
    const currentMultiplier = BigInt(multiplier);
    const status = await signYahooTokenStatus({
      token, multiplier18: currentMultiplier, pendingMultiplier18: BigInt(pendingMultiplier),
      effectiveAt: BigInt(effectiveAtValue), observedAt: updatedAt, oraclePaused, codeHash,
    }, { chainId, verifier: verifierAddress, privateKey: reporterPrivateKey });
    const onchainStatusDigest = await client.readContract({
      address: verifierAddress, abi: REPORTER_ABI, functionName: 'tokenSnapshotDigest',
      args: [token, currentMultiplier, BigInt(pendingMultiplier), BigInt(effectiveAtValue), updatedAt, oraclePaused, codeHash],
      blockNumber: block.number,
    });
    if (onchainStatusDigest.toLowerCase() !== status.digest.toLowerCase()) throw new Error('TOKEN_STATUS_DIGEST_MISMATCH');
    const statusRecovered = await client.readContract({
      address: verifierAddress,
      abi: [{ type: 'function', name: 'recoverTokenStatusSigner', stateMutability: 'view', inputs: [
        { name: 'token', type: 'address' }, { name: 'multiplier18', type: 'uint128' },
        { name: 'pendingMultiplier18', type: 'uint128' }, { name: 'effectiveAt', type: 'uint64' },
        { name: 'observedAt', type: 'uint64' }, { name: 'oraclePaused', type: 'bool' },
        { name: 'codeHash_', type: 'bytes32' }, { name: 'signature', type: 'bytes' },
      ], outputs: [{ type: 'address' }] }],
      functionName: 'recoverTokenStatusSigner',
      args: [token, currentMultiplier, BigInt(pendingMultiplier), BigInt(effectiveAtValue), updatedAt, oraclePaused, codeHash, status.signature],
      blockNumber: block.number,
    });
    if (statusRecovered.toLowerCase() !== expectedReporter.toLowerCase()) throw new Error('ONCHAIN_TOKEN_STATUS_SIGNER_MISMATCH');
    tokenCorporateStatus = {
      multiplier18: currentMultiplier.toString(), pendingMultiplier18: BigInt(pendingMultiplier).toString(),
      effectiveAt: BigInt(effectiveAtValue).toString(), oraclePaused, observedAt: updatedAt.toString(), codeHash,
      eip712Digest: status.digest, signerVerifiedOnchain: true,
    };
  }

  return Object.freeze({
    mode: 'MAINNET_READ_ONLY_PREFLIGHT_NO_BROADCAST',
    chainId,
    blockNumber: block.number.toString(),
    blockHash: block.hash,
    symbol: ticker,
    token,
    adapterAddress,
    verifierAddress,
    reporter: signed.reporter,
    recoveredReporter: recovered,
    eip712Digest: domainDigest,
    quotePriceRaw18: quote.priceRaw18,
    quoteObservedAt: quote.observedAt,
    quoteAgeSeconds: quote.ageSeconds,
    tokenMultiplier18: multiplier.toString(),
    tokenCorporateStatus,
    verifierCodeHash,
    sourceConfigHash,
    sample: _serializeSample(sample),
    validUntil: validUntil.toString(),
    adapterAcceptsAtPinnedBlock: adapterValid,
    signatureValidAtPinnedBlock: verify,
    broadcasted: false,
  });
}

function _soliditySample(sample) {
  return {
    descriptorId: sample.descriptorId,
    feedId: sample.feedId,
    phase: sample.phase,
    price18: sample.price18,
    observedAt: sample.observedAt,
    inputAt: sample.inputAt,
    validFrom: sample.validFrom,
    expiresAt: sample.expiresAt,
    validUntil: sample.validUntil,
    reportHash: sample.reportHash,
  };
}

function _serializeSample(sample) {
  return Object.fromEntries(Object.entries(_soliditySample(sample)).map(([key, value]) => [
    key, typeof value === 'bigint' ? value.toString() : value,
  ]));
}
