"""Stage D0 - d0_arrayform against the whole ch9-10 corpus (335 lesson documents).

The unit tests pin the rules; this pins the rules' BEHAVIOUR on every authored
string the corpus actually contains - 2,680 values across the nine widened slots.
The invariant is checked once per accepted split, not sampled.

Run: /usr/bin/python3 -W ignore -m pytest test_d0_arrayform_corpus.py -q
Skips (does not fail) when the corpus is not on this machine.
"""

import glob
import json
import os
import re

import pytest

import d0_arrayform as af

CORPUS = ("/Users/amenaahmed/rumi/Rumi 10 April 2026/10_Grades 1-5 LP Rebuild/"
          "ch9-10-build/renders")
REASONS = {"ok", "empty", "no_boundary", "unbalanced_quotes", "roundtrip",
           "narrated", "too_few", "too_many", "short_element"}


def _blocks(doc):
    for sec in doc.get("sections") or []:
        for b in sec.get("blocks") or []:
            yield b
            for side in ("left", "right"):
                for inner in (b.get(side) or []):
                    yield inner


def _fields(doc):
    """(slot, value) for every widened slot authored as a string."""
    out = []
    obj = (doc.get("objectives") or {}).get("outcome")
    out.append(("objectives.outcome", obj))
    page2 = doc.get("page2") or {}
    out.append(("page2.coaching_reflection", page2.get("coaching_reflection")))
    for key in ("stuck", "early"):
        out.append(("page2.differentiation." + key,
                    (page2.get("differentiation") or {}).get(key)))
    for sec in doc.get("sections") or []:
        for ticket in (sec.get("exit_ticket") or []):
            out.append(("exit_ticket[].q", ticket.get("q")))
    for block in _blocks(doc):
        kind = block.get("type")
        if kind == "ask" and block.get("hook"):
            out.append(("ask#hook.question", block.get("question")))
        elif kind in ("worked_example", "faded_example"):
            for key in ("prompt", "cfu"):
                out.append((kind + "." + key, block.get(key)))
    return [(slot, val) for slot, val in out if isinstance(val, str)]


def _urdu(text):
    arabic = sum(1 for ch in text if "؀" <= ch <= "ۿ")
    latin = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    return arabic > latin


@pytest.fixture(scope="module")
def corpus():
    paths = sorted(glob.glob(os.path.join(CORPUS, "*", "docs", "*.lp.json")))
    if not paths:
        pytest.skip("ch9-10 corpus not present on this machine")
    out = []
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            doc = json.load(handle)
        name = os.path.basename(os.path.dirname(os.path.dirname(path)))
        out.append((name + "/" + os.path.basename(path), _fields(doc)))
    return out


def test_the_corpus_is_the_one_that_was_measured(corpus):
    assert len(corpus) == 335
    assert sum(len(f) for _, f in corpus) == 2680


def test_every_accepted_split_round_trips_exactly(corpus):
    checked = 0
    for _, fields in corpus:
        for slot, value in fields:
            got = af.split_field(value, slot)
            if got.parts is None:
                continue
            assert " ".join(got.parts) == af.normalise(value)
            checked += 1
    assert checked > 1400


def test_not_one_word_is_dropped_added_or_reordered_anywhere(corpus):
    for _, fields in corpus:
        for slot, value in fields:
            got = af.split_field(value, slot)
            if got.parts is None:
                continue
            words = [w for part in got.parts for w in part.split(" ")]
            assert words == re.sub(r"\s+", " ", value).strip().split(" ")


def test_no_element_is_blank_or_carries_edge_whitespace(corpus):
    for _, fields in corpus:
        for slot, value in fields:
            got = af.split_field(value, slot)
            for part in got.parts or ():
                assert part == part.strip() and part


def test_every_refusal_names_a_known_reason(corpus):
    for _, fields in corpus:
        for slot, value in fields:
            assert af.split_field(value, slot).reason in REASONS


def test_every_document_gains_at_least_one_array(corpus):
    barren = [name for name, fields in corpus
              if not any(af.split_field(v, s).parts for s, v in fields)]
    assert barren == []


def test_urdu_is_served_in_every_slot_not_quietly_declined(corpus):
    served = {}
    for _, fields in corpus:
        for slot, value in fields:
            if _urdu(value) and af.split_field(value, slot).parts:
                served[slot] = served.get(slot, 0) + 1
    assert set(served) == {
        "objectives.outcome", "exit_ticket[].q", "page2.differentiation.stuck",
        "page2.differentiation.early", "page2.coaching_reflection",
        "ask#hook.question", "worked_example.cfu", "faded_example.prompt"}
    assert min(served.values()) >= 7


def test_no_accepted_hook_is_a_narrated_scene(corpus):
    for _, fields in corpus:
        for slot, value in fields:
            if slot != "ask#hook.question":
                continue
            if af.split_field(value, slot).parts:
                assert af.carries_dialogue(value) is False


def test_the_measured_split_counts_hold(corpus):
    """MEASURED 2026-09-24. A change here is a real change in behaviour."""
    tally = {}
    for _, fields in corpus:
        for slot, value in fields:
            if af.split_field(value, slot).parts:
                tally[slot] = tally.get(slot, 0) + 1
    assert tally == {
        "faded_example.prompt": 256, "page2.coaching_reflection": 243,
        "page2.differentiation.stuck": 238, "exit_ticket[].q": 212,
        "worked_example.cfu": 190, "page2.differentiation.early": 165,
        "ask#hook.question": 69, "objectives.outcome": 69}
