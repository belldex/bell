'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { TokenPair } from '@/components/ui/TokenLogo';

export type SwapActionType = 'approve' | 'swap' | 'checkpoint';

interface SwapProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  actionType: SwapActionType;
  busy: boolean;
  message: string;
  error: string | null;
  txHash: string | null;
  inputSymbol: string;
  outputSymbol: string;
  inputAmount?: string;
  outputAmount?: string;
  onRetry?: () => void;
}

export function SwapProgressModal({
  isOpen,
  onClose,
  actionType,
  busy,
  message,
  error,
  txHash,
  inputSymbol,
  outputSymbol,
  inputAmount,
  outputAmount,
  onRetry,
}: SwapProgressModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll when modal is active
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  // Close on Escape when idle
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, busy, onClose]);

  if (!mounted || !isOpen) return null;

  const isSuccess = !busy && !error && (Boolean(txHash) || message.includes('confirmed') || message.includes('confirmed.'));
  const isFailed = Boolean(error);
  const title =
    actionType === 'approve'
      ? `Approve ${inputSymbol}`
      : actionType === 'checkpoint'
      ? 'Policy Checkpoint'
      : 'Swap on BellRouter';

  const subtitle =
    actionType === 'approve'
      ? `Allow BellRouter to swap your ${inputSymbol}`
      : actionType === 'checkpoint'
      ? 'Commit verified state before trading'
      : `Trade ${inputSymbol} for ${outputSymbol}`;

  return createPortal(
    <div className="app-modal-backdrop" onClick={busy ? undefined : onClose} role="presentation">
      <div
        className="app-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="swap-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="app-create-modal__header">
          <div className="flex items-center gap-3">
            <TokenPair symbols={[inputSymbol, outputSymbol]} size={28} />
            <div>
              <p className="app-create-modal__eyebrow">
                ROBINHOOD CHAIN 4663 · BELLROUTER
              </p>
              <h2 id="swap-modal-title" className="app-create-modal__title">
                {title}
                <span className="app-create-modal__class-badge">
                  {actionType === 'approve' ? 'ERC-20' : 'V4 Hook'}
                </span>
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="app-create-modal__close"
            aria-label="Close modal"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* State Banner */}
        <div
          className={`app-create-modal__banner app-create-modal__banner--${
            isSuccess ? 'success' : isFailed ? 'error' : 'progress'
          }`}
        >
          <div className="flex items-start gap-3">
            {isSuccess ? (
              <div className="app-create-modal__banner-icon app-create-modal__banner-icon--success">
                <Check size={20} strokeWidth={2.5} />
              </div>
            ) : isFailed ? (
              <div className="app-create-modal__banner-icon app-create-modal__banner-icon--error">
                <AlertTriangle size={20} strokeWidth={2} />
              </div>
            ) : (
              <div className="app-create-modal__banner-icon app-create-modal__banner-icon--spin">
                <LoaderCircle size={22} className="animate-spin" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <h3 className="font-display text-base font-semibold text-ink">
                {isSuccess
                  ? actionType === 'approve'
                    ? 'Allowance Approved!'
                    : actionType === 'checkpoint'
                    ? 'Checkpoint Committed!'
                    : 'Swap Successfully Executed!'
                  : isFailed
                  ? 'Transaction Halted or Reverted'
                  : busy
                  ? 'Confirming Transaction…'
                  : subtitle}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {isFailed
                  ? error
                  : message ||
                    'Review and confirm the transaction in your connected Web3 wallet.'}
              </p>
            </div>
          </div>
        </div>

        {/* Body Content */}
        <div className="app-create-modal__body space-y-4">
          {/* Swap summary card */}
          {actionType === 'swap' && inputAmount && outputAmount && (
            <div className="border border-line bg-surface/60 p-4">
              <span className="block font-mono text-[9px] uppercase tracking-wider text-dim">
                TRANSACTION DETAILS
              </span>
              <div className="mt-3 flex items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] text-dim">YOU PAY</span>
                  <p className="font-mono text-base font-semibold text-ink">
                    {inputAmount} {inputSymbol}
                  </p>
                </div>
                <ArrowRight size={18} className="text-ion shrink-0" />
                <div className="text-right">
                  <span className="text-[10px] text-dim">ESTIMATED OUTPUT</span>
                  <p className="font-mono text-base font-semibold text-ink">
                    {outputAmount} {outputSymbol}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Simple 2-Step Pipeline */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-3">
              <div
                className={`grid h-6 w-6 place-items-center rounded border font-mono text-xs ${
                  txHash || isSuccess
                    ? 'border-up bg-up/10 text-up'
                    : isFailed
                    ? 'border-down bg-down/10 text-down'
                    : busy
                    ? 'border-ion bg-ion/10 text-ion'
                    : 'border-line text-dim'
                }`}
              >
                {txHash || isSuccess ? (
                  <Check size={12} strokeWidth={2.5} />
                ) : isFailed ? (
                  <X size={12} strokeWidth={2.5} />
                ) : busy ? (
                  <LoaderCircle size={13} className="animate-spin" />
                ) : (
                  '1'
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-ink">
                  {actionType === 'approve'
                    ? 'Token Approval Request'
                    : actionType === 'checkpoint'
                    ? 'Onchain State Checkpoint'
                    : 'Router Swap Simulation & Signature'}
                </p>
                <p className="text-[11px] text-dim">
                  {txHash || isSuccess
                    ? 'Transaction signed and broadcasted to Mainnet.'
                    : busy
                    ? 'Awaiting confirmation in your wallet…'
                    : 'Ready to submit.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div
                className={`grid h-6 w-6 place-items-center rounded border font-mono text-xs ${
                  isSuccess
                    ? 'border-up bg-up/10 text-up'
                    : txHash && busy
                    ? 'border-ion bg-ion/10 text-ion'
                    : 'border-line text-dim'
                }`}
              >
                {isSuccess ? (
                  <Check size={12} strokeWidth={2.5} />
                ) : txHash && busy ? (
                  <LoaderCircle size={13} className="animate-spin" />
                ) : (
                  '2'
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-ink">Mainnet Block Confirmation</p>
                <p className="text-[11px] text-dim">
                  {isSuccess
                    ? 'Confirmed on Robinhood Chain Mainnet.'
                    : txHash
                    ? 'Mining transaction receipt…'
                    : 'Pending transaction submission.'}
                </p>
              </div>
            </div>
          </div>

          {/* Blockscout Explorer Link */}
          {txHash && (
            <div className="border border-line bg-surface p-3">
              <span className="block font-mono text-[9px] uppercase tracking-wider text-dim">
                TRANSACTION HASH
              </span>
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="truncate font-mono text-xs text-muted" title={txHash}>
                  {txHash}
                </code>
                <a
                  href={`https://robinhoodchain.blockscout.com/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex shrink-0 items-center gap-1.5 border border-line px-2.5 py-1 font-mono text-[10px] uppercase text-ion hover:border-ion"
                >
                  <span>Explorer</span>
                  <ExternalLink size={11} />
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="app-create-modal__footer">
          <div className="flex items-center gap-2 text-[11px] text-dim">
            <ShieldCheck size={14} className="text-ion" />
            <span>Robinhood Chain Mainnet (4663)</span>
          </div>

          <div className="flex items-center gap-2">
            {isFailed && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-9 items-center gap-2 border border-ion/50 bg-ion/10 px-4 font-mono text-xs uppercase text-ion hover:bg-ion/20"
              >
                <RefreshCw size={12} />
                <span>Retry</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex min-h-9 items-center border border-line bg-surface px-4 font-mono text-xs uppercase text-muted hover:text-ink disabled:opacity-50"
            >
              {isSuccess ? 'Done' : busy ? 'Working…' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
