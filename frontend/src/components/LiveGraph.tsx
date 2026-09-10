import { useMemo, useState } from "react";
import { LIMITS, RELATION_TYPES, countryColor, relationColor } from "../config";
import type { GenLayerApi } from "../useGenLayer";
import { useAsyncView } from "../useGenLayer";
import type {
  Graph,
  GraphEdge,
  GraphNode,
  NeighborRecord,
  Page,
  Receipt,
  StudyVersion,
} from "../types";
import { Empty, Field, Hash, Loading, Notice, Panel, Pill } from "./ui";

/**
 * The live research graph.
 *
 * Nodes are study versions. Edges are accepted consensus edges and nothing
 * else: a pending claim, an INSUFFICIENT decision, or a failed digest check
 * never reaches this canvas.
 */

const WIDTH = 900;
const HEIGHT = 520;
const RADIUS = 22;

interface Placed extends GraphNode {
  x: number;
  y: number;
}

function place(nodes: GraphNode[]): Placed[] {
  const centreX = WIDTH / 2;
  const centreY = HEIGHT / 2;
  const ring = Math.min(centreX, centreY) - 70;
  return nodes.map((node, index) => {
    const angle = (2 * Math.PI * index) / Math.max(1, nodes.length) - Math.PI / 2;
    return { ...node, x: centreX + ring * Math.cos(angle), y: centreY + ring * Math.sin(angle) };
  });
}

export function LiveGraph({
  api,
  onGoToStudies,
}: {
  api: GenLayerApi;
  onGoToStudies?: () => void;
}) {
  const [selectedNode, setSelectedNode] = useState<string>("");
  const [selectedEdge, setSelectedEdge] = useState<number>(0);
  const [query, setQuery] = useState("");
  const [neighbours, setNeighbours] = useState<NeighborRecord[] | null>(null);
  const [neighbourError, setNeighbourError] = useState("");
  const [neighbourNote, setNeighbourNote] = useState("");

  const graph = useAsyncView<Graph>(
    api,
    () => api.read<Graph>("get_graph", [LIMITS.MAX_GRAPH_NEIGHBORS]),
    [],
  );

  const nodes = useMemo(() => place(graph.data?.nodes ?? []), [graph.data]);
  const nodeIndex = useMemo(
    () => new Map(nodes.map((node) => [node.node_id, node])),
    [nodes],
  );
  const edges = graph.data?.edges ?? [];

  const detail = useAsyncView<StudyVersion | null>(
    api,
    async () => {
      if (!selectedNode) return null;
      const [studyId, version] = selectedNode.split(":");
      return api.read<StudyVersion>("get_study_version", [Number(studyId), Number(version)]);
    },
    [selectedNode],
  );

  const receipts = useAsyncView<Page<Receipt>>(
    api,
    () => api.read<Page<Receipt>>("list_receipts", [0, 100]),
    [],
  );

  const incident = useAsyncView<{ out: GraphEdge[]; into: GraphEdge[] }>(
    api,
    async () => {
      if (!selectedNode) return { out: [], into: [] };
      const [studyId, version] = selectedNode.split(":").map(Number);
      const [out, into] = await Promise.all([
        api.read<Page<GraphEdge>>("get_edges_from", [studyId, version]),
        api.read<Page<GraphEdge>>("get_edges_to", [studyId, version]),
      ]);
      return { out: out.items ?? [], into: into.items ?? [] };
    },
    [selectedNode],
  );

  const edge: GraphEdge | undefined = edges.find((item) => item.edge_id === selectedEdge);

  const nodeReceipts = (receipts.data?.items ?? []).filter((receipt) => {
    if (!selectedNode) return false;
    const [studyId] = selectedNode.split(":");
    return receipt.study_ids.includes(Number(studyId));
  });

  async function findNeighbours() {
    setNeighbourError("");
    setNeighbours(null);
    setNeighbourNote("");
    try {
      const found = await api.read<{ items: NeighborRecord[]; note?: string }>(
        "similar_records",
        [query, LIMITS.MAX_KNN],
      );
      setNeighbours(found.items ?? []);
      // The contract says when retrieval is unavailable. Repeat it verbatim
      // rather than implying the query simply matched nothing.
      setNeighbourNote(found.note ?? "");
      setNeighbourError("");
    } catch (cause) {
      setNeighbourError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <>
      <Panel
        title="Live graph"
        intro="Accepted consensus edges only. Node colour is the jurisdiction, edge colour is the relation type."
        actions={<button className="small ghost" onClick={graph.reload}>Refresh</button>}
      >
        {graph.loading ? <Loading what="the graph" /> : null}
        {graph.error ? <Notice tone="bad">{graph.error}</Notice> : null}

        {!graph.loading && !nodes.length ? (
          <Empty>
            <div style={{ marginBottom: 10 }}>
              This chain has no studies yet, so there is nothing to draw.
            </div>
            {onGoToStudies ? (
              <button className="small primary" onClick={onGoToStudies}>
                Go to Studies and register one
              </button>
            ) : null}
          </Empty>
        ) : (
          <div className="graph-wrap">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="MolfGraph replication graph">
              <defs>
                {RELATION_TYPES.map((type) => (
                  <marker
                    key={type}
                    id={`arrow-${type}`}
                    viewBox="0 0 10 10"
                    refX="10"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={relationColor(type)} />
                  </marker>
                ))}
              </defs>

              {edges.map((item) => {
                const from = nodeIndex.get(`${item.from_study_id}:${item.from_version}`);
                const to = nodeIndex.get(`${item.to_study_id}:${item.to_version}`);
                if (!from || !to) return null;
                const angle = Math.atan2(to.y - from.y, to.x - from.x);
                const x1 = from.x + RADIUS * Math.cos(angle);
                const y1 = from.y + RADIUS * Math.sin(angle);
                const x2 = to.x - RADIUS * Math.cos(angle);
                const y2 = to.y - RADIUS * Math.sin(angle);
                const active = selectedEdge === item.edge_id;
                return (
                  <line
                    key={item.edge_id}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={relationColor(item.relation_type)}
                    strokeWidth={active ? 3.2 : 1.8}
                    opacity={active ? 1 : 0.75}
                    markerEnd={`url(#arrow-${item.relation_type})`}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelectedEdge(item.edge_id)}
                  />
                );
              })}

              {nodes.map((node) => (
                <g
                  key={node.node_id}
                  className="graph-node"
                  onClick={() => setSelectedNode(node.node_id)}
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={RADIUS}
                    fill="#0a0f18"
                    stroke={countryColor(node.country)}
                    strokeWidth={selectedNode === node.node_id ? 3.4 : 1.8}
                    strokeDasharray={node.status === "SUPERSEDED" ? "4 3" : undefined}
                  />
                  <text x={node.x} y={node.y + 3} textAnchor="middle" fill="#e6edf7">
                    {node.study_id}v{node.version}
                  </text>
                  <text x={node.x} y={node.y + RADIUS + 13} textAnchor="middle">
                    {node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        )}

        <div className="legend">
          {RELATION_TYPES.map((type) => (
            <span key={type}>
              <i className="swatch" style={{ background: relationColor(type) }} />
              {type.replaceAll("_", " ")}
            </span>
          ))}
        </div>
        <div className="legend">
          {Array.from(new Set(nodes.map((node) => node.country))).map((code) => (
            <span key={code}>
              <i className="node-swatch" style={{ background: countryColor(code) }} />
              {code}
            </span>
          ))}
          <span>Dashed outline = SUPERSEDED version</span>
        </div>

        {graph.data?.note ? (
          <div style={{ marginTop: 14 }}>
            <Notice>{graph.data.note}</Notice>
          </div>
        ) : null}
      </Panel>

      <div className="grid two">
        <Panel title="Node" intro="Click a node to read its immutable version payload and its receipts.">
          {!selectedNode ? (
            <Empty>No node selected.</Empty>
          ) : detail.loading ? (
            <Loading what="the version" />
          ) : detail.data ? (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <Pill value={detail.data.country} />
                <Pill value={detail.data.status} />
                <span className="meta">
                  study {detail.data.study_id} · version {detail.data.version}
                </span>
              </div>
              <h3 style={{ margin: "0 0 8px" }}>{detail.data.title}</h3>
              <dl className="kv">
                <dt>Charge</dt>
                <dd>{detail.data.crime_or_charge || "—"}</dd>
                <dt>Question</dt>
                <dd>{detail.data.question}</dd>
                <dt>Method</dt>
                <dd>{detail.data.method}</dd>
                <dt>Conclusion</dt>
                <dd>{detail.data.conclusion}</dd>
                {detail.data.correction_note ? (
                  <>
                    <dt>Correction</dt>
                    <dd>{detail.data.correction_note}</dd>
                  </>
                ) : null}
                <dt>Content hash</dt>
                <dd>
                  <Hash value={detail.data.content_sha256} />
                </dd>
                <dt>Records</dt>
                <dd>
                  {detail.data.records.map((record) => (
                    <span key={record.record_id} style={{ marginRight: 6 }}>
                      <Pill value={record.record_type} />
                    </span>
                  ))}
                </dd>
              </dl>

              <div className="meta" style={{ margin: "14px 0 6px" }}>
                ACCEPTED EDGES AT THIS VERSION
              </div>
              {incident.data && (incident.data.out.length || incident.data.into.length) ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {incident.data.out.map((item) => (
                    <li key={`out-${item.edge_id}`} style={{ fontSize: 12.5 }}>
                      <span className="mono">
                        → {item.to_study_id}:{item.to_version}
                      </span>{" "}
                      <Pill value={item.relation_type} />
                    </li>
                  ))}
                  {incident.data.into.map((item) => (
                    <li key={`in-${item.edge_id}`} style={{ fontSize: 12.5 }}>
                      <span className="mono">
                        ← {item.from_study_id}:{item.from_version}
                      </span>{" "}
                      <Pill value={item.relation_type} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta">No accepted edges touch this version yet.</p>
              )}

              <div className="meta" style={{ margin: "14px 0 6px" }}>
                RECEIPTS FOR THIS STUDY
              </div>
              {nodeReceipts.length ? (
                <div className="scroll-x">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Kind</th>
                        <th>Context</th>
                        <th>Content hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nodeReceipts.map((receipt) => (
                        <tr key={receipt.receipt_id}>
                          <td className="mono">{receipt.receipt_id}</td>
                          <td>
                            <Pill value={receipt.kind} />
                          </td>
                          <td className="mono">{receipt.tx_context}</td>
                          <td>
                            <Hash value={receipt.content_sha256} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="meta">No receipts recorded for this study.</p>
              )}
            </>
          ) : (
            <Empty>That version could not be read.</Empty>
          )}
        </Panel>

        <Panel title="Edge" intro="Click an edge to read the consensus key that minted it.">
          {!edge ? (
            <Empty>No edge selected.</Empty>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <Pill value={edge.relation_type} />
                <Pill value={edge.status} />
                <Pill value={edge.confidence} prefix="confidence " />
              </div>
              <dl className="kv">
                <dt>Endpoints</dt>
                <dd className="mono">
                  {edge.from_study_id}:{edge.from_version} → {edge.to_study_id}:{edge.to_version}
                </dd>
                <dt>Claim</dt>
                <dd className="mono">#{edge.claim_id}</dd>
                <dt>Evidence pass</dt>
                <dd>{edge.evidence_pass ? "every source matched its committed digest" : "no"}</dd>
                <dt>Evidence ids</dt>
                <dd className="mono">{edge.evidence_ids.join(", ") || "—"}</dd>
                <dt>Source set</dt>
                <dd>
                  <Hash value={edge.source_set_sha256} />
                </dd>
                {edge.rationale ? (
                  <>
                    <dt>Rationale</dt>
                    <dd>{edge.rationale}</dd>
                  </>
                ) : null}
              </dl>
              <div style={{ marginTop: 12 }}>
                <Notice>{edge.disclaimer}</Notice>
              </div>
            </>
          )}
        </Panel>
      </div>

      <Panel
        title="Semantic neighbours"
        intro="A retrieval drawer over the VecDB index. Deliberately kept apart from the graph: neighbours are context, never edges."
      >
        <div className="drawer">
          <h3>Context only — not evidence, not an edge</h3>
          <div className="row" style={{ marginTop: 8 }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <Field label="Query">
                <input
                  value={query}
                  placeholder="remote credential reuse"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </Field>
            </div>
            <button className="small" disabled={!query.trim()} onClick={findNeighbours}>
              Retrieve
            </button>
          </div>

          {neighbourError ? <Notice tone="bad">{neighbourError}</Notice> : null}
          {neighbours && !neighbours.length ? (
            <Notice tone="warn">
              {neighbourNote ||
                "Semantic retrieval returned nothing for that query on this deployment."}
            </Notice>
          ) : null}
          {neighbours?.length ? (
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Type</th>
                    <th>Study</th>
                    <th>Text</th>
                    <th>Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {neighbours.map((record) => (
                    <tr key={record.record_id}>
                      <td className="mono">{record.record_id}</td>
                      <td>
                        <Pill value={record.record_type} />
                      </td>
                      <td className="mono">
                        {record.study_id}v{record.version}
                      </td>
                      <td>{record.text}</td>
                      <td className="mono">{record.distance.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </Panel>
    </>
  );
}
