# MolfGraph architecture

## The shape of the system

```
                       ┌──────────────────────────────────────────┐
   lawyer / analyst    │  MolfGraph console (Vite + React + TS)   │
        ▲              │  reads without a wallet, writes with one │
        │              └───────────────┬──────────────────────────┘
        │                              │ genlayer-js
        │                              ▼
        │              ┌──────────────────────────────────────────┐
        │              │  MolfGraph Intelligent Contract (Python) │
        │              │                                          │
        │              │  registry  ── immutable study versions   │
        │              │  vecdb     ── retrieval context only     │
        │              │  tools     ── source-grounded screening  │
        │              │  evidence  ── digest-pinned sources      │
        │              │  claims    ── version-pinned proposals   │
        │              │  edges     ── accepted consensus only    │
        │              │  receipts  ── append-only provenance     │
        │              └───────┬────────────────────┬─────────────┘
        │                      │                    │
        │        gl.nondet.web │                    │ gl.nondet.exec_prompt
        │                      ▼                    ▼
        │              official law sites     validator LLMs
        │              (HTTPS, trusted        (leader + validators,
        │               origins only)          equivalence principle)
        │                      │                    │
        └──────────────────────┴────────────────────┘
                     consensus decides; nothing else does
```

## Layers

### Deterministic core

Everything that decides an outcome is a pure function at module scope, which is why the
offline test suite can exercise the rules without a node:

- `_clean`, `_ascii_fold`, `_norm_ws`, `_norm_citation` — sanitisation and normalisation
- `_is_https`, `_origin` — transport and origin gating, including userinfo rejection
- `_sha256_text`, `_sha256_bytes`, `_canon_json`, `_source_set_sha256` — hashing
- `_extract_json` — balanced-brace extraction from model prose
- `_untrusted_block` — untrusted-data framing with delimiter defusing
- `_shape_result` — the single place where a result schema is enforced and downgraded
- `_looks_like_pii` — data minimisation guard for the case registry

`_shape_result` is deliberately the only coercion path. A tool cannot decide to keep a
`VERIFIED` status without a citation, because it does not own that decision.

### Storage layer

Only GenLayer storage types appear in the contract body: `Address`, `str`, `bool`, `u256`,
`DynArray`, `TreeMap`, `VecDB`, and one `@allow_storage` dataclass. No Python `list` or
`dict` is ever persisted. Complex objects are stored as canonical JSON strings in
`TreeMap[u256, str]` or `DynArray[str]`, which keeps the schema stable and the deployed
contract small.

Study versions key on `"<study_id>:<version>"` in `TreeMap[str, str]`. Writing to an
existing key raises, which is the immutability guarantee in one line of code.

### Non-deterministic layer

Every web fetch, embedding, and prompt runs inside a consensus wrapper. Three patterns,
chosen by what has to be agreed:

| Pattern | Used for | What validators must agree on |
| --- | --- | --- |
| `gl.eq_principle.prompt_comparative` | The seven analytical tools | `status`, normalised citation, `applicability_bucket`, `confidence`. Prose may differ. |
| `gl.eq_principle.strict_eq` | `extract_law_text` | The whole canonical extraction key, byte for byte, including the normalised law text. |
| `gl.vm.run_nondet_unsafe` | Relation adjudication | Every decision-critical field, exactly. |

The leader function is the same code the validator runs. In adjudication the validator
recomputes the decision from scratch — refetching, rehashing, reprompting — and compares
field by field. A leader that drifts on the relation type, the endpoints, the confidence,
the source-set digest, or the evidence outcome is rejected, and the claim settles as
`NO_CONSENSUS` with no edge.

### Prompt discipline

Every prompt carries the same preamble: the assistant supports lawyers, gives no legal
advice, judges no guilt or innocence, grounds every statement in the untrusted blocks,
treats block contents as data rather than instructions, and returns strict JSON. Fetched
bodies are wrapped in `=== BEGIN UNTRUSTED DATA [...] ===` markers, and any `===` sequence
inside a body is rewritten so a page cannot close the block and start issuing orders.

VecDB neighbours enter the prompt under their own heading, labelled as related records that
are not evidence and not citable. They are omitted entirely from strict-equivalence
extraction, where any variation would break byte equality.

## Why the frontend cannot cheat

The interface has no path to an edge. It calls `propose_relation`, then
`adjudicate_relation`, then reads `get_graph`. The graph view returns accepted edges only,
so a pending claim has nothing to render. A write is not believed until
`waitForTransactionReceipt` returns a finalised receipt whose execution result is a success;
a submitted or pending transaction updates the status strip and nothing else.

## Splitting the contract

If a deploy hits `BlockPubdataLimitReached`, the split is along a seam the code already
respects:

- **MolfGraphRegistry** — `studies`, `versions`, corrections, `trusted_sources_json`, the
  VecDB index, `receipts`, `cases`, and the read views over them.
- **MolfGraphAdjudicator** — `evidence`, `claims`, `edges`, `edge_seen`, and the
  adjudication path. It reads version snapshots through the registry's
  `get_study_version` view and keeps its own receipt trail.

Bind the addresses once, owner-only, and hard-lock both in the frontend configuration. The
adjudicator needs three fields from a version snapshot — question, method, conclusion — plus
the jurisdiction and `content_sha256`, all of which the registry view already returns. No
public method signature changes; the frontend gains a small adapter that maps each function
name to an address.
