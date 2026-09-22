"""Stage D0 — the three anchored diagram slots. Unit tests.

Run: python3 -m pytest test_d0_diagram.py -q     (or: python3 test_d0_diagram.py)
"""

import copy
import json

import d0_diagram as D
import d0_primary as d0
from test_d0_primary import ENR, PT


FLOW = {"type": "flow", "direction": "lr", "title": "WHICH APOSTROPHE JOB?",
        "steps": [{"title": "READ THE PAIR", "lines": ["Jojo / ball"]},
                  {"title": "ASK WHO OWNS IT", "lines": ["the ball belongs to Jojo"]},
                  {"title": "WRITE 's", "lines": ["Jojo's ball"]}],
        "caption": "Three moves, in order, every time."}


def build(diagrams=None):
    enr = copy.deepcopy(ENR)
    if diagrams is not None:
        enr["generated"]["diagrams"] = diagrams
    return d0.to_lp_doc(enr, PT, day=1, total_days=10)


def _sec(doc, sid):
    return [s for s in doc["sections"] if s["id"] == sid][0]


def _kinds(doc, sid):
    return [(b["type"], b.get("id")) for b in _sec(doc, sid)["blocks"]]


# ── additive: a document with no specs is the document we already ship ────────

def test_a_document_with_no_diagrams_key_is_unchanged():
    """The additive-field pattern. Every one of the 38 corpus lessons carries no
    `diagrams` today, and this is the test that says they still render exactly as
    they did -- not 'about the same', identical."""
    assert build() == build(None)
    assert json.dumps(build(), sort_keys=True) == json.dumps(
        d0.to_lp_doc(copy.deepcopy(ENR), PT, day=1, total_days=10), sort_keys=True)


def test_an_empty_diagrams_map_emits_nothing_and_complains_about_nothing():
    doc = build({})
    assert not [b for s in doc["sections"] for b in s["blocks"] if b["type"] == "diagram"]
    assert doc["notes"]["gaps"] == ENR["generated"]["notes"]


# ── the replacement: same index, one home per source field ───────────────────

def test_the_diagram_takes_the_exact_place_of_the_prose_it_illustrates():
    """'Diagram replaces the prose it illustrates' (operator's choice). Not appended
    beside it -- in its seat, at its index, so the reading order is the one the author
    laid down and nothing is said twice."""
    before = _kinds(build(), "development")
    doc = build({"explanation": dict(FLOW, replaces="worked")})
    after = _kinds(doc, "development")
    seat = before.index(("worked_example", "worked"))
    assert after[seat] == ("diagram", "dia-explanation")
    assert len(after) == len(before)                       # a swap, never an insert
    assert after[:seat] == before[:seat] and after[seat + 1:] == before[seat + 1:]


def test_the_replaced_prose_leaves_the_document_entirely():
    """ONE HOME PER SOURCE FIELD. Its words are the diagram's labels now; printing
    both is the duplication this whole profile exists to remove."""
    doc = build({"explanation": dict(FLOW, replaces="worked")})
    assert "Read the definition." not in json.dumps(doc, ensure_ascii=False)


def test_replaces_is_not_handed_to_the_diagram_engine():
    """`replaces` is routing, not art. renderDiagram(spec) gets the spec the author
    wrote and not one key more, or an unknown key becomes a rendering risk."""
    doc = build({"explanation": dict(FLOW, replaces="worked")})
    spec = [b for b in _sec(doc, "development")["blocks"] if b["type"] == "diagram"][0]["spec"]
    assert "replaces" not in spec
    assert spec == FLOW


# ── the anchor: three slots, each one nailed to its own section ──────────────

def test_each_slot_is_anchored_to_one_section_and_only_that_one():
    """'Three anchored slots' is an invariant, not a habit: hook on page 1, the
    explanation, the practice. A slot that could land anywhere is a slot the teacher
    cannot learn to expect."""
    assert D.SLOT_SECTION == {"hook": "introduction",
                              "explanation": "development",
                              "practice": "activity"}


def test_a_slot_pointing_at_a_block_in_someone_elses_section_is_refused():
    doc = build({"hook": dict(FLOW, replaces="worked")})   # `worked` is in development
    assert not [b for s in doc["sections"] for b in s["blocks"] if b["type"] == "diagram"]
    assert _kinds(doc, "development") == _kinds(build(), "development")
    assert any("hook" in n and "worked" in n for n in doc["notes"]["gaps"])


def test_an_unknown_slot_name_is_refused_rather_than_guessed_at():
    doc = build({"plenary": dict(FLOW, replaces="cfu")})
    assert not [b for s in doc["sections"] for b in s["blocks"] if b["type"] == "diagram"]
    assert any("plenary" in n for n in doc["notes"]["gaps"])


def test_at_most_one_diagram_per_slot():
    """The dose is three, and it is three because the operator costed it at three.
    A map cannot hold two `explanation` keys, so the invariant that needs stating is
    that the emitted document never carries two diagrams in one section."""
    doc = build({"explanation": dict(FLOW, replaces="worked"),
                 "practice": dict(FLOW, replaces="you-do-task")})
    for s in doc["sections"]:
        assert len([b for b in s["blocks"] if b["type"] == "diagram"]) <= 1


def test_all_three_slots_fill_at_once():
    doc = build({"hook": dict(FLOW, replaces="hook"),
                 "explanation": dict(FLOW, replaces="worked"),
                 "practice": dict(FLOW, replaces="you-do-task")})
    got = [(s["id"], b["id"]) for s in doc["sections"]
           for b in s["blocks"] if b["type"] == "diagram"]
    assert got == [("introduction", "dia-hook"), ("development", "dia-explanation"),
                   ("activity", "dia-practice")]
    assert doc["notes"]["gaps"] == ENR["generated"]["notes"]


# ── every refusal is loud (dark stages stay dark) ────────────────────────────

def test_a_spec_naming_a_block_that_is_not_there_is_refused_and_says_so():
    """Dark stages stay dark. The alternative -- emit the diagram anyway -- prints the
    art beside the paragraph it was drawn to replace, and the page says everything twice."""
    doc = build({"practice": dict(FLOW, replaces="no-such-block")})
    assert not [b for s in doc["sections"] for b in s["blocks"] if b["type"] == "diagram"]
    assert any("no-such-block" in n for n in doc["notes"]["gaps"])


def test_a_spec_with_no_replaces_is_refused():
    """A diagram with nothing to replace is a diagram that costs a page and re-homes
    nothing -- which is the opposite of what the operator chose."""
    doc = build({"practice": dict(FLOW)})
    assert not [b for s in doc["sections"] for b in s["blocks"] if b["type"] == "diagram"]
    assert any("replaces" in n for n in doc["notes"]["gaps"])


def test_a_spec_with_no_type_is_refused():
    """`type` is the registry key renderDiagram dispatches on. Without it the renderer
    prints its L1 placeholder, which is invented art wearing a diagram's frame."""
    doc = build({"practice": {"replaces": "you-do-task", "title": "X"}})
    assert not [b for s in doc["sections"] for b in s["blocks"] if b["type"] == "diagram"]
    assert any("type" in n for n in doc["notes"]["gaps"])


def test_a_refusal_never_damages_the_section_it_touched():
    """A rejected spec must leave the prose exactly where it was -- half-applying a
    replacement is the one outcome worse than not applying it."""
    doc = build({"practice": dict(FLOW, replaces="you-do")})   # right section, wrong intent? no:
    ok = [b for b in _sec(doc, "activity")["blocks"] if b["type"] == "diagram"]
    assert len(ok) == 1                                        # `you-do` IS in activity
    bad = build({"practice": dict(FLOW, replaces="ghost")})
    assert _kinds(bad, "activity") == _kinds(build(), "activity")


# ── G6-12 is untouched by construction ───────────────────────────────────────

def test_the_slots_are_primary_only_by_construction():
    """G6-12 never runs d0_primary at all, so the proof here is the narrower one the
    additive-field pattern asks for: the key is read off `generated`, and a record
    without it takes the untouched path above."""
    assert "diagrams" not in ENR["generated"]


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


# ── bd-1nv5q: the hook slot IS the board plan ────────────────────────────────

GRID = {"type": "grid", "rows": 2, "cols": 4, "shaded": 0,
        "colLabels": ["Th", "H", "T", "O"],
        "cellText": [[0, 0, "3"], [0, 1, "6"], [0, 2, "0"], [0, 3, "0"]],
        "alt": "Place-value chart showing 3,600 before any renaming."}


def test_the_hook_slot_replaces_the_board_plan_so_the_board_is_drawn_not_described():
    """OPERATOR, three times over, most recently *"On the board should be an image, why
    are you still writing words there?"*.

    The brief now REQUIRES `diagrams.hook` on every lesson and points it at `board-plan`
    (rule 36/37). That target had never been exercised: every corpus lesson carries a
    `dia-explanation` and a `dia-practice`, and not one has ever replaced the board block,
    so the path the new rule sends every future author down was the one path with no test
    on it. The placement engine is generic and this passes on first run -- it is a contract
    guard, not a red-first bug fix. The bug was a missing key in the brief, which has no
    test surface; the proof for that half is a render.
    """
    doc = build({"hook": dict(GRID, replaces="board-plan")})
    intro = _kinds(doc, "introduction")

    # the board prose is gone -- not appended beside, replaced
    assert ("board", "board-plan") not in intro
    # and the drawing sits in its exact seat, last in the introduction
    assert ("diagram", "dia-hook") in intro
    assert intro[-1] == ("diagram", "dia-hook")
    # nothing else in the section moved
    assert [b for b in intro if b[0] != "diagram"] == [
        ("ask", "hook"), ("key_points", "hook-characters"), ("keywords", "keywords")]
    # routing never reaches the engine
    spec = [b for s in doc["sections"] for b in s["blocks"]
            if b.get("id") == "dia-hook"][0]["spec"]
    assert "replaces" not in spec
    assert spec["colLabels"] == ["Th", "H", "T", "O"]
    # a real placement is silent
    assert not [g for g in doc["notes"]["gaps"] if "hook" in g]
