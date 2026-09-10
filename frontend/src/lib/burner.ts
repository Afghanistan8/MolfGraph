/* src/lib/burner.ts
 *
 * A local StudioNet account, generated or imported in the browser and signed
 * with by genlayer-js directly. This exists so a visitor can try the demo
 * without installing an extension.
 *
 * It is testnet only. The key lives in localStorage, which is readable by any
 * script on this origin, so nothing of value should ever be held here.
 */
import { createAccount, generatePrivateKey } from "genlayer-js";
import type { Account } from "genlayer-js/types";
import { WALLET_STORAGE_KEY } from "../config";

export type Hex = `0x${string}`;

export function isValidKey(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

export function createBurnerKey(): Hex {
  const key = generatePrivateKey() as Hex;
  saveBurnerKey(key);
  return key;
}

export function saveBurnerKey(key: Hex): void {
  try {
    localStorage.setItem(WALLET_STORAGE_KEY, key);
  } catch {
    /* private browsing: the account simply does not persist */
  }
}

export function loadBurnerKey(): Hex | null {
  try {
    const stored = localStorage.getItem(WALLET_STORAGE_KEY);
    return stored && isValidKey(stored) ? (stored as Hex) : null;
  } catch {
    return null;
  }
}

export function clearBurnerKey(): void {
  try {
    localStorage.removeItem(WALLET_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function accountFromKey(key: Hex): Account {
  return createAccount(key);
}

/**
 * Ask StudioNet to fund an address.
 *
 * The Studio exposes a faucet through the SDK on some deployments and only
 * through the droplet button in its own UI on others, so treat failure as
 * normal and fall back to telling the user where to click.
 */
export async function tryFundBurner(
  client: unknown,
  address: string,
  amount = 10n ** 18n,
): Promise<{ funded: boolean; error?: string }> {
  const fund = (client as { fundAccount?: (args: unknown) => Promise<unknown> })?.fundAccount;
  if (typeof fund !== "function") {
    return { funded: false, error: "This node exposes no faucet method." };
  }
  try {
    await fund.call(client, { address, amount });
    return { funded: true };
  } catch (cause) {
    return {
      funded: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
