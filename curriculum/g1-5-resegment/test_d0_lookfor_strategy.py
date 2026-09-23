"""Stage D0 — the coaching LOOK FOR, and the warm-up's named STRATEGY. Unit tests.

Two operator asks, one authoring surface each.

  *"coaching corner should hve a look for"* — `page2.coaching_lookfor` has carried
  DESIGN_PENDING in every document ever built, because d0_page2 listed it among the five
  v9 surfaces primary has no source for. That was true when it was written: the only
  candidate was `cfuExplain`, a teach-time check that already prints in front of the
  class, and copying it here would have paid for the same words twice. It is no longer
  true — enrichment now authors `coachingLookfor`, a thing a COACH watching the lesson
  looks for, which is a different question from the one `coachingReflection` asks the
  teacher to count afterwards. A field with a source of its own stops being design-pending.

  *"warm up should beprior knowledge activation strategy, not just 3 questions"* — the W
  band printed three q/a pairs and never named what the teacher was doing with them.
  `warmUp.strategy` names the ONE strategy the opening runs; operator: *"it should be
  just 1 not multiple strategies since opening is a whole provocation on its own"*.

Run: python3 -m pytest test_d0_lookfor_strategy.py -q
"""

import d0_blocks
import d0_page2
import d0_primary
from test_d0_primary import ENR

DP = d0_blocks.DESIGN_PENDING
LOOK = "Does each child point to the line that proves the answer, or answer from memory?"
# NOT "partner whisper", which the schema's own description still offers as the
# example. OPERATOR: *"teachers dont let students talk to each other, that too when
# the class begins"*. A fixture is the next author's example, so it carries a
# strategy she would actually run. The schema text is vendor-side -- reported, not
# edited here.
STRAT = "Prerequisite retrieval — write, walk, reveal"


def _g(**over):
    return {**ENR["generated"], **over}


def test_an_authored_look_for_reaches_page2():
    assert d0_page2.build(_g(coachingLookfor=LOOK))["coaching_lookfor"] == LOOK


def test_it_stays_dark_when_nothing_authored_it():
    """Dark stages stay dark. An unauthored look-for says so; it is not filled from
    `cfuExplain`, which prints on the teach page and would cost the paper twice."""
    assert d0_page2.build(_g(coachingLookfor=None))["coaching_lookfor"] == DP
    assert d0_page2.build(_g(coachingLookfor="   "))["coaching_lookfor"] == DP


def test_the_look_for_is_not_the_reflection():
    """Two different questions: the coach looks for one thing DURING the lesson, the
    teacher counts another AFTER it. Filling one from the other prints the same
    sentence in two boxes, which is how page 2 lost a third of its space before."""
    b = d0_page2.build(_g(coachingLookfor=LOOK))
    assert b["coaching_lookfor"] != b["coaching_reflection"]


def test_coaching_lookfor_is_no_longer_listed_as_sourceless():
    """The list is data on purpose — the render, the gate report and the enrichment
    backlog all read it. Leaving it here would keep reporting a gap that is filled."""
    assert "coaching_lookfor" not in d0_page2.NO_PRIMARY_SOURCE


def _intro(**warm_over):
    g = _g(warmUp={**(ENR["generated"].get("warmUp") or {}), **warm_over})
    return d0_primary._intro(g, None)


def test_the_warm_up_names_its_strategy():
    assert _intro(strategy=STRAT)["warmup"]["strategy"] == STRAT


def test_no_strategy_key_when_none_was_authored():
    """Absent, not empty: the schema forbids extra properties and the band must not
    print a blank chip where a name belongs."""
    assert "strategy" not in _intro(strategy=None)["warmup"]
    assert "strategy" not in _intro(strategy="  ")["warmup"]


def test_the_items_are_untouched_by_the_strategy():
    """Naming what the teacher is doing must not change what she asks."""
    assert _intro(strategy=STRAT)["warmup"]["items"] == _intro()["warmup"]["items"]
