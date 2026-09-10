import { studionet } from "genlayer-js/chains";

/**
 * MolfGraph targets GenLayer StudioNet only. There is no network selector: a
 * legal-research instrument should not let a reader wonder which chain a
 * receipt came from. The chain object comes from the SDK; only the RPC
 * endpoint is overridable.
 */
export const RPC_URL: string =
  import.meta.env.VITE_GENLAYER_RPC ?? "https://studio.genlayer.com/api";

export const CONTRACT_ADDRESS = (
  import.meta.env.VITE_MOLFGRAPH_CONTRACT_ADDRESS ?? ""
).trim() as `0x${string}`;

export const CHAIN_ID = studionet.id;

export const CHAIN = {
  ...studionet,
  rpcUrls: {
    ...studionet.rpcUrls,
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
};

export const NETWORK_LABEL = "StudioNet";

export const EXPLORER_URL = "https://genlayer-explorer.vercel.app";

export const DISCLAIMER =
  "Decision-support only — not legal advice. Professional review required.";

export const WALLET_STORAGE_KEY = "molfgraph.wallet.pk";

/** Mirrors the caps the contract enforces, so the UI fails before a wallet does. */
export const LIMITS = {
  MAX_TITLE: 160,
  MAX_TEXT: 4000,
  MAX_URLS: 8,
  MAX_RECORDS_PER_VERSION: 12,
  MAX_GRAPH_NEIGHBORS: 25,
  MAX_KNN: 5,
} as const;

export const COUNTRIES = [
  { code: "US", label: "United States" },
  { code: "UK", label: "United Kingdom" },
  { code: "EU", label: "European Union" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "IN", label: "India" },
  { code: "NG", label: "Nigeria" },
  { code: "KE", label: "Kenya" },
  { code: "ZA", label: "South Africa" },
  { code: "INTERNATIONAL", label: "International" },
] as const;

export const RECORD_TYPES = [
  "CRIME",
  "JUDGEMENT",
  "QUESTION",
  "METHOD",
  "CONCLUSION",
] as const;

export const RELATION_TYPES = [
  "DIRECT_REPLICATION",
  "MATERIAL_VARIANT",
  "EXTENSION",
  "CONTRADICTORY_RESULT",
  "INCOMPARABLE",
  "INSUFFICIENT",
] as const;

/** Edge colours on the live graph. Kept in one place so legend and canvas agree. */
export const RELATION_COLORS: Record<string, string> = {
  DIRECT_REPLICATION: "#4ade80",
  MATERIAL_VARIANT: "#60a5fa",
  EXTENSION: "#c084fc",
  CONTRADICTORY_RESULT: "#f87171",
  INCOMPARABLE: "#94a3b8",
  INSUFFICIENT: "#64748b",
};

export const COUNTRY_COLORS: Record<string, string> = {
  US: "#38bdf8",
  UK: "#f472b6",
  EU: "#facc15",
  CA: "#fb923c",
  AU: "#34d399",
  IN: "#a78bfa",
  NG: "#4ade80",
  KE: "#22d3ee",
  ZA: "#fca5a5",
  INTERNATIONAL: "#cbd5e1",
};

export function countryColor(code: string): string {
  return COUNTRY_COLORS[code] ?? "#94a3b8";
}

export function relationColor(relation: string): string {
  return RELATION_COLORS[relation] ?? "#94a3b8";
}
