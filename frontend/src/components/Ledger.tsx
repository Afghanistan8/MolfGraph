import { useState } from "react";
import { TOOLS } from "../tools";
import type { GenLayerApi } from "../useGenLayer";
import { useAsyncView } from "../useGenLayer";
import type { AnalysisResult, Page } from "../types";
import { ResultCard } from "./ScreenTools";
import { CountrySelect, Empty, Field, Hash, Loading, Notice, Panel, Pill } from "./ui";

/** Every analysis MolfGraph has ever run, including the ones that failed closed. */

const STATUSES = ["VERIFIED", "INSUFFICIENT_EVIDENCE", "UNAVAILABLE", "CONFLICT"];

export function Ledger({
  api,
  onGoToScreen,
}: {
  api: GenLayerApi;
  onGoToScreen?: () => void;
}) {
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [country, setCountry] = useState("");
  const [open, setOpen] = useState<AnalysisResult | null>(null);

  const analyses = useAsyncView<Page<AnalysisResult>>(
    api,
    () =>
      kind || status || country
        ? api.read<Page<AnalysisResult>>("search_analyses", [kind, status, country])
        : api.read<Page<AnalysisResult>>("list_analyses", [0, 100]),
    [kind, status, country],
  );

  const items = (analyses.data?.items ?? []).slice().reverse();

  return (
    <>
      <Panel
        title="Analysis ledger"
        intro="Public, append-only, and complete. A run that could not be grounded is recorded exactly as it landed."
        actions={<button className="small ghost" onClick={analyses.reload}>Refresh</button>}
      >
        <div className="grid cards" style={{ marginBottom: 16 }}>
          <Field label="Tool">
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">Any tool</option>
              {TOOLS.map((tool) => (
                <option key={tool.kind} value={tool.kind}>
                  {tool.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Any status</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Jurisdiction">
            <CountrySelect value={country} onChange={setCountry} includeAny />
          </Field>
        </div>

        {analyses.loading ? <Loading what="the ledger" /> : null}
        {analyses.error ? <Notice tone="bad">{analyses.error}</Notice> : null}

        {!analyses.loading && !items.length ? (
          <Empty>
            <div style={{ marginBottom: 10 }}>
              {kind || status || country
                ? "No analyses match those filters."
                : "This chain has no analyses yet."}
            </div>
            {onGoToScreen && !kind && !status && !country ? (
              <button className="small primary" onClick={onGoToScreen}>
                Run a screening tool
              </button>
            ) : null}
          </Empty>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tool</th>
                  <th>Status</th>
                  <th>Confidence</th>
                  <th>Citation</th>
                  <th>Jurisdiction</th>
                  <th>Source set</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((analysis) => (
                  <tr key={analysis.analysis_id}>
                    <td className="mono">{analysis.analysis_id}</td>
                    <td>{analysis.kind}</td>
                    <td>
                      <Pill value={analysis.status} />
                    </td>
                    <td>
                      <Pill value={analysis.confidence} />
                    </td>
                    <td className="citation">{analysis.citation || "—"}</td>
                    <td className="mono">{analysis.country || "—"}</td>
                    <td>
                      <Hash value={analysis.source_set_sha256} />
                    </td>
                    <td>
                      <button className="small ghost" onClick={() => setOpen(analysis)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {open ? (
        <Panel
          title={`Analysis #${open.analysis_id}`}
          actions={<button className="small ghost" onClick={() => setOpen(null)}>Close</button>}
        >
          <ResultCard result={open} />
        </Panel>
      ) : null}
    </>
  );
}
