import { useCallback, useEffect, useMemo, useState } from "react";
import { createAccount, generatePrivateKey } from "genlayer-js";
import type { Account } from "genlayer-js/types";
import { WALLET_STORAGE_KEY } from "./config";

/**
 * A burner wallet, or a private key the lawyer already controls.
 *
 * Reads never touch this hook: every MolfGraph view works without a wallet.
 * Only writes need a signer.
 */

export interface WalletState {
  account: Account | null;
  address: string;
  hasWallet: boolean;
  createBurner: () => void;
  importKey: (privateKey: string) => void;
  forget: () => void;
  exportKey: () => string | null;
  error: string;
}

function readStoredKey(): string | null {
  try {
    return window.localStorage.getItem(WALLET_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredKey(value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(WALLET_STORAGE_KEY);
    else window.localStorage.setItem(WALLET_STORAGE_KEY, value);
  } catch {
    /* private browsing: the wallet simply does not persist */
  }
}

function normaliseKey(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("A private key is 64 hex characters, with or without the 0x prefix.");
  }
  return `0x${hex.toLowerCase()}` as `0x${string}`;
}

export function useWallet(): WalletState {
  const [privateKey, setPrivateKey] = useState<string | null>(() => readStoredKey());
  const [error, setError] = useState("");

  useEffect(() => {
    writeStoredKey(privateKey);
  }, [privateKey]);

  const account = useMemo<Account | null>(() => {
    if (!privateKey) return null;
    try {
      return createAccount(privateKey as `0x${string}`);
    } catch {
      return null;
    }
  }, [privateKey]);

  const createBurner = useCallback(() => {
    setError("");
    setPrivateKey(generatePrivateKey());
  }, []);

  const importKey = useCallback((raw: string) => {
    try {
      setError("");
      setPrivateKey(normaliseKey(raw));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read that private key.");
    }
  }, []);

  const forget = useCallback(() => {
    setError("");
    setPrivateKey(null);
  }, []);

  const exportKey = useCallback(() => privateKey, [privateKey]);

  return {
    account,
    address: account?.address ?? "",
    hasWallet: Boolean(account),
    createBurner,
    importKey,
    forget,
    exportKey,
    error,
  };
}
