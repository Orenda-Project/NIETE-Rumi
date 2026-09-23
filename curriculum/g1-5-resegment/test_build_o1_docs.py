"""What the O1 driver prints, and what it used to print instead.

bd-lidwb. The bead was filed against the v5/v6 JS lineage -- "generate.js has
ZERO reference to worksheet.js ... v5+v6 produced 0 worksheets for 11
assessments" -- and the same hole is here, one language along.
`build_o1_docs` imported exactly one renderer, `d0_primary`, and called it
once per manifest row with no look at what the row IS. Every 995 in a batch
was handed to the lesson-plan builder.

What that cost changed shape halfway through and both halves matter. Before
`d0_route` existed, an assessment came out as four colour pages of teacher
script: well formed, gate-clean, and impossible to hand to a child. Since
`d0_route`, `d0_primary` refuses it -- so the driver now takes the whole batch
down on the first assessment instead, and the worksheet is still never built.
A crash is the better failure and it is still not the artefact.

So the property here is not "an assessment does not render as an LP". It is
that each of the three kinds of day prints the thing it IS: a 995 prints a
child's sheet AND its own answer key, a 990 prints the three panels, and --
the control that keeps this narrow -- an ordinary day still prints an lp_doc
through `d0_primary`, exactly as before.

`d0_route` decides which; nothing below re-decides it. The driver's job is to
call the right builder and to name a day it could not print rather than
dropping it, which is `basicsjudge`'s rule about silent skips applied to the
other end of the pipeline.
"""
import json
import pathlib
import shutil
import tempfile
import unittest

import build_o1_docs
import test_d0_primary
import test_panellint
import test_wslint

SUBJECT = "English"

PT = {"book_stem": "grade_1_english", "grade": 1, "subject": "English",
      "printed_page_number": 12, "pdf_page_index": 16,
      "chapter": {"number": 1, "title": "Hello World!"}}

PASS = {"gate": {"pass": True, "reasons": []}}


class Work(object):
    """A work dir in the shape `build_o1_docs` reads, one row at a time.

    The driver finds its artefacts by glob -- `<Subject>_seg<ordinal>_*.json`
    -- and the ordinal is the row's position on the tab, never the segment's
    own id. Writing the fixtures through the same naming is the only way this
    test exercises the lookup the real run uses.
    """

    def __init__(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.work = self.root / "work"
        for stage in ("enr", "pt", "gate"):
            (self.work / stage).mkdir(parents=True)
        self.rows = []

    def add(self, enr, row=None, pt=None, gate=None):
        self.rows.append(row or {"topic": "Day %d" % (len(self.rows) + 1)})
        n = len(self.rows)
        stem = (enr.get("lesson_id") or "seg%d" % n).split("_")[-1]
        for stage, doc in (("enr", enr), ("pt", pt or PT),
                           ("gate", gate or PASS)):
            path = self.work / stage / ("%s_seg%d_%s.json"
                                        % (SUBJECT, n, stem))
            path.write_text(json.dumps(doc, ensure_ascii=False))
        return self

    def run(self):
        (self.work / "manifest.json").write_text(
            json.dumps({SUBJECT: self.rows}, ensure_ascii=False))
        code = build_o1_docs.main(str(self.work))
        return code, self.root / "o1" / "docs"

    def close(self):
        shutil.rmtree(str(self.root), ignore_errors=True)


def doc(out, name):
    return json.loads((out / name).read_text())


def content(**kw):
    """An ordinary teaching day, as `d0_primary`'s own tests supply it."""
    return dict(test_d0_primary.ENR, **kw)


class AnAssessmentDayPrintsAWorksheet(unittest.TestCase):
    """The 995. Two artefacts from one authored source, and neither is an LP."""

    def setUp(self):
        self.w = Work().add(test_wslint.good())
        self.addCleanup(self.w.close)
        self.code, self.out = self.w.run()

    def test_the_run_succeeds(self):
        self.assertEqual(self.code, 0)

    def test_the_childs_sheet_is_written(self):
        sheet = doc(self.out, "English_seg1.worksheet.json")
        self.assertEqual(sheet["doc_type"], "worksheet")
        self.assertEqual(len(sheet["questions"]), 8)

    def test_the_answer_key_is_written_as_its_own_artefact(self):
        key = doc(self.out, "English_seg1.answer_key.json")
        self.assertEqual(key["doc_type"], "answer_key")
        self.assertTrue(key["doc_id"].endswith("_ANSWER_KEY"))

    def test_no_lesson_plan_is_written_for_it(self):
        self.assertFalse((self.out / "English_seg1.lp.json").exists())

    def test_the_answers_are_on_the_key_and_not_on_the_sheet(self):
        key = doc(self.out, "English_seg1.answer_key.json")
        self.assertTrue(all(a.get("answer") for a in key["answers"]))
        sheet = json.dumps(doc(self.out, "English_seg1.worksheet.json"))
        self.assertNotIn("phonetically", sheet)


class TheSheetSaysWhichPagesItCovers(unittest.TestCase):
    """A 995 spans the chapter; the manifest pairs it with one page truth.

    The header a child holds prints that span, so taking it from the single
    paired page truth makes an eleven-page chapter assessment announce itself
    as page 1. The row already carries `pages_printed` -- the segment's own
    field, the same list the matrix sheet shows -- so the span is read, never
    invented, and a row without it falls back to the one page as before.
    """

    def sheet(self, row):
        w = Work().add(test_wslint.good(), row=row)
        self.addCleanup(w.close)
        return doc(w.run()[1], "English_seg1.worksheet.json")

    def test_a_chapter_wide_sheet_prints_the_whole_span(self):
        s = self.sheet({"topic": "Chapter 1 Assessment",
                        "pages_printed": list(range(1, 12))})
        self.assertEqual(s["provenance"]["printed_pages"], "1-11")

    def test_a_gappy_span_is_printed_as_the_pages_it_is(self):
        s = self.sheet({"topic": "Chapter 1 Assessment",
                        "pages_printed": [1, 4, 9]})
        self.assertEqual(s["provenance"]["printed_pages"], "1, 4, 9")

    def test_a_row_with_no_span_still_prints_its_one_page(self):
        s = self.sheet({"topic": "Chapter 1 Assessment"})
        self.assertEqual(s["provenance"]["printed_pages"], "12")


class ARevisionDayPrintsItsPanels(unittest.TestCase):
    """The 990. Three groups in one room, and legally no iDo and no youDo."""

    def setUp(self):
        self.w = Work().add(test_panellint.enr())
        self.addCleanup(self.w.close)
        self.code, self.out = self.w.run()

    def test_the_panel_set_is_written(self):
        pages = doc(self.out, "English_seg1.panels.json")
        self.assertEqual(self.code, 0)
        self.assertTrue(pages)

    def test_no_lesson_plan_is_written_for_it(self):
        self.assertFalse((self.out / "English_seg1.lp.json").exists())


class AnOrdinaryDayStillPrintsALessonPlan(unittest.TestCase):
    """The control. The route is a fork, not a replacement.

    Every day in the build that is not one of the two special ordinals still
    goes through `d0_primary` and comes out as `<Subject>_seg<N>.lp.json`,
    under the name the v9 renderer already reads.
    """

    def setUp(self):
        self.w = Work().add(content()).add(content())
        self.addCleanup(self.w.close)
        self.code, self.out = self.w.run()

    def test_both_days_are_written_as_lp_docs(self):
        self.assertEqual(self.code, 0)
        for n in (1, 2):
            self.assertTrue((self.out / ("English_seg%d.lp.json" % n)).exists())

    def test_it_is_still_an_lp_doc_and_not_a_worksheet(self):
        # An lp_doc is known by the shape the v9 renderer reads: schema 3.0
        # and the teaching sections. A worksheet carries neither.
        lp = doc(self.out, "English_seg1.lp.json")
        self.assertEqual(lp["schema_version"], "3.0")
        self.assertTrue(lp["sections"])

    def test_no_worksheet_is_invented_for_a_teaching_day(self):
        self.assertFalse((self.out / "English_seg1.worksheet.json").exists())


class AMixedChapterPrintsEachDayAsWhatItIs(unittest.TestCase):
    """The real shape of a chapter: teaching days, then a revision day, then
    the assessment. One run, three builders, and the ordinals stay the row's
    position on the tab rather than the segment's own id."""

    def setUp(self):
        self.w = (Work().add(content()).add(test_panellint.enr())
                  .add(test_wslint.good()))
        self.addCleanup(self.w.close)
        self.code, self.out = self.w.run()

    def test_every_day_printed_something(self):
        self.assertEqual(self.code, 0)
        for name in ("English_seg1.lp.json", "English_seg2.panels.json",
                     "English_seg3.worksheet.json",
                     "English_seg3.answer_key.json"):
            self.assertTrue((self.out / name).exists(), name)


class ADayThatCannotBePrinted(unittest.TestCase):
    """A worksheet of the wrong shape is NAMED, and the batch carries on.

    `d0_worksheet` refuses it before a render is paid for, which is right. The
    driver's part is that one bad day does not take the good ones down with it
    -- and that it says which day, because a silent skip and a clean exit is
    how a batch of forty reports success having written four.
    """

    def setUp(self):
        self.w = Work().add(test_wslint.good(6)).add(content())
        self.addCleanup(self.w.close)
        self.code, self.out = self.w.run()

    def test_the_good_day_is_still_written(self):
        self.assertTrue((self.out / "English_seg2.lp.json").exists())

    def test_the_bad_day_wrote_nothing(self):
        self.assertFalse((self.out / "English_seg1.worksheet.json").exists())

    def test_the_run_does_not_report_success(self):
        self.assertEqual(self.code, 1)


if __name__ == "__main__":
    unittest.main()
