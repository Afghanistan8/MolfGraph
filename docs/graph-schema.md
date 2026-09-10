# MolfGraph graph schema

Every structure below is stored on-chain as canonical JSON: sorted keys, no whitespace
drift, ASCII-escaped. The TypeScript mirrors live in `frontend/src/types.ts`.

## Node — study version

Key: `"<study_id>:<version>"` in `versions: TreeMap[str, str]`.

| Field | Type | Notes |
| --- | --- | --- |
| `study_id` | int | Assigned on first registration, never reused |
| `version` | int | Starts at 1, strictly increasing |
| `parent_version` | int | `0` on version 1 |
| `title` | str | ≤ 160 characters |
| `country` | str | Uppercase jurisdiction code |
| `subject_ref` | str | Non-personal matter reference; PII-shaped values are refused |
| `crime_or_charge` | str | ≤ 160 characters |
| `question` | str | Required, ≤ 4000 characters |
| `method` | str | Required, ≤ 4000 characters |
| `conclusion` | str | Required, ≤ 4000 characters |
| `records` | array | ≤ 12 records, see below |
| `creator` | str | Registering address |
| `correction_note` | str | Empty on version 1, required on every later version |
| `content_sha256` | str | SHA-256 of the canonical JSON of all fields above |
| `created_at` | str | Transaction time when the runtime exposes one |
| `seq` | int | Monotonic sequence, always present |
| `status` | str | `ACTIVE` or `SUPERSEDED` |
| `superseded_by` | int | Present once a correction supersedes this version |
| `disclaimer` | str | Always the MolfGraph disclaimer |

`content_sha256` covers the payload before `created_at`, `seq`, `status` and `disclaimer`
are attached, so the hash describes the substance a lawyer registered and stays stable when
a later correction flips `status`.

### Record

| Field | Type | Notes |
| --- | --- | --- |
| `record_id` | str | `"<study_id>:<version>:<index>"` |
| `record_type` | str | `CRIME`, `JUDGEMENT`, `QUESTION`, `METHOD`, `CONCLUSION` |
| `text` | str | ≤ 4000 characters |
| `source_uris` | array of str | HTTPS, trusted origins only |
| `expected_sha256` | array of str | 64 lowercase hex characters each |

## Edge — accepted relation

Stored in `edges: TreeMap[u256, str]`. Only consensus writes here.

| Field | Type | Notes |
| --- | --- | --- |
| `edge_id` | int | Sequential |
| `claim_id` | int | The claim this edge settled |
| `relation_type` | str | One of the six; `INSUFFICIENT` never appears on an edge |
| `from_study_id`, `from_version` | int | Source endpoint, always version-pinned |
| `to_study_id`, `to_version` | int | Target endpoint, always version-pinned |
| `status` | str | Always `ACCEPTED` |
| `confidence` | str | `LOW`, `MEDIUM`, `HIGH` |
| `source_set_sha256` | str | Digest over the `(uri, sha256)` set that backed the decision |
| `evidence_pass` | bool | Always `true`; a `false` never reaches an edge |
| `evidence_ids` | array of int | The pinned evidence the claim relied on |
| `rationale` | str | Consensus rationale text |
| `created_at`, `seq` | str, int | Provenance |

Duplicate protection keys on `"<from_sid>:<from_ver>-><to_sid>:<to_ver>:<relation>"` in
`edge_seen`, so the same endpoints can carry two different relations but never the same one
twice.

### Relation semantics

| Relation | Applies when |
| --- | --- |
| `DIRECT_REPLICATION` | Same question, same method, same jurisdictional basis, consistent conclusion |
| `MATERIAL_VARIANT` | Same question, materially different method, provision, or jurisdictional basis |
| `EXTENSION` | Builds on the first study, widening scope, facts, or jurisdiction |
| `CONTRADICTORY_RESULT` | Comparable question and method, incompatible conclusions |
| `INCOMPARABLE` | The studies do not address a comparable question |
| `INSUFFICIENT` | Verified evidence supports none of the above — stored as a rejected claim, never as an edge |

## Claim

Stored in `claims: TreeMap[u256, str]`. A claim is a hypothesis with a receipt.

| Field | Type | Notes |
| --- | --- | --- |
| `claim_id` | int | Sequential |
| `from_study_id`, `from_version`, `to_study_id`, `to_version` | int | Version pinning is mandatory |
| `claimed_relation` | str | What the proposer believes |
| `evidence_ids` | array of int | At least one registered evidence id |
| `status` | str | `PENDING`, `ACCEPTED`, `REJECTED_AS_INSUFFICIENT`, `REPAIR_REQUIRED`, `DUPLICATE` |
| `from_content_sha256`, `to_content_sha256` | str | Endpoint hashes captured at proposal time |
| `from_status`, `to_status` | str | Whether either endpoint was already superseded |
| `decision` | object | Written at adjudication, see below |
| `edge_id` | int | Present only when an edge was minted |

### Decision

| Field | Notes |
| --- | --- |
| `status` | `ACCEPTED`, `REJECTED_AS_INSUFFICIENT`, `REPAIR_REQUIRED` |
| `relation_type` | Consensus relation, which may differ from the claim |
| `confidence` | `LOW`, `MEDIUM`, `HIGH` |
| `evidence_pass` | Whether every source matched its committed digest |
| `source_set_sha256` | Empty when verification failed |
| `failure_code` | `HASH_MISMATCH`, `UNREACHABLE`, `NON_UTF8`, `OVERSIZED`, `NOT_HTTPS`, `NO_CONSENSUS`, or empty |
| `failed_evidence_id` | The evidence item that failed, or `0` |
| `observed_sha256` | The digest actually seen, when a mismatch was the cause |
| `rationale` | Consensus rationale text |

## Evidence

| Field | Notes |
| --- | --- |
| `evidence_id` | Sequential |
| `stable_record_id` | Durable handle across repairs |
| `source_uri` | HTTPS, on a trusted origin |
| `expected_sha256` | 64 lowercase hex characters |
| `version` | Strictly increasing per stable record id |
| `publisher_origin` | Must equal the source origin, and cannot change on repair |
| `issued_at`, `observed_at` | Publisher date and registration time |
| `record_type` | Optional hint from the closed record-type set |
| `mode` | `REGISTER` or `REPAIR` |

## Receipt

Append-only in `receipts: DynArray[str]`.

| Field | Notes |
| --- | --- |
| `receipt_id` | 1-based index |
| `kind` | `STUDY_VERSION`, `CORRECTION`, `ANALYSIS`, `EDGE`, `ALERT` |
| `actor` | The writing address |
| `study_ids`, `versions` | What the receipt concerns |
| `content_sha256` | Hash of the payload the receipt attests to |
| `source_set_sha256` | The source set behind it, when there was one |
| `tx_context` | The method that produced it |

## Graph view

`get_graph(limit)` returns:

```json
{
  "nodes": [{ "node_id": "1:1", "study_id": 1, "version": 1, "title": "…",
              "country": "US", "crime_or_charge": "…", "status": "ACTIVE",
              "content_sha256": "…", "record_types": ["CRIME", "QUESTION"] }],
  "edges": [ /* accepted edges only */ ],
  "note": "Accepted consensus edges only. Semantic neighbours are context, not edges.",
  "disclaimer": "…"
}
```

Nodes come from the endpoints of accepted edges first, then the latest version of every
registered study, so a study with no relations yet still appears. Edges are capped at 25.

## Semantic neighbours — not part of the graph

`similar_records(text, k)` returns VecDB nearest neighbours with `context_only: true`. They
carry a `record_id`, `study_id`, `version`, `record_type`, `text`, and `distance`.

They are not nodes, not edges, and not citable. The interface renders them in a separate
drawer with a different visual treatment for exactly that reason.
