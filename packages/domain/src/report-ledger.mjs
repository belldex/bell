const MAX_REPORTS = 6;
const MAX_REPORT_BYTES = 16384;
const MAX_BATCH_BYTES = 98304;
const FEED_ID = /^0x[0-9a-f]{64}$/i;
const REPORT_HASH = /^0x[0-9a-f]{64}$/i;

// This ledger accepts only already-authenticated/decoded samples. It does not verify signatures.
export class SessionReportLedger {
  #observations = new Map();
  #reportHashes = new Set();

  highWater(feedId) {
    return this.#observations.get(String(feedId).toLowerCase()) ?? null;
  }

  submitBatch(reports, now) {
    const reasons = [];
    if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('now must be a non-negative integer timestamp');
    if (!Array.isArray(reports) || reports.length === 0 || reports.length > MAX_REPORTS) {
      return Object.freeze({ accepted: false, reasons: Object.freeze(['BATCH_COUNT']) });
    }

    let totalBytes = 0;
    const batchFeedIds = new Set();
    const batchReportHashes = new Set();
    for (const report of reports) {
      if (!report || typeof report !== 'object') {
        reasons.push('MALFORMED_REPORT');
        continue;
      }
      const feedId = typeof report.feedId === 'string' ? report.feedId.toLowerCase() : '';
      const reportHash = typeof report.reportHash === 'string' ? report.reportHash.toLowerCase() : '';
      if (!FEED_ID.test(feedId) || !REPORT_HASH.test(reportHash)) reasons.push('INVALID_IDENTITY');
      if (batchFeedIds.has(feedId)) reasons.push('DUPLICATE_FEED');
      if (batchReportHashes.has(reportHash) || this.#reportHashes.has(reportHash)) reasons.push('DUPLICATE_REPORT');
      batchFeedIds.add(feedId);
      batchReportHashes.add(reportHash);

      if (!Number.isSafeInteger(report.observedAt) || report.observedAt <= 0 || report.observedAt > now) reasons.push('INVALID_OBSERVATION');
      if (!Number.isInteger(report.phase) || report.phase < 1 || report.phase > 5) reasons.push('INVALID_PHASE');
      if (!Number.isInteger(report.encodedBytes) || report.encodedBytes < 1 || report.encodedBytes > MAX_REPORT_BYTES) reasons.push('REPORT_SIZE');
      else totalBytes += report.encodedBytes;

      const previous = this.#observations.get(feedId);
      if (previous !== undefined && report.observedAt <= previous) reasons.push('REPLAY_OR_NONPROGRESS');
    }
    if (totalBytes > MAX_BATCH_BYTES) reasons.push('BATCH_SIZE');
    if (reasons.length > 0) return Object.freeze({ accepted: false, reasons: Object.freeze([...new Set(reasons)]) });

    for (const report of reports) {
      const feedId = report.feedId.toLowerCase();
      const reportHash = report.reportHash.toLowerCase();
      this.#observations.set(feedId, report.observedAt);
      this.#reportHashes.add(reportHash);
    }
    return Object.freeze({ accepted: true, reasons: Object.freeze([]) });
  }
}
