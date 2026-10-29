"""Tests for d0_board_chalk_shapes -- row -> text -> spec-dict "shape".

Split out of test_d0_board_chalk.py alongside the coordinator's file split
(d0_board_chalk.py was 311 lines; per-shape spec construction moved to a
sibling module, so its tests move with it -- no orphan file without a test).

These are unit tests of the low-level building blocks (sanitization,
code-point-safe primitives, row formatting, spec-dict assembly). The
higher-level "every word survives, never raises, fits the page" contract
tests stay in test_d0_board_chalk.py against the public chalk_specs/chalk_spec
API, which is what actually matters to a caller.
"""

import d0_board_chalk_shapes as shapes


def test_cp_len_counts_code_points_not_bytes():
    assert shapes.cp_len("abc") == 3
    urdu = "یہ ایک جملہ ہے"
    assert shapes.cp_len(urdu) == len([*urdu])


def test_has_urdu_detects_arabic_script_ranges():
    assert shapes.has_urdu("یہ ایک جملہ ہے") is True
    assert shapes.has_urdu("plain english") is False
    assert shapes.has_urdu("") is False


def test_truncate_cp_never_splits_a_combining_mark():
    # Latin "e" + COMBINING ACUTE ACCENT (U+0301) as two code points.
    s = "café" + "x" * 20
    out = shapes.truncate_cp(s, 4)
    # cut point must not land strictly inside the base+combining pair
    assert not (len(out) >= 1 and out[-1] == "e" and shapes.cp_len(s) > 4 and s[4] == "́")
    assert out.endswith("…")


def test_truncate_cp_is_a_noop_under_the_limit():
    assert shapes.truncate_cp("short", 100) == "short"


def test_as_text_coerces_list_and_dict_without_raising():
    assert shapes.as_text(["a", "b", "c"]) == "a b c"
    assert shapes.as_text({"x": "one", "y": "two"}) in ("one two", "two one")
    assert shapes.as_text(None) == ""
    assert shapes.as_text(42) == "42"


def test_sanitize_text_turns_empty_brackets_into_a_ruled_line():
    out = shapes.sanitize_text("The answer is [ ] because [] of it.")
    assert "[ ]" not in out and "[]" not in out
    assert "_" in out


def test_sanitize_text_strips_angle_placeholder_tokens():
    out = shapes.sanitize_text("Write <WORD> on the line.")
    assert "<" not in out and ">" not in out
    assert "WORD" in out


def test_flatten_preserves_panel_label_as_its_own_line():
    board = {
        "panels": [{"label": "Vocabulary", "rows": [{"kind": "text", "text": "habitat", "term": None,
                                                        "gloss": None, "cells": None}]}],
        "instruction": "",
    }
    lines = shapes.flatten(board)
    assert any("Vocabulary" in l for l in lines)
    assert any("habitat" in l for l in lines)


def test_flatten_appends_instruction_as_final_line():
    board = {"panels": [], "instruction": "Copy this into your notebook."}
    lines = shapes.flatten(board)
    assert lines and "Copy this into your notebook." in lines[-1]


def test_flatten_on_garbage_board_never_raises():
    for bad in (None, {}, "not a dict", 5, {"panels": "nope"}):
        lines = shapes.flatten(bad)
        assert isinstance(lines, list)


def test_build_alt_names_the_part_when_split():
    board = {"title": "Long board"}
    alt = shapes.build_alt(board, 1, 3, ["a", "b"])
    assert "part 2 of 3" in alt
    assert "Long board" in alt


def test_make_spec_shape_is_a_clean_panels_dict():
    spec = shapes.make_spec("Title", ["line one", "line two"], 360, "an alt string")
    assert spec["type"] == "panels"
    assert spec["width"] == 360
    assert spec["panels"][0]["title"] == "Title"
    assert spec["panels"][0]["lines"] == ["line one", "line two"]
    assert spec["alt"] == "an alt string"


def test_fallback_spec_is_never_empty_and_carries_an_alt():
    spec = shapes.fallback_spec(360)
    assert spec["type"] == "panels"
    assert spec["panels"][0]["lines"]
    assert spec["alt"]


def test_make_spec_omits_width_key_entirely_when_width_is_none():
    # primaryRedraw (template.js:1658) -- the strict 15.5px G1-5 floor -- only
    # runs when b.spec.width == null. Omitting the key (not setting it to
    # None/0) is what makes that condition true on the JS side.
    spec = shapes.make_spec("Title", ["line"], None, "alt")
    assert "width" not in spec


def test_fallback_spec_defaults_to_no_width_key():
    spec = shapes.fallback_spec()
    assert "width" not in spec
