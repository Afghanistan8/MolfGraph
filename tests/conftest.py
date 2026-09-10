"""Offline GenVM test double for MolfGraph.

The double reproduces the parts of the GenLayer runtime the contract actually
touches -- storage types, the message context, web fetches, prompts, and the
three consensus wrappers -- so the whole contract can be exercised with plain
pytest and no network.

It is deliberately faithful where faithfulness matters:

  * ``strict_eq`` runs the leader twice and fails on any divergence, which is
    what catches non-deterministic extraction code.
  * ``run_nondet_unsafe`` runs the validator against the leader's result and
    raises when they disagree, so a contract that ignores consensus failure
    cannot pass.
  * Storage containers reject nothing, but the contract may only declare the
    storage types GenLayer supports; anything else fails at class definition.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import pathlib
import sys
import types

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts" / "molfgraph.py"

ZERO_ADDRESS = "0x" + "00" * 20
OWNER_ADDRESS = "0x" + "11" * 20
OTHER_ADDRESS = "0x" + "22" * 20
THIRD_ADDRESS = "0x" + "33" * 20


# ---------------------------------------------------------------------------
# Storage type doubles
# ---------------------------------------------------------------------------


class _Parametrisable:
    """Storage generics: ``TreeMap[u256, str]`` evaluates to ``TreeMap``."""

    def __class_getitem__(cls, item):
        return cls


class Address(_Parametrisable):
    def __init__(self, value=ZERO_ADDRESS):
        if isinstance(value, Address):
            value = value.as_hex
        self._hex = str(value).lower()

    @property
    def as_hex(self) -> str:
        return self._hex

    def __eq__(self, other) -> bool:
        return isinstance(other, Address) and other._hex == self._hex

    def __ne__(self, other) -> bool:
        return not self.__eq__(other)

    def __hash__(self) -> int:
        return hash(self._hex)

    def __repr__(self) -> str:
        return "Address(" + self._hex + ")"


class u256(int, _Parametrisable):
    pass


class u32(int, _Parametrisable):
    pass


class u8(int, _Parametrisable):
    pass


class TreeMap(dict, _Parametrisable):
    # dict defines __class_getitem__ (GenericAlias) and would win on the MRO.
    def __class_getitem__(cls, item):
        return cls


class DynArray(list, _Parametrisable):
    def __class_getitem__(cls, item):
        return cls


class _KnnResult:
    def __init__(self, value, distance):
        self.value = value
        self.distance = distance


class VecDB(_Parametrisable):
    def __init__(self):
        self._rows = []

    def insert(self, embedding, value):
        self._rows.append((list(embedding), value))

    def knn(self, embedding, k):
        query = list(embedding)
        norm_q = sum(x * x for x in query) ** 0.5 or 1.0
        scored = []
        for vector, value in self._rows:
            dot = sum(a * b for a, b in zip(vector, query))
            norm_v = sum(a * a for a in vector) ** 0.5 or 1.0
            scored.append((1.0 - (dot / (norm_v * norm_q)), value))
        scored.sort(key=lambda row: row[0])
        return [_KnnResult(value, distance) for distance, value in scored[: max(1, int(k))]]

    def __len__(self):
        return len(self._rows)


def allow_storage(cls):
    return cls


_DEFAULTS = {
    TreeMap: TreeMap,
    DynArray: DynArray,
    VecDB: VecDB,
}


def _default_for(annotation):
    if annotation in _DEFAULTS:
        return _DEFAULTS[annotation]()
    if annotation is Address:
        return Address(ZERO_ADDRESS)
    if annotation in (u256, u32, u8):
        return annotation(0)
    if annotation is str:
        return ""
    if annotation is bool:
        return False
    if annotation is int:
        return 0
    return None


# ---------------------------------------------------------------------------
# Runtime doubles
# ---------------------------------------------------------------------------


class _Message:
    def __init__(self):
        self.sender_address = Address(OWNER_ADDRESS)
        self.origin_address = Address(OWNER_ADDRESS)
        self.contract_address = Address(THIRD_ADDRESS)
        self.value = 0
        self.is_init = False
        self.datetime = None


class _Response:
    def __init__(self, body: str, status: int = 200):
        self.body = body
        self.text = body
        self.status = status


class _Web:
    """Scripted HTTPS surface. Unregistered URLs behave as unreachable."""

    def __init__(self):
        self.bodies = {}
        self.render_disabled = False
        self.calls = []

    def set(self, url: str, body: str) -> None:
        self.bodies[url] = body

    def clear(self) -> None:
        self.bodies = {}
        self.calls = []
        self.render_disabled = False

    def render(self, url, mode="text"):
        self.calls.append(("render", url))
        if self.render_disabled:
            raise RuntimeError("render unavailable")
        if url not in self.bodies:
            raise RuntimeError("unreachable: " + str(url))
        return self.bodies[url]

    def request(self, url, method="GET", **kwargs):
        self.calls.append((method, url))
        if url not in self.bodies:
            raise RuntimeError("unreachable: " + str(url))
        return _Response(self.bodies[url])


class _Nondet:
    def __init__(self):
        self.web = _Web()
        self.prompt_responses = []
        self.default_prompt_response = json.dumps({
            "status": "INSUFFICIENT_EVIDENCE",
            "citation": "",
            "exact_text_or_summary": "",
            "applicability_score": 0,
            "confidence": "LOW",
            "notes": "test double default",
        })
        self.prompts = []

    def queue_prompt(self, response) -> None:
        """Queue one response. The last queued value repeats once exhausted."""
        self.prompt_responses.append(response)

    def set_prompt(self, response) -> None:
        self.prompt_responses = []
        self.default_prompt_response = response

    def exec_prompt(self, prompt, **kwargs):
        self.prompts.append(prompt)
        if self.prompt_responses:
            value = self.prompt_responses[0]
            if len(self.prompt_responses) > 1:
                self.prompt_responses.pop(0)
            return value(prompt) if callable(value) else value
        value = self.default_prompt_response
        return value(prompt) if callable(value) else value

    def reset(self) -> None:
        self.web.clear()
        self.prompt_responses = []
        self.prompts = []


class _EqPrinciple:
    """Consensus wrappers, with the divergence checks the real runtime makes."""

    def __init__(self, nondet):
        self._nondet = nondet
        self.calls = []

    def prompt_comparative(self, fn, principle=""):
        self.calls.append(("prompt_comparative", principle))
        return fn()

    def strict_eq(self, fn):
        self.calls.append(("strict_eq", ""))
        leader = fn()
        validator = fn()
        if leader != validator:
            raise RuntimeError("strict_eq: validators diverged from the leader")
        return leader


class _Vm:
    def __init__(self):
        self.calls = []
        self.force_no_consensus = False

    def run_nondet_unsafe(self, leader_fn, validator_fn):
        self.calls.append("run_nondet_unsafe")
        result = leader_fn()
        if self.force_no_consensus:
            raise RuntimeError("validators rejected the leader result")
        if not validator_fn(result):
            raise RuntimeError("validators rejected the leader result")
        return result


class _Public:
    @staticmethod
    def view(fn):
        fn.__gl_public__ = "view"
        return fn

    @staticmethod
    def write(fn):
        fn.__gl_public__ = "write"
        return fn


class _Contract:
    def __new__(cls, *args, **kwargs):
        instance = super().__new__(cls)
        for klass in reversed(cls.__mro__):
            for name, annotation in getattr(klass, "__annotations__", {}).items():
                setattr(instance, name, _default_for(annotation))
        return instance


class _Gl(types.SimpleNamespace):
    pass


def _build_gl():
    nondet = _Nondet()
    gl = _Gl()
    gl.Contract = _Contract
    gl.public = _Public
    gl.message = _Message()
    gl.nondet = nondet
    gl.eq_principle = _EqPrinciple(nondet)
    gl.vm = _Vm()

    return gl


# ---------------------------------------------------------------------------
# Module installation
# ---------------------------------------------------------------------------


class _SentenceTransformer:
    """Deterministic bag-of-tokens embedding in the pinned 384 dimensions."""

    def __init__(self, model_name="all-MiniLM-L6-v2"):
        self.model_name = model_name

    def __call__(self, text):
        vector = [0.0] * 384
        for token in str(text).lower().split():
            digest = int(hashlib.sha256(token.encode("utf-8")).hexdigest(), 16)
            vector[digest % 384] += 1.0
        if not any(vector):
            vector[0] = 1.0
        return vector


def _install_modules():
    if importlib.util.find_spec("numpy") is None:
        numpy_stub = types.ModuleType("numpy")
        numpy_stub.float32 = float
        numpy_stub.float64 = float
        sys.modules["numpy"] = numpy_stub

    wrappers = types.ModuleType("genlayermodelwrappers")
    wrappers.SentenceTransformer = _SentenceTransformer
    sys.modules["genlayermodelwrappers"] = wrappers

    gl = _build_gl()
    genlayer = types.ModuleType("genlayer")
    genlayer.gl = gl
    genlayer.Address = Address
    genlayer.u256 = u256
    genlayer.u32 = u32
    genlayer.u8 = u8
    genlayer.TreeMap = TreeMap
    genlayer.DynArray = DynArray
    genlayer.VecDB = VecDB
    genlayer.allow_storage = allow_storage
    genlayer.__all__ = [
        "gl", "Address", "u256", "u32", "u8",
        "TreeMap", "DynArray", "VecDB", "allow_storage",
    ]
    sys.modules["genlayer"] = genlayer
    return gl


GL = _install_modules()


def _load_contract_module():
    spec = importlib.util.spec_from_file_location("molfgraph_contract", CONTRACT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["molfgraph_contract"] = module
    spec.loader.exec_module(module)
    return module


MOD = _load_contract_module()

@pytest.fixture
def gl_env():
    GL.nondet.reset()
    GL.vm.calls = []
    GL.vm.force_no_consensus = False
    GL.eq_principle.calls = []
    GL.message.sender_address = Address(OWNER_ADDRESS)
    GL.message.datetime = None
    return GL


@pytest.fixture
def mod():
    return MOD


@pytest.fixture
def contract(gl_env):
    gl_env.message.sender_address = Address(OWNER_ADDRESS)
    return MOD.Contract()


@pytest.fixture
def as_sender(gl_env):
    def _switch(address: str):
        gl_env.message.sender_address = Address(address)
        return gl_env.message.sender_address
    return _switch


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
