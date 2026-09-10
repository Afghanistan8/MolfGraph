import { useState } from "react";
import type { GenLayerApi } from "../useGenLayer";
import { useAsyncView } from "../useGenLayer";
import type { Stats } from "../types";
import { CountrySelect, Empty, Field, Loading, Notice, Panel, shortAddress } from "./ui";

/**
 * The trusted source registry.
 *
 * Public to read, owner-only to change. Nothing outside these origins can
 * ground an analysis or back a piece of evidence.
 */

export function Sources({
  api,
  hasWallet,
  walletAddress,
}: {
  api: GenLayerApi;
  hasWallet: boolean;
  walletAddress: string;
}) {
  const [country, setCountry] = useState("US");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const registry = useAsyncView<Record<string, string[]>>(
    api,
    () => api.read<Record<string, string[]>>("get_trusted_sources", []),
    [],
  );

  const stats = useAsyncView<Stats>(api, () => api.read<Stats>("get_stats", []), []);

  const isOwner =
    Boolean(walletAddress) &&
    Boolean(stats.data?.owner) &&
    walletAddress.toLowerCase() === stats.data!.owner.toLowerCase();

  async function mutate(fn: "add_trusted_source" | "remove_trusted_source", target: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.write(fn, [country, target]);
      setMessage(
        fn === "add_trusted_source"
          ? `${target} is now a trusted origin for ${country}.`
          : `${target} was retired for ${country}. Past analyses stay auditable.`,
      );
      setUrl("");
      registry.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const entries = Object.entries(registry.data ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <Panel
        title="Trusted sources"
        intro="Official and primary law sites only. A caller-supplied URL is honoured only when its origin already appears here."
        actions={<button className="small ghost" onClick={registry.reload}>Refresh</button>}
      >
        {registry.loading ? <Loading what="the registry" /> : null}
        {registry.error ? <Notice tone="bad">{registry.error}</Notice> : null}

        {!registry.loading && !entries.length ? (
          <Empty>The registry is empty.</Empty>
        ) : (
          <div className="grid cards">
            {entries.map(([code, urls]) => (
              <div className="card" key={code}>
                <h3>{code}</h3>
                <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>
                  {urls.map((entry) => (
                    <li key={entry} className="mono" style={{ fontSize: 11.5, marginBottom: 4 }}>
                      <a href={entry} target="_blank" rel="noreferrer noopener">
                        {entry.replace("https://", "")}
                      </a>
                      {isOwner ? (
                        <button
                          className="small ghost"
                          style={{ marginLeft: 6 }}
                          disabled={busy}
                          onClick={() => {
                            setCountry(code);
                            void mutate("remove_trusted_source", entry);
                          }}
                        >
                          retire
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Registry administration"
        intro={
          isOwner
            ? "You hold the owner key for this deployment."
            : "Read-only. Only the deployment owner can change the registry."
        }
      >
        <div className="grid two">
          <div>
            <Field label="Jurisdiction">
              <CountrySelect value={country} onChange={setCountry} />
            </Field>
            <Field label="Origin or URL" hint="Must be HTTPS. Use the publisher's canonical origin.">
              <input
                className="mono"
                placeholder="https://www.legislation.gov.uk"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>
            <div className="row">
              <button
                className="primary"
                disabled={busy || !hasWallet || !isOwner || !url.startsWith("https://")}
                onClick={() => mutate("add_trusted_source", url)}
              >
                Add trusted source
              </button>
              <button
                className="ghost"
                disabled={busy || !hasWallet || !isOwner || !url.startsWith("https://")}
                onClick={() => mutate("remove_trusted_source", url)}
              >
                Retire source
              </button>
            </div>
          </div>
          <div>
            <dl className="kv">
              <dt>Owner</dt>
              <dd className="mono">{shortAddress(stats.data?.owner)}</dd>
              <dt>Your wallet</dt>
              <dd className="mono">{walletAddress ? shortAddress(walletAddress) : "not connected"}</dd>
            </dl>
            {message ? (
              <div style={{ marginTop: 12 }}>
                <Notice>{message}</Notice>
              </div>
            ) : null}
            {error ? (
              <div style={{ marginTop: 12 }}>
                <Notice tone="bad">{error}</Notice>
              </div>
            ) : null}
          </div>
        </div>
      </Panel>
    </>
  );
}
