"""
Red-first tests for the textbook importer's page and chapter normalisation.

    python3 -m unittest scripts/lib/test_textbook_import.py -v

Every case here is a defect found in the 27 ICT books on 2026-09-02 (bd-60012),
reproduced with the smallest page array that shows it.
"""
import unittest

from textbook_import import (
    clean_page_text, normalise_pages, dominant_offset, chapters_to_printed,
)


def P(pdf, printed, text="x"):
    return {"pdf_page_no": pdf, "book_page_no": printed, "text": text}


class NonPositivePrintedNumbers(unittest.TestCase):
    """Urdu books number their title/QR/contents pages -2, -1, 0 (G1–G5 Urdu);
    Science G5 numbers three front pages 0. They are front matter, same as None."""

    def test_dropped_like_front_matter(self):
        rows = normalise_pages([P(1, -2), P(2, -1), P(3, 0), P(4, 1), P(5, 2)])
        self.assertEqual([r["textbook_page_number"] for r in rows], [1, 2])


class RepeatedPdfPages(unittest.TestCase):
    """textbook_pages has UNIQUE (textbook_id, pdf_page_index). Islamiat G2/G3/G5
    carry the same pdf page twice (identical text); Maths G4's array is two whole
    OCR runs of the same scan back to back."""

    def test_identical_repeat_keeps_one(self):
        rows = normalise_pages([P(55, 51, "a"), P(56, 52, "b"), P(56, 52, "b")])
        self.assertEqual([r["pdf_page_index"] for r in rows], [55, 56])

    def test_second_ocr_run_is_dropped_in_favour_of_the_first(self):
        first = [P(1, None), P(2, None), P(3, 1, "run1-p1"), P(4, 2, "run1-p2")]
        second = [P(1, 229), P(2, 230), P(3, 1, "run2-p1"), P(4, 2, "run2-p2")]
        rows = normalise_pages(first + second)
        self.assertEqual([(r["pdf_page_index"], r["page_content"]) for r in rows],
                         [(3, "run1-p1"), (4, "run1-p2")])


class DuplicatePrintedNumbers(unittest.TestCase):
    """The OCR misreads a printed page number now and then (Eng G2: pdf 104 read
    as 8, leaving 100 missing). Only pages whose number is a duplicate are
    touched; the copy that disagrees with the book's pdf→printed offset is given
    the number its position implies when that number is otherwise missing."""

    def test_misread_copy_is_moved_to_the_gap_its_position_implies(self):
        pages = [P(5, 1), P(6, 2), P(7, 3), P(8, 4), P(9, 5), P(10, 6), P(11, 3), P(12, 8)]
        rows = normalise_pages(pages)
        got = {r["pdf_page_index"]: r["textbook_page_number"] for r in rows}
        self.assertEqual(got[11], 7)
        self.assertEqual(got[7], 3)
        self.assertEqual(sorted(got.values()), [1, 2, 3, 4, 5, 6, 7, 8])

    def test_mislabelled_front_matter_is_dropped(self):
        """GK G1: cover, copyright, foreword and contents carry 1, 2, 1, 1;
        the real printed 1 is pdf 6. Their implied numbers are <= 0."""
        pages = [P(1, 1), P(2, None), P(3, 2), P(4, 1), P(5, 1),
                 P(6, 1), P(7, 2), P(8, 3), P(9, 4)]
        rows = normalise_pages(pages)
        self.assertEqual([(r["pdf_page_index"], r["textbook_page_number"]) for r in rows],
                         [(6, 1), (7, 2), (8, 3), (9, 4)])

    def test_unique_numbers_are_never_touched_even_off_offset(self):
        """An unnumbered insert shifts the offset mid-book; those pages are
        unique and must stay exactly as printed."""
        pages = [P(4, 1), P(5, 2), P(6, 3), P(7, None), P(8, 4), P(9, 5)]
        rows = normalise_pages(pages)
        self.assertEqual([r["textbook_page_number"] for r in rows], [1, 2, 3, 4, 5])


class Offset(unittest.TestCase):
    def test_dominant_offset_is_the_mode_of_pdf_minus_printed(self):
        pages = [P(1, None), P(2, None), P(3, None), P(4, 1), P(5, 2), P(6, 3), P(104, 8)]
        self.assertEqual(dominant_offset(pages), 3)


class ChapterRanges(unittest.TestCase):
    """The source chapter table is in pdf positions, not printed numbers: in
    English G1 the chapter-4 opener is pdf page 41 (printed 38) and chapter 5
    opens at pdf 54. Our bot reads page_start/page_end as printed numbers, so
    the import converts."""

    def test_converted_by_offset(self):
        ch = [{"chapter_number": 4, "title": "TV Troubles", "start_page": 41, "end_page": 53}]
        out = chapters_to_printed(ch, offset=3, max_printed=166)
        self.assertEqual((out[0]["start_page"], out[0]["end_page"]), (38, 50))

    def test_clamped_to_the_printed_range_and_flagged(self):
        ch = [{"chapter_number": 1, "title": "Hello", "start_page": 2, "end_page": 14},
              {"chapter_number": 9, "title": "Last", "start_page": 160, "end_page": 190}]
        out = chapters_to_printed(ch, offset=4, max_printed=185)
        self.assertEqual((out[0]["start_page"], out[0]["end_page"]), (1, 10))
        self.assertTrue(out[0]["clamped"])
        self.assertEqual((out[1]["start_page"], out[1]["end_page"]), (156, 185))
        self.assertTrue(out[1]["clamped"])
        self.assertFalse(chapters_to_printed(
            [{"chapter_number": 2, "title": "T", "start_page": 20, "end_page": 30}],
            offset=4, max_printed=185)[0]["clamped"])


class EmptyChapterRanges(unittest.TestCase):
    """GK G3's source lists chapter 1 as pages 0-0. After conversion that is an
    empty range the bot would offer as "pages 1-0" and then find no content for."""

    def test_empty_after_conversion_is_marked(self):
        out = chapters_to_printed(
            [{"chapter_number": 1, "title": "?", "start_page": 0, "end_page": 0},
             {"chapter_number": 2, "title": "Two", "start_page": 5, "end_page": 12}],
            offset=0, max_printed=130)
        self.assertTrue(out[0]["empty"])
        self.assertFalse(out[1]["empty"])

    def test_missing_bounds_are_marked_empty(self):
        out = chapters_to_printed(
            [{"chapter_number": 3, "title": "T", "start_page": None, "end_page": 9}],
            offset=0, max_printed=130)
        self.assertTrue(out[0]["empty"])


class CleanPageStillByteIdentical(unittest.TestCase):
    def test_clean_input_unchanged(self):
        s = "Object: a cat.\nThe cat sat.\n\nDone."
        self.assertEqual(clean_page_text(s), s)


if __name__ == "__main__":
    unittest.main()
