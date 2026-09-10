# MolfGraph

**A GenLayer-native scientific replication primitive for legal screening.**

MolfGraph builds an on-chain graph of relationships between legal screening studies, so
that a legal team can see whether a screening conclusion about how a law was applied has
been replicated, varied, extended, or contradicted somewhere else — and can check the
evidence behind every link.

Studies are registered as immutable versions. Validator consensus, not a single model and
never the interface, decides whether a relation claim becomes an accepted edge. Evidence is
re-fetched and re-hashed against a committed SHA-256 digest before any adjudication runs.

---

## Live deployment

MolfGraph is deployed on GenLayer StudioNet.

| | |
| --- | --- |
| Contract | `0x1ab5205a14716EfbC54085B4386876B217a8b2CC` |
| Network | StudioNet, chain `61999` |
| Owner | `0x4184bc5E5444F250767E8D33A49817A9B4FB0df3` |

The deployed build is [contracts/molfgraph_deployable.py](contracts/molfgraph_deployable.py).
It is the canonical contract with the VecDB retrieval layer removed, because the dual `Seq`
magic header that VecDB requires is rejected by the GenVM on both StudioNet and Bradbury.
`index_study_records` raises a clear unavailable error and `similar_records` returns an empty,
explicitly labelled result rather than pretending to work. Everything else is intact.

To point the console at it, copy `frontend/.env.example` to `frontend/.env` and set
`VITE_MOLFGRAPH_CONTRACT_ADDRESS` to the address above.

---

## Disclaimer

> **Decision-support only — not legal advice. Professional review required.**

MolfGraph is a research instrument for qualified legal professionals. It does not practise
law, does not give legal advice, and never judges guilt, innocence, liability, or case
outcomes. Every output is verified reference information grounded in public sources, and
every output requires professional review. The disclaimer is embedded in each analysis
result, each study version, each edge, and throughout the interface. It is not decoration:
the prompts themselves forbid the model from making those judgements, and results that
cannot be grounded fail closed rather than being answered.

---

## How it works

### 1. Studies are immutable versions

A study version is a snapshot: title, jurisdiction, a non-personal subject reference, the
charge, the question, the method, the conclusion, and up to twelve typed records. The
canonical JSON of that payload is hashed into `content_sha256`, and the version is written
to a key that can never be reused.

A correction never edits a prior version. It registers version N+1, pins
`parent_version = N`, requires a correction note, and marks version N `SUPERSEDED`. Old
versions stay readable forever, which is what makes the graph auditable.

Record types are a closed set: `CRIME`, `JUDGEMENT`, `QUESTION`, `METHOD`, `CONCLUSION`.

### 2. VecDB is context, never an edge

Record texts are embedded with the pinned `all-MiniLM-L6-v2` sentence transformer and
stored in a 384-dimension `VecDB`. Nearest neighbours are injected into prompts under an
explicit label — related records, not evidence, not an edge — and surfaced in the interface
in a visually separate drawer.

VecDB never creates an edge, never decides a relation, and never supplies a citation.
Correcting a study adds new vectors rather than deleting old ones, so retrieval keeps
working across the full version history.

### 3. Evidence is digest-pinned before it counts

Registering evidence commits a stable record id, an HTTPS source URI on an origin that is
already in the trusted registry, an expected SHA-256, a version, and the publisher origin.
At adjudication time the contract refetches the body, rehashes it, and compares.

A body that is unreachable, non-UTF8, oversized, or whose digest no longer matches produces
`REPAIR_REQUIRED` with a failure code, the failing evidence id, and the digest actually
observed. That is a repairable failure, not an edge. `repair_evidence` re-pins the same
stable id under the same publisher origin at a strictly higher version.

### 4. Consensus decides the edge

Adjudication runs in a leader/validator pair. Validators must agree exactly on every
decision-critical field:

`status`, `relation_type`, `from_study_id`, `from_version`, `to_study_id`, `to_version`,
`confidence`, `source_set_sha256`, `evidence_pass` — plus `failure_code`,
`failed_evidence_id`, and `observed_sha256` whenever the status is `REPAIR_REQUIRED`.

An accepted edge is written only when the relation is substantive, the evidence passed, and
the endpoints are not already joined by that relation. A consensus of `INSUFFICIENT` stores
a rejected receipt for the audit trail and puts nothing on the live graph.

---

## Tools

Each tool is a consensus-backed write that returns the same normalised result and is stored
in the public analysis ledger.

| Tool | What it answers |
| --- | --- |
| `verify_statute` | Which official statute or code section defines a charge in a jurisdiction |
| `screen_application` | Whether a described application of a law is consistent with the published elements |
| `extract_law_text` | The exact current text of a provision, under strict equivalence |
| `compare_jurisdictions` | How two jurisdictions treat the same topic or offence |
| `check_statute_of_limitations` | The published limitation period and any tolling rules |
| `check_conflicts` | Whether a provision is in force, amended, repealed, superseded, or conflicting |
| `map_facts_to_provisions` | Which published provisions a fact pattern should be reviewed against |
| `generate_verification_report` | An auditable report for one pinned study version |

Graph and registry writes: `register_study_version`, `correct_study`, `index_study_records`,
`register_evidence`, `repair_evidence`, `propose_relation`, `adjudicate_relation`,
`register_case`, `link_analysis_to_case`, `add_trusted_source`, `remove_trusted_source`.

### Normalised analysis result

```json
{
  "kind": "verify_statute",
  "status": "VERIFIED | INSUFFICIENT_EVIDENCE | UNAVAILABLE | CONFLICT",
  "citation": "",
  "exact_text_or_summary": "",
  "applicability_score": 0,
  "applicability_bucket": "LOW | MEDIUM | HIGH",
  "confidence": "LOW | MEDIUM | HIGH",
  "sources": ["https://..."],
  "source_set_sha256": "",
  "notes": "",
  "disclaimer": "Decision-support only — not legal advice. Professional review required.",
  "study_id": 0,
  "study_version": 0
}
```

Coercion rules the contract applies to every result, including its own:

- an unrecognised status becomes `INSUFFICIENT_EVIDENCE`
- `VERIFIED` without a citation, or without at least one readable source, is downgraded
- the bucket is derived from the score (`>=67` high, `>=34` medium, else low) and never trusted from the model
- non-HTTPS sources are dropped
- the disclaimer is always present

Low confidence, `CONFLICT`, `UNAVAILABLE`, `INSUFFICIENT_EVIDENCE`, and any digest mismatch
raise an alert automatically.

---

## Graph schema

Nodes are study versions, addressed as `"<study_id>:<version>"`. Edges are accepted
consensus relations drawn from a closed set:

| Relation | Meaning |
| --- | --- |
| `DIRECT_REPLICATION` | Same question, same method, same jurisdictional basis, consistent conclusion |
| `MATERIAL_VARIANT` | Same question, materially different method, provision, or basis |
| `EXTENSION` | Builds on the first study and widens scope, facts, or jurisdiction |
| `CONTRADICTORY_RESULT` | Comparable question and method, incompatible conclusions |
| `INCOMPARABLE` | The studies do not address a comparable question |
| `INSUFFICIENT` | The verified evidence supports none of the above — no edge is created |

`docs/graph-schema.md` carries the full field-level schema for versions, claims, edges,
evidence, and receipts.

---

## Repository layout

```
molfgraph/
  contracts/molfgraph.py       Intelligent Contract (registry, tools, VecDB, adjudication)
  scripts/deploy.py            Deploys via encrypted keystore or an environment key
  tests/conftest.py            Offline GenVM test double
  tests/test_molfgraph.py      75 offline tests
  tests/direct/                Opt-in end-to-end tests against a live node
  frontend/                    Vite + React 18 + TypeScript + genlayer-js console
  docs/                        Architecture, workflow, graph schema
  gltest.config.yaml           genlayer-test networks and paths
```

### A note on deploy size

The contract is 92,717 bytes and ships as a single Intelligent Contract on StudioNet.

Some GenLayer networks cap a deploy payload well below that. The Bradbury testnet, for
example, rejects anything over roughly 49 KB with `BlockPubdataLimitReached`; a padded probe
at 49,152 bytes is accepted and one at 53,248 is not. If you target a network with that cap,
the contract has to be split, and stripping comments and docstrings is not enough on its own
(it only reaches 74,869 bytes). See `docs/architecture.md` for the split boundary.

---

## Security

| Control | Where it lives |
| --- | --- |
| HTTPS only | `_is_https` rejects every non-HTTPS URL before a fetch is attempted |
| No blind URL trust | Caller URLs are honoured only when their origin is already registered |
| Origin spoofing refused | `_origin` rejects URLs carrying userinfo (`https://evil@trusted.gov`) |
| Untrusted-data isolation | Every fetched body is wrapped in explicit markers; `===` inside a body is defused |
| Prompt-injection resistance | Prompts state that block contents are data and directives inside them are ignored |
| Grounding | Prompts forbid inventing statutes, citations, judgments, or edges |
| Fail-safe defaults | Missing, unreachable, oversized, or non-UTF8 sources produce `UNAVAILABLE` / `INSUFFICIENT_EVIDENCE` |
| Consensus before state | Analyses and edges are written only after the equivalence principle returns |
| Evidence hash pinning | Digests are recomputed and compared at adjudication, not at registration |
| Version pinning | Every relation claim pins explicit versions; an unpinned claim is refused |
| Immutability | Writing to an existing version key raises; corrections append |
| Duplicate edges | `edge_seen` blocks a second accepted edge on the same endpoints and relation |
| Access control | Owner-only source registry; creator-only case mutation; nobody edits a version |
| Input validation | Control characters stripped, punctuation folded, every field length-capped |
| Data minimisation | The case registry refuses e-mail-shaped strings, identifier labels, and long digit runs |
| Auditability | Append-only receipts and alerts for every version, correction, analysis, and edge |
| Provisional never final | The interface refuses to draw an edge from a transaction that has not finalised |

---

## Environment

`frontend/.env` (copy from `frontend/.env.example`):

```
VITE_MOLFGRAPH_CONTRACT_ADDRESS=
VITE_GENLAYER_RPC=https://studio.genlayer.com/api
```

---

## Deploying

MolfGraph pins its runner explicitly. The magic header at the top of
`contracts/molfgraph.py` is:

```python
# {
#   "Seq": [
#     { "Depends": "py-lib-genlayermodelwrappers:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" },
#     { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
#   ]
# }
```

Do not replace that hash with `:test`. The dual dependency is required because the contract
uses `VecDB` with the sentence-transformer wrapper.

### Deploying to StudioNet

The deploy signs its own transaction, so it needs a funded key. There are two routes.

**Encrypted keystore (preferred).** The script picks up the active account from
`~/.genlayer/genlayer-config.json` and prompts for the password with `getpass`, so the
password is never echoed, never lands in your shell history or a process listing, and is
never written to disk. Run it in a real terminal:

```bash
python scripts/deploy.py
```

Use `--keystore NAME` to sign with a different keystore. The script refuses to prompt when
it is not attached to a terminal, so it fails fast under automation instead of hanging.

**Raw private key.** For CI or a throwaway account, put the key in a `.env` file in the repo
root, which is already gitignored, then pass `--use-env-key`:

```
GENLAYER_PRIVATE_KEY=0x<your 64-hex-character key>
```

Either way, check the key, the RPC, and the balance without sending anything first:

```bash
python scripts/deploy.py --dry-run
```

The script deploys with no constructor arguments, so the deploying account becomes the
owner and the default trusted source registry is written in the constructor. It waits for a
finalised receipt, writes the address into `frontend/.env`, and reads three views back off
the chain to prove the contract is live.

Start the console:

```bash
cd frontend && npm install && npm run dev
```

An unlocked browser wallet cannot sign this deploy: `genlayer-py` signs locally from a
private key and has no bridge to an extension. If you would rather not put a key on disk,
deploy from the GenLayer Studio UI with Bradbury selected, then set
`VITE_MOLFGRAPH_CONTRACT_ADDRESS` in `frontend/.env` by hand.

### If the deploy hits `BlockPubdataLimitReached`

The contract is written so it can be split without changing the ABI the interface calls.
Move studies, versions, corrections, the trusted registry, VecDB, receipts, and cases into
`MolfGraphRegistry`, and evidence, claims, edges, and adjudication into
`MolfGraphAdjudicator`. Give the adjudicator an owner-only `bind_registry` and have it read
version snapshots through the registry's `get_study_version` view. Nothing in the semantics
above changes; add a thin adapter in `frontend/src/useGenLayer.ts` that routes each function
name to the right address, and hard-lock both addresses in `frontend/src/config.ts`.

---

## Demo path

1. Register two study versions in **Studies** (the sample loader fills the form).
2. Index each version's records into VecDB.
3. Run `verify_statute` in **Screen** and read the grounded result card.
4. In **Relations**, pin a public source with the SHA-256 of the bytes you fetched.
5. Propose a version-pinned relation between the two studies.
6. Run adjudication. Watch the transaction move submitted → pending → finalized.
7. Open **Live graph**: the accepted edge is drawn, coloured by relation type.
8. Open **Receipts**: the provenance entry carries the source-set digest that backed it.

---

## Tests

The offline suite runs with no network and no node, against a GenVM double that reproduces
storage types, the message context, web fetches, prompts, and all three consensus wrappers.
`strict_eq` runs the leader twice and fails on divergence; `run_nondet_unsafe` runs the
validator against the leader's result and raises when they disagree.

```bash
python -m pytest -q
```

Direct-mode tests deploy to a live node and are opt-in:

```bash
MOLFGRAPH_DIRECT=1 pytest tests/direct -q --network studionet
```

Frontend:

```bash
cd frontend && npm run typecheck && npm run build
```

---

## Network

MolfGraph targets **GenLayer StudioNet** (chain `61999`, `https://studio.genlayer.com/api`).
There is no network selector in the interface: a research instrument should never leave a
reader guessing which chain a receipt came from.

The chain object is imported from the SDK rather than assembled by hand, so consensus
contract addresses are never hand-copied. Only the RPC endpoint is overridable, through
`VITE_GENLAYER_RPC`.

---

## Licence

MIT. See [LICENSE](LICENSE).
