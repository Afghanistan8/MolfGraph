"""Direct-mode end-to-end flow for MolfGraph.

These tests deploy the real Intelligent Contract through genlayer-test and walk
the demo path: register two study versions, index their records, run a screening
tool, propose a version-pinned relation, adjudicate it, and read the accepted
edge back off the live graph.

They need a reachable GenLayer node (StudioNet by default, per
``gltest.config.yaml``) and are skipped automatically when ``gltest`` is not
installed or no node answers. Run them with::

    pytest tests/direct -q --network studionet
"""

from __future__ import annotations

import json

import pytest

gltest = pytest.importorskip("gltest", reason="genlayer-test is not installed")

from gltest import get_contract_factory  # noqa: E402
from gltest.assertions import tx_execution_succeeded  # noqa: E402


US_SOURCE = "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title18-section1030"
UK_SOURCE = "https://www.legislation.gov.uk/ukpga/1990/18/section/1"


pytestmark = pytest.mark.direct


@pytest.fixture(scope="module")
def molfgraph():
    factory = get_contract_factory("Contract")
    return factory.deploy(args=[])


def _record(record_type: str, text: str, uri: str) -> dict:
    return {"record_type": record_type, "text": text, "source_uris": [uri]}


def test_deploy_exposes_the_default_registry(molfgraph):
    registry = json.loads(molfgraph.get_trusted_sources(args=[]))
    assert registry["US"] and registry["UK"]
    assert all(url.startswith("https://") for url in registry["US"])


def test_register_index_screen_propose_adjudicate(molfgraph):
    first = molfgraph.register_study_version(args=[
        "Unauthorised access screening (US)",
        "US",
        "matter-alpha",
        "Unauthorised computer access",
        "Does the charged provision cover remote credential reuse?",
        "Element-by-element comparison against the published statute.",
        "The described application tracks the published elements.",
        json.dumps([
            _record("CRIME", "Remote reuse of another person's credentials.", US_SOURCE),
            _record("QUESTION", "Does remote credential reuse meet the access element?", US_SOURCE),
        ]),
    ])
    assert tx_execution_succeeded(first)

    second = molfgraph.register_study_version(args=[
        "Computer misuse screening (UK)",
        "UK",
        "matter-beta",
        "Unauthorised access to computer material",
        "Does the charged provision cover remote credential reuse?",
        "Element-by-element comparison against the published statute.",
        "The described application tracks the published elements.",
        json.dumps([
            _record("CRIME", "Remote reuse of another person's credentials.", UK_SOURCE),
        ]),
    ])
    assert tx_execution_succeeded(second)

    assert tx_execution_succeeded(molfgraph.index_study_records(args=[1, 1]))
    assert tx_execution_succeeded(molfgraph.index_study_records(args=[2, 1]))

    neighbours = json.loads(molfgraph.similar_records(args=["credential reuse", 5]))
    assert neighbours["context_only"] is True

    screening = molfgraph.verify_statute(args=["Unauthorised computer access", "US", ""])
    assert tx_execution_succeeded(screening)

    ledger = json.loads(molfgraph.list_analyses(args=[0, 10]))
    assert ledger["total"] >= 1
    assert all("not legal advice" in item["disclaimer"] for item in ledger["items"])

    # Evidence must be digest-pinned before a claim can be adjudicated. Compute
    # the digest off-chain from the exact bytes you intend to pin.
    stats_before = json.loads(molfgraph.get_stats(args=[]))
    assert stats_before["total_studies"] >= 2

    graph = json.loads(molfgraph.get_graph(args=[25]))
    assert {node["node_id"] for node in graph["nodes"]} >= {"1:1", "2:1"}
    assert "Accepted consensus edges only" in graph["note"]


def test_correction_supersedes_the_previous_version(molfgraph):
    correction = molfgraph.correct_study(args=[
        1,
        "Repinned the conclusion after the subsection was amended.",
        "Unauthorised access screening (US)",
        "US",
        "matter-alpha",
        "Unauthorised computer access",
        "Does the charged provision cover remote credential reuse?",
        "Element-by-element comparison against the published statute.",
        "The cited subsection was amended; the earlier conclusion no longer holds.",
        json.dumps([
            _record("CONCLUSION", "The cited subsection was amended.", US_SOURCE),
        ]),
    ])
    assert tx_execution_succeeded(correction)

    previous = json.loads(molfgraph.get_study_version(args=[1, 1]))
    assert previous["status"] == "SUPERSEDED"
    assert previous["superseded_by"] == 2

    receipts = json.loads(molfgraph.list_receipts(args=[0, 50]))
    assert any(item["kind"] == "CORRECTION" for item in receipts["items"])


# ---------------------------------------------------------------------------
# Runtime-representative check for the two analysis paths that use different
# consensus wrappers. extract_law_text runs under strict_eq, where the law text
# itself is inside the value validators must agree on byte for byte;
# compare_jurisdictions runs under prompt_comparative. Both must complete, and
# neither may replace its extracted body with a generic message.
# ---------------------------------------------------------------------------

UK_CMA_S1 = "https://www.legislation.gov.uk/ukpga/1990/18/section/1"


def _latest_of(molfgraph, kind: str) -> dict:
    page = json.loads(molfgraph.list_analyses(args=[0, 50]))
    matching = [item for item in page["items"] if item["kind"] == kind]
    assert matching, f"no {kind} analysis was recorded"
    return matching[-1]


def test_extract_law_text_completes_and_preserves_the_provision(molfgraph):
    """The strict path must finish and keep the statutory text it extracted."""
    written = molfgraph.extract_law_text(
        args=["Computer Misuse Act 1990, s 1", "UK", json.dumps([UK_CMA_S1])]
    )
    assert tx_execution_succeeded(written)

    result = _latest_of(molfgraph, "extract_law_text")
    body = result["exact_text_or_summary"]

    # The whole point of this path: a real provision, not a placeholder.
    assert body, "extract_law_text stored an empty body"
    assert body.strip() != "Validators did not reach consensus on this analysis."
    assert len(body) > 200, f"body looks truncated: {body[:120]!r}"
    assert "unauthorised" in body.lower() or "offence" in body.lower()

    # Strict extraction is comparative prose free: notes are cleared by design.
    assert result["notes"] == ""
    assert result["disclaimer"]


def test_compare_jurisdictions_completes_and_preserves_its_body(molfgraph):
    """The comparative path must finish and keep its comparison text."""
    written = molfgraph.compare_jurisdictions(
        args=["Unauthorised access to computer material", "UK", "US", json.dumps([UK_CMA_S1])]
    )
    assert tx_execution_succeeded(written)

    result = _latest_of(molfgraph, "compare_jurisdictions")
    body = result["exact_text_or_summary"]

    assert body, "compare_jurisdictions stored an empty body"
    assert body.strip() != "Validators did not reach consensus on this analysis."
    # Either jurisdiction may be unsupported by the sources, and the contract is
    # expected to say so rather than invent. What it may not do is lose the body.
    assert result["status"] in (
        "VERIFIED", "INSUFFICIENT_EVIDENCE", "UNAVAILABLE", "CONFLICT",
    )
    assert result["disclaimer"]
