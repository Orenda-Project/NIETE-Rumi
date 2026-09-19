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
    unmerged vendor divergence sets it to the worktree. Unmerged today: the five properties
    spliced by SYNC §3.27 (`board.panels`/`.title`, `turns` on both example variants,
    `sequence.day`/`.of`), the `big_idea` variant (§3.26) and `section.move` (§3.28).
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
    """content+language -> LL-2, content+STEM -> STEM-2."""
    assert build()["lp_type"] == "LL-2"
    maths = dict(PT, subject="Maths", book_stem="grade_4_maths")
    assert d0.to_lp_doc(ENR, maths)["lp_type"] == "STEM-2"


def test_a_review_day_is_refused_rather_than_mapped_onto_RECALL():
    """The RECALL mapping was the silent fallback, not the answer (d0_route).

    It stays reachable under the named escape hatch, because somebody
    occasionally wants to see what the LP renderer makes of a review day --
    but it is no longer what happens by default, which is what shipped a
    worksheet as a teacher lesson plan.
    """
    import d0_route
    rev = {**ENR, "lp_type": "revision"}
    try:
        d0.to_lp_doc(rev, PT)
    except d0_route.WrongRoute:
        pass
    else:
        raise AssertionError("a revision segment rendered as a lesson plan")
    assert d0.to_lp_doc(rev, PT, force_lp=True)["lp_type"] == "RECALL"


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
