"""Stage C may only ground a lesson on the page the lesson is actually about.

A segment carries two page keys, `pages_printed` and `pages_pdf`, and on three
of the seventeen books they do not point at the same page. The worst case is
Grade 5 Urdu, where the book has a genuine production fault: printed pages
130-137 are printed TWICE — once at the true offset of +3, and again at +13
for the Chapter 14 tail, Chapter 15 and Chapter 16. Chapter 15 Day 1 asks for
printed 131. Resolving that by the printed number alone lands on
"میں ایک کیلنڈر ہوں" — I am a calendar — while the lesson teaches Allama
Iqbal, thirteen pages later. Thirteen days of Grade 5 Urdu would have been
enriched from the wrong chapter, and nothing would have said so.

The division agent knew: the segment's own `notes` say so in prose, book by
book. Prose is not a check. Every case below is measured off the live corpus
and the live `textbook_pages` table on 18 Sep 2026, and the rule they encode
is one line — resolve by BOTH keys, keep the one whose page agrees with the
segment's own chapter, and when they disagree SAY SO rather than pick.
"""
import unittest

import pageres


def page(pdf, printed, chapter, title="", **kw):
    """The fields of a Stage-A page-truth file this module actually reads."""
    d = {"pdf_page_index": pdf, "printed_page_number": printed,
         "chapter": {"number": chapter, "title": title}}
    d.update(kw)
    return d


# Grade 5 Urdu around the duplicated band. pdf 134 and pdf 144 both print
# "131": the first is Chapter 1, the second is the Chapter 15 the segment
# is teaching.
G5_URDU = [page(134, 131, 1, "میں ایک کیلنڈر ہوں (آپ بیتی)"),
           page(135, 132, 1),
           page(143, 130, 14),
           page(144, 131, 15, "علامہ اقبال رحمتہ اللہ علیہ اور ملتِ اسلامیہ"),
           page(145, 132, 15)]


def seg(chapter, printed, pdf=None, **kw):
    d = {"chapter_number": chapter, "pages_printed": list(printed)}
    if pdf is not None:
        d["pages_pdf"] = list(pdf)
    d.update(kw)
    return d


class BuildingTheIndex(unittest.TestCase):
    """A printed number is not a key. That is the whole defect."""

    def test_the_pdf_index_holds_one_page_per_number(self):
        idx = pageres.index(G5_URDU)
        self.assertEqual(idx.by_pdf[144]["printed_page_number"], 131)

    def test_the_printed_index_holds_every_page_claiming_that_number(self):
        idx = pageres.index(G5_URDU)
        self.assertEqual([p["pdf_page_index"] for p in idx.by_printed[131]],
                         [134, 144])

    def test_a_printed_number_printed_once_still_arrives_as_a_list(self):
        # Uniform shape: a caller that special-cases the singular is a caller
        # that will index [0] into the duplicated case without noticing.
        idx = pageres.index(G5_URDU)
        self.assertEqual(len(idx.by_printed[130]), 1)

    def test_a_page_with_no_chapter_does_not_break_the_index(self):
        # Front matter and the odd blank carry `chapter: null`.
        idx = pageres.index([{"pdf_page_index": 1, "printed_page_number": None,
                              "chapter": None}])
        self.assertEqual(idx.by_pdf[1]["chapter"], None)

    def test_the_index_reports_which_printed_numbers_are_duplicated(self):
        # The real fault spans printed 130-137; the fixture carries two of
        # them, and 130 (printed once, in the tail that was not reprinted)
        # is the control.
        self.assertEqual(pageres.index(G5_URDU).duplicated, {131, 132})


class TheGrade5UrduCase(unittest.TestCase):
    """The one that would have shipped thirteen wrong days."""

    def test_the_pdf_key_wins_because_its_chapter_agrees(self):
        r = pageres.resolve(seg(15, [131], [144]), pageres.index(G5_URDU))
        self.assertEqual([p["pdf_page_index"] for p in r.pages], [144])

    def test_the_printed_key_alone_would_have_chosen_the_calendar_lesson(self):
        # Stated as a test so the defect cannot quietly come back: this is
        # what the old behaviour did, and it is why `resolve` exists.
        idx = pageres.index(G5_URDU)
        self.assertEqual(idx.by_printed[131][0]["chapter"]["number"], 1)

    def test_the_flag_says_the_keys_disagreed(self):
        r = pageres.resolve(seg(15, [131], [144]), pageres.index(G5_URDU))
        self.assertEqual(r.flags[0]["reason"], "keys-disagree")

    def test_the_disagreement_is_flagged_even_though_it_was_resolved(self):
        r = pageres.resolve(seg(15, [131], [144]), pageres.index(G5_URDU))
        self.assertTrue(r.flags)
        self.assertTrue(r.resolved)

    def test_the_flag_names_both_candidates_and_the_chapter_that_decided(self):
        r = pageres.resolve(seg(15, [131], [144]), pageres.index(G5_URDU))
        f = r.flags[0]
        self.assertEqual(f["printed"], 131)
        self.assertEqual(f["pdf"], 144)
        self.assertEqual(f["chose"], "pdf")
        self.assertEqual(f["chapter_number"], 15)


class WhenTheTwoKeysAgree(unittest.TestCase):
    """The ordinary case must stay silent, or the flags mean nothing."""

    def test_agreement_resolves_with_no_flag(self):
        # printed 130 sits outside the reprinted band, so it means one page
        # and the pdf key confirms it. Nothing to report.
        r = pageres.resolve(seg(14, [130], [143]), pageres.index(G5_URDU))
        self.assertEqual([p["pdf_page_index"] for p in r.pages], [143])
        self.assertEqual(r.flags, [])

    def test_a_tie_the_chapter_broke_is_reported_even_when_the_pdf_key_agrees(self):
        # printed 132 is duplicated too. The pdf key picks the right page and
        # the chapter confirms it — but the printed number was ambiguous, and
        # an ambiguity resolved in silence is the defect this module exists
        # for. Resolved, and said out loud.
        r = pageres.resolve(seg(15, [132], [145]), pageres.index(G5_URDU))
        self.assertEqual([p["pdf_page_index"] for p in r.pages], [145])
        self.assertEqual(r.flags[0]["reason"], "keys-disagree")

    def test_several_pages_resolve_in_the_order_they_were_asked_for(self):
        r = pageres.resolve(seg(15, [131, 132], [144, 145]),
                            pageres.index(G5_URDU))
        self.assertEqual([p["pdf_page_index"] for p in r.pages], [144, 145])


class WhenThereIsNoPdfKey(unittest.TestCase):
    """All five English books carry `pages_printed` and nothing else."""

    ENGLISH = [page(24, 21, 2, "Five Senses Funland!"),
               page(25, 22, 2)]

    def test_the_printed_number_is_used_when_it_is_the_only_key(self):
        r = pageres.resolve(seg(2, [21]), pageres.index(self.ENGLISH))
        self.assertEqual([p["pdf_page_index"] for p in r.pages], [24])
        self.assertEqual(r.flags, [])

    def test_a_lone_printed_key_is_still_checked_against_the_chapter(self):
        # A single key is not a reason to skip the check — it is the only
        # check left.
        r = pageres.resolve(seg(9, [21]), pageres.index(self.ENGLISH))
        self.assertFalse(r.resolved)
        self.assertEqual(r.flags[0]["reason"], "chapter-mismatch")

    def test_an_empty_pdf_list_is_treated_as_no_pdf_key(self):
        r = pageres.resolve(seg(2, [21], []), pageres.index(self.ENGLISH))
        self.assertEqual([p["pdf_page_index"] for p in r.pages], [24])


class WhenNothingAgrees(unittest.TestCase):
    """Never pick silently. An unresolved page is a stop, not a guess."""

    def test_a_chapter_neither_candidate_matches_is_left_unresolved(self):
        r = pageres.resolve(seg(9, [131], [144]), pageres.index(G5_URDU))
        self.assertFalse(r.resolved)
        self.assertEqual(r.flags[0]["reason"], "chapter-mismatch")

    def test_an_unresolved_page_yields_no_page_rather_than_a_wrong_one(self):
        r = pageres.resolve(seg(9, [131], [144]), pageres.index(G5_URDU))
        self.assertEqual(r.pages, [])

    def test_a_printed_number_the_book_does_not_have_is_flagged(self):
        r = pageres.resolve(seg(15, [999]), pageres.index(G5_URDU))
        self.assertFalse(r.resolved)
        self.assertEqual(r.flags[0]["reason"], "not-in-book")

    def test_a_pdf_index_the_book_does_not_have_is_flagged(self):
        r = pageres.resolve(seg(15, [131], [999]), pageres.index(G5_URDU))
        self.assertEqual(r.flags[0]["reason"], "not-in-book")

    def test_two_candidates_of_the_same_chapter_are_ambiguous_not_chosen(self):
        # Same printed number twice, both inside the asked-for chapter. The
        # chapter cannot break the tie, so nothing may.
        dupes = [page(50, 45, 3), page(60, 45, 3)]
        r = pageres.resolve(seg(3, [45]), pageres.index(dupes))
        self.assertFalse(r.resolved)
        self.assertEqual(r.flags[0]["reason"], "ambiguous")
        self.assertEqual(r.pages, [])


class PartialResolution(unittest.TestCase):
    """One bad page in a three-page day fails the day, not just the page."""

    def test_a_segment_is_resolved_only_if_every_page_resolved(self):
        r = pageres.resolve(seg(15, [131, 999], [144, None]),
                            pageres.index(G5_URDU))
        self.assertFalse(r.resolved)

    def test_the_pages_that_did_resolve_are_still_returned_for_the_report(self):
        r = pageres.resolve(seg(15, [131, 999], [144, None]),
                            pageres.index(G5_URDU))
        self.assertEqual([p["pdf_page_index"] for p in r.pages], [144])

    def test_a_segment_asking_for_no_pages_is_not_silently_resolved(self):
        r = pageres.resolve(seg(15, []), pageres.index(G5_URDU))
        self.assertFalse(r.resolved)
        self.assertEqual(r.flags[0]["reason"], "no-pages")

    def test_keys_of_different_lengths_do_not_zip_pages_out_of_step(self):
        # pages_printed [131,132] against pages_pdf [144] must not pair 132
        # with nothing and call it agreement.
        r = pageres.resolve(seg(15, [131, 132], [144]), pageres.index(G5_URDU))
        self.assertEqual(r.flags[0]["reason"], "key-length-mismatch")
        self.assertFalse(r.resolved)


class ResolutionStaysPure(unittest.TestCase):
    """Stage C's grounding rule must be testable without credentials."""

    def test_it_imports_nothing(self):
        with open("pageres.py") as fh:
            src = fh.read()
        self.assertEqual([l for l in src.splitlines()
                          if l.startswith(("import ", "from "))], [])

    def test_it_does_not_mutate_the_segment_it_was_given(self):
        s = seg(15, [131], [144])
        before = dict(s)
        pageres.resolve(s, pageres.index(G5_URDU))
        self.assertEqual(s, before)


if __name__ == "__main__":
    unittest.main()
