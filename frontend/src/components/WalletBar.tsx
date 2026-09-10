import { useState } from "react";
import {
  CHAIN_HELP,
  CHAIN_ID,
  FAUCET_URL,
  NET,
  NETWORK_LABEL,
  explorerAddress,
  explorerTx,
} from "../config";
import { shortAddress, switchNetwork } from "../lib/wallet";
import type { DiscoveredWallet, WalletState } from "../useWallet";

/**
 * Wallet controls.
 *
 * StudioNet has no public RPC faucet, so the demo path is a local account plus
 * the Studio's own droplet button. An injected wallet stays available for
 * anyone who already holds StudioNet GEN.
 */
export function WalletBar({
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
  const [keyInput, setKeyInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  function flash(what: string) {
    setCopied(what);
    setTimeout(() => setCopied(""), 1600);
  }

  async function doConnectExternal(detail?: DiscoveredWallet) {
    setError("");
    setBusy(true);
    const result = await wallet.connectExternal(detail);
    setBusy(false);
    if (!result.ok) setError(result.error ?? "Wallet connection failed.");
    else setOpen(false);
  }

  function doCreateLocal() {
    setError("");
    const result = wallet.createLocal();
    if (!result.ok) setError(result.error ?? "Could not create a local account.");
    else setOpen(false);
  }

  function doImport() {
    setError("");
    const result = wallet.importLocal(keyInput);
    if (!result.ok) setError(result.error ?? "Could not import that key.");
    else {
      setOpen(false);
      setKeyInput("");
    }
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

  const isLocal = wallet.mode === "local";

  return (
    <div className="wallet">
      <div className="row">
        <span className="badge">
          <i className="dot" />
          {NETWORK_LABEL} · chain {CHAIN_ID}
        </span>

        {wallet.connected ? (
          <>
            {!isLocal && !wallet.onChain ? (
              <button className="small warn-btn" onClick={doSwitch} disabled={busy}>
                Switch to {NET.chainName}
              </button>
            ) : null}

            <a
              className="badge badge-link"
              href={explorerAddress(wallet.address ?? "")}
              target="_blank"
              rel="noreferrer noopener"
              title={wallet.address ?? ""}
            >
              {isLocal ? "Local" : wallet.onChain ? "Connected" : "Wrong network"}{" "}
              {shortAddress(wallet.address)}
            </a>

            {isLocal ? (
              <button
                className="small ghost"
                title="Copy this account's private key. Testnet only."
                onClick={() => {
                  const key = wallet.exportKey();
                  if (key) void navigator.clipboard?.writeText(key);
                  flash("key");
                }}
              >
                {copied === "key" ? "Copied" : "Copy key"}
              </button>
            ) : null}

            <button
              className="small ghost"
              onClick={() => {
                if (wallet.address) void navigator.clipboard?.writeText(wallet.address);
                flash("addr");
              }}
            >
              {copied === "addr" ? "Copied" : "Copy address"}
            </button>

            <a className="small btn-link" href={FAUCET_URL} target="_blank" rel="noreferrer noopener">
              Get GEN
            </a>

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
                <div className="wm-title">Try it now, no extension</div>
                <button className="wm-item" onClick={doCreateLocal} disabled={busy}>
                  Create local StudioNet account
                </button>
                <div className="wm-note">
                  A throwaway key generated in this browser. Fund it from the{" "}
                  <a href={FAUCET_URL} target="_blank" rel="noreferrer noopener">
                    Studio faucet
                  </a>{" "}
                  using the droplet on the account selector. Testnet only, never
                  for real funds.
                </div>

                <div className="wm-divider" />

                <div className="wm-title">Browser wallet</div>
                {wallet.discovered.length ? (
                  wallet.discovered.map((item) => (
                    <button
                      key={item.info.rdns ?? item.info.name}
                      className="wm-item"
                      disabled={busy}
                      onClick={() => doConnectExternal(item)}
                    >
                      {item.info.icon ? (
                        <img src={item.info.icon} alt="" width={16} height={16} />
                      ) : null}
                      {item.info.name}
                    </button>
                  ))
                ) : (
                  <button className="wm-item" disabled={busy} onClick={() => doConnectExternal()}>
                    MetaMask / OKX / injected
                  </button>
                )}
                <div className="wm-note">
                  You will be asked to add and switch to {NET.chainName} (chain{" "}
                  {CHAIN_HELP.chainIdDecimal}).{" "}
                  <button className="linklike" onClick={() => setShowHelp((v) => !v)}>
                    {showHelp ? "hide" : "details"}
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

                <div className="wm-divider" />

                <div className="wm-title">Import a testnet key</div>
                <div className="wm-import">
                  <input
                    className="mono"
                    value={keyInput}
                    placeholder="0x… 64 hex"
                    onChange={(event) => setKeyInput(event.target.value)}
                  />
                  <button className="small" disabled={!keyInput.trim()} onClick={doImport}>
                    Import
                  </button>
                </div>

                {error ? <div className="wm-err">{error}</div> : null}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {error && !open ? <span className="help wallet-err">{error}</span> : null}

      {phase !== "idle" ? (
        <div className="tx-strip">
          <i className={`tx-dot ${phase}`} />
          <span>{phase}</span>
          {hash ? (
            <a href={explorerTx(hash)} target="_blank" rel="noreferrer noopener" title={hash}>
              {shortAddress(hash)}
            </a>
          ) : null}
          {message ? <span>· {message}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
