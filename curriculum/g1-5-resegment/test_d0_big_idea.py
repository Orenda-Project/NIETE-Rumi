"""Stage D0 — THE BIG IDEA, the block that opens EXPLANATION. Unit tests.

Operator, choosing between three costed options for kie.ai's `bigIdea`:
*"give it its own surface on page 2 under EXPLANATION"*.

The surface is built now and prints "design pending" until Stage C authors it —
the operator's standing decision (*"Build the surfaces now, print 'design pending'"*).
That is the whole reason these tests are about ABSENCE as much as presence: the
common case today is an enrichment record that carries no `bigIdea` at all, and the
one outcome worse than a blank surface is an invented one.

Run: python3 -m pytest test_d0_big_idea.py -q     (or: python3 test_d0_big_idea.py)
"""

import copy
import json

import d0_blocks as B
import d0_primary as d0
from test_d0_primary import ENR, PT


BI = {"distinction": "A describing word tells you HOW, not WHO.",
      "misconception": "Pupils mark the noun, because it is the word they recognise.",
      "demo": "Circle the noun in one colour and the describing word in another."}


def build(big_idea="absent"):
    enr = copy.deepcopy(ENR)
    if big_idea != "absent":
        enr["generated"]["bigIdea"] = big_idea
    return d0.to_lp_doc(enr, PT, day=1, total_days=10)


def _dev(doc):
    return [s for s in doc["sections"] if s["id"] == "development"][0]


def _bi(doc):
    return [b for b in _dev(doc)["blocks"] if b["type"] == "big_idea"]


# ── it opens EXPLANATION ─────────────────────────────────────────────────────

def test_the_big_idea_is_the_first_block_of_development():
    """Placement is the point. A teacher cannot model a distinction she has not been
    told, so the Big Idea sits AHEAD of I Do -- not after the worked example, where it
    would read as a footnote to teaching that already happened."""
    assert _dev(build(BI))["blocks"][0]["type"] == "big_idea"


def test_it_is_emitted_even_when_stage_c_carried_nothing():
    """'Build the surfaces now, print design pending.' Today every one of the 38 corpus
    lessons carries no `bigIdea`, so the absent case IS the case."""
    assert _dev(build())["blocks"][0]["type"] == "big_idea"


def test_exactly_one_big_idea_and_only_in_development():
    doc = build(BI)
    assert len(_bi(doc)) == 1
    assert not [b for s in doc["sections"] if s["id"] != "development"
                for b in s["blocks"] if b["type"] == "big_idea"]


# ── the three paragraphs, and nothing invented ───────────────────────────────

def test_the_three_paragraphs_are_carried_verbatim():
    blk = _bi(build(BI))[0]
    for k, v in BI.items():
        assert blk[k] == v


def test_an_absent_source_prints_design_pending_in_all_three():
    """Dark stages stay dark. The proxies available here are all worse than a blank:
    keyFact is the outcome, cfuExplain is the error cue, and either one printed as the
    Big Idea says the same thing twice and hides the gap."""
    blk = _bi(build())[0]
    for k in ("distinction", "misconception", "demo"):
        assert blk[k] == B.DESIGN_PENDING


def test_a_partial_source_fills_only_the_missing_paragraphs():
    blk = _bi(build({"distinction": BI["distinction"]}))[0]
    assert blk["distinction"] == BI["distinction"]
    assert blk["misconception"] == B.DESIGN_PENDING
    assert blk["demo"] == B.DESIGN_PENDING


def test_a_blank_string_is_a_gap_not_a_value():
    blk = _bi(build({"distinction": "   ", "misconception": BI["misconception"], "demo": ""}))[0]
    assert blk["distinction"] == B.DESIGN_PENDING
    assert blk["demo"] == B.DESIGN_PENDING
    assert blk["misconception"] == BI["misconception"]


def test_a_source_that_is_not_an_object_is_refused_rather_than_guessed_at():
    for junk in ("a sentence", ["a", "list"], 7):
        blk = _bi(build(junk))[0]
        assert blk["distinction"] == B.DESIGN_PENDING


# ── ONE HOME PER SOURCE FIELD ────────────────────────────────────────────────

def test_the_big_idea_does_not_repeat_key_fact_or_the_slip_cue():
    """Key fact stays the one-line outcome, Watch for this slip stays the in-the-moment
    error cue, and the Big Idea is the teaching behind both. Printing either one here is
    the duplication this whole profile exists to remove."""
    blk = _bi(build(BI))[0]
    printed = json.dumps(blk, ensure_ascii=False)
    assert ENR["generated"]["keyFact"] not in printed
    assert ENR["generated"]["cfuExplain"] not in printed


def test_the_surface_carries_no_key_the_renderer_would_reject():
    """`additionalProperties: false` in the schema. An extra key fails validation, which
    fails the render -- so the emitted block is exactly the block the schema allows."""
    assert set(_bi(build(BI))[0]) == {"type", "id", "distinction", "misconception", "demo"}


# ── G6-12 untouched by construction ─────────────────────────────────────────

def test_the_surface_is_primary_only_by_construction():
    """G6-12 never runs d0_primary at all, and no enrichment record outside this profile
    carries `bigIdea` -- the same proof the diagram slots take."""
    assert "bigIdea" not in ENR["generated"]


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
