import { useState } from "react";
import { LIMITS } from "../config";
import type { GenLayerApi } from "../useGenLayer";
import { useAsyncView } from "../useGenLayer";
import type { AnalysisResult, CaseRecord, Page } from "../types";
import { CountrySelect, Empty, Field, Loading, Notice, Panel, Pill, shortAddress } from "./ui";

/**
 * A deliberately thin matter registry.
 *
 * MolfGraph stores metadata a research graph needs and nothing more. The
 * contract refuses anything that looks like a personal identifier, and notes
 * stay readable only to the wallet that wrote them.
 */

export function Cases({ api, hasWallet }: { api: GenLayerApi; hasWallet: boolean }) {
  const [title, setTitle] = useState("");
  const [country, setCountry] = useState("US");
  const [matterRef, setMatterRef] = useState("");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [linkCase, setLinkCase] = useState(0);
  const [linkAnalysis, setLinkAnalysis] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const cases = useAsyncView<Page<CaseRecord>>(
    api,
    () => api.read<Page<CaseRecord>>("search_cases", [query, filterCountry]),
    [query, filterCountry],
  );

  const analyses = useAsyncView<Page<AnalysisResult>>(
    api,
    () => api.read<Page<AnalysisResult>>("list_analyses", [0, 100]),
    [],
  );

  async function createCase() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.write("register_case", [title, country, matterRef, notes]);
      setMessage("Matter registered. Notes stay visible only to your wallet.");
      setTitle("");
      setMatterRef("");
      setNotes("");
      cases.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function link() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.write("link_analysis_to_case", [linkCase, linkAnalysis]);
      setMessage(`Analysis #${linkAnalysis} linked to matter #${linkCase}.`);
      cases.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel
        title="Register a matter"
        intro="Minimal metadata only. The contract rejects e-mail addresses, identifier labels, and long digit runs that look like account or passport numbers."
      >
        <div className="grid two">
          <div>
            <Field label="Title" value={title} maxLength={LIMITS.MAX_TITLE}>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label="Jurisdiction">
              <CountrySelect value={country} onChange={setCountry} />
            </Field>
            <Field label="Matter reference" value={matterRef} maxLength={64}>
              <input value={matterRef} onChange={(event) => setMatterRef(event.target.value)} />
            </Field>
          </div>
          <div>
            <Field
              label="Notes"
              value={notes}
              maxLength={LIMITS.MAX_TEXT}
              hint="Readable only by the wallet that created the matter."
            >
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            <button className="primary" disabled={busy || !hasWallet || !title.trim()} onClick={createCase}>
              Register matter
            </button>
          </div>
        </div>

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
      </Panel>

      <Panel title="Matters" actions={<button className="small ghost" onClick={cases.reload}>Refresh</button>}>
        <div className="grid cards" style={{ marginBottom: 14 }}>
          <Field label="Search">
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </Field>
          <Field label="Jurisdiction">
            <CountrySelect value={filterCountry} onChange={setFilterCountry} includeAny />
          </Field>
        </div>

        {cases.loading ? <Loading what="matters" /> : null}
        {cases.error ? <Notice tone="bad">{cases.error}</Notice> : null}
        {!cases.loading && !(cases.data?.items ?? []).length ? (
          <Empty>No matters registered.</Empty>
        ) : (
          <div className="list">
            {(cases.data?.items ?? []).map((item) => (
              <div className="card" key={item.case_id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>
                    #{item.case_id} · {item.title}
                  </h3>
                  <div className="row" style={{ gap: 6 }}>
                    <Pill value={item.country || "—"} />
                    <Pill value={item.restricted ? "RESTRICTED" : "ACTIVE"} />
                  </div>
                </div>
                <div className="meta">
                  created by {shortAddress(item.creator)}
                  {item.matter_ref ? ` · ref ${item.matter_ref}` : ""}
                </div>
                {item.notes ? <p style={{ marginBottom: 4 }}>{item.notes}</p> : null}
                <div className="meta">
                  linked analyses: {item.analysis_ids.length ? item.analysis_ids.join(", ") : "none"}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <div>
              <h2>Link an analysis</h2>
              <p>Only the wallet that created a matter may attach analyses to it.</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="grid two">
              <Field label="Matter">
                <select value={linkCase || ""} onChange={(event) => setLinkCase(Number(event.target.value))}>
                  <option value="">Select a matter…</option>
                  {(cases.data?.items ?? []).map((item) => (
                    <option key={item.case_id} value={item.case_id}>
                      #{item.case_id} · {item.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Analysis">
                <select
                  value={linkAnalysis || ""}
                  onChange={(event) => setLinkAnalysis(Number(event.target.value))}
                >
                  <option value="">Select an analysis…</option>
                  {(analyses.data?.items ?? []).map((item) => (
                    <option key={item.analysis_id} value={item.analysis_id}>
                      #{item.analysis_id} · {item.kind} · {item.status}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <button
              className="primary"
              disabled={busy || !hasWallet || !linkCase || !linkAnalysis}
              onClick={link}
            >
              Link
            </button>
          </div>
        </div>
      </Panel>
    </>
  );
}
