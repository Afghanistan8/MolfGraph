/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOLFGRAPH_CONTRACT_ADDRESS?: string;
  readonly VITE_GENLAYER_RPC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
