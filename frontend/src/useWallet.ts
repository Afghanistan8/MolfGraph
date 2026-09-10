/**
 * useWallet -- two ways to sign MolfGraph writes on StudioNet.
 *
 *  1. Local account: a key generated or imported in the browser, signed with by
 *     genlayer-js. This is the demo path, so a visitor can try the console
 *     without installing an extension. Testnet only.
 *  2. Injected wallet: MetaMask, OKX, or any EIP-6963 wallet, switched onto the
 *     GenLayer chain. MolfGraph never sees the key.
 *
 * The two are mutually exclusive at runtime. Reads never touch this hook: every
 * MolfGraph view works with no wallet at all.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Account } from "genlayer-js/types";
import {
  connect as walletConnect,
  disconnect as walletDisconnect,
  getDiscoveredWallets,
  getState,
  hasWallet as hasInjectedWallet,
  subscribe,
  trySilentReconnect,
  type DiscoveredWallet,
  type WalletSnapshot,
} from "./lib/wallet";
import {
  accountFromKey,
  clearBurnerKey,
  createBurnerKey,
  isValidKey,
  loadBurnerKey,
  saveBurnerKey,
  type Hex,
} from "./lib/burner";

export type { DiscoveredWallet } from "./lib/wallet";
export type WalletMode = "local" | "external";

export interface WalletState {
  mode: WalletMode | null;
  address: string | null;
  connected: boolean;
  /** Connected AND on the GenLayer chain. A local account is always on it. */
  onChain: boolean;
  /** Present only in local mode; genlayer-js signs with this directly. */
  account: Account | null;
  discovered: DiscoveredWallet[];
  hasWallet: boolean;
  connectExternal: (detail?: DiscoveredWallet) => Promise<{ ok: boolean; error?: string }>;
  createLocal: () => { ok: boolean; error?: string };
  importLocal: (key: string) => { ok: boolean; error?: string };
  exportKey: () => string | null;
  disconnect: () => void;
}

export function useWallet(): WalletState {
  const [snap, setSnap] = useState<WalletSnapshot>(() => getState());
  const [discovered, setDiscovered] = useState<DiscoveredWallet[]>(() =>
    getDiscoveredWallets(),
  );
  const [mode, setMode] = useState<WalletMode | null>(null);
  const [localKey, setLocalKey] = useState<Hex | null>(null);

  useEffect(() => {
    const unsub = subscribe(setSnap);
    const timer = setTimeout(() => setDiscovered(getDiscoveredWallets()), 300);
    // An existing local account is an explicit prior choice, so restore it.
    // Otherwise try to silently re-attach an injected wallet already authorised.
    const existing = loadBurnerKey();
    if (existing) {
      setLocalKey(existing);
      setMode("local");
    } else {
      void trySilentReconnect();
    }
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (snap.address && mode !== "local") setMode("external");
  }, [snap.address, mode]);

  const account = useMemo<Account | null>(() => {
    if (mode === "local" && localKey) {
      try {
        return accountFromKey(localKey);
      } catch {
        return null;
      }
    }
    return null;
  }, [mode, localKey]);

  const connectExternal = useCallback(async (detail?: DiscoveredWallet) => {
    try {
      clearBurnerKey();
      setLocalKey(null);
      setMode("external");
      await walletConnect(detail);
      setDiscovered(getDiscoveredWallets());
      return { ok: true };
    } catch (e) {
      setMode(null);
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Wallet connection failed.",
      };
    }
  }, []);

  const createLocal = useCallback(() => {
    try {
      walletDisconnect();
      const key = createBurnerKey();
      setLocalKey(key);
      setMode("local");
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Could not create a local account.",
      };
    }
  }, []);

  const importLocal = useCallback((key: string) => {
    const trimmed = key.trim();
    if (!isValidKey(trimmed)) {
      return { ok: false, error: "Expected a 0x-prefixed 64-hex-character key." };
    }
    try {
      walletDisconnect();
      saveBurnerKey(trimmed);
      setLocalKey(trimmed);
      setMode("local");
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Could not import that key.",
      };
    }
  }, []);

  const exportKey = useCallback(() => localKey, [localKey]);

  const disconnect = useCallback(() => {
    walletDisconnect();
    clearBurnerKey();
    setLocalKey(null);
    setMode(null);
  }, []);

  const address = mode === "local" ? (account?.address as string | undefined) ?? null : snap.address;
  const onChain = mode === "local" ? true : snap.onChain;

  return useMemo(
    () => ({
      mode,
      address,
      connected: mode !== null && Boolean(address),
      onChain,
      account,
      discovered,
      hasWallet: hasInjectedWallet(),
      connectExternal,
      createLocal,
      importLocal,
      exportKey,
      disconnect,
    }),
    [
      mode, address, onChain, account, discovered,
      connectExternal, createLocal, importLocal, exportKey, disconnect,
    ],
  );
}
