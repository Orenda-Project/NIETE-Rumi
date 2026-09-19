"""An author writes body fields; the budget measures render surfaces. This is the map.

spec/07-lp-production.md §4 states the law in surfaces — `key_points` 120,
`faded_example` 470 — and briefs/enrich_brief_v3.md, the only Stage-C brief that
exists, is written entirely in fields: `hookStory`, `steps`, `problems`,
`homework`. Nothing joins them, so an author following the brief cannot tell
whether the lesson fits the law, and §8's rule 4 — "write `key_points` last" —
names a surface no author ever writes.

The map is therefore a fact about `d0_*`, and a fact about code drifts. So this
does not restate it: it MEASURES it. Each field is filled with a marker word,
the lesson is rendered, and the surface the marker lands in is the answer. A
renderer change that moves a field shows up here as a failing test rather than
as a brief that quietly stopped being true.
"""
import copy
import unittest

import bodysurface
import d0_primary
import wordbudget
from test_d0_primary import ENR, PT

MARK = "zzmarkerzz"

# A hook only reaches `key_points` through the narration OUTSIDE its quoted
# speech, so the probe has to be a hook the splitter recognises — narration,
# then a quoted question. A bare marker word returns a single uncapped `ask`
# and would have measured `hookStory` as free, which it is not.
HOOK = (f"{MARK} {MARK} {MARK}. Teacher holds up the page and says "
        f'"What do you notice {MARK}? Now read it with me."')


def _phase(generated, phase, marker):
    for s in generated["steps"]:
        if s["phase"] == phase:
            s["action"] = marker
            s["say"] = ""


# How to put a marker into each authored field. Written out rather than derived:
# `steps` feeds three different surfaces depending on the phase, which is the
# one thing about this map a reader would otherwise get wrong.
INJECT = {
    "hookStory": lambda g, m: g.__setitem__("hookStory", HOOK),
    "hookCharacters": lambda g, m: g.__setitem__(
        "hookCharacters", [{"name": m, "role": "speaking", "position": "p.102",
                            "speechBubble": m}]),
    "steps[You-Do]": lambda g, m: _phase(g, "You-Do", m),
    "homework": lambda g, m: g.__setitem__("homework", m),
    "steps[I-Do]": lambda g, m: _phase(g, "I-Do", m),
    "workedExample": lambda g, m: g.__setitem__("workedExample", m),
    "steps[We-Do]": lambda g, m: _phase(g, "We-Do", m),
    "partnerActivity": lambda g, m: g.__setitem__(
        "partnerActivity", {"structure": m, "dialogueFrameA": m,
                            "dialogueFrameB": m, "teacher_role": m}),
    "problems": lambda g, m: g.__setitem__(
        "problems", [{"prompt": m, "status": "solved", "solution": m}]),
    "bigIdea": lambda g, m: g.__setitem__(
        "bigIdea", {"distinction": m, "misconception": m, "demo": m}),
}


def surfaces_holding(marker, doc):
    """Every capped surface whose prose carries `marker`."""
    found = set()

    def walk(n):
        if isinstance(n, dict):
            t = n.get("type")
            if isinstance(t, str) and t in wordbudget.CAPS:
                if marker in repr({k: v for k, v in n.items()
                                   if k not in wordbudget.SCAFFOLDING}):
                    found.add(t)
                return
            for v in n.values():
                walk(v)
        elif isinstance(n, (list, tuple)):
            for v in n:
                walk(v)

    walk(doc)
    return found


def render_with(field):
    enr = copy.deepcopy(ENR)
    INJECT[field](enr["generated"], MARK)
    return d0_primary.to_lp_doc(enr, PT, day=1, total_days=8, seq={})


class TheMapIsMeasuredNotDeclared(unittest.TestCase):
    """Every field in the map lands where the map says it lands."""

    def test_every_authored_field_reaches_the_surface_it_is_mapped_to(self):
        for field, surface in bodysurface.FEEDS.items():
            with self.subTest(field=field):
                self.assertIn(surface, surfaces_holding(MARK, render_with(field)))

    def test_no_field_leaks_into_a_second_capped_surface(self):
        # One home per source field. A field counted twice would make a lesson
        # fail a cap it is nowhere near.
        for field, surface in bodysurface.FEEDS.items():
            with self.subTest(field=field):
                self.assertEqual(surfaces_holding(MARK, render_with(field)),
                                 {surface})

    def test_the_map_covers_every_field_the_probe_knows_how_to_fill(self):
        self.assertEqual(set(bodysurface.FEEDS), set(INJECT))


class WhatTheAuthorIsToldToAimAt(unittest.TestCase):

    def test_a_surface_names_every_field_that_shares_its_cap(self):
        self.assertEqual(sorted(bodysurface.fields_of("faded_example")),
                         ["partnerActivity", "steps[We-Do]"])

    def test_the_four_fields_sharing_the_key_points_cap_are_named_together(self):
        # 120 words across four unrelated fields is the hardest number in §4 to
        # hit blind, and the one 35 of 38 corpus lessons miss.
        self.assertEqual(sorted(bodysurface.fields_of("key_points")),
                         ["homework", "hookCharacters", "hookStory",
                          "steps[You-Do]"])

    def test_every_capped_surface_has_at_least_one_field_feeding_it(self):
        for surface in wordbudget.CAPS:
            self.assertTrue(bodysurface.fields_of(surface), surface)

    def test_the_target_carries_the_cap_from_the_budget_not_a_second_copy(self):
        self.assertEqual(bodysurface.targets()["big_idea"]["cap"],
                         wordbudget.CAPS["big_idea"])


class TheUnauthoredWordsThatStillCount(unittest.TestCase):
    """Two surfaces spend the author's budget on design-pending placeholders."""

    def test_remember_is_design_pending_and_not_fed_by_keyFact(self):
        # d0_close.py:40 prints DESIGN_PENDING. The comment beside it is
        # explicit — no key_points echo of keyFact, it is the outcome. So
        # `keyFact` is NOT in the map, and `remember` costs the author words
        # they cannot write.
        self.assertNotIn("keyFact", bodysurface.FEEDS)
        self.assertIn("remember", bodysurface.PLACEHOLDER_COST)

    def test_keyFact_reaches_no_capped_surface_at_all(self):
        # Measured, not reasoned: the brief asks for `keyFact` and the author
        # should know it costs them nothing.
        enr = copy.deepcopy(ENR)
        enr["generated"]["keyFact"] = MARK
        doc = d0_primary.to_lp_doc(enr, PT, day=1, total_days=8, seq={})
        self.assertEqual(surfaces_holding(MARK, doc), set())

    def test_a_hooks_quoted_question_is_not_charged_to_key_points(self):
        # The narration is charged and the provocation is not, so a hook
        # written as speech costs less than the same hook written as stage
        # directions. `UNCHARGED` says so; this proves it.
        enr = copy.deepcopy(ENR)
        enr["generated"]["hookStory"] = f'Teacher asks "Is {MARK} here? Look."'
        doc = d0_primary.to_lp_doc(enr, PT, day=1, total_days=8, seq={})
        self.assertEqual(surfaces_holding(MARK, doc), set())

    def test_the_placeholder_cost_is_measured_against_the_live_renderer(self):
        doc = d0_primary.to_lp_doc(copy.deepcopy(ENR), PT, day=1, total_days=8,
                                   seq={})
        for block_id, words in bodysurface.PLACEHOLDER_COST.items():
            with self.subTest(block=block_id):
                self.assertEqual(self._words(doc, block_id), words)

    def test_the_author_is_told_what_is_left_after_the_placeholders(self):
        # key_points: 120 cap less the 10 words `remember` spends on a hole.
        self.assertEqual(bodysurface.targets()["key_points"]["author_budget"],
                         wordbudget.CAPS["key_points"]
                         - bodysurface.PLACEHOLDER_COST["remember"])

    @staticmethod
    def _words(node, block_id):
        if isinstance(node, dict):
            if node.get("id") == block_id and node.get("type") in wordbudget.CAPS:
                return wordbudget.block_words(node)
            for v in node.values():
                n = TheUnauthoredWordsThatStillCount._words(v, block_id)
                if n is not None:
                    return n
        elif isinstance(node, (list, tuple)):
            for v in node:
                n = TheUnauthoredWordsThatStillCount._words(v, block_id)
                if n is not None:
                    return n
        return None


class ItStaysPure(unittest.TestCase):

    def test_it_imports_nothing_but_the_budget(self):
        with open("bodysurface.py") as fh:
            lines = [l for l in fh.read().splitlines()
                     if l.startswith(("import ", "from "))]
        self.assertEqual(lines, ["import wordbudget"])


if __name__ == "__main__":
    unittest.main()
