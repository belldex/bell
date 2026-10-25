import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { validatePolicyConfig } from '../../packages/domain/src/policy-config.mjs';

export function renderPolicyConstants(policy) {
  validatePolicyConfig(policy);
  const rows = [];
  const add = (name, value, type = 'uint32') => rows.push(`    ${type} internal constant ${name} = ${value};`);

  for (const [phase, value] of Object.entries(policy.sessions.phase)) add(`PHASE_${phase}`, value, 'uint8');
  for (const [session, fee] of Object.entries(policy.fees.session)) add(`FEE_${session}`, fee, 'uint24');
  add('BELL_DURATION_SECONDS', policy.fees.bell.durationSeconds);
  add('BELL_MAXIMUM_FEE_UNITS', policy.fees.bell.maximumFeeUnits, 'uint24');
  add('CORPORATE_MINIMUM_FEE_UNITS', policy.fees.corporate.minimumFeeUnits, 'uint24');
  add('CORPORATE_DURATION_SECONDS', policy.fees.corporate.durationSeconds);
  add('REPRICING_MINIMUM_FEE_UNITS', policy.fees.repricingMinimumFeeUnits, 'uint24');
  add('MAX_REPORT_AGE_SECONDS', policy.freshness.reportAgeSeconds);
  for (const [phase, age] of Object.entries(policy.freshness.inputAgeSeconds)) add(`MAX_INPUT_AGE_${phase}_SECONDS`, age);
  add('MAX_DIRECT_PRICE_AGE_SECONDS', policy.freshness.directPriceMaximumAgeSeconds);
  add('MAX_QUOTE_AGE_SECONDS', policy.freshness.quoteMaximumAgeSeconds);
  add('OFFICIAL_HEARTBEAT_CAP_SECONDS', policy.freshness.officialHeartbeatCapSeconds);
  add('MAX_CROSS_SOURCE_DEVIATION_BPS', policy.freshness.maximumCrossSourceDeviationBps, 'uint16');
  add('CLOSE_CAPTURE_WINDOW_SECONDS', policy.closure.captureWindowSeconds);
  add('MAX_ANCHOR_AGE_SECONDS', policy.closure.maximumAnchorAgeSeconds);
  add('REOPEN_MINIMUM_SEPARATION_SECONDS', policy.closure.reopenMinimumSeparationSeconds);
  add('ACTIVE_BAND_BPS', policy.price.activeBandBps, 'uint16');
  add('FROZEN_STOCK_BAND_BPS', policy.price.frozenStockBandBps, 'uint16');
  add('NORMALIZED_PRICE_DECIMALS', policy.price.normalizedPriceDecimals, 'uint8');
  add('MAX_TOKEN_DECIMALS', policy.price.maximumTokenDecimals, 'uint8');
  add('PRICE_COMPARISON_WIDTH_BITS', policy.price.comparisonWidthBits, 'uint16');
  add('ROLLING_WINDOW_SECONDS', policy.budgets.rollingWindowSeconds);
  add('MAX_CLOSURE_TIMES_TRADE_CAP', policy.budgets.maximumClosureTimesTradeCap, 'uint8');
  add('MAX_CLOSURE_SEED_FRACTION_DENOMINATOR', policy.budgets.maximumClosureSeedFractionDenominator, 'uint8');
  for (const [session, factors] of Object.entries(policy.budgets.sessionFactors)) {
    for (const key of ['tradeNumerator', 'tradeDenominator', 'windowNumerator', 'windowDenominator']) {
      add(`${session}_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`, factors[key], 'uint8');
    }
  }
  add('GUARD_TRADE_NUMERATOR', policy.budgets.guardMinimum.tradeNumerator, 'uint8');
  add('GUARD_TRADE_DENOMINATOR', policy.budgets.guardMinimum.tradeDenominator, 'uint8');
  add('GUARD_WINDOW_NUMERATOR', policy.budgets.guardMinimum.windowNumerator, 'uint8');
  add('GUARD_WINDOW_DENOMINATOR', policy.budgets.guardMinimum.windowDenominator, 'uint8');
  add('MAX_STOCKS_PER_POOL', policy.bounds.maxStocksPerPool, 'uint8');
  add('MAX_REPORTS_PER_BATCH', policy.bounds.maxReports, 'uint8');
  add('MAX_REPORT_BYTES', policy.bounds.maxReportBytes, 'uint32');
  add('MAX_REPORT_BATCH_BYTES', policy.bounds.maxBatchBytes, 'uint32');
  add('MAX_SOURCE_WIRES_PER_ASSET', policy.bounds.maxSourceWiresPerAsset, 'uint8');
  add('MAX_SOURCE_RETURN_BYTES', policy.bounds.maxSourceReturnBytes, 'uint16');
  add('MAX_STATIC_CALL_GAS', policy.bounds.maxStaticCallGas, 'uint32');
  add('MAX_MERKLE_PROOF_NODES', policy.bounds.maxMerkleProofNodes, 'uint8');
  add('GOVERNANCE_MINIMUM_DELAY_SECONDS', policy.bounds.governanceMinimumDelaySeconds);
  add('CALENDAR_PUBLICATION_LEAD_SECONDS', policy.bounds.calendarPublicationLeadSeconds);
  add('GOVERNANCE_OPERATION_EXPIRY_SECONDS', policy.bounds.governanceOperationExpirySeconds);
  add('MAX_QUOTE_EXPIRY_SECONDS', policy.transactions.quoteExpiryMaximumSeconds, 'uint8');
  add('MAX_TRANSACTION_DEADLINE_SECONDS', policy.transactions.deadlineMaximumSeconds, 'uint16');

  return [
    '// SPDX-License-Identifier: MIT',
    'pragma solidity 0.8.26;',
    '',
    '// Generated from config/policy/policy-v1.json; do not edit by hand.',
    'library PolicyConstants {',
    ...rows,
    '}',
    '',
  ].join('\n');
}

export async function generatePolicyConstants() {
  const policy = JSON.parse(await readFile(new URL('../../config/policy/policy-v1.json', import.meta.url), 'utf8'));
  const output = renderPolicyConstants(policy);
  const destination = new URL('../../contracts/src/libraries/PolicyConstants.sol', import.meta.url);
  await mkdir(dirname(fileURLToPath(destination)), { recursive: true });
  await writeFile(destination, output, 'utf8');
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const output = await generatePolicyConstants();
  console.log(`Generated Solidity policy constants (${output.split('\n').length - 1} lines).`);
}
