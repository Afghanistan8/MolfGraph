import type { GenLayerApi } from "../useGenLayer";
import { useAsyncView } from "../useGenLayer";
import type { Alert, Page } from "../types";
import { Empty, Loading, Notice, Panel, Pill, shortAddress } from "./ui";

/**
 * Alerts are raised automatically: low confidence, conflicting sources, an
 * unreachable source, insufficient evidence, or a digest that stopped matching.
 */

export function Alerts({ api }: { api: GenLayerApi }) {
  const alerts = useAsyncView<Page<Alert>>(
    api,
    () => api.read<Page<Alert>>("get_alerts", [0, 100]),
    [],
  );

  const items = (alerts.data?.items ?? []).slice().reverse();

  return (
    <Panel
      title="Alerts"
      intro="Raised by the contract, not by the interface. Each one marks a place where a lawyer must look before relying on a result."
      actions={<button className="small ghost" onClick={alerts.reload}>Refresh</button>}
    >
      {alerts.loading ? <Loading what="alerts" /> : null}
      {alerts.error ? <Notice tone="bad">{alerts.error}</Notice> : null}

      {!alerts.loading && !items.length ? (
        <Empty>No alerts. Nothing has failed closed yet.</Empty>
      ) : (
        <div className="list">
          {items.map((alert) => (
            <div className="card" key={alert.alert_id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3>
                  #{alert.alert_id} · <span className="mono">{alert.kind}</span>
                </h3>
                <Pill value={alert.severity} prefix="severity " />
              </div>
              <p style={{ margin: "6px 0 8px" }}>{alert.message}</p>
              <div className="meta">
                raised by {shortAddress(alert.actor)}
                {Object.keys(alert.refs ?? {}).length
                  ? ` · ${Object.entries(alert.refs)
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join(" · ")}`
                  : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
