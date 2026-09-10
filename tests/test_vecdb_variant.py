"""Tests for the VecDB variant, which is NOT what is deployed.

``contracts/molfgraph.py`` is the deployed contract and is covered by
``test_molfgraph.py``. ``contracts/molfgraph_vecdb.py`` keeps the semantic
retrieval layer for the day a GenLayer runtime accepts the dual ``Seq`` magic
header that ``genlayermodelwrappers`` needs. Both StudioNet and Bradbury reject
that header today, so this module exists to stop the variant rotting, not to
give confidence about production.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
VARIANT = ROOT / "contracts" / "molfgraph_vecdb.py"

pytestmark = pytest.mark.skipif(not VARIANT.exists(), reason="VecDB variant not in tree")


@pytest.fixture(scope="module")
def vecdb_mod():
    """Load the variant through the same GenVM double the other suite installs."""
    spec = importlib.util.spec_from_file_location("molfgraph_vecdb", VARIANT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["molfgraph_vecdb"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def vec(gl_env, vecdb_mod):
    gl_env.message.sender_address = gl_env.message.sender_address
    return vecdb_mod.Contract()


def records(record_type: str, text: str, uri: str = "") -> str:
    entry = {"record_type": record_type, "text": text}
    if uri:
        entry["source_uris"] = [uri]
    return json.dumps([entry])


US_SOURCE = "https://uscode.house.gov/view.xhtml?req=1030"


def register(contract):
    return json.loads(contract.register_study_version(
        "Unauthorised access screening", "US", "matter-alpha",
        "Unauthorised computer access",
        "Does the charged provision cover remote credential reuse?",
        "Element-by-element comparison against the published statute.",
        "Consistent.",
        records("CRIME", "Remote reuse of another person's credentials.", US_SOURCE),
    ))


def test_variant_declares_the_vecdb_dependency(vecdb_mod):
    text = VARIANT.read_text(encoding="utf-8")
    assert "py-lib-genlayermodelwrappers" in text[:600]
    assert "Seq" in text[:600]


def test_variant_indexes_and_retrieves_context(vec):
    register(vec)
    indexed = json.loads(vec.index_study_records(1, 1))
    assert indexed["indexed_record_ids"] == ["1:1:0"]
    assert "never create edges" in indexed["note"]

    found = json.loads(vec.similar_records("reuse of another person's credentials", 5))
    assert found["context_only"] is True
    assert found["items"][0]["study_id"] == 1
    assert found["items"][0]["record_type"] == "CRIME"


def test_variant_retrieval_still_creates_no_edges(vec):
    register(vec)
    vec.index_study_records(1, 1)
    vec.similar_records("anything", 5)
    assert json.loads(vec.get_stats())["total_edges"] == 0
    assert json.loads(vec.list_edges(0, 25))["total"] == 0


def test_variant_keeps_historical_vectors_across_a_correction(vec):
    register(vec)
    vec.index_study_records(1, 1)
    vec.correct_study(
        1, "Refined the record.", "Unauthorised access screening", "US", "matter-alpha",
        "Unauthorised computer access", "q", "m", "c",
        records("CRIME", "Remote reuse of another person's credentials, refined."),
    )
    vec.index_study_records(1, 2)
    found = json.loads(vec.similar_records("remote reuse credentials", 5))
    assert {item["version"] for item in found["items"]} == {1, 2}
