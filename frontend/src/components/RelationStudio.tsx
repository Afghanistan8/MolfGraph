import { useEffect, useState } from "react";
import { RELATION_TYPES } from "../config";
import type { GenLayerApi } from "../useGenLayer";
import { useAsyncView } from "../useGenLayer";
import type { Evidence, Page, RelationClaim, StudySummary } from "../types";
import { Empty, Field, Hash, Loading, Notice, Panel, Pill } from "./ui";

/**
 * Propose and adjudicate version-pinned relation claims.
 *
 * A claim is not an edge. Only a substantive consensus decision, backed by
 * evidence whose digests matched, creates an accepted edge on the live graph.
 */

export interface Pinned {
  studyId: number;
  version: number;
}

export function RelationStudio({
  api,
  hasWallet,
  pinnedFrom,
  pinnedTo,
  onPinFrom,
  onPinTo,
}: {
  api: GenLayerApi;
  hasWallet: boolean;
  pinnedFrom: Pinned | null;
  pinnedTo: Pinned | null;
  onPinFrom: (pin: Pinned | null) => void;
  onPinTo: (pin: Pinned | null) => void;
}) {
  const [relation, setRelation] = useState<string>("DIRECT_REPLICATION");
  const [selectedEvidence, setSelectedEvidence] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [stableId, setStableId] = useState("");
  const [sourceUri, setSourceUri] = useState("");
  const [expectedSha, setExpectedSha] = useState("");
  const [evidenceVersion, setEvidenceVersion] = useState("1");
  const [issuedAt, setIssuedAt] = useState("");
  const [evidenceMode, setEvidenceMode] = useState<"register" | "repair">("register");
  const [activeClaim, setActiveClaim] = useState<number>(0);
  const [outcome, setOutcome] = useState<RelationClaim | null>(null);

  const studies = useAsyncView<Page<StudySummary>>(
    api,
    () => api.read<Page<StudySummary>>("list_studies", [0, 100]),
    [],
  );
  const evidence = useAsyncView<Page<Evidence>>(
    api,
    () => api.read<Page<Evidence>>("list_evidence", [0, 100]),
    [],
  );
  const claims = useAsyncView<Page<RelationClaim>>(
    api,
    () => api.read<Page<RelationClaim>>("list_claims", [0, 100]),
    [],
  );

  useEffect(() => {
    setSelectedEvidence([]);
  }, [pinnedFrom?.studyId, pinnedFrom?.version, pinnedTo?.studyId, pinnedTo?.version]);

  async function submitEvidence() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (evidenceMode === "register") {
        await api.write("register_evidence", [
          stableId,
          sourceUri,
          expectedSha.trim().toLowerCase(),
          Number(evidenceVersion || 1),
          "",
          issuedAt,
          "",
        ]);
        setMessage("Evidence pinned. Its digest will be re-verified at adjudication time.");
      } else {
        await api.write("repair_evidence", [
          stableId,
          sourceUri,
          expectedSha.trim().toLowerCase(),
          Number(evidenceVersion || 1),
        ]);
        setMessage(
          "Evidence re-pinned at a higher version. Open a fresh claim against the repaired item.",
        );
      }
      setSourceUri("");
      setExpectedSha("");
      evidence.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  /** Prefill the repair form from an item that already failed verification. */
  function startRepair(item: Evidence) {
    setEvidenceMode("repair");
    setStableId(item.stable_record_id);
    setSourceUri(item.source_uri);
    setExpectedSha("");
    setEvidenceVersion(String(item.version + 1));
  }

  async function propose() {
    if (!pinnedFrom || !pinnedTo) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const written = await api.write<RelationClaim>("propose_relation", [
        Math.trunc(pinnedFrom.studyId),
        Math.trunc(pinnedFrom.version),
        Math.trunc(pinnedTo.studyId),
        Math.trunc(pinnedTo.version),
        relation,
        JSON.stringify(selectedEvidence.map((id) => Math.trunc(id))),
      ]);
      const claimId = written.value?.claim_id ?? 0;
      if (claimId) setActiveClaim(claimId);
      setOutcome(null);
      setMessage(
        claimId
          ? `Claim #${claimId} opened and selected. It stays PENDING and draws nothing on the graph until adjudicated.`
          : "Claim opened. It stays PENDING and draws nothing on the graph until adjudicated.",
      );
      claims.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function adjudicate(claimId: number) {
    setBusy(true);
    setError("");
    setMessage("");
    setActiveClaim(claimId);
    try {
      const written = await api.write<{ claim?: RelationClaim; edge_id: number }>(
        "adjudicate_relation",
        [Math.trunc(claimId)],
      );
      if (!written.finalized) {
        setError("Adjudication did not finalise. No edge was created.");
        claims.reload();
        return;
      }

      // Re-read rather than trust the return shape, then say exactly what happened.
      const settled = await api.read<RelationClaim>("get_claim", [Math.trunc(claimId)]);
      setOutcome(settled);
      const decision = settled?.decision;

      if (settled?.status === "REPAIR_REQUIRED" && decision) {
        const failed = (evidence.data?.items ?? []).find(
          (item) => item.evidence_id === decision.failed_evidence_id,
        );
        if (failed) {
          // Hand the reader straight into the repair, pre-filled with the
          // digest the validators actually observed.
          setEvidenceMode("repair");
          setStableId(failed.stable_record_id);
          setSourceUri(failed.source_uri);
          setExpectedSha(decision.observed_sha256 ?? "");
          setEvidenceVersion(String(failed.version + 1));
        }
        setError(
          `Evidence verification failed (${decision.failure_code}) on evidence #${decision.failed_evidence_id}. ` +
            `No edge was created. The repair form is pre-filled with the observed digest.`,
        );
      } else if (settled?.status === "REJECTED_AS_INSUFFICIENT") {
        setMessage(
          "Consensus returned INSUFFICIENT, so no edge was created. The decision is stored " +
            "in the claim ledger below for audit.",
        );
      } else if (settled?.status === "DUPLICATE") {
        setMessage("Those endpoints already carry that relation, so no second edge was created.");
      } else if (settled?.status === "ACCEPTED") {
        setMessage(
          `Accepted. Edge #${settled.edge_id ?? written.value?.edge_id ?? "?"} is now on the Live graph, ` +
            "and a provenance receipt was written.",
        );
      } else {
        setMessage("Adjudicated. Open the claim below to read the consensus decision.");
      }
      claims.reload();
      evidence.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function toggleEvidence(id: number) {
    setSelectedEvidence((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function pinPicker(label: string, pin: Pinned | null, onPin: (pin: Pinned | null) => void) {
    return (
      <Field label={label} hint="Every claim pins an explicit version. A study id alone is refused.">
        <div className="row">
          <select
            style={{ flex: 2 }}
            value={pin ? pin.studyId : ""}
            onChange={(event) =>
              onPin(event.target.value ? { studyId: Number(event.target.value), version: 1 } : null)
            }
          >
            <option value="">Select a study…</option>
            {(studies.data?.items ?? []).map((study) => (
              <option key={study.study_id} value={study.study_id}>
                #{study.study_id} · {study.country} · {study.title}
              </option>
            ))}
          </select>
          <input
            style={{ flex: 1 }}
            type="number"
            min={1}
            placeholder="version"
            value={pin?.version ?? ""}
            onChange={(event) =>
              pin && onPin({ studyId: pin.studyId, version: Number(event.target.value || 1) })
            }
          />
        </div>
      </Field>
    );
  }

  const canPropose =
    hasWallet && api.ready && Boolean(pinnedFrom) && Boolean(pinnedTo) && selectedEvidence.length > 0;

  return (
    <>
      <Panel
        title="Pin evidence"
        intro="Evidence is a public source plus the SHA-256 digest of the exact bytes you read. At adjudication the contract refetches and rehashes. A mismatch is a repairable failure, never an edge."
      >
        <div className="grid two">
          <div>
            <div className="row" style={{ marginBottom: 14 }}>
              <button
                className={evidenceMode === "register" ? "primary small" : "small ghost"}
                onClick={() => setEvidenceMode("register")}
              >
                Pin new evidence
              </button>
              <button
                className={evidenceMode === "repair" ? "primary small" : "small ghost"}
                onClick={() => setEvidenceMode("repair")}
              >
                Repair existing
              </button>
            </div>

            {evidenceMode === "repair" ? (
              <div style={{ marginBottom: 14 }}>
                <Notice>
                  A repair keeps the same stable id and the same publisher origin, and must use a
                  strictly higher version. That is what stops a repair becoming a source swap.
                </Notice>
              </div>
            ) : null}

            <Field label="Stable record id" hint="Your durable handle for this source across repairs.">
              <input value={stableId} onChange={(event) => setStableId(event.target.value)} />
            </Field>
            <Field label="Source URL" hint="HTTPS, on an origin already in the trusted registry.">
              <input value={sourceUri} onChange={(event) => setSourceUri(event.target.value)} />
            </Field>
            <Field label="Expected SHA-256" hint="64 lowercase hex characters of the fetched body.">
              <input
                className="mono"
                value={expectedSha}
                onChange={(event) => setExpectedSha(event.target.value)}
              />
            </Field>
            <div className="grid two">
              <Field label="Version">
                <input
                  type="number"
                  min={1}
                  value={evidenceVersion}
                  onChange={(event) => setEvidenceVersion(event.target.value)}
                />
              </Field>
              <Field label="Issued at">
                <input
                  placeholder="2026-01-31"
                  value={issuedAt}
                  disabled={evidenceMode === "repair"}
                  onChange={(event) => setIssuedAt(event.target.value)}
                />
              </Field>
            </div>
            <button
              className="primary"
              disabled={busy || !hasWallet || !stableId || !sourceUri || expectedSha.length !== 64}
              onClick={submitEvidence}
            >
              {evidenceMode === "register" ? "Register evidence" : "Repair evidence"}
            </button>
          </div>

          <div>
            <div className="meta" style={{ marginBottom: 6 }}>
              REGISTERED EVIDENCE — tick the items this claim relies on
            </div>
            {evidence.loading ? <Loading what="evidence" /> : null}
            <div className="list">
              {(evidence.data?.items ?? []).map((item) => (
                <div
                  key={item.evidence_id}
                  className={`card selectable ${
                    selectedEvidence.includes(item.evidence_id) ? "selected" : ""
                  }`}
                  onClick={() => toggleEvidence(item.evidence_id)}
                >
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3>
                      #{item.evidence_id} · {item.stable_record_id}
                    </h3>
                    <Pill value={item.mode} />
                  </div>
                  <div className="meta">{item.source_uri}</div>
                  <div className="row" style={{ marginTop: 6, justifyContent: "space-between" }}>
                    <span>
                      <Hash value={item.expected_sha256} label="sha256" /> · v{item.version}
                    </span>
                    <button
                      className="small ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        startRepair(item);
                      }}
                    >
                      Repair
                    </button>
                  </div>
                </div>
              ))}
              {!evidence.loading && !(evidence.data?.items ?? []).length ? (
                <Empty>No evidence pinned yet.</Empty>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="Propose a relation"
        intro="You name the relation you believe holds. Validators decide independently, and may overrule you."
      >
        <div className="grid two">
          <div>
            {pinPicker("From study version", pinnedFrom, onPinFrom)}
            {pinPicker("To study version", pinnedTo, onPinTo)}
            <Field label="Claimed relation">
              <select value={relation} onChange={(event) => setRelation(event.target.value)}>
                {RELATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <div className="row">
              <button className="primary" disabled={!canPropose || busy} onClick={propose}>
                Open claim
              </button>
              <span className="help">
                {selectedEvidence.length} evidence item{selectedEvidence.length === 1 ? "" : "s"}{" "}
                attached
              </span>
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

            {outcome?.decision ? (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>Claim #{outcome.claim_id} decision</h3>
                  <Pill value={outcome.status} />
                </div>
                <dl className="kv" style={{ marginTop: 8 }}>
                  <dt>Consensus</dt>
                  <dd>
                    <Pill value={outcome.decision.relation_type} />
                  </dd>
                  <dt>Evidence</dt>
                  <dd>
                    {outcome.decision.evidence_pass
                      ? "every digest matched"
                      : `verification failed: ${outcome.decision.failure_code || "unknown"}`}
                  </dd>
                  {outcome.decision.observed_sha256 ? (
                    <>
                      <dt>Observed</dt>
                      <dd>
                        <Hash value={outcome.decision.observed_sha256} />
                      </dd>
                    </>
                  ) : null}
                  {outcome.decision.source_set_sha256 ? (
                    <>
                      <dt>Source set</dt>
                      <dd>
                        <Hash value={outcome.decision.source_set_sha256} />
                      </dd>
                    </>
                  ) : null}
                  {outcome.decision.rationale ? (
                    <>
                      <dt>Rationale</dt>
                      <dd>{outcome.decision.rationale}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
            ) : null}
          </div>

          <div>
            <div className="meta" style={{ marginBottom: 6 }}>
              CLAIM LEDGER
            </div>
            {claims.loading ? <Loading what="claims" /> : null}
            <div className="list">
              {(claims.data?.items ?? [])
                .slice()
                .reverse()
                .map((claim) => (
                  <div
                    className={`card ${activeClaim === claim.claim_id ? "selected" : ""}`}
                    key={claim.claim_id}
                  >
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <h3>
                        Claim #{claim.claim_id} ·{" "}
                        <span className="mono">
                          {claim.from_study_id}:{claim.from_version} → {claim.to_study_id}:
                          {claim.to_version}
                        </span>
                      </h3>
                      <Pill value={claim.status} />
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 6 }}>
                      <Pill value={claim.claimed_relation} prefix="claimed " />
                      {claim.decision ? <Pill value={claim.decision.relation_type} prefix="consensus " /> : null}
                    </div>
                    {claim.decision ? (
                      <dl className="kv" style={{ marginTop: 10 }}>
                        <dt>Evidence</dt>
                        <dd>{claim.decision.evidence_pass ? "all digests matched" : "verification failed"}</dd>
                        {claim.decision.failure_code ? (
                          <>
                            <dt>Failure</dt>
                            <dd className="mono">
                              {claim.decision.failure_code}
                              {claim.decision.failed_evidence_id
                                ? ` on evidence #${claim.decision.failed_evidence_id}`
                                : ""}
                            </dd>
                          </>
                        ) : null}
                        {claim.decision.observed_sha256 ? (
                          <>
                            <dt>Observed</dt>
                            <dd>
                              <Hash value={claim.decision.observed_sha256} />
                            </dd>
                          </>
                        ) : null}
                        {claim.decision.source_set_sha256 ? (
                          <>
                            <dt>Source set</dt>
                            <dd>
                              <Hash value={claim.decision.source_set_sha256} />
                            </dd>
                          </>
                        ) : null}
                        {claim.decision.rationale ? (
                          <>
                            <dt>Rationale</dt>
                            <dd>{claim.decision.rationale}</dd>
                          </>
                        ) : null}
                      </dl>
                    ) : null}
                    {claim.status === "PENDING" ? (
                      <div className="row" style={{ marginTop: 10 }}>
                        <button
                          className="small primary"
                          disabled={busy || !hasWallet}
                          onClick={() => adjudicate(claim.claim_id)}
                        >
                          Run adjudication
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              {!claims.loading && !(claims.data?.items ?? []).length ? (
                <Empty>No claims opened yet.</Empty>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>
    </>
  );
}
