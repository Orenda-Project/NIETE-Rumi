"""Stage D0 primary — the vendor CONTRACT tests.

Split out of test_d0_primary.py, which holds the shape of the transform. These three are
different in kind: they check the document against v9's own closed vocabularies -- the
block enum and the `lp_type` enum -- so they fail when the VENDOR moves, not when D0 does.

Run: python3 -m pytest test_d0_contract.py -q
"""

import json

import d0_primary as d0
from test_d0_primary import ENR, PT, build


def test_renders_against_the_live_v9_schema():
    """The block enum is closed — this is the check that caught the invented types.

    `LP_V9` points this at the vendor tree the render is actually using. It defaults to the
    live clone, so a normal run checks against what is deployed; a render that depends on an
    unmerged vendor divergence (today: `board.panels`, SYNC §3.16) sets it to the worktree.
    """
    import os
    schema = os.path.join(
        os.environ.get("LP_V9") or os.path.expanduser(
            "~/rumi/Rumi 10 April 2026/NIETE-Rumi/bot/vendor/lp-v9"),
        "schema/lp_doc.schema.json")
    if not os.path.exists(schema):
        return
    try:
        import jsonschema
    except ImportError:
        return
    jsonschema.validate(build(), json.load(open(schema)))


def test_primary_lp_type_maps_onto_the_closed_v9_enum():
    """content+language -> LL-2, content+STEM -> STEM-2, revision/assessment -> RECALL."""
    assert build()["lp_type"] == "LL-2"
    maths = dict(PT, subject="Maths", book_stem="grade_4_maths")
    assert d0.to_lp_doc(ENR, maths)["lp_type"] == "STEM-2"
    rev = {**ENR, "lp_type": "revision"}
    assert d0.to_lp_doc(rev, PT)["lp_type"] == "RECALL"


def test_primary_lp_type_is_preserved_not_lost():
    assert "primary lp_type: content" in build()["notes"]["supplied"]

if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except Exception as e:
                fails += 1
                print(f"  FAIL {name}: {type(e).__name__}: {e}")
    print("FAILED" if fails else "all passed")
    raise SystemExit(1 if fails else 0)
