'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { TokenPair } from '@/components/ui/TokenLogo';

export type PositionOperation = 'increase' | 'remove' | 'collect';

interface PositionActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  operation: PositionOperation;
  busy: boolean;
  status: string;
  error: string | null;
  hash: string | null;
  tokenId: string;
  symbols: [string, string];
  onRetry?: () => void;
}

export function PositionActionModal({
  isOpen,
  onClose,
  operation,
  busy,
  status,
  error,
  hash,
  tokenId,
  symbols,
  onRetry,
}: PositionActionModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll
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

  const isSuccess = !busy && !error && (status.includes('successfully') || status.includes('added') || status.includes('removed') || status.includes('collected'));
  const isFailed = Boolean(error);

  const title =
    operation === 'increase'
      ? 'Add Liquidity'
      : operation === 'remove'
      ? 'Remove Liquidity'
      : 'Collect Accrued Fees';

  const subtitle =
    operation === 'increase'
      ? `Mint additional liquidity units for NFT #${tokenId}`
      : operation === 'remove'
      ? `Burn liquidity units and withdraw in-kind to wallet`
      : `Collect earned fees directly to your wallet`;

  return createPortal(
    <div className="app-modal-backdrop" onClick={busy ? undefined : onClose} role="presentation">
      <div
        className="app-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="position-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="app-create-modal__header">
          <div className="flex items-center gap-3">
            <TokenPair symbols={symbols} size={28} />
            <div>
              <p className="app-create-modal__eyebrow">
                POSITION MANAGER · NFT #{tokenId}
              </p>
              <h2 id="position-modal-title" className="app-create-modal__title">
                {title}
                <span className="app-create-modal__class-badge">
                  {symbols[0]} / {symbols[1]}
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

        {/* Modal Body with 2-Column Responsive Layout */}
        <div className="app-create-modal__body">
          <div className="app-create-modal__layout">
            {/* Left Column: State Banner & Position Details */}
            <div className="app-create-modal__left">
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
                        ? `${title} Confirmed!`
                        : isFailed
                        ? 'Transaction Halted or Reverted'
                        : busy
                        ? 'Confirming Transaction…'
                        : subtitle}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      {isFailed
                        ? error
                        : status || 'Please review and confirm this transaction in your wallet.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Position summary card */}
              <div className="border border-line bg-surface/60 p-3.5 space-y-2 text-xs">
                <div className="flex justify-between text-dim font-mono text-[9px] uppercase">
                  <span>Position NFT</span>
                  <span className="text-ink font-semibold">#{tokenId}</span>
                </div>
                <div className="flex justify-between text-dim font-mono text-[9px] uppercase">
                  <span>Pool Pair</span>
                  <span className="text-ink">{symbols[0]} / {symbols[1]}</span>
                </div>
                <div className="flex justify-between text-dim font-mono text-[9px] uppercase">
                  <span>Operation</span>
                  <span className="text-ink font-semibold">{title}</span>
                </div>
              </div>
            </div>

            {/* Right Column: Execution Pipeline Steps & Explorer Hash */}
            <div className="app-create-modal__right">
              <p className="app-create-modal__section-title">TRANSACTION PIPELINE</p>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`grid h-6 w-6 place-items-center rounded border font-mono text-xs ${
                      hash || isSuccess
                        ? 'border-up bg-up/10 text-up'
                        : isFailed
                        ? 'border-down bg-down/10 text-down'
                        : busy
                        ? 'border-ion bg-ion/10 text-ion'
                        : 'border-line text-dim'
                    }`}
                  >
                    {hash || isSuccess ? (
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
                    <p className="text-xs font-semibold text-ink">PositionManager Transaction</p>
                    <p className="text-[11px] text-dim">
                      {hash || isSuccess
                        ? 'Transaction approved and broadcasted.'
                        : busy
                        ? 'Waiting for wallet approval…'
                        : 'Ready to submit.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div
                    className={`grid h-6 w-6 place-items-center rounded border font-mono text-xs ${
                      isSuccess
                        ? 'border-up bg-up/10 text-up'
                        : hash && busy
                        ? 'border-ion bg-ion/10 text-ion'
                        : 'border-line text-dim'
                    }`}
                  >
                    {isSuccess ? (
                      <Check size={12} strokeWidth={2.5} />
                    ) : hash && busy ? (
                      <LoaderCircle size={13} className="animate-spin" />
                    ) : (
                      '2'
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink">Mainnet Block Receipt</p>
                    <p className="text-[11px] text-dim">
                      {isSuccess
                        ? 'Confirmed on Robinhood Chain Mainnet.'
                        : hash
                        ? 'Waiting for block receipt…'
                        : 'Awaiting submission.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Blockscout Explorer Link */}
              {hash && (
                <div className="mt-3.5 border border-line bg-surface p-3">
                  <span className="block font-mono text-[9px] uppercase tracking-wider text-dim">
                    TRANSACTION HASH
                  </span>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <code className="truncate font-mono text-xs text-muted" title={hash}>
                      {hash}
                    </code>
                    <a
                      href={`https://robinhoodchain.blockscout.com/tx/${hash}`}
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
          </div>
        </div>

        {/* Footer */}
        <div className="app-create-modal__footer">
          <div className="flex items-center gap-2 text-[11px] text-dim">
            <ShieldCheck size={14} className="text-ion" />
            <span>PositionManager Noncustodial Contract</span>
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
