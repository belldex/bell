import { bellFee } from '../src/fee-policy.mjs';
import { FlowBudget } from '../src/flow-budget.mjs';
import { ClosureBudget } from '../src/closure-budget.mjs';
import { parseUnits, formatUnits } from '../src/amounts.mjs';
import { isWithinPriceBand } from '../src/wide-price.mjs';
import { validatePolicyConfig } from '../src/policy-config.mjs';
import { evaluateActiveSample } from '../src/freshness.mjs';
import { inspectCandidateManifest } from '../src/source-manifest.mjs';
import policy from '../../../config/policy/policy-v1.json' with { type: 'json' };
import candidateManifest from '../../../config/assets/candidates.mainnet.json' with { type: 'json' };
import { planBoundedLogRanges } from '../src/log-planner.mjs';
import { buildReferencePolicy } from '../src/reference-policy.mjs';
import vector from '../../test-vectors/runtime-compat.json' with { type: 'json' };
import { SessionReportLedger } from '../src/report-ledger.mjs';
import { normalizeUnderlyingWithMultiplier } from '../src/price-source.mjs';
import { evaluateSourceRights } from '../src/source-rights.mjs';
import { hashCalendarLeaf } from '../../protocol/src/calendar.mjs';
import { canonicalTokenId } from '../../protocol/src/identity.mjs';
import { encodeSourceWires } from '../../protocol/src/source-codec.mjs';
import { encodeSwapRequest } from '../../protocol/src/swap-codec.mjs';
import { deriveUiState, UI_STATES } from '../src/ui-state.mjs';
import { planTick } from '../src/scheduler.mjs';
import { planIngest, projectFinality } from '../src/indexing.mjs';

// Deno-specific smoke test; Node's automatic test discovery intentionally excludes this file.

Deno.test('shared policy code behaves identically in Deno', () => {
  if (bellFee(500, 150) !== 5250) throw new Error('fee vector mismatch');
  const flow = new FlowBudget({ tradeCap: [100n, 100n], windowCap: [200n, 200n] });
  if (!flow.consume(1, -100n, 100n, 'REGULAR')) throw new Error('flow vector mismatch');
  const closure = new ClosureBudget([100n, 100n], 1);
  if (closure.enterPlannedClosure() !== 1n || !closure.consume(1n, 1n)) throw new Error('closure vector mismatch');
  if (formatUnits(parseUnits('1.25', 2), 2) !== '1.25') throw new Error('amount vector mismatch');
  if (!isWithinPriceBand(1n << 96n, 10n ** 18n, 10n ** 18n, 18, 18, 200)) throw new Error('price vector mismatch');
  if (!evaluateActiveSample({ phase: 'REGULAR', price18: 1n, observedAt: 100, inputAt: 100, validFrom: 90, expiresAt: 200 }, 110, 250).healthy) throw new Error('freshness vector mismatch');
});

Deno.test('policy constants validate in Deno without Node-only imports', () => {
  if (!validatePolicyConfig(policy)) throw new Error('policy validation mismatch');
});

Deno.test('documented source metadata remains unadmitted in Deno until evidence exists', () => {
  const result = inspectCandidateManifest(candidateManifest);
  if (!result.valid || result.admitted.length !== 0 || result.candidates.length !== 3) {
    throw new Error('source admission vector mismatch');
  }
});

Deno.test('bounded indexer log planner is runtime-neutral', () => {
  const plan = planBoundedLogRanges([{ id: 'project', fromBlock: 1n, toBlock: 10n }]);
  if (!plan.complete || plan.calls.length !== 1) throw new Error('log planner vector mismatch');
});

Deno.test('Deno matches the shared runtime compatibility vector', () => {
  if (bellFee(vector.fee.baseSessionFee, vector.fee.bellElapsedSeconds) !== vector.fee.expectedFeeUnits) throw new Error('fee vector mismatch');
  if (parseUnits(vector.amount.display, vector.amount.decimals).toString() !== vector.amount.expectedRaw) throw new Error('amount vector mismatch');
});

Deno.test('reference policy remains runtime-neutral and class-aware', () => {
  const result = buildReferencePolicy({ poolClass: 'SESSION_ONLY', now: 1, stock: { mode: 'CLOSED' }, quote: null });
  if (result.canPriceGuard || result.reference !== null) throw new Error('SESSION_ONLY reference vector mismatch');
});

Deno.test('atomic source report ledger runs in Deno', () => {
  const ledger = new SessionReportLedger();
  const result = ledger.submitBatch([{ feedId: `0x${'1'.repeat(64)}`, reportHash: `0x${'2'.repeat(64)}`, observedAt: 100, phase: 2, encodedBytes: 100 }], 101);
  if (!result.accepted) throw new Error('report ledger vector mismatch');
});

Deno.test('Deno normalizes underlying prices and applies multiplier once', () => {
  if (normalizeUnderlyingWithMultiplier(10n * 10n ** 18n, 2n * 10n ** 18n) !== 20n * 10n ** 18n) {
    throw new Error('price normalization vector mismatch');
  }
});

Deno.test('source rights stay closed when only public metadata is known', () => {
  const rights = evaluateSourceRights({
    discoveryMetadataPublic: true,
    reportEntitlementA: 'NOT_VERIFIED',
    reportEntitlementB: 'NOT_VERIFIED',
    internalProcessing: 'NOT_VERIFIED',
    encryptedBackup: 'NOT_VERIFIED',
    rawReportRedistribution: 'NOT_ALLOWED',
    derivedCustomerProduct: 'NOT_VERIFIED',
  });
  if (rights.keeperA || rights.keeperB || rights.exposeRawReports || rights.sellDerivedData) throw new Error('rights fail-closed vector mismatch');
});

Deno.test('Deno matches the shared Calendar leaf ABI/Keccak vector', () => {
  const item = vector.calendarLeaf;
  const hash = hashCalendarLeaf({ ...item, chainId: BigInt(item.chainId), start: BigInt(item.start), end: BigInt(item.end) });
  if (hash !== item.expectedHash) throw new Error('calendar leaf hash vector mismatch');
});

Deno.test('Deno matches the canonical token ID vector', () => {
  if (canonicalTokenId(BigInt(vector.canonicalToken.chainId), vector.canonicalToken.address) !== vector.canonicalToken.expectedId) {
    throw new Error('canonical token ID vector mismatch');
  }
});

Deno.test('Deno matches the shared SourceWire ABI encoding vector', () => {
  if (encodeSourceWires([vector.sourceWire]) !== vector.sourceWireEncoded) throw new Error('SourceWire encoding vector mismatch');
});

Deno.test('Deno matches the shared SwapRequest ABI encoding vector', () => {
  if (encodeSwapRequest(vector.swapRequest) !== vector.swapRequestEncoded) throw new Error('SwapRequest encoding vector mismatch');
});

Deno.test('Deno encodes PUBLIC LP transactions identically to the Node vector', async () => {
  const { buildPublicLpTransaction } = await import('../../protocol/src/lp-codec.mjs');
  const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
  const request = {
    operation: 'increase', account: addr(10), positionManager: addr(20), recipient: addr(11),
    tokenId: '9007199254740993', liquidity: '100000', amountMax: ['1000', '2000'],
    currency0: addr(30), currency1: addr(40), now: '10000', deadline: '10120',
  };
  const tx = buildPublicLpTransaction(request);
  const lpVector = vector.publicLpIncrease as { to: string; value: string; data: string };
  if (tx.to !== lpVector.to || tx.value !== 0n) throw new Error('LP tx envelope mismatch');
  if (tx.data !== lpVector.data) throw new Error('LP calldata byte mismatch');
});

Deno.test('Deno round-trips the CreateRequest ABI vector', async () => {
  const { encodeCreateRequest, decodeCreateRequest } = await import('../../protocol/src/create-codec.mjs');
  const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
  const request = {
    config: {
      token0: addr(1), token1: addr(2), asset0: `0x${'a'.repeat(64)}`, asset1: `0x${'b'.repeat(64)}`,
      poolManager: addr(3), positionManager: addr(4), factory: addr(5), assetRegistry: addr(6),
      calendarRegistry: addr(7), safetyController: addr(8), treasuryAdapter: addr(9),
      poolClass: 0, liquidityMode: 0, referenceMode: 0, tickSpacing: 60,
      tradeCap: ['1000', '2000'], windowCap: ['4000', '8000'], closureCap: ['500', '1000'],
      policyId: `0x${'c'.repeat(64)}`,
    },
    salt: `0x${'d'.repeat(64)}`, nonce: '7', deadline: '1790000000', recipient: addr(10),
    sqrtPriceX96: '79228162514264337593543950336', tickLower: -120, tickUpper: 120,
    liquidity: '100000', amountMax: ['9007199254740993', '9007199254740994'], maxServiceFee: '490000000',
  };
  const roundtripped = decodeCreateRequest(encodeCreateRequest(request));
  if (JSON.stringify(roundtripped) !== JSON.stringify(request)) throw new Error('create codec round-trip mismatch');
  let rejected = false;
  try { encodeCreateRequest({ ...request, liquidity: 100000 }); } catch { rejected = true; }
  if (!rejected) throw new Error('create codec unsafe-amount rejection mismatch');
});
