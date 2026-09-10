import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "genlayer-js";
import { CHAIN, CONTRACT_ADDRESS } from "./config";
import { ensureNetwork } from "./lib/wallet";
import type { TxState } from "./types";
import type { WalletState } from "./useWallet";

/**
 * The single seam between MolfGraph's UI and the Intelligent Contract.
 *
 * Two rules are enforced here rather than in the panels:
 *   1. Reads never require a wallet. They use a chain-only client.
 *   2. A write is only believed once its receipt has actually finalised. A
 *      submitted or pending transaction never updates the accepted graph.
 *
 * Writes are signed by the user's own injected wallet, so MolfGraph never
 * holds a private key.
 */

type Hex = `0x${string}`;

export interface TxOutcome<T> {
  hash: string;
  finalized: boolean;
  value: T | null;
  raw: unknown;
}

export interface GenLayerApi {
  ready: boolean;
  /** A wallet is connected and on the GenLayer chain, so writes are allowed. */
  canWrite: boolean;
  address: string;
  read: <T>(functionName: string, args?: unknown[]) => Promise<T>;
  readRaw: (functionName: string, args?: unknown[]) => Promise<string>;
  write: <T>(functionName: string, args?: unknown[]) => Promise<TxOutcome<T>>;
  tx: TxState;
  resetTx: () => void;
  version: number;
  bump: () => void;
}

function parseJson<T>(raw: unknown): T {
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

/** genlayer-js receipt shapes vary by version, so read defensively. */
function decodeReceiptReturn(receipt: any): unknown {
  if (!receipt) return null;
  const candidates = [
    receipt?.result,
    receipt?.returnValue,
    receipt?.consensusData?.leader_receipt?.result,
    Array.isArray(receipt?.consensusData?.leader_receipt)
      ? receipt.consensusData.leader_receipt[0]?.result
      : undefined,
    receipt?.data?.result,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
    if (candidate && typeof candidate === "object") return candidate;
  }
  return null;
}

function receiptFinalized(receipt: any): boolean {
  if (!receipt) return false;
  const leader = Array.isArray(receipt?.consensusData?.leader_receipt)
    ? receipt.consensusData.leader_receipt[0]
    : receipt?.consensusData?.leader_receipt;
  const execution = leader?.execution_result ?? receipt?.execution_result;
  if (typeof execution === "string" && execution.toUpperCase() !== "SUCCESS") return false;

  const status = receipt?.status ?? receipt?.statusName;
  if (typeof status === "string") {
    const upper = status.toUpperCase();
    if (upper.includes("ERROR") || upper.includes("REVERT") || upper.includes("FAIL")) {
      return false;
    }
  }
  return true;
}

/** Turn raw genlayer-js and wallet errors into something a reader can act on. */
export function humanizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.toLowerCase();
  if (/user rejected|user denied|4001|rejected the request/.test(m))
    return "You declined the request in your wallet.";
  if (/insufficient funds|insufficient balance|not enough/.test(m))
    return "This account has no GEN for gas. Fund the address on StudioNet and retry.";
  if (/wrong network|chain|switch/.test(m)) return raw;
  return raw;
}

export function useGenLayer(wallet: WalletState): GenLayerApi {
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  const [version, setVersion] = useState(0);

  // Reads are wallet-free, so every panel loads for anyone.
  const readClient = useMemo(() => createClient({ chain: CHAIN }), []);

  const ready = Boolean(CONTRACT_ADDRESS) && CONTRACT_ADDRESS.startsWith("0x");
  const canWrite = ready && wallet.connected && wallet.onChain;

  const bump = useCallback(() => setVersion((value) => value + 1), []);
  const resetTx = useCallback(() => setTx({ phase: "idle" }), []);

  const assertReady = useCallback(() => {
    if (!ready) {
      throw new Error(
        "Set VITE_MOLFGRAPH_CONTRACT_ADDRESS in frontend/.env to the deployed MolfGraph address.",
      );
    }
  }, [ready]);

  const readRaw = useCallback(
    async (functionName: string, args: unknown[] = []): Promise<string> => {
      assertReady();
      const value = await (readClient as any).readContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args,
      });
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    [assertReady, readClient],
  );

  const read = useCallback(
    async <T,>(functionName: string, args: unknown[] = []): Promise<T> => {
      return parseJson<T>(await readRaw(functionName, args));
    },
    [readRaw],
  );

  const write = useCallback(
    async <T,>(functionName: string, args: unknown[] = []): Promise<TxOutcome<T>> => {
      assertReady();
      if (!wallet.connected) {
        throw new Error("Connect a wallet before writing to MolfGraph.");
      }

      setTx({ phase: "submitted", message: functionName });
      try {
        // Hard gate: guarantees the wallet is on the GenLayer chain, or throws.
        const provider = await ensureNetwork();
        const accounts = (await provider.request({
          method: "eth_requestAccounts",
        })) as string[];
        const signer = accounts?.[0];
        if (!signer) throw new Error("Wallet not connected.");

        const client = createClient({
          chain: CHAIN,
          account: signer as Hex,
          provider,
        } as any);

        const hash: string = await (client as any).writeContract({
          address: CONTRACT_ADDRESS,
          functionName,
          args,
          value: 0n,
        });

        setTx({ phase: "pending", hash, message: functionName });

        const receipt = await (client as any).waitForTransactionReceipt({
          hash,
          status: "FINALIZED",
          interval: 4000,
          retries: 90,
        });

        if (!receiptFinalized(receipt)) {
          setTx({
            phase: "failed",
            hash,
            message: functionName + " did not finalise successfully.",
          });
          return { hash, finalized: false, value: null, raw: receipt };
        }

        setTx({ phase: "finalized", hash, message: functionName });
        bump();
        return {
          hash,
          finalized: true,
          value: parseJson<T>(decodeReceiptReturn(receipt)),
          raw: receipt,
        };
      } catch (cause) {
        setTx({ phase: "failed", message: humanizeError(cause) });
        throw cause;
      }
    },
    [assertReady, bump, wallet.connected],
  );

  return {
    ready,
    canWrite,
    address: CONTRACT_ADDRESS,
    read,
    readRaw,
    write,
    tx,
    resetTx,
    version,
    bump,
  };
}

/** Small helper the panels use to load a view and keep it in step with writes. */
export function useAsyncView<T>(
  api: GenLayerApi,
  loader: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!api.ready) {
      setError("No contract address configured.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    loaderRef
      .current()
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.ready, api.version, nonce, ...deps]);

  return { data, error, loading, reload };
}
