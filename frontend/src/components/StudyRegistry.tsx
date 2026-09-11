import { useEffect, useState } from "react";
import { LIMITS, RECORD_TYPES } from "../config";
import type { GenLayerApi } from "../useGenLayer";
import { useAsyncView } from "../useGenLayer";
import type { Page, SampleData, StudySummary, StudyVersion } from "../types";
import { CountrySelect, Empty, Field, Hash, Loading, Notice, Panel, Pill } from "./ui";

/**
 * Studies are immutable versions. A correction never edits version N: it
 * appends version N+1 and marks N SUPERSEDED, which is what the timeline below
 * renders.
 */

interface DraftRecord {
  record_type: string;
  text: string;
  source_uris: string;
  expected_sha256: string;
}

const EMPTY_RECORD: DraftRecord = {
  record_type: "CRIME",
  text: "",
  source_uris: "",
  expected_sha256: "",
};

interface Draft {
  title: string;
  country: string;
  subject_ref: string;
  crime_or_charge: string;
  question: string;
  method: string;
  conclusion: string;
  correction_note: string;
  records: DraftRecord[];
}

const EMPTY_DRAFT: Draft = {
  title: "",
  country: "US",
  subject_ref: "",
  crime_or_charge: "",
  question: "",
  method: "",
  conclusion: "",
  correction_note: "",
  records: [{ ...EMPTY_RECORD }],
};

function encodeRecords(records: DraftRecord[]): string {
  const payload = records
    .filter((record) => record.text.trim())
    .map((record) => ({
      record_type: record.record_type,
      text: record.text.trim(),
      source_uris: record.source_uris
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean),
      expected_sha256: record.expected_sha256
        .split(/[\n,]/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    }));
  return JSON.stringify(payload);
}

export function StudyRegistry({
  api,
  hasWallet,
  onPin,
}: {
  api: GenLayerApi;
  hasWallet: boolean;
  onPin: (studyId: number, version: number) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [mode, setMode] = useState<"register" | "correct">("register");
  const [targetStudy, setTargetStudy] = useState<number>(0);
  const [selected, setSelected] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [samples, setSamples] = useState<SampleData | null>(null);
  const [sampleClaims, setSampleClaims] = useState<number[]>([]);

  const [search, setSearch] = useState("");
  const [searchCountry, setSearchCountry] = useState("");

  const studies = useAsyncView<Page<StudySummary>>(
    api,
    () =>
      search.trim() || searchCountry
        ? api.read<Page<StudySummary>>("search_studies", [search.trim(), searchCountry])
        : api.read<Page<StudySummary>>("list_studies", [0, LIMITS.MAX_GRAPH_NEIGHBORS * 4]),
    [search, searchCountry],
  );

  const versions = useAsyncView<{ items: StudyVersion[] }>(
    api,
    async () =>
      selected
        ? api.read<{ items: StudyVersion[] }>("list_study_versions", [selected])
        : { items: [] },
    [selected],
  );

  useEffect(() => {
    fetch("/sample_studies.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setSamples(data))
      .catch(() => setSamples(null));
  }, []);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setRecord(index: number, patch: Partial<DraftRecord>) {
    setDraft((current) => ({
      ...current,
      records: current.records.map((record, position) =>
        position === index ? { ...record, ...patch } : record,
      ),
    }));
  }

  function draftFromSample(sample: NonNullable<SampleData["studies"]>[number]): Draft {
    return {
      title: sample.title,
      country: sample.country,
      subject_ref: sample.subject_ref,
      crime_or_charge: sample.crime_or_charge,
      question: sample.question,
      method: sample.method,
      conclusion: sample.conclusion,
      correction_note: "",
      records: sample.records.map((record) => ({
        record_type: record.record_type,
        text: record.text,
        source_uris: record.source_uris.join("\n"),
        expected_sha256: record.expected_sha256.join("\n"),
      })),
    };
  }

  /**
   * Put the whole sample pack on chain in dependency order: studies first, then
   * the hash-pinned evidence, then the relation claims that reference both.
   *
   * It deliberately stops before adjudication. A claim is a hypothesis, and
   * minting an edge is a separate, explicit decision the reader makes.
   */
  async function registerSamplePack() {
    if (!samples?.studies.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    setSampleClaims([]);
    const done: string[] = [];
    try {
      // 1. Studies. Each returns the pin the claim will later reference.
      const pins: Array<{ study_id: number; version: number }> = [];
      for (const sample of samples.studies) {
        const draft = draftFromSample(sample);
        const outcome = await api.write<{ study_id: number; version: number }>(
          "register_study_version",
          [
            draft.title, draft.country, draft.subject_ref, draft.crime_or_charge,
            draft.question, draft.method, draft.conclusion, encodeRecords(draft.records),
          ],
        );
        if (!outcome.finalized || !outcome.value?.study_id) {
          throw new Error(`${sample.title} did not return a usable pin.`);
        }
        pins.push({ study_id: outcome.value.study_id, version: outcome.value.version });
        done.push(`study ${outcome.value.study_id}:${outcome.value.version}`);
        setMessage(`Registered ${done.length} of ${samples.studies.length} studies…`);
      }

      // 2. Hash-pinned evidence, keyed by the id the relations refer to.
      const evidenceIds: Record<string, number> = {};
      for (const item of samples.evidence ?? []) {
        const outcome = await api.write<{ evidence_id: number }>("register_evidence", [
          item.stable_record_id, item.source_uri, item.expected_sha256,
          Math.trunc(item.version), "", item.issued_at, item.record_type ?? "",
        ]);
        if (!outcome.finalized || !outcome.value?.evidence_id) {
          throw new Error(`Evidence ${item.stable_record_id} did not return an id.`);
        }
        evidenceIds[item.stable_record_id] = outcome.value.evidence_id;
        done.push(`evidence #${outcome.value.evidence_id}`);
        setMessage(`Registered evidence ${item.stable_record_id}…`);
      }

      // 3. Claims. These stay PENDING and draw nothing until adjudicated.
      const claimIds: number[] = [];
      for (const relation of samples.proposed_relations ?? []) {
        const from = pins[relation.from_index];
        const to = pins[relation.to_index];
        if (!from || !to) continue;
        const ids = relation.evidence_stable_ids
          .map((key) => evidenceIds[key])
          .filter((value): value is number => typeof value === "number");
        if (!ids.length) continue;
        const outcome = await api.write<{ claim_id: number }>("propose_relation", [
          from.study_id, from.version, to.study_id, to.version,
          relation.claimed_relation, JSON.stringify(ids),
        ]);
        if (!outcome.finalized || !outcome.value?.claim_id) {
          throw new Error(`Claim ${relation.claimed_relation} did not return an id.`);
        }
        claimIds.push(outcome.value.claim_id);
        done.push(`claim #${outcome.value.claim_id}`);
      }

      setSampleClaims(claimIds);
      setMessage(
        `Sample pack on chain: ${done.join(", ")}. The claims are PENDING and the graph is ` +
          "unchanged until you adjudicate them below.",
      );
      studies.reload();
    } catch (cause) {
      setError(
        (cause instanceof Error ? cause.message : String(cause)) +
          (done.length ? ` Completed before failing: ${done.join(", ")}.` : ""),
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Adjudicate the sample claims. Kept separate from the pack because this is
   * what can actually mint an edge, and because a round can end without
   * agreement, in which case the claim stays PENDING and is safe to retry.
   */
  async function adjudicateSampleClaims() {
    if (!sampleClaims.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    const results: string[] = [];
    try {
      for (const claimId of sampleClaims) {
        await api.write("adjudicate_relation", [Math.trunc(claimId)]);
        // Never trust the write's own view: read the settled claim back.
        const settled = await api.read<{ status?: string; decision?: { relation_type?: string } }>(
          "get_claim",
          [Math.trunc(claimId)],
        );
        const status = settled?.status ?? "UNKNOWN";
        results.push(
          status === "ACCEPTED"
            ? `#${claimId} ACCEPTED as ${settled?.decision?.relation_type}`
            : `#${claimId} ${status}`,
        );
        setMessage(`Adjudicated ${results.join(", ")}…`);
      }
      setMessage(
        `Adjudication finished: ${results.join(", ")}. Any ACCEPTED claim is now an edge on ` +
          "Live graph. A claim still showing PENDING means validators did not agree on that " +
          "run; press again to retry.",
      );
      studies.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function loadSample(index: number) {
    const sample = samples?.studies[index];
    if (!sample) return;
    setMode("register");
    setDraft(draftFromSample(sample));
  }

  async function submit() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const records = encodeRecords(draft.records);
      if (mode === "register") {
        await api.write("register_study_version", [
          draft.title,
          draft.country,
          draft.subject_ref,
          draft.crime_or_charge,
          draft.question,
          draft.method,
          draft.conclusion,
          records,
        ]);
        setMessage("Study version 1 registered and hashed. It can never be edited.");
      } else {
        await api.write("correct_study", [
          targetStudy,
          draft.correction_note,
          draft.title,
          draft.country,
          draft.subject_ref,
          draft.crime_or_charge,
          draft.question,
          draft.method,
          draft.conclusion,
          records,
        ]);
        setMessage("Correction appended. The previous version is now SUPERSEDED.");
      }
      studies.reload();
      versions.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const disabled =
    busy ||
    !hasWallet ||
    !api.ready ||
    !draft.title.trim() ||
    !draft.question.trim() ||
    !draft.method.trim() ||
    !draft.conclusion.trim() ||
    (mode === "correct" && (!targetStudy || !draft.correction_note.trim()));

  return (
    <>
      <Panel
        title="Register a study version"
        intro="A study version is an immutable snapshot: title, jurisdiction, charge, question, method, conclusion, and typed records. Corrections append; they never overwrite."
        actions={
          samples?.studies.length ? (
            <>
              <span className="help">Load a sample:</span>
              {samples.studies.map((sample, index) => (
                <button key={sample.title} className="small ghost" onClick={() => loadSample(index)}>
                  {sample.country} · {sample.title.slice(0, 26)}
                </button>
              ))}
              {sampleClaims.length ? (
                <button
                  className="small primary"
                  disabled={busy || !hasWallet}
                  onClick={adjudicateSampleClaims}
                  title="Adjudicate the sample claims. Only this can mint an edge."
                >
                  Adjudicate sample claims ({sampleClaims.length})
                </button>
              ) : null}
              <button
                className="small primary"
                disabled={busy || !hasWallet}
                onClick={registerSamplePack}
                title={
                  hasWallet
                    ? "Register all sample studies in order"
                    : "Connect a funded wallet first"
                }
              >
                Register sample pack
              </button>
            </>
          ) : null
        }
      >
        <div className="row" style={{ marginBottom: 16 }}>
          <button
            className={mode === "register" ? "primary small" : "small ghost"}
            onClick={() => setMode("register")}
          >
            New study (version 1)
          </button>
          <button
            className={mode === "correct" ? "primary small" : "small ghost"}
            onClick={() => setMode("correct")}
          >
            Append a correction
          </button>
        </div>

        {mode === "correct" ? (
          <Field label="Study to correct" hint="The correction becomes version N+1 of this study.">
            <select
              value={targetStudy || ""}
              onChange={(event) => setTargetStudy(Number(event.target.value))}
            >
              <option value="">Select a study…</option>
              {(studies.data?.items ?? []).map((study) => (
                <option key={study.study_id} value={study.study_id}>
                  #{study.study_id} · {study.title} (latest v{study.latest_version})
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {mode === "correct" ? (
          <Field
            label="Correction note"
            value={draft.correction_note}
            maxLength={LIMITS.MAX_TEXT}
            hint="Required. Say what was wrong in the previous version."
          >
            <textarea
              value={draft.correction_note}
              onChange={(event) => set("correction_note", event.target.value)}
            />
          </Field>
        ) : null}

        <div className="grid two">
          <div>
            <Field label="Title" value={draft.title} maxLength={LIMITS.MAX_TITLE}>
              <input value={draft.title} onChange={(event) => set("title", event.target.value)} />
            </Field>
            <Field label="Jurisdiction">
              <CountrySelect value={draft.country} onChange={(next) => set("country", next)} />
            </Field>
            <Field
              label="Subject reference"
              value={draft.subject_ref}
              maxLength={LIMITS.MAX_TITLE}
              hint="Non-personal matter reference only. The contract rejects anything that looks like a personal identifier."
            >
              <input
                value={draft.subject_ref}
                onChange={(event) => set("subject_ref", event.target.value)}
              />
            </Field>
            <Field label="Crime or charge" value={draft.crime_or_charge} maxLength={LIMITS.MAX_TITLE}>
              <input
                value={draft.crime_or_charge}
                onChange={(event) => set("crime_or_charge", event.target.value)}
              />
            </Field>
          </div>
          <div>
            <Field label="Question" value={draft.question} maxLength={LIMITS.MAX_TEXT}>
              <textarea
                value={draft.question}
                onChange={(event) => set("question", event.target.value)}
              />
            </Field>
            <Field label="Method" value={draft.method} maxLength={LIMITS.MAX_TEXT}>
              <textarea value={draft.method} onChange={(event) => set("method", event.target.value)} />
            </Field>
            <Field label="Conclusion" value={draft.conclusion} maxLength={LIMITS.MAX_TEXT}>
              <textarea
                value={draft.conclusion}
                onChange={(event) => set("conclusion", event.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 6 }}>
          <div className="panel-head">
            <div>
              <h2>Records</h2>
              <p>
                Typed sections of the study. Source URLs must sit on an origin already in the
                trusted registry, and digests are 64 lowercase hex characters.
              </p>
            </div>
            <button
              className="small"
              disabled={draft.records.length >= LIMITS.MAX_RECORDS_PER_VERSION}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  records: [...current.records, { ...EMPTY_RECORD }],
                }))
              }
            >
              Add record ({draft.records.length}/{LIMITS.MAX_RECORDS_PER_VERSION})
            </button>
          </div>
          <div className="panel-body">
            {draft.records.map((record, index) => (
              <div className="card" key={index} style={{ marginBottom: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <select
                    style={{ width: "auto" }}
                    value={record.record_type}
                    onChange={(event) => setRecord(index, { record_type: event.target.value })}
                  >
                    {RECORD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <button
                    className="small ghost"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        records: current.records.filter((_, position) => position !== index),
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  placeholder="Record text"
                  value={record.text}
                  maxLength={LIMITS.MAX_TEXT}
                  onChange={(event) => setRecord(index, { text: event.target.value })}
                />
                <div className="grid two" style={{ marginTop: 8 }}>
                  <textarea
                    placeholder="Source URLs, one per line"
                    value={record.source_uris}
                    onChange={(event) => setRecord(index, { source_uris: event.target.value })}
                  />
                  <textarea
                    placeholder="Expected SHA-256 digests, one per line"
                    value={record.expected_sha256}
                    onChange={(event) => setRecord(index, { expected_sha256: event.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <button className="primary" disabled={disabled} onClick={submit}>
            {busy
              ? "Writing…"
              : mode === "register"
                ? "Register immutable version"
                : "Append correction"}
          </button>
          <button className="ghost" onClick={() => setDraft(EMPTY_DRAFT)} disabled={busy}>
            Clear
          </button>
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

      <Panel title="Registered studies" intro="Select a study to see its immutable version timeline.">
        <div className="grid cards" style={{ marginBottom: 14 }}>
          <Field label="Search title or charge">
            <input value={search} onChange={(event) => setSearch(event.target.value)} />
          </Field>
          <Field label="Jurisdiction">
            <CountrySelect value={searchCountry} onChange={setSearchCountry} includeAny />
          </Field>
        </div>
        {studies.loading ? <Loading what="studies" /> : null}
        {studies.error ? <Notice tone="bad">{studies.error}</Notice> : null}
        <div className="grid two">
          <div className="list">
            {(studies.data?.items ?? []).map((study) => (
              <div
                key={study.study_id}
                className={`card selectable ${selected === study.study_id ? "selected" : ""}`}
                onClick={() => setSelected(study.study_id)}
              >
                <h3>{study.title}</h3>
                <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                  <Pill value={study.country} />
                  <span className="meta">
                    #{study.study_id} · {study.versions.length} version
                    {study.versions.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="meta">{study.crime_or_charge}</div>
              </div>
            ))}
            {!studies.loading && !(studies.data?.items ?? []).length ? (
              <Empty>No studies registered yet.</Empty>
            ) : null}
          </div>

          <div className="list">
            {(versions.data?.items ?? []).map((version) => (
              <div className="card" key={`${version.study_id}:${version.version}`}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>
                    Version {version.version}
                    {version.parent_version ? ` (from v${version.parent_version})` : ""}
                  </h3>
                  <Pill value={version.status} />
                </div>
                <dl className="kv" style={{ marginTop: 8 }}>
                  <dt>Question</dt>
                  <dd>{version.question}</dd>
                  <dt>Method</dt>
                  <dd>{version.method}</dd>
                  <dt>Conclusion</dt>
                  <dd>{version.conclusion}</dd>
                  {version.correction_note ? (
                    <>
                      <dt>Correction</dt>
                      <dd>{version.correction_note}</dd>
                    </>
                  ) : null}
                  <dt>Content hash</dt>
                  <dd>
                    <Hash value={version.content_sha256} />
                  </dd>
                  <dt>Records</dt>
                  <dd>
                    {version.records.length
                      ? version.records.map((record) => (
                          <span key={record.record_id} style={{ marginRight: 6 }}>
                            <Pill value={record.record_type} />
                          </span>
                        ))
                      : "none"}
                  </dd>
                </dl>
                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    className="small ghost"
                    onClick={() => onPin(version.study_id, version.version)}
                  >
                    Pin for a relation claim
                  </button>
                  <span
                    className="help"
                    title="This deployment ships without the VecDB retrieval layer."
                  >
                    Semantic indexing unavailable on this deployment
                  </span>
                </div>
              </div>
            ))}
            {selected && !(versions.data?.items ?? []).length ? (
              <Empty>No versions loaded for that study.</Empty>
            ) : null}
            {!selected ? <Empty>Select a study on the left.</Empty> : null}
          </div>
        </div>
      </Panel>
    </>
  );
}
