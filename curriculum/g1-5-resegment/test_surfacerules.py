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


if __name__ == "__main__":
    unittest.main()
