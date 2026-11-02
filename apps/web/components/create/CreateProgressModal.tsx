'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ExternalLink,
  Layers,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { TokenPair } from '@/components/ui/TokenLogo';
import type { CreateResult, CreateStage } from '@/lib/mainnet-create-flow';

const STAGE_TITLES: Record<string, string> = {
  preflight: 'Mainnet checks',
  prepared: 'Preflight verification',
  wrap: 'Wrap WETH',
  approve: 'Token approval',
  health: 'Market health',
  create: 'Create and seed',
  complete: 'Pool created',
};

type StepStatus = 'pending' | 'active' | 'completed' | 'failed';

interface PipelineStep {
  id: string;
  number: number;
  title: string;
  description: string;
  status: StepStatus;
  activeMessage?: string;
  txHash?: string;
}

interface CreateProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  busy: boolean;
  stage: CreateStage | null;
  history: CreateStage[];
  error: string | null;
  result: CreateResult | null;
  stockSymbol: string;
  counterSymbol: string;
  poolClassName: string;
  onRetry: () => void;
}

export function CreateProgressModal({
  isOpen,
  onClose,
  busy,
  stage,
  history,
  error,
  result,
  stockSymbol,
  counterSymbol,
  poolClassName,
  onRetry,
}: CreateProgressModalProps) {
  const [mounted, setMounted] = useState(false);
  const [showRawLogs, setShowRawLogs] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while modal is active so user stays focused
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  // Close on Escape when not in a critical busy state
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

  // Derive pipeline steps from history and active stage
  const pipelineSteps = useMemo<PipelineStep[]>(() => {
    const hasKey = (key: string) => history.some((h) => h.key === key);
    const getHash = (key: string) => {
      const match = [...history].reverse().find((h) => h.key === key && h.hash);
      return match?.hash;
    };
    const getLatestMsg = (key: string) => {
      const match = [...history].reverse().find((h) => h.key === key);
      return match?.message;
    };

    const currentKey = stage?.key;
    const isCompleted = Boolean(result);
    const isFailed = Boolean(error);

    // 1. Preflight
    let s1: StepStatus = 'pending';
    if (isCompleted || hasKey('prepared') || hasKey('wrap') || hasKey('approve') || hasKey('health') || hasKey('create')) {
      s1 = 'completed';
    } else if (isFailed && (currentKey === 'preflight' || !history.length)) {
      s1 = 'failed';
    } else if (busy && currentKey === 'preflight') {
      s1 = 'active';
    }

    // 2. Approvals
    let s2: StepStatus = 'pending';
    if (isCompleted || hasKey('health') || hasKey('create')) {
      s2 = 'completed';
    } else if (isFailed && (currentKey === 'wrap' || currentKey === 'approve')) {
      s2 = 'failed';
    } else if (busy && (currentKey === 'wrap' || currentKey === 'approve')) {
      s2 = 'active';
    } else if (s1 === 'completed' && !isFailed) {
      s2 = 'pending';
    }

    // 3. Simulation & Health
    let s3: StepStatus = 'pending';
    if (isCompleted || hasKey('create') || hasKey('complete')) {
      s3 = 'completed';
    } else if (isFailed && currentKey === 'health') {
      s3 = 'failed';
    } else if (busy && currentKey === 'health') {
      s3 = 'active';
    } else if (s2 === 'completed' && !isFailed) {
      s3 = 'pending';
    }

    // 4. Create and Seed
    let s4: StepStatus = 'pending';
    if (isCompleted) {
      s4 = 'completed';
    } else if (isFailed && (currentKey === 'create' || (!busy && !result && s3 === 'completed'))) {
      s4 = 'failed';
    } else if (busy && currentKey === 'create') {
      s4 = 'active';
    }

    return [
      {
        id: 'preflight',
        number: 1,
        title: 'Preflight & Verification',
        description: 'Verify contracts, registry descriptors, and mine hook address salt.',
        status: s1,
        activeMessage: s1 === 'active' ? (stage?.message ?? 'Verifying parameters…') : getLatestMsg('prepared'),
      },
      {
        id: 'approvals',
        number: 2,
        title: 'Token Approvals',
        description: `Allow factory to spend ${counterSymbol} service fee and initial seed tokens.`,
        status: s2,
        activeMessage: s2 === 'active' ? stage?.message : getLatestMsg('approve'),
        txHash: getHash('approve') || getHash('wrap'),
      },
      {
        id: 'health',
        number: 3,
        title: 'Market Phase & Gas Estimation',
        description: 'Check active session policy, initial price ratio, and simulate transaction.',
        status: s3,
        activeMessage: s3 === 'active' ? stage?.message : getLatestMsg('health'),
      },
      {
        id: 'create',
        number: 4,
        title: 'Deploy & Seed Pool',
        description: 'Atomic Uniswap v4 hook creation, liquidity minting, and position NFT transfer.',
        status: s4,
        activeMessage: s4 === 'active' ? (stage?.message ?? 'Confirming in wallet…') : getLatestMsg('complete'),
        txHash: result?.createHash || getHash('create'),
      },
    ];
  }, [history, stage, result, error, busy, counterSymbol]);

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(label);
      window.setTimeout(() => setCopiedText(null), 1600);
    } catch {
      // ignore
    }
  }

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div className="app-modal-backdrop" onClick={busy ? undefined : onClose} role="presentation">
      <div
        className="app-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="app-create-modal__header">
          <div className="flex items-center gap-3">
            <TokenPair symbols={[stockSymbol, counterSymbol]} size={28} />
            <div>
              <p className="app-create-modal__eyebrow">
                ROBINHOOD CHAIN 4663 · UNISWAP V4 POOL
              </p>
              <h2 id="create-modal-title" className="app-create-modal__title">
                {stockSymbol} / {counterSymbol}
                <span className="app-create-modal__class-badge">{poolClassName}</span>
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

        {/* State Banner with Visual Animation */}
        <div
          className={`app-create-modal__banner app-create-modal__banner--${
            result ? 'success' : error ? 'error' : 'progress'
          }`}
        >
          <div className="flex items-start gap-3">
            {result ? (
              <div className="app-create-modal__banner-icon app-create-modal__banner-icon--success">
                <Check size={20} strokeWidth={2.5} />
              </div>
            ) : error ? (
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
                {result
                  ? result.staged
                    ? 'Pool Deployed & Seeded (Staged)'
                    : 'Pool Successfully Created & Seeded!'
                  : error
                  ? 'Transaction Halted or Reverted'
                  : 'Executing Deployment Pipeline…'}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {result
                  ? result.staged
                    ? 'Swaps are currently locked until healthy market prices or verified close anchor activate. Your position NFT is minted.'
                    : 'Your Uniswap v4 hook instance is deployed on Mainnet. Position NFT has been transferred to your wallet.'
                  : error
                  ? error
                  : stage?.message || 'Please review and confirm each prompt in your connected wallet.'}
              </p>
            </div>
          </div>
        </div>

        {/* Pipeline Step-by-Step Tracker */}
        <div className="app-create-modal__body">
          <p className="app-create-modal__section-title">TRANSACTION PIPELINE</p>

          <ol className="app-create-pipeline">
            {pipelineSteps.map((step, idx) => {
              const isLast = idx === pipelineSteps.length - 1;
              return (
                <li
                  key={step.id}
                  className={`app-pipeline-step app-pipeline-step--${step.status}`}
                  data-status={step.status}
                >
                  <div className="app-pipeline-step__col-left">
                    <div className="app-pipeline-step__node">
                      {step.status === 'completed' ? (
                        <Check size={13} strokeWidth={2.5} />
                      ) : step.status === 'active' ? (
                        <LoaderCircle size={15} className="animate-spin text-ion" />
                      ) : step.status === 'failed' ? (
                        <X size={13} strokeWidth={2.5} />
                      ) : (
                        <span>{step.number}</span>
                      )}
                    </div>
                    {!isLast && <div className="app-pipeline-step__line" />}
                  </div>

                  <div className="app-pipeline-step__content">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-xs font-semibold tracking-tight text-ink">
                        {step.title}
                      </strong>
                      <span className={`app-pipeline-step__badge app-pipeline-step__badge--${step.status}`}>
                        {step.status === 'completed'
                          ? 'Completed'
                          : step.status === 'active'
                          ? 'In progress'
                          : step.status === 'failed'
                          ? 'Failed'
                          : 'Pending'}
                      </span>
                    </div>

                    <p className="mt-1 text-[11px] leading-relaxed text-dim">
                      {step.activeMessage && step.status !== 'pending'
                        ? step.activeMessage
                        : step.description}
                    </p>

                    {step.txHash && (
                      <a
                        href={`https://robinhoodchain.blockscout.com/tx/${step.txHash}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="app-pipeline-step__tx-link"
                      >
                        <span>View on Blockscout Explorer</span>
                        <ExternalLink size={11} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Success Card */}
          {result && (
            <div className="app-create-success-card">
              <div className="app-create-success-card__grid">
                <div>
                  <span className="app-create-success-card__label">HOOK ADDRESS</span>
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs text-ink">{result.hook}</code>
                    <button
                      type="button"
                      onClick={() => void copyToClipboard(result.hook, 'hook')}
                      className="app-create-success-card__copy-btn"
                    >
                      {copiedText === 'hook' ? <Check size={12} /> : <Clipboard size={12} />}
                    </button>
                  </div>
                </div>

                <div>
                  <span className="app-create-success-card__label">POOL ID</span>
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs text-dim truncate">{result.poolId}</code>
                    <button
                      type="button"
                      onClick={() => void copyToClipboard(result.poolId, 'poolId')}
                      className="app-create-success-card__copy-btn"
                    >
                      {copiedText === 'poolId' ? <Check size={12} /> : <Clipboard size={12} />}
                    </button>
                  </div>
                </div>

                <div>
                  <span className="app-create-success-card__label">POSITION NFT</span>
                  <strong className="text-sm font-mono text-ink">#{result.tokenId.toString()}</strong>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/pool?hook=${result.hook}`}
                  className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 border border-ion/40 bg-ion/10 px-4 font-mono text-xs uppercase text-ion hover:bg-ion/20"
                >
                  <span>Go to Pool Details</span>
                  <ArrowRight size={14} />
                </Link>

                <a
                  href={`https://robinhoodchain.blockscout.com/tx/${result.createHash}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex min-h-10 items-center justify-center gap-2 border border-line bg-surface px-4 font-mono text-xs uppercase text-muted hover:text-ink"
                >
                  <span>Receipt</span>
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          )}

          {/* Collapsible Execution Log Console */}
          {history.length > 0 && (
            <div className="app-create-logs">
              <button
                type="button"
                onClick={() => setShowRawLogs(!showRawLogs)}
                className="app-create-logs__toggle"
                aria-expanded={showRawLogs}
              >
                <div className="flex items-center gap-2">
                  <Terminal size={13} className="text-dim" />
                  <span>Detailed Execution Log ({history.length} events)</span>
                </div>
                {showRawLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showRawLogs && (
                <div className="app-create-logs__terminal">
                  <pre>
                    {history.map((item, index) => (
                      <div key={`${item.key}-${index}`} className="app-create-logs__entry">
                        <span className="app-create-logs__timestamp">
                          [{STAGE_TITLES[item.key] ?? item.key}]
                        </span>
                        <span>{item.message}</span>
                        {item.hash && (
                          <a
                            href={`https://robinhoodchain.blockscout.com/tx/${item.hash}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-ion underline ml-1"
                          >
                            (tx: {item.hash.slice(0, 10)}…)
                          </a>
                        )}
                      </div>
                    ))}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div className="app-create-modal__footer">
          <div className="flex items-center gap-2 text-[11px] text-dim">
            <ShieldCheck size={14} className="text-ion" />
            <span>Onchain Uniswap v4 Hook verification</span>
          </div>

          <div className="flex items-center gap-2">
            {error && !busy && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-9 items-center gap-2 border border-ion/50 bg-ion/10 px-4 font-mono text-xs uppercase text-ion hover:bg-ion/20"
              >
                <RefreshCw size={12} />
                <span>Retry creation</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex min-h-9 items-center border border-line bg-surface px-4 font-mono text-xs uppercase text-muted hover:text-ink disabled:opacity-50"
            >
              {result ? 'Done' : busy ? 'Working…' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
