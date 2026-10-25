// UI state machine (plan M11, plan §8.5 state contract, brief G32/G37/G40).
// Derives the single UI state from wallet/quote/tx/index/source/quota/backup
// evidence. Priority: wallet identity, then tx lifecycle (money in flight
// dominates), then quote/policy, then infra degradations, then ready.
export const UI_STATES = Object.freeze({
  CONNECT_WALLET: 'CONNECT_WALLET',
  WRONG_CHAIN: 'WRONG_CHAIN',
  LOADING: 'LOADING',
  READY: 'READY',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  POLICY_BLOCKED: 'POLICY_BLOCKED',
  APPROVAL_PENDING: 'APPROVAL_PENDING',
  WALLET_REJECTED: 'WALLET_REJECTED',
  TX_PENDING: 'TX_PENDING',
  TX_REPLACED: 'TX_REPLACED',
  TX_REVERTED: 'TX_REVERTED',
  CONFIRMED_UNFINALIZED: 'CONFIRMED_UNFINALIZED',
  FINALIZED: 'FINALIZED',
  ORPHANED: 'ORPHANED',
  INDEX_LAGGING: 'INDEX_LAGGING',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  BACKUP_DEGRADED: 'BACKUP_DEGRADED',
});

const TX_STATE_MAP = Object.freeze({
  PENDING: UI_STATES.TX_PENDING,
  PROVISIONAL: UI_STATES.TX_PENDING,
  REPLACED: UI_STATES.TX_REPLACED,
  REVERTED: UI_STATES.TX_REVERTED,
  CONFIRMED_UNFINALIZED: UI_STATES.CONFIRMED_UNFINALIZED,
  FINALIZED: UI_STATES.FINALIZED,
  ORPHANED: UI_STATES.ORPHANED,
});

const WARNING_STATES = new Set([UI_STATES.INDEX_LAGGING, UI_STATES.SOURCE_UNAVAILABLE, UI_STATES.QUOTA_EXHAUSTED, UI_STATES.BACKUP_DEGRADED]);

// severity: 'blocking' = action impossible; 'action' = user must decide;
// 'progress' = money in flight; 'warning' = usable with disclosure; 'ok'.
const SEVERITY = Object.freeze({
  CONNECT_WALLET: 'blocking',
  WRONG_CHAIN: 'blocking',
  LOADING: 'blocking',
  READY: 'ok',
  QUOTE_EXPIRED: 'action',
  POLICY_BLOCKED: 'blocking',
  APPROVAL_PENDING: 'progress',
  WALLET_REJECTED: 'action',
  TX_PENDING: 'progress',
  TX_REPLACED: 'progress',
  TX_REVERTED: 'action',
  CONFIRMED_UNFINALIZED: 'progress',
  FINALIZED: 'ok',
  ORPHANED: 'action',
  INDEX_LAGGING: 'warning',
  SOURCE_UNAVAILABLE: 'warning',
  QUOTA_EXHAUSTED: 'warning',
  BACKUP_DEGRADED: 'warning',
});

export function deriveUiState(input = {}) {
  const { wallet = {}, quote = {}, tx = null, index = {}, source = {}, quota = {}, backup = {} } = input;
  if (!wallet.connected) return state(UI_STATES.CONNECT_WALLET);
  if (wallet.chainIdOk === false) return state(UI_STATES.WRONG_CHAIN);
  if (wallet.lastActionRejected === true) return state(UI_STATES.WALLET_REJECTED);

  // Money in flight dominates everything below it: a pending transaction is
  // never reported as a mere READY warning.
  if (tx) {
    const mapped = TX_STATE_MAP[tx.state];
    if (mapped) return state(mapped);
  }

  if (quote.expired === true) return state(UI_STATES.QUOTE_EXPIRED);
  if (quote.policyBlocked === true) return state(UI_STATES.POLICY_BLOCKED);
  if (quote.approvalPending === true) return state(UI_STATES.APPROVAL_PENDING);
  if (quota.exhausted === true) return state(UI_STATES.QUOTA_EXHAUSTED);
  if (source.unavailable === true) return state(UI_STATES.SOURCE_UNAVAILABLE);
  if (index.lagging === true) return state(UI_STATES.INDEX_LAGGING);
  if (backup.degraded === true) return state(UI_STATES.BACKUP_DEGRADED);
  if (wallet.loading === true || quote.loading === true) return state(UI_STATES.LOADING);
  return state(UI_STATES.READY);
}

function state(name) {
  return Object.freeze({ state: name, severity: SEVERITY[name], warning: WARNING_STATES.has(name) });
}

// Status API down must not hide contract/exit info that is available
// statically: degraded states carry the warning flag, not a blank screen.
export function exitGuideAvailable(s) {
  return s.severity !== 'blocking';
}