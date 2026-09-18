"""Stage D0 — the close: the check, REMEMBER, and the one exit ticket. Unit tests.

Run: python3 -m pytest test_d0_close.py -q     (or: python3 test_d0_close.py)
"""

import json

import d0_primary as d0
from test_d0_primary import ENR, PT, TOPIC, build


def test_the_exit_criteria_print_beside_the_exit_ticket_only():
    """success_criteria is the exit ticket's ANSWER, and it prints there once.

    It was once also the CFU's `look_for`, which printed the same line twice in 30 of the
    corpus's 38 lessons. The CFU has since moved into the worked example (below) and still
    carries no `look_for`, so the criteria have exactly one home either way."""
    concl = build()["sections"][3]
    assert concl["exit_ticket"][0]["a"] == ENR["generated"]["exitTicket"]["success_criteria"]
    body = json.dumps(build(), ensure_ascii=False)
    assert body.count(ENR["generated"]["exitTicket"]["success_criteria"]) == 1


# \u2500\u2500 the worked example closes on its check \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

def _development(doc):
    return [s for s in doc["sections"] if s["id"] == "development"][0]


def test_the_check_closes_the_worked_example_it_checks():
    """Operator: *"worked example should be better formatted ending with a CFU like
    usual"*. `cfuExplain` used to file as a stand-alone `ask` in the conclusion, which
    printed the check pages after the modelling it checks."""
    doc = build()
    worked = [b for b in _development(doc)["blocks"] if b["type"] == "worked_example"]
    assert worked[-1]["cfu"] == ENR["generated"]["cfuExplain"]


def test_the_check_has_exactly_one_home():
    """ONE HOME PER SOURCE FIELD. The conclusion no longer carries it."""
    doc = build()
    assert not [b for b in doc["sections"][3]["blocks"] if b.get("id") == "cfu"]
    assert json.dumps(doc, ensure_ascii=False).count(ENR["generated"]["cfuExplain"]) == 1


def test_a_lesson_with_no_worked_example_still_prints_its_check():
    """No word may be deleted. With nothing to close, the check keeps its old seat in the
    conclusion rather than falling on the floor."""
    g = {**ENR["generated"]}
    g.pop("workedExample")
    g["steps"] = [s for s in g["steps"] if s["phase"] != "I-Do"]
    doc = d0.to_lp_doc({**ENR, "generated": g}, PT, day=1, total_days=10)
    assert not [b for b in _development(doc)["blocks"] if b["type"] == "worked_example"]
    assert [b for b in doc["sections"][3]["blocks"]
            if b.get("id") == "cfu"][0]["question"] == g["cfuExplain"]


def test_a_diagram_that_eats_the_box_does_not_eat_the_check():
    """`apply_slots` swaps a block out WHOLE. If the box carrying the check is the one the
    explanation diagram replaces, the check must come back rather than vanish with it."""
    g = {**ENR["generated"], "diagrams": {"explanation": {
        "type": "flow", "replaces": "worked",
        "steps": [{"title": "READ", "lines": ["the pair"]}]}}}
    doc = d0.to_lp_doc({**ENR, "generated": g}, PT, day=1, total_days=10)
    assert json.dumps(doc, ensure_ascii=False).count(g["cfuExplain"]) == 1


# \u2500\u2500 REMEMBER \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

def test_remember_has_a_surface_and_says_what_is_missing():
    """Operator's page map lists *"HW, remember and coaching corner"* at the close. No
    enrichment field carries it and no proxy was accepted -- `keyFact` is already the
    outcome. Dark stages stay dark: build the surface, print "design pending"."""
    import d0_blocks
    concl = build()["sections"][3]
    rem = [b for b in concl["blocks"] if b.get("id") == "remember"][0]
    assert rem["type"] == "key_points"
    assert rem["title"] == "Remember"
    assert rem["items"] == [d0_blocks.DESIGN_PENDING]


def test_the_close_is_never_an_empty_section():
    """`sections.items.properties.blocks` is minItems 1. A conclusion whose only block was
    the CFU would be schema-invalid the moment the CFU moved out, which is the blocker
    REMEMBER also resolves."""
    for g in ({**ENR["generated"]},
              {k: v for k, v in ENR["generated"].items() if k != "cfuExplain"}):
        doc = d0.to_lp_doc({**ENR, "generated": g}, PT, day=1, total_days=10)
        for sec in doc["sections"]:
            assert sec["blocks"], sec["id"]


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
