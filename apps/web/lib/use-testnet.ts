'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import { useWallet } from './wallet';
import { readTestnetStatus, TESTNET, type TestnetStatus } from './protocol-adapter';

export interface UseTestnetResult {
  isTestnet: boolean;
  status: TestnetStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  contracts: typeof TESTNET.contracts;
}

export function useTestnet(): UseTestnetResult {
  const wallet = useWallet();
  const [status, setStatus] = useState<TestnetStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const isTestnet = wallet.chainId === TESTNET.chainId;

  const fetchStatus = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) return;
    if (wallet.chainId !== TESTNET.chainId) {
      setStatus(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const eth = window.ethereum!;
      const data = await readTestnetStatus(
        (args: { method: string; params?: unknown[] }) => eth.request(args as never),
        { account: wallet.account ?? undefined }
      );
      startTransition(() => {
        setStatus(data);
        setLoading(false);
      });
    } catch (err) {
      startTransition(() => {
        setError(err instanceof Error ? err.message : 'Failed to query testnet status');
        setLoading(false);
      });
    }
  }, [wallet.chainId, wallet.account]);

  useEffect(() => {
    if (isTestnet) {
      fetchStatus();
    } else {
      setStatus(null);
      setError(null);
    }
  }, [isTestnet, fetchStatus]);

  return {
    isTestnet,
    status,
    loading,
    error,
    refresh: fetchStatus,
    contracts: TESTNET.contracts,
  };
}
