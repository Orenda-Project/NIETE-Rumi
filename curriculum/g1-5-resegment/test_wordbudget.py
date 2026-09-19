"""The word budget is a law, not a style note, and it is enforced here or nowhere.

DECIDED B (operator, 2026-09-18, `spec/07-lp-production.md` §4): `key_points`
120, `practice` 350, `big_idea` 80, `worked_example` 470, `faded_example` 470.
`ask`, `warmup`, `board`, `keywords` and `exit_ticket` are uncapped on purpose —
each already sits inside 1.5x its median, and a cap there would police noise.

The defect these tests exist for, measured on `grade_1_english_ch1_seg1` — the
first lesson of the approved slice — on 18 Sep 2026:

    faded_example   627   cap 470   OVER by 157
    worked_example  515   cap 470   OVER by  45
    key_points      367   cap 120   OVER by 247
    practice        125   cap 350   ok
    big_idea         29   cap  80   ok

Three of five caps broken, and the check reported nothing. It matched dict
KEYS, and a capped surface is a block TYPE — `{"type": "key_points", ...}`.
It therefore matched nothing in either artifact. The fixtures in this file
were written the same wrong way, which is why they all passed.

Two more things make this a real check rather than a `len()`:

  The `key_points` cap is **per lesson, across all sections**. The real render
  carries five key_points blocks — hook setup, key fact, Remember, homework,
  coaching corner — so a checker that reads one of them calls 367 words 60.

  **The renderer never trims.** Over cap FAILS; nothing downstream absorbs it.
  So a surface that is over must be named, with its count and its cap, because
  the fix is editorial — `practice` over cap splits across days, it does not
  get compressed.

Measured on the RENDERED document. The Stage-C body is camelCase v9 and
carries no blocks; the budget is a property of the printed page.
"""
import unittest

import wordbudget


def block(kind, **kw):
    """A D0 render block, shaped as `d0_*.py` actually emits one."""
    d = {"type": kind, "id": kind.replace("_", "-")}
    d.update(kw)
    return d


def doc(*blocks):
    return {"sections": [{"blocks": list(blocks)}]}


class CountingWords(unittest.TestCase):

    def test_a_string_surface_counts_its_words(self):
        self.assertEqual(wordbudget.count("one two three"), 3)

    def test_a_list_of_strings_counts_across_the_list(self):
        self.assertEqual(wordbudget.count(["one two", "three"]), 3)

    def test_a_nested_structure_counts_every_string_in_it(self):
        self.assertEqual(
            wordbudget.count({"a": ["one two"], "b": {"c": "three"}}), 3)

    def test_urdu_counts_by_whitespace_like_everything_else(self):
        self.assertEqual(wordbudget.count("علامہ اقبال رحمتہ اللہ علیہ"), 5)

    def test_numbers_and_booleans_are_not_words(self):
        self.assertEqual(wordbudget.count({"minutes": 6, "hoisted": True}), 0)

    def test_nothing_counts_as_nothing(self):
        self.assertEqual(wordbudget.count(None), 0)


class TheCapsAreTheSpec(unittest.TestCase):

    def test_the_five_capped_surfaces_carry_the_decided_b_numbers(self):
        self.assertEqual(wordbudget.CAPS,
                         {"key_points": 120, "practice": 350, "big_idea": 80,
                          "worked_example": 470, "faded_example": 470})

    def test_the_five_uncapped_surfaces_are_named_and_not_capped(self):
        for s in ("ask", "warmup", "board", "keywords", "exit_ticket"):
            self.assertIn(s, wordbudget.UNCAPPED)
            self.assertNotIn(s, wordbudget.CAPS)


class ASurfaceIsABlockType(unittest.TestCase):
    """The defect. A capped name is the VALUE of `type`, never a dict key."""

    def test_a_capped_block_is_found_by_its_type(self):
        self.assertEqual(wordbudget.totals(doc(block("big_idea",
                                                     text="word " * 81))),
                         {"big_idea": 81})

    def test_the_real_lessons_three_broken_caps_are_all_found(self):
        d = {"sections": [
            {"blocks": [block("key_points", items=["word"] * 367),
                        block("worked_example", steps=["word"] * 515)]},
            {"blocks": [block("faded_example", steps=["word"] * 627),
                        block("practice", items=["word"] * 125)]}]}
        self.assertEqual([f["surface"] for f in wordbudget.over(d)],
                         ["key_points", "faded_example", "worked_example"])

    def test_a_dict_key_that_merely_shares_the_name_is_not_a_surface(self):
        # `generated.instance_ledger.worked_example` is a real dict key holding
        # five words of provenance. Counting it returned a non-empty result,
        # which is how the gate's "nothing was measured" net stayed silent
        # while three caps were broken.
        body = {"generated": {"instance_ledger":
                              {"worked_example": "birthday cupcake candle age x"}}}
        self.assertEqual(wordbudget.totals(body), {})

    def test_a_block_of_an_uncapped_type_is_never_a_finding_however_long(self):
        self.assertEqual(wordbudget.over(doc(block("board",
                                                   text="word " * 2000))), [])

    def test_a_type_that_is_not_a_string_does_not_match(self):
        self.assertEqual(wordbudget.totals({"type": ["big_idea"],
                                            "text": "word " * 90}), {})

    def test_block_wiring_is_not_teacher_prose(self):
        # `id`, `type` and `mode` are slugs the renderer keys on.
        b = block("big_idea", mode="independent", minutes=6, text="one two")
        self.assertEqual(wordbudget.totals(doc(b)), {"big_idea": 2})


class CheckingALesson(unittest.TestCase):

    def test_a_lesson_inside_every_cap_reports_nothing(self):
        self.assertEqual(wordbudget.over(doc(block("big_idea", t="word " * 80),
                                             block("practice",
                                                   items=["word"] * 350))), [])

    def test_exactly_at_the_cap_is_inside_it(self):
        self.assertEqual(
            wordbudget.over(doc(block("big_idea", t="word " * 80))), [])

    def test_one_word_over_is_over(self):
        self.assertEqual([f["surface"] for f in wordbudget.over(
            doc(block("big_idea", t="word " * 81)))], ["big_idea"])

    def test_the_finding_carries_the_count_and_the_cap(self):
        f = wordbudget.over(doc(block("big_idea", t="word " * 95)))[0]
        self.assertEqual((f["words"], f["cap"], f["over"]), (95, 80, 15))

    def test_a_surface_the_lesson_does_not_have_is_not_a_finding(self):
        # Absence is a different defect, and qa_checks already owns it.
        self.assertEqual(wordbudget.over({}), [])

    def test_findings_come_back_worst_first(self):
        d = doc(block("big_idea", t="word " * 90),          # 10 over
                block("key_points", items=["word"] * 200))  # 80 over
        self.assertEqual([f["surface"] for f in wordbudget.over(d)],
                         ["key_points", "big_idea"])


class KeyPointsIsCountedAcrossTheWholeLesson(unittest.TestCase):
    """The cap the spec states as 'across all sections' — the one needing a walk."""

    def test_key_points_in_several_sections_sum_to_one_number(self):
        d = {"sections": [{"blocks": [block("key_points", items=["word"] * 60)]},
                          {"blocks": [block("key_points", items=["word"] * 60)]},
                          {"blocks": [block("key_points", items=["word"] * 60)]}]}
        f = wordbudget.over(d)[0]
        self.assertEqual((f["surface"], f["words"]), ("key_points", 180))

    def test_a_block_nested_anywhere_is_still_found(self):
        d = {"page2": {"extras": {"blocks": [block("practice",
                                                   items=["word"] * 400)]}}}
        self.assertEqual([f["surface"] for f in wordbudget.over(d)],
                         ["practice"])

    def test_the_whole_envelope_is_walked_so_no_wrapper_hides_a_block(self):
        # Stage C hands over {"segment_id":…, "generated": {…}} and D0 hands
        # over a doc. Type matching finds a block wherever it sits, so neither
        # needs unwrapping — and unwrapping the wrong one is how this got shipped.
        self.assertEqual(
            wordbudget.over({"lesson_id": "X",
                             "sections": [{"blocks":
                                           [block("big_idea",
                                                  t="word " * 81)]}]})[0]["words"],
            81)

    def test_a_matched_block_is_not_descended_into(self):
        # Blocks are siblings in the section registry, so a matched block is
        # counted whole. Descending would let a surface nested by accident
        # inside another one be billed to two caps at once.
        d = doc(block("practice", items=["word"] * 200,
                      extras=[block("key_points", items=["word"] * 300)]))
        self.assertEqual(sorted(wordbudget.totals(d)), ["practice"])


class ItStaysPure(unittest.TestCase):
    """The budget must be checkable without the corpus, credentials, or a judge."""

    def test_it_imports_nothing(self):
        with open("wordbudget.py") as fh:
            src = fh.read()
        self.assertEqual([l for l in src.splitlines()
                          if l.startswith(("import ", "from "))], [])

    def test_it_does_not_mutate_the_document(self):
        d = doc(block("big_idea", t="word " * 81))
        before = repr(d)
        wordbudget.over(d)
        self.assertEqual(repr(d), before)


if __name__ == "__main__":
    unittest.main()
