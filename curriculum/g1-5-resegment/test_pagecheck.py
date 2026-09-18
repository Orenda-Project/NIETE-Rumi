"""The grounding gate has one job it must not get wrong: telling a book that
disagrees with itself apart from a book that has not finished downloading.

Both show up as segments that will not resolve. They mean opposite things. A
half-fetched tree reporting "17 books cannot be grounded" would send someone
looking for a corpus fault that is not there; a genuinely faulty book reported
as "still downloading" would let Stage C run on it. The first probe run showed
exactly this shape — six books at roughly half their pages, every flag a
`not-in-book` — so the distinction is the thing under test.
"""
import json
import os
import shutil
import tempfile
import unittest

import pagecheck


def page(pdf, printed, chapter):
    return {"pdf_page_index": pdf, "printed_page_number": printed,
            "chapter": {"number": chapter, "title": ""}}


def seg(i, chapter, printed, pdf=None):
    d = {"segment_index": i, "chapter_number": chapter,
         "pages_printed": list(printed)}
    if pdf is not None:
        d["pages_pdf"] = list(pdf)
    return d


class Corpus(unittest.TestCase):
    """A two-directory fixture shaped like the real one."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.truth = os.path.join(self.root, "pagetruth")
        self.seg = os.path.join(self.root, "seg")
        os.makedirs(self.truth)
        os.makedirs(self.seg)

    def tearDown(self):
        shutil.rmtree(self.root)

    def write_book(self, stem, pages, segments, total=None, front=0,
                   span=None, back=0):
        d = os.path.join(self.truth, stem)
        os.makedirs(d, exist_ok=True)
        for p in pages:
            with open(os.path.join(d, "pg_%03d.json" % p["pdf_page_index"]),
                      "w") as fh:
                json.dump(p, fh)
        if total is not None:
            book = {"book_stem": stem, "total_pdf_pages": total,
                    "front_matter_pages": ["f%d" % i for i in range(front)]}
            if span is not None:
                book["content_span"] = span
            if back:
                book["back_matter_pages"] = ["b%d" % i for i in range(back)]
            with open(os.path.join(d, "_book.json"), "w") as fh:
                json.dump(book, fh)
        with open(os.path.join(self.seg, stem + ".json"), "w") as fh:
            json.dump({"_meta": {}, "segments": segments}, fh)

    def check(self, stem):
        return pagecheck.check(stem, truth=self.truth, seg=self.seg)


class AHealthyBook(Corpus):

    def test_every_segment_resolves_and_the_book_is_groundable(self):
        self.write_book("grade_2_math",
                        [page(10, 7, 1), page(11, 8, 1)],
                        [seg(1, 1, [7], [10]), seg(2, 1, [8], [11])], total=2)
        r = self.check("grade_2_math")
        self.assertEqual(r.unresolved, [])
        self.assertTrue(r.groundable)
        self.assertEqual(r.real_faults, 0)

    def test_the_line_says_OK(self):
        self.write_book("grade_2_math", [page(10, 7, 1)],
                        [seg(1, 1, [7], [10])], total=1)
        self.assertIn("OK", self.check("grade_2_math").line())


class AHalfDownloadedBook(Corpus):
    """Missing pages must never read as a corpus that disagrees."""

    def test_it_is_not_groundable_but_it_is_not_a_fault_either(self):
        self.write_book("grade_1_english", [page(10, 7, 1)],
                        [seg(1, 1, [7], [10]), seg(2, 1, [80], [83])],
                        total=168)
        r = self.check("grade_1_english")
        self.assertFalse(r.groundable)
        self.assertFalse(r.complete)
        self.assertEqual(r.real_faults, 0)

    def test_the_missing_page_is_reported_as_not_in_book(self):
        self.write_book("grade_1_english", [page(10, 7, 1)],
                        [seg(2, 1, [80], [83])], total=168)
        self.assertEqual(self.check("grade_1_english").reasons["not-in-book"], 1)

    def test_the_line_says_incomplete_not_faults(self):
        self.write_book("grade_1_english", [page(10, 7, 1)],
                        [seg(2, 1, [80], [83])], total=168)
        line = self.check("grade_1_english").line()
        self.assertIn("INCOMPLETE", line)
        self.assertNotIn("FAULTS", line)

    def test_front_matter_is_not_missing_page_truth(self):
        # Measured 18 Sep 2026: Stage A describes the content pages and not the
        # cover, imprint, QR page or contents. Grade 5 Maths holds 279 page
        # files against a 284-page PDF and its `_book.json` names all five.
        # A book's own front-matter list is the accounting, so completeness is
        # exact rather than a tolerance somebody guessed.
        self.write_book("grade_5_math", [page(10, 7, 1), page(11, 8, 1)],
                        [seg(1, 1, [7], [10])], total=7, front=5)
        self.assertTrue(self.check("grade_5_math").complete)
        self.assertEqual(self.check("grade_5_math").expected, 2)

    def test_one_page_short_of_the_books_own_count_is_still_incomplete(self):
        # Grade 1 Urdu is exactly this case, and it is also the book carrying
        # 16 chapter-mismatch flags. A tolerance would have hidden it.
        self.write_book("grade_1_urdu", [page(10, 7, 1)],
                        [seg(1, 1, [7], [10])], total=7, front=5)
        self.assertFalse(self.check("grade_1_urdu").complete)

    def test_a_declared_back_cover_is_not_a_missing_page(self):
        # Grade 4 Urdu, measured: pdf 4-153 described, total 154, and its
        # `back_matter_pages` names the 154th. The content is all here.
        self.write_book(
            "grade_4_urdu", [page(4, 1, 1), page(5, 2, 1)],
            [seg(1, 1, [1], [4])], total=6, front=3, back=1,
            span={"pdf_first": 4, "printed_first": 1})
        r = self.check("grade_4_urdu")
        self.assertTrue(r.complete)
        self.assertEqual(r.expected, 2)

    def test_a_confirmed_last_footer_ends_the_content(self):
        # Grade 3 Urdu declares `pdf_last_confirmed_footer` rather than listing
        # its back matter. Same fact, said differently.
        self.write_book(
            "grade_3_urdu", [page(4, 1, 1), page(5, 2, 1)],
            [seg(1, 1, [1], [4])], total=9, front=3,
            span={"pdf_first": 4, "pdf_last_confirmed_footer": 5})
        self.assertTrue(self.check("grade_3_urdu").complete)

    def test_a_download_that_stopped_early_is_still_caught(self):
        # The case the whole property exists for. Contiguous, starts in the
        # right place, and less than half the book.
        self.write_book("grade_2_math", [page(6, 1, 1), page(7, 2, 1)],
                        [seg(1, 1, [1], [6])], total=305, front=5,
                        span={"pdf_first": 6})
        self.assertFalse(self.check("grade_2_math").complete)

    def test_a_hole_in_the_middle_is_reported(self):
        # One page that failed while its neighbours landed. The count alone
        # would only notice by accident.
        self.write_book("grade_2_math", [page(6, 1, 1), page(8, 3, 1)],
                        [seg(1, 1, [1], [6])], total=8, front=5,
                        span={"pdf_first": 6})
        r = self.check("grade_2_math")
        self.assertEqual(r.gaps, [7])
        self.assertFalse(r.complete)

    def test_a_book_with_no_front_matter_listed_is_counted_whole(self):
        self.write_book("grade_2_math", [page(10, 7, 1), page(11, 8, 1)],
                        [seg(1, 1, [7], [10])], total=2)
        self.assertTrue(self.check("grade_2_math").complete)


class ABookThatDisagreesWithItself(Corpus):
    """The faults a re-download does not fix."""

    def test_a_chapter_mismatch_counts_as_a_real_fault(self):
        self.write_book("grade_1_urdu", [page(10, 7, 3)],
                        [seg(1, 9, [7], [10])], total=1)
        r = self.check("grade_1_urdu")
        self.assertEqual(r.real_faults, 1)
        self.assertTrue(r.complete)
        self.assertFalse(r.groundable)
        self.assertIn("FAULTS", r.line())

    def test_the_unresolved_segment_is_named_with_its_reason(self):
        # A count alone is not actionable — the report has to say which day.
        self.write_book("grade_1_urdu", [page(10, 7, 3)],
                        [seg(4, 9, [7], [10])], total=1)
        self.assertEqual(self.check("grade_1_urdu").unresolved,
                         [(4, ["chapter-mismatch"])])

    def test_a_duplicated_printed_number_is_surfaced(self):
        # Grade 5 Urdu prints 130-137 twice. Worth seeing even where every
        # segment happens to resolve.
        self.write_book("grade_5_urdu", [page(134, 131, 1), page(135, 131, 15)],
                        [seg(1, 15, [131], [135])], total=2)
        r = self.check("grade_5_urdu")
        self.assertEqual(r.duplicated, {131})
        self.assertTrue(r.groundable)     # resolved, because the pdf key won

    def test_that_resolved_tie_is_still_reported(self):
        self.write_book("grade_5_urdu", [page(134, 131, 1), page(135, 131, 15)],
                        [seg(1, 15, [131], [135])], total=2)
        self.assertEqual(self.check("grade_5_urdu").reasons["keys-disagree"], 1)


class ChoosingWhatToCheck(Corpus):

    def test_only_books_with_both_page_truth_and_segments_are_listed(self):
        self.write_book("grade_2_math", [page(10, 7, 1)], [seg(1, 1, [7])])
        os.makedirs(os.path.join(self.truth, "grade_4_islamiat"))
        self.assertEqual(pagecheck.books(self.truth, self.seg),
                         ["grade_2_math"])

    def test_a_missing_page_truth_tree_is_not_an_error(self):
        self.assertEqual(pagecheck.books(os.path.join(self.root, "nope"),
                                         self.seg), [])

    def test_metadata_and_part_files_are_not_counted_as_pages(self):
        d = os.path.join(self.truth, "grade_2_math")
        self.write_book("grade_2_math", [page(10, 7, 1)], [seg(1, 1, [7])],
                        total=10)
        with open(os.path.join(d, "_toc.json"), "w") as fh:
            json.dump({}, fh)
        with open(os.path.join(d, "pg_011.json.part"), "w") as fh:
            fh.write("{")
        self.assertEqual(len(pagecheck.load_pages(d)), 1)


class TheGateDefaultsToTheRealCorpus(unittest.TestCase):

    def test_it_reads_the_page_truth_beside_the_segmentation_corpus(self):
        here = os.path.dirname(os.path.abspath(pagecheck.__file__))
        self.assertEqual(pagecheck.TRUTH,
                         os.path.join(here, "corpus-local", "pagetruth"))
        self.assertEqual(pagecheck.SEG, os.path.join(here, "corpus", "seg"))


if __name__ == "__main__":
    unittest.main()
