"""Opt-in guard for direct-mode tests.

Direct-mode tests deploy the contract to a live GenLayer node, so they are not
collected during an ordinary offline run. Enable them explicitly::

    MOLFGRAPH_DIRECT=1 pytest tests/direct -q --network studionet

The GenVM double installed by ``tests/conftest.py`` stubs only modules that run
inside the GenVM (``genlayer``, ``genlayermodelwrappers``). Nothing in the
direct-mode path imports them locally, so the two suites do not collide.
"""

import os

if not os.environ.get("MOLFGRAPH_DIRECT"):
    collect_ignore_glob = ["test_*.py"]
