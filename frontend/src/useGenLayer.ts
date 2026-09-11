import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "genlayer-js";
import { CHAIN, CONTRACT_ADDRESS, NETWORK_KEY } from "./config";
import { ensureNetwork } from "./lib/wallet";
import type { TxState } from "./types";
import type { WalletState } from "./useWallet";

/**
 * The single seam between MolfGraph's UI and the Intelligent Contract.
 *
 * Three rules are enforced here rather than in the panels:
 *   1. Reads never require a wallet. They use a chain-only client.
 *   2. A write counts as done only when the transaction finalises AND its
 *      execution result is a success. An ACCEPTED-but-reverted transaction is a
 *      failure, and never becomes an accepted edge or a ledger entry.
 *   3. Fees are estimated when the SDK can price them, and left to the node
 *      when it cannot. See the note on pinning below.
 *
 * SDK pinning: genlayer-js is held at 1.x on purpose. The 2.0 release candidate
 * encodes calldata in a newer wire format that the deployed StudioNet node
 * rejects, which breaks every read. When StudioNet updates, move to 2.x and the
 * fee/finality helpers below will start using the richer API automatically.
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
  /** Ask StudioNet to fund an address. Returns why it failed, if it did. */
  requestFunds: (address: string) => Promise<{ funded: boolean; error?: string }>;
}

function parseJson<T>(raw: unknown): T {
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

/** Read the leader receipt off a transaction, regardless of SDK key casing. */
function leaderReceiptOf(transaction: any): any {
  const cd = transaction?.consensus_data ?? transaction?.consensusData;
  return Array.isArray(cd?.leader_receipt) ? cd.leader_receipt[0] : cd?.leader_receipt;
}

/**
 * Pull the contract's return value out of a finalized transaction.
 *
 * The node wraps a write's return value two JSON layers deep:
 * `leader_receipt.result.payload.readable` is a JSON string containing the
 * contract's own `_canon_json(...)` string, so it takes two `JSON.parse`
 * calls to reach the actual object. Get this wrong and every write silently
 * returns null, which is why callers used to fall back to re-reading the
 * ledger after every write.
 */
function decodeReturn(transaction: any): unknown {
  if (!transaction) return null;
  const leader = leaderReceiptOf(transaction);
  const readable = leader?.result?.payload?.readable;

  if (typeof readable === "string") {
    try {
      const once = JSON.parse(readable);
      if (typeof once !== "string") return once;
      try {
        return JSON.parse(once);
      } catch {
        return once;
      }
    } catch {
      /* fall through to the legacy candidates below */
    }
  }

  const candidates = [
    transaction?.result,
    transaction?.returnValue,
    leader?.result?.readable,
    leader?.result,
    transaction?.data?.result,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
    if (candidate && typeof candidate === "object") return candidate;
  }
  return null;
}

function statusOf(transaction: any): string {
  return String(
    transaction?.statusName ?? transaction?.status_name ?? transaction?.status ?? "UNKNOWN",
  );
}

function executionOf(transaction: any): string {
  const leader = leaderReceiptOf(transaction);
  return String(
    transaction?.txExecutionResultName ??
      leader?.execution_result ??
      transaction?.execution_result ??
      "UNKNOWN",
  );
}

/**
 * A transaction only counts when it finalised AND the contract call itself
 * succeeded. GenLayer will happily finalise a transaction whose execution
 * reverted, and treating that as success is how a phantom edge gets drawn.
 */
function executionSucceeded(transaction: any): boolean {
  if (!transaction) return false;

  const execution = executionOf(transaction).toUpperCase();
  if (execution === "UNKNOWN") {
    // Nothing to judge on; fall back to the status alone.
    const status = statusOf(transaction).toUpperCase();
    return !/ERROR|REVERT|FAIL|UNDETERMINED|CANCEL/.test(status);
  }
  // FINISHED_WITH_RETURN and SUCCESS are the two shapes the node reports.
  if (!/SUCCESS|FINISHED_WITH_RETURN/.test(execution)) return false;

  const status = statusOf(transaction).toUpperCase();
  return !/ERROR|REVERT|FAIL|UNDETERMINED|CANCEL/.test(status);
}

/** Turn raw SDK and wallet errors into something a reader can act on. */
export function humanizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.toLowerCase();
  if (/user rejected|user denied|4001|rejected the request/.test(m))
    return "You declined the request in your wallet.";
  if (/insufficient funds|insufficient balance|not enough|no funds/.test(m))
    return (
      "This account has no StudioNet GEN for fees. Fund the address from the " +
      "Studio faucet, then retry."
    );
  if (/estimate|fee/.test(m) && /fail|error|revert/.test(m))
    return (
      "Fee estimation failed, so nothing was sent. The contract call may be " +
      "invalid, or the node is busy. Check the arguments and retry."
    );
  if (/wrong network|unrecognized chain|switch/.test(m)) return raw;
  if (/undetermined/.test(m))
    return "Validators could not agree (UNDETERMINED). Retry, or narrow the source URLs so they converge.";
  if (/timeout|timed out|deadline|exceeded/.test(m))
    return (
      "The network is taking longer than expected. The transaction may still " +
      "complete. Check the Ledger or the explorer in a few minutes."
    );
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
        "No contract address configured. Set VITE_MOLFGRAPH_CONTRACT_ADDRESS in frontend/.env.",
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

  /** Build a signing client for whichever wallet mode is active. */
  const signingClient = useCallback(async () => {
    if (wallet.mode === "local" && wallet.account) {
      // A local account signs through genlayer-js directly. connect() drives an
      // injected wallet and throws "MetaMask is not installed" here, so skip it.
      return createClient({ chain: CHAIN, account: wallet.account } as any);
    }
    if (wallet.mode === "external") {
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
      // Only meaningful for an injected wallet, and only on SDKs that have it.
      if (typeof (client as any).connect === "function") {
        await (client as any).connect(NETWORK_KEY).catch(() => {
          /* the provider is already the signer; ensureNetwork pinned the chain */
        });
      }
      return client;
    }
    throw new Error("Connect a wallet before writing to MolfGraph.");
  }, [wallet.mode, wallet.account]);

  const write = useCallback(
    async <T,>(functionName: string, args: unknown[] = []): Promise<TxOutcome<T>> => {
      assertReady();
      if (!wallet.connected) {
        throw new Error("Connect a wallet before writing to MolfGraph.");
      }

      setTx({ phase: "submitted", message: `${functionName}: estimating fees…` });
      try {
        const client = await signingClient();
        const call: Record<string, unknown> = {
          address: CONTRACT_ADDRESS,
          functionName,
          args,
          value: 0n,
        };

        // Price the call when this SDK can. On 1.x the node prices it, which is
        // what the live StudioNet deployment expects.
        const estimator = (client as any).estimateTransactionFeesForWrite;
        if (typeof estimator === "function") {
          try {
            const estimate = await estimator.call(client, {
              address: CONTRACT_ADDRESS,
              functionName,
              args,
            });
            call.fees = {
              distribution: estimate.distribution,
              feeValue: estimate.feeValue,
              messageAllocations: estimate.messageAllocations,
            };
          } catch (cause) {
            throw new Error(
              `Fee estimation failed, so nothing was sent: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            );
          }
        }

        setTx({
          phase: "submitted",
          message: call.fees
            ? `${functionName}: confirm to sign…`
            : `${functionName}: fees skipped, this SDK has no estimator. Confirm to sign…`,
        });
        const hash: string = await (client as any).writeContract(call);

        setTx({ phase: "pending", hash, message: `${functionName}: awaiting consensus…` });

        // Prefer the richer helper when present; otherwise wait on FINALIZED.
        const waitFinal = (client as any).waitForFinalization;
        const transaction =
          typeof waitFinal === "function"
            ? await waitFinal.call(client, { hash })
            : await (client as any).waitForTransactionReceipt({
                hash,
                status: "FINALIZED",
                interval: 5000,
                retries: 100,
              });

        if (!executionSucceeded(transaction)) {
          const detail = `${statusOf(transaction)} / ${executionOf(transaction)}`;
          setTx({ phase: "failed", hash, message: `${functionName} failed: ${detail}` });
          return { hash, finalized: false, value: null, raw: transaction };
        }

        setTx({ phase: "finalized", hash, message: functionName });
        bump();
        return {
          hash,
          finalized: true,
          value: parseJson<T>(decodeReturn(transaction)),
          raw: transaction,
        };
      } catch (cause) {
        setTx({ phase: "failed", message: humanizeError(cause) });
        throw cause;
      }
    },
    [assertReady, bump, signingClient, wallet.connected],
  );

  const requestFunds = useCallback(
    async (address: string) => {
      const fund = (readClient as any)?.fundAccount;
      if (typeof fund !== "function") {
        return { funded: false, error: "This node exposes no faucet method." };
      }
      try {
        await fund.call(readClient, { address, amount: 10n ** 18n });
        return { funded: true };
      } catch (cause) {
        return {
          funded: false,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
    [readClient],
  );

  return {
    ready,
    canWrite,
    requestFunds,
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
