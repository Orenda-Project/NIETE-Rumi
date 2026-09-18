"""The word budget is a law, not a style note, and it is enforced here or nowhere.

DECIDED B (operator, 2026-09-18, `spec/07-lp-production.md` §4): `key_points`
120, `practice` 350, `big_idea` 80, `worked_example` 470, `faded_example` 470.
`ask`, `warmup`, `board`, `keywords` and `exit_ticket` are uncapped on purpose —
each already sits inside 1.5x its median, and a cap there would police noise.

Two things make this a real check rather than a `len()`:

  The `key_points` cap is **per lesson, across all sections**. A lesson that
  carries 60 words of key points in each of three sections is 180 words over a
  120 cap, and a checker that reads `body["key_points"]` alone would call it 0.

  **The renderer never trims.** Over cap FAILS; nothing downstream absorbs it.
  So a surface that is over must be named, with its count and its cap, because
  the fix is editorial — `practice` over cap splits across days, it does not get
  compressed.

Measured on this build's snake_case surfaces, NOT the imported reviewer's
camelCase v9 body (`warmUp`, `keyWords`, `exitTicket`). The two schemas are
different and a checker pointed at the wrong one silently passes everything.
"""
import unittest

import wordbudget


class CountingWords(unittest.TestCase):

    def test_a_string_surface_counts_its_words(self):
        self.assertEqual(wordbudget.count("one two three"), 3)

    def test_a_list_of_strings_counts_across_the_list(self):
        self.assertEqual(wordbudget.count(["one two", "three"]), 3)

    def test_a_nested_structure_counts_every_string_in_it(self):
        self.assertEqual(
            wordbudget.count({"a": "one two", "b": [{"c": "three"}]}), 3)

    def test_urdu_counts_by_whitespace_like_everything_else(self):
        # Five whitespace tokens. "ملتِ اسلامیہ" is one idea joined by an izafat
        # and a reader would call it one word — the budget does not, and should
        # not: it was measured on whitespace tokens across the whole corpus, so
        # an Urdu-aware count here would silently loosen the Urdu caps.
        self.assertEqual(wordbudget.count("علامہ اقبال اور ملتِ اسلامیہ"), 5)

    def test_numbers_and_booleans_are_not_words(self):
        # A surface's structural metadata is not prose the teacher reads.
        self.assertEqual(wordbudget.count({"minutes": 5, "hoisted": True}), 0)

    def test_nothing_counts_as_nothing(self):
        self.assertEqual(wordbudget.count(None), 0)
        self.assertEqual(wordbudget.count([]), 0)


class TheCapsAreTheSpecs(unittest.TestCase):

    def test_the_five_capped_surfaces_carry_the_decided_b_numbers(self):
        self.assertEqual(wordbudget.CAPS,
                         {"key_points": 120, "practice": 350, "big_idea": 80,
                          "worked_example": 470, "faded_example": 470})

    def test_the_five_uncapped_surfaces_are_named_and_not_capped(self):
        for s in ("ask", "warmup", "board", "keywords", "exit_ticket"):
            self.assertIn(s, wordbudget.UNCAPPED)
            self.assertNotIn(s, wordbudget.CAPS)


class CheckingALesson(unittest.TestCase):

    def test_a_lesson_inside_every_cap_reports_nothing(self):
        body = {"big_idea": "word " * 80, "practice": "word " * 350}
        self.assertEqual(wordbudget.over(body), [])

    def test_exactly_at_the_cap_is_inside_it(self):
        self.assertEqual(wordbudget.over({"big_idea": "word " * 80}), [])

    def test_one_word_over_is_over(self):
        self.assertEqual([f["surface"] for f in
                          wordbudget.over({"big_idea": "word " * 81})],
                         ["big_idea"])

    def test_the_finding_carries_the_count_and_the_cap(self):
        f = wordbudget.over({"big_idea": "word " * 95})[0]
        self.assertEqual((f["words"], f["cap"], f["over"]), (95, 80, 15))

    def test_an_uncapped_surface_is_never_a_finding_however_long(self):
        self.assertEqual(wordbudget.over({"warmup": "word " * 2000}), [])

    def test_a_surface_the_lesson_does_not_have_is_not_a_finding(self):
        # Absence is a different defect, and qa_checks already owns it.
        self.assertEqual(wordbudget.over({}), [])

    def test_findings_come_back_worst_first(self):
        body = {"big_idea": "word " * 90,          # 10 over
                "key_points": "word " * 200}       # 80 over
        self.assertEqual([f["surface"] for f in wordbudget.over(body)],
                         ["key_points", "big_idea"])


class KeyPointsIsCountedAcrossTheWholeLesson(unittest.TestCase):
    """The cap the spec states as 'across all sections' — the one that needs a walk."""

    def test_key_points_in_several_sections_sum_to_one_number(self):
        body = {"sections": [{"key_points": "word " * 60},
                             {"key_points": "word " * 60},
                             {"key_points": "word " * 60}]}
        f = wordbudget.over(body)[0]
        self.assertEqual((f["surface"], f["words"]), ("key_points", 180))

    def test_a_surface_nested_anywhere_is_still_found(self):
        body = {"page2": {"blocks": {"practice": "word " * 400}}}
        self.assertEqual([f["surface"] for f in wordbudget.over(body)],
                         ["practice"])

    def test_the_envelope_is_unwrapped_so_the_generated_body_is_what_counts(self):
        # Stage C hands over {"segment_id":…, "generated": {…}}. Counting the
        # envelope's own metadata as prose would make every lesson look longer.
        self.assertEqual(
            wordbudget.over({"generated": {"big_idea": "word " * 81}})[0]["words"],
            81)

    def test_a_capped_key_appearing_twice_at_one_level_is_not_double_counted(self):
        # dicts cannot repeat a key; a list of sections can. Guard the obvious
        # shape rather than assuming the body is flat.
        body = {"generated": {"steps": [{"practice": "word " * 200},
                                        {"practice": "word " * 200}]}}
        self.assertEqual(wordbudget.over(body)[0]["words"], 400)


class ItStaysPure(unittest.TestCase):
    """The budget must be checkable without the corpus, credentials, or a judge."""

    def test_it_imports_nothing(self):
        with open("wordbudget.py") as fh:
            src = fh.read()
        self.assertEqual([l for l in src.splitlines()
                          if l.startswith(("import ", "from "))], [])

    def test_it_does_not_mutate_the_body(self):
        body = {"big_idea": "word " * 81}
        before = dict(body)
        wordbudget.over(body)
        self.assertEqual(body, before)


if __name__ == "__main__":
    unittest.main()
