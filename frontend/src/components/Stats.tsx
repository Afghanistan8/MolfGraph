import { CONTRACT_ADDRESS } from "../config";
import type { GenLayerApi } from "../useGenLayer";
import { useAsyncView } from "../useGenLayer";
import type { Stats as StatsPayload } from "../types";
import { Hash, Loading, Notice, Panel } from "./ui";

/** Counters the contract maintains itself, so the numbers cannot drift from state. */

const GROUPS: Array<{ heading: string; keys: Array<[keyof StatsPayload, string]> }> = [
  {
    heading: "Graph",
    keys: [
      ["total_studies", "Studies"],
      ["total_versions", "Immutable versions"],
      ["total_edges", "Accepted edges"],
      ["total_claims", "Relation claims"],
    ],
  },
  {
    heading: "Screening",
    keys: [
      ["total_analyses", "Analyses"],
      ["stat_verified", "Verified"],
      ["stat_insufficient", "Insufficient"],
      ["stat_unavailable", "Unavailable"],
      ["stat_conflicts", "Conflicts"],
      ["stat_low_confidence", "Low confidence"],
    ],
  },
  {
    heading: "Integrity",
    keys: [
      ["total_evidence", "Pinned evidence"],
      ["stat_hash_mismatch", "Digest failures"],
      ["stat_alerts", "Alerts raised"],
      ["total_receipts", "Receipts"],
      ["total_cases", "Matters"],
    ],
  },
];

export function Stats({ api }: { api: GenLayerApi }) {
  const stats = useAsyncView<StatsPayload>(api, () => api.read<StatsPayload>("get_stats", []), []);

  if (stats.loading) {
    return (
      <Panel title="Statistics">
        <Loading what="statistics" />
      </Panel>
    );
  }

  if (stats.error || !stats.data) {
    return (
      <Panel title="Statistics">
        <Notice tone="bad">{stats.error || "Statistics are unavailable."}</Notice>
      </Panel>
    );
  }

  const data = stats.data;

  return (
    <>
      {GROUPS.map((group) => (
        <Panel key={group.heading} title={group.heading}>
          <div className="grid cards">
            {group.keys.map(([key, label]) => (
              <div className="stat" key={String(key)}>
                <div className="value">{String(data[key] ?? 0)}</div>
                <div className="label">{label}</div>
              </div>
            ))}
          </div>
        </Panel>
      ))}

      <Panel title="Deployment">
        <dl className="kv">
          <dt>Contract</dt>
          <dd>
            <Hash value={CONTRACT_ADDRESS} />
          </dd>
          <dt>Owner</dt>
          <dd>
            <Hash value={data.owner} />
          </dd>
          <dt>Network</dt>
          <dd className="mono">GenLayer StudioNet · chain 61999</dd>
        </dl>
        <div style={{ marginTop: 12 }}>
          <Notice tone="warn">{data.disclaimer}</Notice>
        </div>
      </Panel>
    </>
  );
}
