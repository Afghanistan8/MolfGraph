/**
 * useWallet -- injected browser wallet connection for MolfGraph.
 *
 * MolfGraph signs through the user's own wallet (MetaMask, OKX, or any
 * EIP-6963 wallet), switched onto the GenLayer chain. There is no in-browser
 * key handling: the app never sees a private key.
 *
 * Reads never touch this hook. Every MolfGraph view works without a wallet.
 * Only writes need a signer.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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

export type { DiscoveredWallet } from "./lib/wallet";

export interface WalletState {
  address: string | null;
  /** A wallet is connected. */
  connected: boolean;
  /** Connected AND on the GenLayer chain. Writes require this. */
  onChain: boolean;
  /** Injected wallets discovered via EIP-6963. */
  discovered: DiscoveredWallet[];
  /** Any injected provider is present in this browser. */
  hasWallet: boolean;
  connect: (detail?: DiscoveredWallet) => Promise<{ ok: boolean; error?: string }>;
  disconnect: () => void;
}

export function useWallet(): WalletState {
  const [snap, setSnap] = useState<WalletSnapshot>(() => getState());
  const [discovered, setDiscovered] = useState<DiscoveredWallet[]>(() =>
    getDiscoveredWallets(),
  );

  useEffect(() => {
    const unsub = subscribe(setSnap);
    // Wallets announce themselves asynchronously, so re-read shortly after mount.
    const timer = setTimeout(() => setDiscovered(getDiscoveredWallets()), 300);
    void trySilentReconnect();
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, []);

  const connect = useCallback(async (detail?: DiscoveredWallet) => {
    try {
      await walletConnect(detail);
      setDiscovered(getDiscoveredWallets());
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Wallet connection failed.",
      };
    }
  }, []);

  const disconnect = useCallback(() => {
    walletDisconnect();
  }, []);

  return useMemo(
    () => ({
      address: snap.address,
      connected: Boolean(snap.address),
      onChain: snap.onChain,
      discovered,
      hasWallet: hasInjectedWallet(),
      connect,
      disconnect,
    }),
    [snap.address, snap.onChain, discovered, connect, disconnect],
  );
}
