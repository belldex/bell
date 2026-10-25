// Nonce and pending transaction reconciliation for keepers (plan M09-03).
// Contract: record signed bytes BEFORE broadcast; a timeout never implies the
// transaction failed; retries replay identical bytes; replacement reuses the
// same nonce with an explicit fee bump and bounded attempts.
const MAX_UINT64 = (1n << 64n) - 1n;

function assertHash(value, name) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)) {
    throw new RangeError(`${name} must be a 32-byte hex hash`);
  }
  return value;
}

function assertHexBytes(value, name) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]*$/.test(value) || value.length < 4) {
    throw new RangeError(`${name} must be non-empty hex bytes`);
  }
  return value;
}

function assertNonce(value) {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_UINT64) {
    throw new RangeError('nonce must be a uint64 bigint');
  }
  return value;
}

export class NonceLedger {
  #signer;
  #maxRetries;
  #records = new Map(); // nonce -> record
  #nextNonce = null;    // local high-water mark after reconciliation

  constructor({ signer, maxRetries = 3 } = {}) {
    if (typeof signer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(signer)) {
      throw new RangeError('signer must be a 20-byte hex address');
    }
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 1) {
      throw new RangeError('maxRetries must be a positive integer');
    }
    this.#signer = signer.toLowerCase();
    this.#maxRetries = maxRetries;
  }

  get signer() {
    return this.#signer;
  }

  // Step 1 of the crash matrix: signed, not yet broadcast. The signed bytes
  // and hash are durable state before any network call.
  recordSigned({ nonce, txHash, signedBytes, action, maxFeePerGas, createdAt }) {
    const n = assertNonce(nonce);
    assertHash(txHash, 'txHash');
    assertHexBytes(signedBytes, 'signedBytes');
    if (this.#records.has(n)) throw new Error('nonce already has a pending or mined record');
    if (this.#nextNonce !== null && n < this.#nextNonce) {
      throw new Error('signed nonce is below the reconciled high-water mark');
    }
    const record = {
      nonce: n,
      txHash,
      signedBytes,
      action: action === undefined ? null : action,
      maxFeePerGas: typeof maxFeePerGas === 'bigint' ? maxFeePerGas : null,
      attempts: 0,
      state: 'SIGNED',
      firstBroadcastAt: null,
      receipt: null,
    };
    this.#records.set(n, record);
    if (this.#nextNonce === null || n >= this.#nextNonce) this.#nextNonce = n + 1n;
    return record;
  }

  // Step 2: broadcast attempt. Retries must replay identical bytes.
  markBroadcast(nonce, { now }) {
    const record = this.#requireRecord(nonce);
    if (record.state !== 'SIGNED' && record.state !== 'BROADCAST') {
      throw new Error(`cannot broadcast from state ${record.state}`);
    }
    record.attempts += 1;
    record.state = 'BROADCAST';
    if (record.firstBroadcastAt === null) record.firstBroadcastAt = now;
    return record;
  }

  // Step 3a: receipt observed.
  markMined(nonce, receipt) {
    const record = this.#requireRecord(nonce);
    if (receipt === null || typeof receipt !== 'object') throw new TypeError('receipt must be an object');
    record.state = receipt.status === 1n || receipt.status === 1 ? 'MINED_SUCCESS' : 'MINED_REVERTED';
    record.receipt = receipt;
    return record;
  }

  // Step 3b: replacement. Same nonce, explicitly higher fees, bounded retries,
  // and the original signed bytes are kept for audit/replay.
  planReplacement(nonce, { newMaxFeePerGas }) {
    const record = this.#requireRecord(nonce);
    if (typeof newMaxFeePerGas !== 'bigint' || newMaxFeePerGas <= 0n) {
      throw new RangeError('newMaxFeePerGas must be a positive bigint');
    }
    if (record.maxFeePerGas !== null && newMaxFeePerGas <= record.maxFeePerGas) {
      throw new Error('replacement fee must strictly exceed the original');
    }
    if (record.attempts > this.#maxRetries) {
      throw new Error('replacement budget exhausted; stopping without creating a nonce gap');
    }
    if (record.state === 'MINED_SUCCESS' || record.state === 'MINED_REVERTED') {
      throw new Error('cannot replace a mined transaction');
    }
    return { nonce, sameTxHash: record.txHash, maxFeePerGas: newMaxFeePerGas, attempt: record.attempts + 1 };
  }

  markReplaced(nonce, { txHash, signedBytes, maxFeePerGas }) {
    const record = this.#requireRecord(nonce);
    assertHash(txHash, 'txHash');
    assertHexBytes(signedBytes, 'signedBytes');
    record.txHash = txHash;
    record.signedBytes = signedBytes;
    record.maxFeePerGas = typeof maxFeePerGas === 'bigint' ? maxFeePerGas : record.maxFeePerGas;
    record.state = 'BROADCAST';
    return record;
  }

  // Crash recovery: the durable record decides the next action; a timeout is
  // never interpreted as "not sent" and never produces blind new work.
  nextAction(nonce) {
    const record = this.#requireRecord(nonce);
    switch (record.state) {
      case 'SIGNED':
        return { action: 'BROADCAST', txHash: record.txHash, signedBytes: record.signedBytes };
      case 'BROADCAST':
        if (record.attempts > this.#maxRetries) return { action: 'ESCALATE', txHash: record.txHash };
        return { action: 'POLL_RECEIPT', txHash: record.txHash, attempts: record.attempts };
      case 'MINED_SUCCESS':
      case 'MINED_REVERTED':
      case 'MINED_UNKNOWN_STATUS':
        return { action: 'DONE', txHash: record.txHash, state: record.state, receipt: record.receipt };
      default:
        throw new Error(`unknown state ${record.state}`);
    }
  }

  // Reconcile against the chain before choosing the next transaction. Chain
  // evidence overrides local guesses in the direction of safety: any nonce at
  // or below the chain pending count that we do not hold is consumed.
  reconcile({ pendingNonce, latestNonce, confirmedHashes = [], reorgedHashes = [] }) {
    if (typeof pendingNonce !== 'bigint' || typeof latestNonce !== 'bigint') {
      throw new TypeError('pendingNonce and latestNonce are required bigints');
    }
    if (pendingNonce > latestNonce + 1n) throw new RangeError('pending nonce cannot exceed latest+1');
    for (const hash of confirmedHashes) {
      assertHash(hash, 'confirmed hash');
      const record = this.#findByHash(hash);
      if (record) {
        record.state = 'MINED_SUCCESS';
        record.receipt = record.receipt ?? { status: 1 };
      }
    }
    for (const hash of reorgedHashes) {
      assertHash(hash, 'reorged hash');
      const record = this.#findByHash(hash);
      // A reorged transaction returns to BROADCAST: it may land again or be
      // replaced, but its bytes are still the durable candidate.
      if (record && record.state.startsWith('MINED')) record.state = 'BROADCAST';
    }
    // Nonces strictly below the chain pending count are consumed onchain even
    // if we never observed the receipt (crash after broadcast).
    for (const [n, record] of this.#records) {
      if (n < pendingNonce && !record.state.startsWith('MINED')) {
        record.state = 'MINED_UNKNOWN_STATUS';
        record.receipt = record.receipt ?? { status: null };
      }
    }
    if (this.#nextNonce === null || pendingNonce > this.#nextNonce) this.#nextNonce = pendingNonce;
    return this.#nextNonce;
  }

  // The next usable nonce: no gaps, never below the reconciled high-water mark.
  allocate() {
    if (this.#nextNonce === null) throw new Error('allocate requires a reconciled ledger');
    const nonce = this.#nextNonce;
    this.#nextNonce = nonce + 1n;
    return nonce;
  }

  pending() {
    return [...this.#records.values()].filter((r) => !r.state.startsWith('MINED') && r.state !== 'MINED_UNKNOWN_STATUS');
  }

  #requireRecord(nonce) {
    const record = this.#records.get(assertNonce(nonce));
    if (!record) throw new Error('no pending record for nonce');
    return record;
  }

  #findByHash(hash) {
    for (const record of this.#records.values()) {
      if (record.txHash.toLowerCase() === hash.toLowerCase()) return record;
    }
    return null;
  }
}
