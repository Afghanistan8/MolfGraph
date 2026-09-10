import { useMemo, useState } from "react";
import { DISCLAIMER } from "../config";
import { TOOLS, encodeUrls, type ToolSpec } from "../tools";
import type { GenLayerApi } from "../useGenLayer";
import type { AnalysisResult } from "../types";
import { CountrySelect, Disclaimer, Field, Hash, Notice, Panel, Pill } from "./ui";

/**
 * The eight source-grounded screening tools.
 *
 * Every run is a consensus write. The card below shows exactly what the chain
 * recorded, including a downgraded status. The UI never upgrades a result.
 */

function initialValues(tool: ToolSpec): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of tool.fields) {
    if (field.kind === "country") values[field.name] = "US";
    else if (field.kind === "number") values[field.name] = "1";
    else values[field.name] = "";
  }
  return values;
}

export function ResultCard({ result }: { result: AnalysisResult }) {
  const neighbours = result.neighbors_context_only ?? [];
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div className="row">
          <Pill value={result.status} />
          <Pill value={result.confidence} prefix="confidence " />
          <Pill value={result.applicability_bucket} prefix="applicability " />
        </div>
        <span className="meta">
          {result.kind}
          {result.analysis_id ? ` · analysis #${result.analysis_id}` : ""}
        </span>
      </div>

      <dl className="kv">
        <dt>Citation</dt>
        <dd className="citation">{result.citation || "none recorded"}</dd>

        <dt>Score</dt>
        <dd className="mono">{result.applicability_score}/100</dd>

        {result.study_id ? (
          <>
            <dt>Pinned study</dt>
            <dd className="mono">
              study {result.study_id} · version {result.study_version}
            </dd>
          </>
        ) : null}

        <dt>Source set</dt>
        <dd>
          <Hash value={result.source_set_sha256} />
        </dd>
      </dl>

      {result.exact_text_or_summary ? (
        <div className="excerpt" style={{ marginTop: 12 }}>
          {result.exact_text_or_summary}
        </div>
      ) : null}

      {result.notes ? (
        <p style={{ marginTop: 10, color: "var(--text-dim)", fontSize: 12.5 }}>{result.notes}</p>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <div className="meta" style={{ marginBottom: 4 }}>
          VERIFIED SOURCES ({result.sources.length})
        </div>
        {result.sources.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {result.sources.map((url) => (
              <li key={url} className="mono" style={{ fontSize: 12 }}>
                <a href={url} target="_blank" rel="noreferrer noopener">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta">No source was readable. MolfGraph refused to answer.</p>
        )}
      </div>

      {neighbours.length ? (
        <div className="drawer" style={{ marginTop: 14 }}>
          <h3>Semantic neighbours — context only</h3>
          <p className="meta" style={{ marginBottom: 8 }}>
            Retrieved from VecDB to orient the reader. These are not evidence, not citations,
            and they never create graph edges.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {neighbours.map((record) => (
              <li key={record.record_id} style={{ fontSize: 12.5 }}>
                <span className="mono">
                  [{record.record_type} · study {record.study_id} v{record.version}]
                </span>{" "}
                {record.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <Disclaimer text={result.disclaimer || DISCLAIMER} />
      </div>
    </div>
  );
}

export function ScreenTools({ api, hasWallet }: { api: GenLayerApi; hasWallet: boolean }) {
  const [toolKind, setToolKind] = useState(TOOLS[0].kind);
  const tool = useMemo(() => TOOLS.find((item) => item.kind === toolKind) ?? TOOLS[0], [toolKind]);
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(TOOLS[0]));
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function selectTool(kind: string) {
    const next = TOOLS.find((item) => item.kind === kind) ?? TOOLS[0];
    setToolKind(next.kind);
    setValues(initialValues(next));
    setResult(null);
    setError("");
  }

  function setValue(name: string, next: string) {
    setValues((current) => ({ ...current, [name]: next }));
  }

  const missing = tool.fields
    .filter((field) => field.required && !values[field.name]?.trim())
    .map((field) => field.label);

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const args = tool.args.map((name) => {
        const field = tool.fields.find((item) => item.name === name);
        const raw = values[name] ?? "";
        if (field?.kind === "urls") return encodeUrls(raw);
        if (field?.kind === "number") {
          // The ABI takes u256. Never send a float, an empty string, or 0 for
          // an id the contract will reject anyway.
          const parsed = Math.trunc(Number(raw));
          if (!Number.isFinite(parsed) || parsed < 1) {
            throw new Error(`${field.label} must be a whole number of at least 1.`);
          }
          return parsed;
        }
        return raw;
      });
      const outcome = await api.write<AnalysisResult>(tool.functionName, args);
      if (!outcome.finalized) {
        setError("The transaction did not finalise. Nothing was recorded on the ledger.");
        return;
      }
      if (outcome.value && typeof outcome.value === "object") {
        setResult(outcome.value);
        return;
      }
      // Receipt shapes differ between genlayer-js releases; fall back to the ledger.
      const page = await api.read<{ total: number }>("list_analyses", [0, 1]);
      if (page.total > 0) {
        const latest = await api.read<{ items: AnalysisResult[] }>("list_analyses", [
          page.total - 1,
          1,
        ]);
        setResult(latest.items[0] ?? null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Screen"
      intro="Source-grounded screening against official law sites. Every run is adjudicated by validator consensus and written to the public ledger, including its failures."
    >
      <div className="grid two">
        <div>
          <Field label="Tool">
            <select value={toolKind} onChange={(event) => selectTool(event.target.value)}>
              {TOOLS.map((item) => (
                <option key={item.kind} value={item.kind}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <p className="help" style={{ marginTop: -8, marginBottom: 16 }}>
            {tool.summary}
          </p>

          {tool.fields.map((field) => (
            <Field
              key={field.name}
              label={field.label}
              hint={field.help}
              value={values[field.name]}
              maxLength={field.maxLength}
            >
              {field.kind === "country" ? (
                <CountrySelect
                  value={values[field.name] ?? "US"}
                  onChange={(next) => setValue(field.name, next)}
                />
              ) : field.kind === "textarea" || field.kind === "urls" ? (
                <textarea
                  value={values[field.name] ?? ""}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                  onChange={(event) => setValue(field.name, event.target.value)}
                />
              ) : (
                <input
                  type={field.kind === "number" ? "number" : "text"}
                  min={field.kind === "number" ? 1 : undefined}
                  value={values[field.name] ?? ""}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                  onChange={(event) => setValue(field.name, event.target.value)}
                />
              )}
            </Field>
          ))}

          <div className="row">
            <button
              className="primary"
              onClick={run}
              disabled={busy || !hasWallet || missing.length > 0 || !api.ready}
            >
              {busy ? "Running consensus…" : `Run ${tool.label.toLowerCase()}`}
            </button>
            {missing.length ? <span className="help">Required: {missing.join(", ")}</span> : null}
          </div>

          {!hasWallet ? (
            <div style={{ marginTop: 12 }}>
              <Notice>Reading MolfGraph needs no wallet. Running a tool writes to the ledger, so it does.</Notice>
            </div>
          ) : null}
        </div>

        <div>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          {result ? (
            <ResultCard result={result} />
          ) : !error ? (
            <div className="empty">
              Results appear here once consensus finalises. A run that cannot reach a trusted
              source is recorded as UNAVAILABLE rather than answered.
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
