"""Tests for d0_board_chalk — the board drawn as the teacher will chalk it.

Operator (4th escalation): *"pls make sure write on the board section is an
actual image ALWAYS rather than text instructions"*.

Contract, per the coordinator's two corrections mid-build:
  - `chalk_specs(board) -> list[dict]`, always non-empty. Each element is an
    independently renderable `panels` spec.
  - The spec REPLACES the board text outright (d0_diagram.apply_slots seats it
    in the block's exact seat) so every word in `board` must survive into some
    spec in the list -- dropping content is data loss, not a layout choice.
  - Each spec must fit the real render floor/ceiling -- PHONE_FULL_COL=455px,
    PRIMARY_DIAGRAM_MIN_PX=15.5px, PRIMARY_FIG_MAX_H=1086px (the coordinator's
    third and final correction; template.js:1595-1612) -- a board that does
    not fit becomes MORE specs, never a truncated one.
  - Never raises, never returns an empty list, regardless of how malformed
    `board` is.

These tests check the Python-side contract and content-preservation. Real
rendering through the JS engine (`renderDiagram`), the `figureSlot` legibility/
height check, and the 335-board corpus run are exercised separately by
`verify_render.mjs` / `run_corpus.py` in this same directory (not pytest --
they shell out to `node`, which pytest here must not depend on to stay green
in isolation).
"""

import re

import d0_board_chalk as d0


FORBIDDEN = ("TODO", "FIXME", "TBD", "XXX", "lorem ipsum", "INSERT", "PLACEHOLDER")
HEX_RE = re.compile(r"#[0-9A-Fa-f]{6}")
EMPTY_BRACKET_RE = re.compile(r"\[\s*\]")
ANGLE_TOKEN_RE = re.compile(r"<\s*[A-Za-z_][A-Za-z0-9_ ]{0,30}\s*>")


def _strings(obj):
    """Every string value in a nested dict/list, for a lint-gate-10-style sweep."""
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _strings(v)


def _assert_clean_spec(spec):
    assert isinstance(spec, dict)
    assert spec.get("type") == "panels"
    assert spec.get("alt"), "every spec must carry an alt string"
    for s in _strings(spec):
        assert not HEX_RE.search(s), f"lint-fatal hex colour in spec: {s!r}"
        for bad in FORBIDDEN:
            assert bad.lower() not in s.lower(), f"forbidden token {bad!r} in {s!r}"
        assert not EMPTY_BRACKET_RE.search(s), f"empty-bracket slot literal in {s!r}"
        assert not ANGLE_TOKEN_RE.search(s), f"angle-bracket placeholder token in {s!r}"


def _row(text=None, kind="text", term=None, gloss=None, cells=None):
    return {"kind": kind, "text": text, "term": term, "gloss": gloss, "cells": cells}


def test_normal_board_returns_nonempty_list_of_clean_panels_specs():
    board = {
        "title": "Today's new words",
        "panels": [
            {
                "label": "Vocabulary",
                "rows": [
                    _row(kind="gloss", term="habitat", gloss="the place an animal lives"),
                    _row(kind="gloss", term="carnivore", gloss="an animal that eats meat"),
                ],
            }
        ],
        "instruction": "Copy these words into your notebook.",
    }
    specs = d0.chalk_specs(board)
    assert isinstance(specs, list) and specs
    for spec in specs:
        _assert_clean_spec(spec)


def test_never_raises_never_empty_on_garbage_input():
    for bad in (None, {}, "", "a plain string", 42, [], [1, 2, 3], {"panels": "not-a-list"}):
        specs = d0.chalk_specs(bad)
        assert isinstance(specs, list) and len(specs) >= 1
        for spec in specs:
            _assert_clean_spec(spec)


def test_chalk_spec_singular_wrapper_never_none():
    spec = d0.chalk_spec({"title": "x", "panels": [], "instruction": ""})
    assert spec is not None
    _assert_clean_spec(spec)
    spec2 = d0.chalk_spec(None)
    assert spec2 is not None
    _assert_clean_spec(spec2)


def test_one_line_board_fits_a_single_spec():
    board = {"title": "Rule", "panels": [{"label": None, "rows": [_row(text="i before e except after c")]}],
             "instruction": ""}
    specs = d0.chalk_specs(board)
    assert len(specs) == 1
    lines = specs[0]["panels"][0]["lines"]
    assert any("i before e except after c" in ln for ln in lines)


def test_empty_board_is_honest_not_invented():
    # Dark stages stay dark: an empty board says so plainly, it does not fabricate content.
    specs = d0.chalk_specs({"title": None, "panels": [], "instruction": ""})
    assert len(specs) == 1
    _assert_clean_spec(specs[0])
    all_text = " ".join(specs[0]["panels"][0]["lines"])
    assert all_text.strip() != ""


def test_content_arriving_as_a_list_is_coerced_not_dropped():
    row = _row(text=["multiple", "fragments", "joined"])
    board = {"title": "T", "panels": [{"label": None, "rows": [row]}], "instruction": ""}
    specs = d0.chalk_specs(board)
    joined = " ".join(ln for spec in specs for ln in spec["panels"][0]["lines"])
    for frag in ("multiple", "fragments", "joined"):
        assert frag in joined


def test_43_line_board_preserves_every_row_across_however_many_specs():
    rows = [_row(text=f"ROWTAG{i:03d} this is the sentence a teacher would chalk for item {i}")
            for i in range(43)]
    board = {
        "title": "Long practice board",
        "panels": [{"label": "Practice", "rows": rows}],
        "instruction": "Work through every line with your partner.",
    }
    specs = d0.chalk_specs(board)
    assert isinstance(specs, list) and specs
    joined = " ".join(ln for spec in specs for ln in spec["panels"][0]["lines"])
    for i in range(43):
        assert f"ROWTAG{i:03d}" in joined, f"row {i} lost -- data loss, not a layout choice"
    for spec in specs:
        _assert_clean_spec(spec)


def test_long_board_splits_into_more_than_one_spec():
    # 60 substantial rows should exceed the single-page height budget.
    rows = [_row(text=f"item {i}: " + ("word " * 20)) for i in range(60)]
    board = {"title": "Very long board", "panels": [{"label": None, "rows": rows}], "instruction": "Copy it all."}
    specs = d0.chalk_specs(board)
    assert len(specs) > 1


def test_empty_bracket_slot_becomes_a_ruled_line_not_literal_brackets():
    row = _row(kind="slot", text="The answer is [ ] because [] of the rule.")
    board = {"title": "T", "panels": [{"label": None, "rows": [row]}], "instruction": ""}
    specs = d0.chalk_specs(board)
    joined = " ".join(ln for spec in specs for ln in spec["panels"][0]["lines"])
    assert "[ ]" not in joined and "[]" not in joined
    assert "_" in joined


def test_urdu_row_round_trips_intact():
    urdu = "یہ ایک جملہ ہے جو بورڈ پر لکھا جائے گا۔"
    row = _row(text=urdu)
    board = {"title": None, "panels": [{"label": None, "rows": [row]}], "instruction": ""}
    specs = d0.chalk_specs(board)
    joined = " ".join(ln for spec in specs for ln in spec["panels"][0]["lines"])
    assert urdu in joined  # not re-encoded, not truncated mid-mark


def test_gloss_pair_kept_as_one_unit():
    row = _row(kind="gloss", term="photosynthesis", gloss="how plants make food from light")
    board = {"title": "T", "panels": [{"label": None, "rows": [row]}], "instruction": ""}
    specs = d0.chalk_specs(board)
    joined = " ".join(ln for spec in specs for ln in spec["panels"][0]["lines"])
    assert "photosynthesis" in joined and "how plants make food from light" in joined


def test_cells_row_joined_without_brackets():
    row = _row(kind="table", cells=["Row", "Middle", "End"])
    board = {"title": "T", "panels": [{"label": None, "rows": [row]}], "instruction": ""}
    specs = d0.chalk_specs(board)
    joined = " ".join(ln for spec in specs for ln in spec["panels"][0]["lines"])
    for c in ("Row", "Middle", "End"):
        assert c in joined


def test_pathological_single_word_does_not_crash_or_lose_length():
    # 5000 "x" in a row legitimately contains the substring "xxx" -- that is
    # pathological INPUT spelling a forbidden token by coincidence, not a
    # placeholder this module emits, so this test checks crash-safety and
    # length preservation only, not the lint-gate-10 sweep (see the other
    # tests for that).
    huge = "x" * 5000
    row = _row(text=huge)
    board = {"title": "T", "panels": [{"label": None, "rows": [row]}], "instruction": ""}
    specs = d0.chalk_specs(board)
    assert isinstance(specs, list) and specs
    joined = "".join(ln for spec in specs for ln in spec["panels"][0]["lines"])
    assert joined.count("x") >= 5000
    for spec in specs:
        assert isinstance(spec, dict)
        assert spec.get("type") == "panels"
        assert spec.get("alt"), "every spec must carry an alt string"


def test_specs_never_set_width_so_the_engines_own_primary_narrowing_runs():
    # Corrected geometry (template.js:1595-1612): PHONE_FULL_COL=455,
    # PRIMARY_DIAGRAM_MIN_PX=15.5. The strict G1-5 ("primary") floor is only
    # enforced by primaryRedraw (template.js:1658), which is only invoked
    # when `b.spec.width == null` (template.js ~2205-2210). A spec that sets
    # `width` itself opts OUT of that protection and is graded on the lenient
    # G6-12 floor instead (~8.4px) -- exactly the silent regression this test
    # exists to catch. This module's own NARROW_TARGET_W/INNER_W estimate
    # what the engine's narrowing will land on, purely to size the height
    # budget in Python -- that estimate must never leak into the emitted spec.
    board = {"title": "T", "panels": [{"label": None, "rows": [_row(text="a short board")]}], "instruction": ""}
    for spec in d0.chalk_specs(board):
        assert "width" not in spec, "spec must never set width -- it disables primaryRedraw's strict floor"
