import { useState } from "react";
import {
  CHAIN_HELP,
  CHAIN_ID,
  CONTRACT_ADDRESS,
  DISCLAIMER,
  NET,
  NETWORK_LABEL,
  RPC_URL,
} from "./config";
import { useWallet, type DiscoveredWallet, type WalletState } from "./useWallet";
import { useGenLayer } from "./useGenLayer";
import { shortAddress, switchNetwork } from "./lib/wallet";
import { Alerts } from "./components/Alerts";
import { Cases } from "./components/Cases";
import { Ledger } from "./components/Ledger";
import { LiveGraph } from "./components/LiveGraph";
import { RelationStudio, type Pinned } from "./components/RelationStudio";
import { Receipts } from "./components/Receipts";
import { ScreenTools } from "./components/ScreenTools";
import { Sources } from "./components/Sources";
import { Stats } from "./components/Stats";
import { StudyRegistry } from "./components/StudyRegistry";
import { Notice } from "./components/ui";

type TabId =
  | "screen"
  | "studies"
  | "relations"
  | "graph"
  | "ledger"
  | "receipts"
  | "alerts"
  | "cases"
  | "sources"
  | "stats";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "screen", label: "Screen" },
  { id: "studies", label: "Studies" },
  { id: "relations", label: "Relations" },
  { id: "graph", label: "Live graph" },
  { id: "ledger", label: "Ledger" },
  { id: "receipts", label: "Receipts" },
  { id: "alerts", label: "Alerts" },
  { id: "cases", label: "Matters" },
  { id: "sources", label: "Sources" },
  { id: "stats", label: "Stats" },
];

/**
 * Wallet controls: connect an injected browser wallet (MetaMask, OKX, or any
 * EIP-6963 wallet), with a wrong-network guard and manual chain-add details.
 */
function WalletBar({
  wallet,
  phase,
  hash,
  message,
}: {
  wallet: WalletState;
  phase: string;
  hash?: string;
  message?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function doConnect(detail?: DiscoveredWallet) {
    setError("");
    setBusy(true);
    const result = await wallet.connect(detail);
    setBusy(false);
    if (!result.ok) setError(result.error ?? "Wallet connection failed.");
    else setOpen(false);
  }

  async function doSwitch() {
    setError("");
    setBusy(true);
    try {
      await switchNetwork();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Switch failed.");
    }
    setBusy(false);
  }

  return (
    <div className="wallet">
      <div className="row">
        <span className="badge">
          <i className="dot" />
          {NETWORK_LABEL} · chain {CHAIN_ID}
        </span>

        {wallet.connected ? (
          <>
            {!wallet.onChain ? (
              <button
                className="small"
                onClick={doSwitch}
                disabled={busy}
                title={`Switch to ${NET.chainName}`}
              >
                Switch network
              </button>
            ) : null}
            <span className="badge" title={wallet.address ?? ""}>
              {wallet.onChain ? "Connected" : "Wrong network"}{" "}
              {shortAddress(wallet.address)}
            </span>
            <button className="small ghost" onClick={wallet.disconnect}>
              Disconnect
            </button>
          </>
        ) : (
          <div style={{ position: "relative" }}>
            <button
              className="small primary"
              onClick={() => setOpen((value) => !value)}
              disabled={busy}
            >
              {busy ? "Connecting…" : "Connect wallet"}
            </button>

            {open ? (
              <div className="wallet-menu">
                <div className="wm-title">Browser wallet</div>
                {wallet.discovered.length ? (
                  wallet.discovered.map((item) => (
                    <button
                      key={item.info.rdns ?? item.info.name}
                      className="wm-item"
                      disabled={busy}
                      onClick={() => doConnect(item)}
                    >
                      {item.info.icon ? (
                        <img src={item.info.icon} alt="" width={16} height={16} />
                      ) : null}
                      {item.info.name}
                    </button>
                  ))
                ) : (
                  <button className="wm-item" disabled={busy} onClick={() => doConnect()}>
                    MetaMask / OKX / injected
                  </button>
                )}

                <div className="wm-note">
                  You will be asked to add and switch to {NET.chainName} (chain{" "}
                  {CHAIN_HELP.chainIdDecimal}).{" "}
                  <button className="linklike" onClick={() => setShowHelp((v) => !v)}>
                    {showHelp ? "hide" : "how?"}
                  </button>
                </div>

                {showHelp ? (
                  <div className="wm-help">
                    <div>
                      <b>Network</b> {CHAIN_HELP.name}
                    </div>
                    <div>
                      <b>Chain ID</b> {CHAIN_HELP.chainIdDecimal} ({CHAIN_HELP.chainIdHex})
                    </div>
                    <div style={{ wordBreak: "break-all" }}>
                      <b>RPC</b> {CHAIN_HELP.rpc}
                    </div>
                    <div>
                      <b>Currency</b> {CHAIN_HELP.currency}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {error ? <span className="help">{error}</span> : null}

      {phase !== "idle" ? (
        <div className="tx-strip">
          <i className={`tx-dot ${phase}`} />
          <span>{phase}</span>
          {hash ? <span title={hash}>{shortAddress(hash)}</span> : null}
          {message ? <span>· {message}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<TabId>("screen");
  const [pinnedFrom, setPinnedFrom] = useState<Pinned | null>(null);
  const [pinnedTo, setPinnedTo] = useState<Pinned | null>(null);

  const wallet = useWallet();
  const api = useGenLayer(wallet);
  const canWrite = api.canWrite;

  function pin(studyId: number, version: number) {
    if (!pinnedFrom) setPinnedFrom({ studyId, version });
    else setPinnedTo({ studyId, version });
    setTab("relations");
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <h1>MolfGraph</h1>
            <span className="tagline">on-chain replication graph for legal screening</span>
          </div>
          <WalletBar
            wallet={wallet}
            phase={api.tx.phase}
            hash={api.tx.hash}
            message={api.tx.message}
          />
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              className="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="disclaimer-bar">{DISCLAIMER}</div>
      </header>

      <main className="main">
        {!CONTRACT_ADDRESS ? (
          <div style={{ marginBottom: 18 }}>
            <Notice tone="warn">
              No contract address configured. Copy <code>frontend/.env.example</code> to{" "}
              <code>frontend/.env</code> and set{" "}
              <code>VITE_MOLFGRAPH_CONTRACT_ADDRESS</code> to your deployed MolfGraph address.
            </Notice>
          </div>
        ) : null}

        {tab === "screen" ? <ScreenTools api={api} hasWallet={canWrite} /> : null}
        {tab === "studies" ? (
          <StudyRegistry api={api} hasWallet={canWrite} onPin={pin} />
        ) : null}
        {tab === "relations" ? (
          <RelationStudio
            api={api}
            hasWallet={canWrite}
            pinnedFrom={pinnedFrom}
            pinnedTo={pinnedTo}
            onPinFrom={setPinnedFrom}
            onPinTo={setPinnedTo}
          />
        ) : null}
        {tab === "graph" ? <LiveGraph api={api} /> : null}
        {tab === "ledger" ? <Ledger api={api} /> : null}
        {tab === "receipts" ? <Receipts api={api} /> : null}
        {tab === "alerts" ? <Alerts api={api} /> : null}
        {tab === "cases" ? <Cases api={api} hasWallet={canWrite} /> : null}
        {tab === "sources" ? (
          <Sources api={api} hasWallet={canWrite} walletAddress={wallet.address ?? ""} />
        ) : null}
        {tab === "stats" ? <Stats api={api} /> : null}
      </main>

      <footer className="footer">
        <p style={{ margin: "0 0 6px" }}>
          MolfGraph is a research instrument for qualified legal professionals. It does not
          practise law, does not give legal advice, and never judges guilt, innocence, or case
          outcomes. Every output is verified reference information grounded in public sources and
          requires professional review.
        </p>
        <p className="mono" style={{ margin: 0, fontSize: 11 }}>
          {CONTRACT_ADDRESS || "no contract configured"} · {RPC_URL}
        </p>
      </footer>
    </div>
  );
}
