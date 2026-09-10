# MolfGraph workflow

This is the path a legal research team actually walks, and what the contract does at each
step. Everything here is decision-support. Nothing here is legal advice, and no step
produces a judgement about any person or any matter.

## 1. Confirm the sources you are allowed to rely on

Open **Sources**. The registry ships with official and primary law sites for the United
States, United Kingdom, European Union, Canada, Australia, India, Nigeria, Kenya, South
Africa, and an international bucket.

Only the deployment owner can add or retire an origin. Everyone can read the list. A URL you
supply to a tool is honoured only when its origin already appears here; anything else is
recorded as `UNAVAILABLE` with reason `UNTRUSTED_ORIGIN` rather than silently fetched.

## 2. Screen the law

Open **Screen** and pick a tool. Each run:

1. resolves the trusted sources for the jurisdiction,
2. fetches each source over HTTPS inside the consensus wrapper,
3. wraps every body in untrusted-data markers,
4. adds VecDB neighbours as labelled context,
5. prompts the model with strict grounding rules,
6. coerces the answer into the normalised schema,
7. writes the result, a receipt, and any alert to the chain.

Read the result card as it stands. A downgraded status is the system working: `VERIFIED`
without a citation is not a near-miss, it is an ungrounded answer, and MolfGraph refuses to
present it as verified.

## 3. Register the screening as a study version

Open **Studies**. Fill in the question, the method, and the conclusion — the three fields
that make a screening comparable to another screening. Add typed records for the crime,
the judgement material, the question, the method, and the conclusion.

Keep `subject_ref` non-personal. The contract rejects e-mail-shaped strings, explicit
identifier labels, and long digit runs, because a research graph does not need them.

The version is hashed and written. It can never be edited.

## 4. Index the records

Press **Index records into VecDB** on the version. Record texts are embedded and stored for
retrieval context.

This is not a graph operation. Indexing creates no edge, changes no relation, and adds no
citation. Its only effect is that future prompts and the neighbours drawer can surface
related records.

## 5. Correct, rather than edit

When a screening turns out to be wrong, append a correction. You must supply a correction
note. The contract writes version N+1, pins `parent_version = N`, and marks version N
`SUPERSEDED`.

The superseded version stays readable, keeps its hash, and keeps its vectors. Claims already
pinned to it remain readable for audit, but the live graph shows it with a dashed outline so
no reader mistakes it for current.

## 6. Pin the evidence

Open **Relations**. Before you can claim a relationship, pin the public sources that support
it:

1. Fetch the source yourself.
2. Compute the SHA-256 of the exact bytes you fetched.
3. Register the stable record id, the HTTPS URL, that digest, a version, and the issue date.

The digest is not checked at registration. It is checked at adjudication, which is the point
of the exercise: MolfGraph is testing whether the source still says what you read.

## 7. Propose a relation

Pick two study versions — explicitly, including version numbers — choose the relation you
believe holds, and tick the evidence the claim rests on.

The claim opens as `PENDING`. It draws nothing on the graph. Naming a relation is a
hypothesis, not a result.

## 8. Adjudicate

Run adjudication. The contract refetches every pinned source, rehashes it, and compares
against the committed digest.

- **A digest fails** → `REPAIR_REQUIRED`, with the failure code, the failing evidence id,
  and the digest actually observed. An alert is raised. No edge.
- **Digests pass, consensus lands on `INSUFFICIENT`** → `REJECTED_AS_INSUFFICIENT`. The
  decision is stored for audit. No edge.
- **Validators disagree** → `NO_CONSENSUS`. No edge.
- **Digests pass and consensus reaches a substantive relation** → an accepted edge, unless
  those endpoints already carry that relation.

Consensus may overrule the relation you claimed. That is the point of proposing rather than
asserting.

## 9. Repair and re-claim

When a publisher reissues a page, call `repair_evidence` with the same stable id, the same
publisher origin, the new digest, and a strictly higher version. Then open a fresh claim
against the repaired evidence.

A repair cannot change the publisher, and it cannot go backwards. Those two rules are what
stop a repair from becoming a quiet source swap.

## 10. Read the graph

Open **Live graph**. Nodes are study versions coloured by jurisdiction; edges are accepted
relations coloured by type. Click a node for its immutable payload and receipts. Click an
edge for the consensus key and the source-set digest that backed it.

The semantic neighbours drawer sits below, visually separate and labelled context-only,
because a retrieval hit and an adjudicated edge are not the same kind of claim and should
never look alike.

## 11. Audit

**Ledger** holds every analysis, filterable by tool, status, and jurisdiction, including the
ones that failed closed. **Receipts** is the append-only provenance trail. **Alerts** marks
each place where a lawyer must look before relying on a result. **Stats** counts everything
the contract counts itself.
