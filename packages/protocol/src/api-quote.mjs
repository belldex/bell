// Executable quote route logic (plan M08-03, brief G21/G27/G37).
// A quote binds configHash + observed block + expiry (<=30s) + deadline
// (<=120s). Policy halts are typed canExecute=false responses with contract
// reasons, not HTTP 503, and never consume nonce/budget permanently.
import { envelope, validateAmount, validateAddress, ValidationError, validateQuoteExpiry, validateDeadline } from './api-schema.mjs';

export function validateQuoteRequest({ amountIn, amountOut, direction, recipient, slippageRaw, quoteExpirySeconds, deadlineSeconds, configHash }) {
  const hasIn = amountIn !== undefined;
  const hasOut = amountOut !== undefined;
  if (hasIn === hasOut) throw new ValidationError('amount', 'exactly one of amountIn/amountOut (exact-input or exact-output)');
  if (hasIn) validateAmount(amountIn, 'amountIn');
  if (hasOut) validateAmount(amountOut, 'amountOut');
  if (direction !== 'EXACT_IN' && direction !== 'EXACT_OUT') throw new ValidationError('direction', 'must be EXACT_IN or EXACT_OUT');
  validateAddress(recipient, 'recipient');
  if (typeof slippageRaw !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(slippageRaw)) {
    throw new ValidationError('slippageRaw', 'must be a non-negative decimal string chosen by the user');
  }
  validateQuoteExpiry(quoteExpirySeconds);
  validateDeadline(deadlineSeconds);
  if (typeof configHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(configHash)) {
    throw new ValidationError('configHash', 'must be a 32-byte hash');
  }
  return { direction, amountIn: amountIn ?? null, amountOut: amountOut ?? null, recipient, slippageRaw };
}

export function quoteResponse({ chainId, observedBlockNumber, observedBlockHash, observedAt, requestId, request, simulation, quoteExpirySeconds }) {
  const canExecute = simulation.canExecute === true;
  return envelope({
    chainId, observedBlockNumber, observedBlockHash, observedAt, requestId,
    status: canExecute ? 'OK' : 'POLICY_BLOCKED',
    extra: {
      quote: {
        direction: request.direction,
        amountIn: request.amountIn,
        amountOut: request.amountOut,
        recipient: request.recipient,
        slippageRaw: request.slippageRaw,
        configHash: request.configHash,
        quoteExpirySeconds,
        expectedObservedBlockNumber: observedBlockNumber,
      },
      canExecute,
      revertReason: simulation.revertReason ?? null,
      reasons: simulation.reasons ?? [],
      actualFees: simulation.actualFees ?? null,
      capsConsumption: simulation.capsConsumption ?? null,
      calldataCandidate: simulation.calldataCandidate ?? null,
      disclaimer: 'Simulated result; state can change before execution. Re-quote never silently lowers user slippage.',
    },
  });
}

// A policy halt (e.g. HALTED, budget exhausted, band breach) is NOT a 503:
// the request was valid, the protocol refuses execution for typed reasons.
export function isPolicyBlock(simulation) {
  return simulation.canExecute !== true && Array.isArray(simulation.reasons) && simulation.reasons.length > 0;
}