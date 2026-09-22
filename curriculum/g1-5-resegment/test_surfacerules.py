"""The render-surface rules say true things about the renderer they describe.

Prose in a brief is not testable the way a function is, but the FACTS these
rules assert are: the caps are real numbers in `wordbudget`, the surfaces
are real keys in `bodysurface`, and `cbrief` still receives one flat tuple.
A rule that quotes a cap the code no longer has is worse than no rule, because
an author will budget against it. So every number here is checked against
its source.
"""
import re
import unittest

import bodysurface
import d0_bigidea
import wordbudget
import lessonrules
import surfacerules


class TheTuple(unittest.TestCase):
    def test_every_rule_is_a_nonempty_labelled_string(self):
        self.assertTrue(surfacerules.SURFACE)
        for rule in surfacerules.SURFACE:
            self.assertIsInstance(rule, str)
            self.assertRegex(rule, r"^\[7A\] ")
            self.assertGreater(len(rule.split()), 20, rule[:60])

    def test_lessonrules_still_exports_one_flat_tuple(self):
        """`cbrief.py` does `brief["rules"] = lessonrules.RULES` and iterates it."""
        self.assertIsInstance(lessonrules.RULES, tuple)
        self.assertEqual(len(lessonrules.RULES),
                         len(lessonrules.PEDAGOGY) + len(surfacerules.SURFACE))
        self.assertEqual(lessonrules.RULES[len(lessonrules.PEDAGOGY):],
                         surfacerules.SURFACE)
        self.assertTrue(all(isinstance(r, str) for r in lessonrules.RULES))

    def test_no_rule_is_duplicated_across_the_two_modules(self):
        self.assertEqual(len(set(lessonrules.RULES)), len(lessonrules.RULES))

    def test_the_surface_rules_left_lessonrules(self):
        for rule in surfacerules.SURFACE:
            self.assertNotIn(rule, lessonrules.PEDAGOGY)


class TheFactsTheyAssert(unittest.TestCase):
    """Each number a rule quotes must still be the number the code uses."""

    def setUp(self):
        self.flat = " ".join(surfacerules.SURFACE)
        self.doc = surfacerules.__doc__

    def _rule(self, phrase):
        hits = [r for r in surfacerules.SURFACE if phrase in r]
        self.assertEqual(len(hits), 1, phrase)
        return hits[0]

    def test_the_worked_example_cap_is_470(self):
        self.assertEqual(wordbudget.CAPS["worked_example"], 470)
        self.assertIn("470", self._rule("share one word budget"))

    def test_the_key_points_room_left_is_120_less_the_placeholder(self):
        cap = wordbudget.CAPS["key_points"]
        placeholder = bodysurface.PLACEHOLDER_COST["remember"]
        self.assertEqual(cap, 120)
        self.assertEqual(cap - placeholder, 110)
        self.assertIn("110 words", self._rule("ONLY quoted question"))

    def test_the_hook_and_the_you_do_really_do_land_on_key_points(self):
        feeds = bodysurface.FEEDS
        for field in ("hookStory", "homework"):
            self.assertEqual(feeds[field], "key_points", field)

    def test_every_field_the_free_room_rule_names_is_actually_free(self):
        rule = self._rule("before you cut them")
        named = set(re.findall(r"`([A-Za-z_]+)`", rule))
        named -= {"action", "say"}          # these two are named as CHARGED
        self.assertTrue(named)
        charged = set(bodysurface.FEEDS)
        for field in sorted(named):
            self.assertNotIn(field, charged, "%s is charged, not free" % field)
        # the top-level ones are positively named free in bodysurface
        for field in ("boardWork", "weakLearnerSupport", "challengeExtension"):
            self.assertIn(field, bodysurface.UNCHARGED)

    def test_the_uncapped_surfaces_the_docstring_lists_are_uncapped(self):
        for name in ("ask", "warmup", "board", "keywords", "exit_ticket"):
            self.assertIn(name, wordbudget.UNCAPPED)
            self.assertNotIn(name, wordbudget.CAPS)

    def test_the_docstring_quotes_the_live_caps(self):
        for surface, cap in wordbudget.CAPS.items():
            self.assertRegex(self.doc, r"%s\s+%d" % (surface, cap),
                             "docstring cap for %s is stale" % surface)


class TheBigIdeaShapeIsStated(unittest.TestCase):
    """bd-uuxuu. Every part of this surface was built on 18 Sep 2026 -- the
    schema variant, the 80-word cap, the renderer, `d0_bigidea` -- except the
    one sentence that tells an author to write it.

    What an author is handed today is `bodysurface.targets()`, which says
    `big_idea` 80 `<- bigIdea` and stops. That is a name with no shape: it does
    not say the field is an object, does not name its three parts, and does not
    say what each part is for. So `bigIdea` was never written -- 38 of 38
    corpus lessons carry none -- every part fills with DESIGN_PENDING, the
    primary prune drops the whole block, and 80 words of a tight page budget
    stay held open for a block that never prints. A capped surface with no
    authoring rule is the one kind of surface that cannot be authored.
    """

    def setUp(self):
        self.rules = [r for r in surfacerules.SURFACE if "`bigIdea`" in r]

    def test_exactly_one_rule_owns_the_field(self):
        self.assertEqual(len(self.rules), 1,
                         "one home per source field; found %d" % len(self.rules))

    def test_it_names_all_three_parts(self):
        rule = self.rules[0]
        for part in d0_bigidea.BIG_IDEA_PARTS:
            self.assertIn("`%s`" % part, rule, part)

    def test_it_quotes_the_live_cap(self):
        self.assertEqual(wordbudget.CAPS["big_idea"], 80)
        self.assertIn("80", self.rules[0])

    def test_the_field_it_names_is_the_one_that_feeds_the_surface(self):
        self.assertEqual(bodysurface.FEEDS["bigIdea"], "big_idea")

    def test_an_unwritten_big_idea_really_does_cost_the_whole_block(self):
        """The claim the rule is there to make, measured rather than quoted:
        nothing authored is not a partial block, it is no block at all."""
        blank = d0_bigidea.big_idea_block(None)
        self.assertEqual([blank[p] for p in d0_bigidea.BIG_IDEA_PARTS],
                         [d0_bigidea.DESIGN_PENDING] * 3)


if __name__ == "__main__":
    unittest.main()
