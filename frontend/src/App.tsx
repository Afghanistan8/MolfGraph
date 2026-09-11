import { useState } from "react";
import { CONTRACT_ADDRESS, DISCLAIMER } from "./config";
import { useWallet } from "./useWallet";
import { useGenLayer } from "./useGenLayer";
import { WalletBar } from "./components/WalletBar";
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
            requestFunds={api.requestFunds}
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
        {tab === "graph" ? (
          <LiveGraph api={api} onGoToStudies={() => setTab("studies")} />
        ) : null}
        {tab === "ledger" ? (
          <Ledger api={api} onGoToScreen={() => setTab("screen")} />
        ) : null}
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
      </footer>
    </div>
  );
}
