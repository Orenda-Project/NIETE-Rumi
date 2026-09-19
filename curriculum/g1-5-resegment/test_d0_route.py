"""A 995 is a student worksheet. The engine has to say so, not render past it.

The skill records this defect as caught TWICE in the cloud lineage and writes
it up as Law 18: the routing lives in the ENGINE, never in a wrapper, because
a defect fixed in a wrapper is a defect scheduled to recur.

This build had it a third time. `d0_primary._lp_type` maps primary's
`assessment` onto v9's `"RECALL"` and `to_lp_doc` then builds the same five
content sections it builds for every other day — so Chapter 1's assessment
segment would have rendered as a well-formed, gate-passing four-page TEACHER
lesson plan, with a warm-up, a hook, a Big Idea, I-Do/We-Do/You-Do and a
homework box, for something that must be a student-facing worksheet plus a
separate answer key. Nothing in the pipeline would have said a word.

So the refusal is tested through `to_lp_doc` itself rather than through a
helper anyone could route around, and it is tested for BOTH review
vocabularies. A 990 (revision) now has a route of its own in `d0_panels`, and
`d0_primary` must still refuse it — the point of the guard was never that
nothing else could build it, it was that THIS builder must not. `dayfold`
folds 115 of the 236 revision segments away in the languages and maths
corpora, which is arithmetic, not a guard; the other 121 go to the panel
builder. 81 segments say `revision`, 72 say `duhrai` and 18 say
`review_assess` — guard the vocabulary, not the English word.
"""
import unittest

import d0_primary
import d0_route


def enr(lp_type="content", **kw):
    d = {"lesson_id": "grade_1_english_ch1_seg1", "lp_type": lp_type,
         "generated": {"steps": [], "slo_refs": ["E-01-VO-02"]}}
    d.update(kw)
    return d


def seg(**kw):
    d = {"segment_index": 1, "chapter_number": 1, "lp_type": "content",
         "skill_type": "vocabulary_grammar"}
    d.update(kw)
    return d


PAGE = {"book_stem": "grade_1_english", "printed_page_number": 2,
        "pdf_page_index": 5, "chapter": {"number": 1, "title": "Hello World!"}}


class WhatKindOfArtefactIsThis(unittest.TestCase):
    """Three primary types, three different printed objects."""

    def test_an_ordinary_teaching_day_is_a_lesson_plan(self):
        self.assertEqual(d0_route.kind(enr(), seg()), "content")

    def test_the_995_segment_is_a_worksheet(self):
        self.assertEqual(d0_route.kind(enr("assessment"),
                                       seg(lp_type="assessment",
                                           skill_type="assessment")),
                         "assessment")

    def test_the_990_segment_is_a_revision_panel_set(self):
        self.assertEqual(d0_route.kind(enr("revision"),
                                       seg(lp_type="revision",
                                           skill_type="revision")),
                         "revision")

    def test_the_urdu_spelling_of_revision_routes_the_same_way(self):
        # 72 segments say دہرائی. An English-word check misses every one.
        self.assertEqual(d0_route.kind(enr(), seg(lp_type=None,
                                                  skill_type="duhrai")),
                         "revision")

    def test_review_assess_is_a_review_not_a_teaching_day(self):
        # 18 segments, science. Its own word, same route.
        self.assertEqual(d0_route.kind(enr(), seg(lp_type=None,
                                                  skill_type="review_assess")),
                         "revision")

    def test_the_urdu_spelling_of_assessment_routes_to_the_worksheet(self):
        # skills.ALIAS renders Urdu assessment as جائزہ. If a segment ever
        # carries the alias as its own key, it is still a worksheet.
        self.assertEqual(d0_route.kind(enr(), seg(lp_type=None,
                                                  skill_type="jaiza")),
                         "assessment")

    def test_a_key_present_but_null_counts_as_absent(self):
        # The skill names this explicitly. A null `lp_type` beside an
        # assessment `skill_type` must not read as "not an assessment".
        self.assertEqual(d0_route.kind(enr(), seg(lp_type=None,
                                                  skill_type="assessment")),
                         "assessment")

    def test_the_envelope_alone_is_enough_when_there_is_no_segment(self):
        self.assertEqual(d0_route.kind(enr("assessment"), None), "assessment")

    def test_either_source_saying_assessment_is_enough(self):
        # Never AND them. One source calling this a worksheet is the whole
        # signal; requiring both is how a silent fallback comes back.
        self.assertEqual(d0_route.kind(enr(), seg(skill_type="assessment")),
                         "assessment")


class TheEngineRefuses(unittest.TestCase):
    """Through `to_lp_doc`, because a wrapper guard is not a guard."""

    def test_an_assessment_segment_does_not_render_as_a_lesson_plan(self):
        with self.assertRaises(d0_route.WrongRoute):
            d0_primary.to_lp_doc(enr("assessment"), PAGE,
                                 segment=seg(lp_type="assessment",
                                             skill_type="assessment"))

    def test_the_refusal_names_the_route_that_should_have_been_taken(self):
        try:
            d0_primary.to_lp_doc(enr("assessment"), PAGE)
        except d0_route.WrongRoute as e:
            self.assertIn("d0_worksheet", str(e))
            self.assertIn("ANSWER_KEY", str(e))
        else:
            self.fail("an assessment rendered as a teacher lesson plan")

    def test_the_refusal_names_the_lesson_so_it_can_be_found(self):
        try:
            d0_primary.to_lp_doc(enr("assessment"), PAGE)
        except d0_route.WrongRoute as e:
            self.assertIn("grade_1_english_ch1_seg1", str(e))

    def test_a_revision_segment_is_refused_too(self):
        # `d0_panels` builds these now, and this builder must still refuse
        # one. Refusing is the honest answer; the silent RECALL fallback was
        # not.
        with self.assertRaises(d0_route.WrongRoute):
            d0_primary.to_lp_doc(enr("revision"), PAGE)

    def test_the_revision_refusal_says_what_a_990_actually_is(self):
        try:
            d0_primary.to_lp_doc(enr(), PAGE, segment=seg(skill_type="duhrai"))
        except d0_route.WrongRoute as e:
            self.assertIn("panel", str(e).lower())

    def test_an_ordinary_lesson_still_renders(self):
        # The control. A guard that refuses everything is not a guard.
        doc = d0_primary.to_lp_doc(enr(), PAGE, segment=seg())
        self.assertEqual(doc["schema_version"], "3.0")

    def test_the_guard_does_not_need_a_segment_to_fire(self):
        # `to_lp_doc` is called without one today. The envelope carries the
        # type, so the absence of a segment may not disable the check.
        with self.assertRaises(d0_route.WrongRoute):
            d0_primary.to_lp_doc(enr("assessment"), PAGE, segment=None)


class TheEscapeHatchIsDeliberate(unittest.TestCase):
    """Named, explicit, and never the default."""

    def test_force_renders_the_assessment_as_a_lesson_plan_anyway(self):
        doc = d0_primary.to_lp_doc(enr("assessment"), PAGE, force_lp=True)
        self.assertEqual(doc["schema_version"], "3.0")

    def test_the_hatch_is_off_unless_it_is_asked_for(self):
        with self.assertRaises(d0_route.WrongRoute):
            d0_primary.to_lp_doc(enr("assessment"), PAGE, force_lp=False)


class RoutingStaysPure(unittest.TestCase):
    """The rule has to be testable without the corpus or a renderer."""

    def test_it_imports_nothing(self):
        with open("d0_route.py") as fh:
            src = fh.read()
        self.assertEqual([l for l in src.splitlines()
                          if l.startswith(("import ", "from "))], [])

    def test_the_vocabularies_do_not_overlap(self):
        self.assertEqual(d0_route.ASSESSMENT & d0_route.REVISION, set())


if __name__ == "__main__":
    unittest.main()
