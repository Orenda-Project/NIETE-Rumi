"""Giving a basics period a segment row, without lying about what it teaches.

`basics` names the 366 periods that have none. This is the other half: a row
shaped like every other row in `corpus/seg`, so the existing Stage-C path --
`d0_route` to `d0_primary`, a brief, a render, a gate -- can reach a period
the book never claimed.

Two things have to be got right, and they pull in opposite directions.

The INDEX has to be stable, because `judgerun` finds an authored artefact by
`<stem>_ch<n>_seg<i>.json`. Numbering basics rows in the order they fall in
the year would renumber every one of them the next time a chapter is folded
or re-paced, and the authored work would re-attach to the wrong day in
silence. So the index is computed from (skill, ordinal) -- the same identity
`basics` already guarantees -- inside a band no real day uses.

The SLO has to be honest. A number-fluency period is not an FDE SLO; the
syllabus has no such objective, and stamping the anchor chapter's codes on it
would inflate coverage with days that never taught them. The Coverage Map is
deliberately built the other way round -- it shows these skills as zeros and
invents no number for them -- and a row that claimed otherwise would put the
two in disagreement. So a basics row carries NO `slo_codes`. It carries its
own formative objective, and it names the chapter SLOs it FEEDS in a separate
field that no coverage arithmetic reads.
"""
import unittest

import basicseg
import d0_route


def rec(skill="number_fluency", ordinal=1, chapter=4, stem="grade_2_math",
        grade=2, subject="Maths", kind="fill"):
    return {"id": "%s_ch%d_x%d" % (stem, chapter, ordinal), "stem": stem,
            "grade": grade, "subject": subject, "chapter": chapter,
            "skill": skill, "kind": kind, "ordinal": ordinal,
            "position": 30, "of": 150}


def chapter(pages=((2, 7), (3, 8)), title="Numberland", codes=("M-02-NS-03",)):
    return [{"chapter_number": 4, "chapter_title": title,
             "pages_printed": [p for p, _ in pages],
             "pages_pdf": [q for _, q in pages],
             "slo_codes": list(codes), "segment_index": 1}]


class TheIndexBand(unittest.TestCase):

    def test_it_sits_above_every_real_day_and_below_the_tail_sentinels(self):
        # Measured 20 Sep 2026: no real segment_index exceeds 99, and the only
        # values above it anywhere in the corpus are 990 (review) and 995
        # (assessment), 233 of each.
        i = basicseg.index_of("number_fluency", 1)
        self.assertTrue(100 < i < 990, i)

    def test_the_same_skill_and_ordinal_always_give_the_same_index(self):
        self.assertEqual(basicseg.index_of("concrete", 3),
                         basicseg.index_of("concrete", 3))

    def test_it_does_not_depend_on_where_the_period_falls_in_the_year(self):
        # The property the band exists for: a rebalance must not renumber it.
        a = basicseg.segment(rec(ordinal=2), chapter())
        b = basicseg.segment(dict(rec(ordinal=2), position=140), chapter())
        self.assertEqual(a["segment_index"], b["segment_index"])

    def test_no_two_live_skill_and_ordinal_pairs_collide(self):
        seen = {basicseg.index_of(s, n)
                for s in basicseg.SLOT for n in range(1, basicseg.MAX_ORDINAL + 1)}
        self.assertEqual(len(seen),
                         len(basicseg.SLOT) * basicseg.MAX_ORDINAL)

    def test_every_index_it_can_mint_stays_inside_the_band(self):
        for s in basicseg.SLOT:
            for n in range(1, basicseg.MAX_ORDINAL + 1):
                self.assertTrue(100 < basicseg.index_of(s, n) < 990)

    def test_an_ordinal_past_the_band_is_refused_not_wrapped(self):
        # The largest real group is 16 periods (G2 Maths ch1 concrete), so
        # there is headroom -- but a wrap would silently collide with the next
        # skill's band, which is the one failure that would not show up.
        with self.assertRaises(ValueError):
            basicseg.index_of("concrete", basicseg.MAX_ORDINAL + 1)

    def test_an_unknown_skill_has_no_band_at_all(self):
        with self.assertRaises(KeyError):
            basicseg.index_of("telepathy", 1)


class TheRowIsHonestAboutSLOs(unittest.TestCase):

    def test_it_claims_no_fde_slo_of_its_own(self):
        # Coverage arithmetic reads `slo_codes`. A basics day did not teach
        # the chapter's objectives, and saying it did would overstate the
        # syllabus as covered.
        s = basicseg.segment(rec(), chapter(codes=("M-02-NS-03", "M-02-NS-01")))
        self.assertEqual(s["slo_codes"], [])

    def test_it_names_the_chapter_slos_it_feeds_in_a_separate_field(self):
        s = basicseg.segment(rec(), chapter(codes=("M-02-NS-03", "M-02-NS-01")))
        self.assertEqual(sorted(s["supports_slo_codes"]),
                         ["M-02-NS-01", "M-02-NS-03"])

    def test_it_carries_its_own_formative_objective(self):
        # The day still has to tell a teacher what it is for. It is ours and
        # formative, not FDE's and summative, so it is worded as its own.
        s = basicseg.segment(rec(), chapter())
        self.assertTrue(s["objective"])
        self.assertNotIn("slo", s["objective"].lower())


class TheRowIsAnchoredInTheBook(unittest.TestCase):

    def test_it_takes_the_anchor_chapters_pages(self):
        s = basicseg.segment(rec(), chapter(pages=((2, 7), (3, 8), (4, 9))))
        self.assertEqual((s["pages_printed"], s["pages_pdf"]),
                         ([2, 3, 4], [7, 8, 9]))

    def test_it_takes_the_anchor_chapters_title_and_number(self):
        s = basicseg.segment(rec(), chapter(title="Numberland"))
        self.assertEqual((s["chapter_number"], s["chapter_title"]),
                         (4, "Numberland"))

    def test_a_chapter_with_no_rows_is_refused_rather_than_left_ungrounded(self):
        # Without pages there is nothing to anchor to, and the spec's first
        # rule for every template is that the class never leaves the book.
        with self.assertRaises(ValueError):
            basicseg.segment(rec(), [])

    def test_duplicate_pages_across_the_chapters_days_are_not_repeated(self):
        rows = chapter() + chapter()
        self.assertEqual(basicseg.segment(rec(), rows)["pages_printed"], [2, 3])


class TheRowRoutesToATeacherLessonPlan(unittest.TestCase):

    def test_d0_route_calls_it_content(self):
        # Not a worksheet and not revision panels: a basics period is taught.
        s = basicseg.segment(rec(), chapter())
        self.assertEqual(d0_route.kind(None, s), "content")

    def test_it_is_marked_as_a_basics_row_so_it_can_be_told_apart(self):
        s = basicseg.segment(rec(), chapter())
        self.assertTrue(s["is_basics"])

    def test_it_keeps_the_basics_id_that_minted_it(self):
        s = basicseg.segment(rec(), chapter())
        self.assertEqual(s["basics_id"], rec()["id"])

    def test_its_day_label_names_the_skill_rather_than_a_day_number(self):
        # It has no place in the chapter's day sequence -- calling it "Day 4"
        # would claim one and push the real days along.
        s = basicseg.segment(rec(skill="number_fluency", ordinal=2), chapter())
        self.assertIn("Number Fluency", s["day_label"])
        self.assertIn("2", s["day_label"])

    def test_every_basics_skill_has_a_readable_name_for_that_label(self):
        for skill in basicseg.SLOT:
            self.assertIn(skill, basicseg.NAME)

    def test_it_takes_its_period_length_from_the_book_it_sits_in(self):
        # docs/05-basics-build.md assumes a 40-minute period throughout. No
        # book in the corpus does: measured 20 Sep 2026 the only lengths are
        # 30 (1,635 days), 35 (372) and 25 (32). A basics period is a slot in
        # the same timetable as the days either side of it, so it is as long
        # as they are -- writing a 40-minute plan into a 30-minute slot is the
        # "too long to do in the period" complaint, manufactured. Tracked as a
        # correction to the spec.
        rows = chapter()
        rows[0]["duration_min"] = 35
        self.assertEqual(basicseg.segment(rec(), rows)["duration_min"], 35)

    def test_a_chapter_that_does_not_say_falls_back_to_the_corpus_norm(self):
        self.assertEqual(basicseg.segment(rec(), chapter())["duration_min"], 30)


if __name__ == "__main__":
    unittest.main()
