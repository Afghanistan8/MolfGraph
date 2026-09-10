import { useState } from "react";
import type { GenLayerApi } from "../useGenLayer";
import { useAsyncView } from "../useGenLayer";
import type { Page, Receipt } from "../types";
import { Empty, Field, Hash, Loading, Notice, Panel, Pill, shortAddress } from "./ui";

/** Append-only provenance. One row per state change MolfGraph considers auditable. */

const KINDS = ["STUDY_VERSION", "CORRECTION", "ANALYSIS", "EDGE", "ALERT"];

export function Receipts({ api }: { api: GenLayerApi }) {
  const [kind, setKind] = useState("");

  const receipts = useAsyncView<Page<Receipt>>(
    api,
    () => api.read<Page<Receipt>>("list_receipts", [0, 100]),
    [],
  );

  const items = (receipts.data?.items ?? [])
    .filter((receipt) => !kind || receipt.kind === kind)
    .slice()
    .reverse();

  return (
    <Panel
      title="Provenance receipts"
      intro="Every study version, correction, analysis, edge and alert leaves a receipt. Receipts are never rewritten."
      actions={<button className="small ghost" onClick={receipts.reload}>Refresh</button>}
    >
      <div style={{ maxWidth: 280, marginBottom: 14 }}>
        <Field label="Kind">
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">Any kind</option>
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {receipts.loading ? <Loading what="receipts" /> : null}
      {receipts.error ? <Notice tone="bad">{receipts.error}</Notice> : null}

      {!receipts.loading && !items.length ? (
        <Empty>No receipts recorded yet.</Empty>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Kind</th>
                <th>Actor</th>
                <th>Studies</th>
                <th>Versions</th>
                <th>Content hash</th>
                <th>Source set</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {items.map((receipt) => (
                <tr key={receipt.receipt_id}>
                  <td className="mono">{receipt.receipt_id}</td>
                  <td>
                    <Pill value={receipt.kind} />
                  </td>
                  <td className="mono">{shortAddress(receipt.actor)}</td>
                  <td className="mono">{receipt.study_ids.join(", ") || "—"}</td>
                  <td className="mono">{receipt.versions.join(", ") || "—"}</td>
                  <td>
                    <Hash value={receipt.content_sha256} />
                  </td>
                  <td>
                    <Hash value={receipt.source_set_sha256} />
                  </td>
                  <td className="mono">{receipt.tx_context}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
