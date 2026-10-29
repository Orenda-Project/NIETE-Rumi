"""Stage D0 supporting block builders — unit tests.

Split out of test_d0_blocks.py alongside d0_blocks_support.py (bd-y7hst, the
300-line limit). These tests moved verbatim; nothing about their behaviour
changed, only which file owns them.

Run: python3 test_d0_blocks_support.py
"""

import d0_blocks_support as S


def test_first_warmup_item_is_the_scaffold():
    """Schema: the scaffold for TODAY'S concept comes first."""
    items = S.warmup_items({"items": [{"prompt": "Count to ten."},
                                      {"prompt": "Name a shape."}]})
    assert [i["kind"] for i in items] == ["scaffold", "prerequisite"]


def test_retrieval_flavoured_items_are_spaced():
    items = S.warmup_items({"items": [
        {"prompt": "Recall yesterday.", "type": "cumulative peer retrieval"}]})
    assert items[0]["kind"] == "spaced"


def test_expected_answer_is_read_under_all_four_spellings():
    for key, val in [("expected_answer", "A"), ("expected", "B"),
                     ("expected_answers", ["C", "D"]),
                     ("expected_spelling_check", "E")]:
        got = S.warmup_items({"items": [{"prompt": "Name it?", key: val}]})[0]["a"]
        assert got in ("A", "B", "C; D", "E"), (key, got)


def test_missing_answer_surfaces_as_design_pending():
    """Dark stages stay dark — never a plausible-looking proxy."""
    assert S.warmup_items({"items": ["bare string"]})[0]["a"] == S.DESIGN_PENDING


def test_worked_example_drops_only_what_the_script_already_says():
    """Per line, not per field. Urdu worked examples are 100% restatement and
    Science's are 100% new, so a blanket rule either way loses or duplicates."""
    said = ["Model two words using the title and picture.", "Say: “I read the title.”"]
    lines = ["Model two words using the title and picture.",   # already said -> drop
             "word: crescendo",                                 # new -> keep
             "word: crescendo"]                                 # internal repeat -> drop
    out = S.drop_lines_already_said(lines, said)
    assert out == ["word: crescendo"]


def test_a_fuller_worked_line_survives_a_shorter_script_line():
    """Containment the other way keeps the richer line; the script line it
    swallows carries the move's minutes and stays where it is."""
    out = S.drop_lines_already_said(
        ["Divide 84 by 12 to get 7, then label the answer 7 years."], ["Divide 84 by 12"])
    assert len(out) == 1


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
