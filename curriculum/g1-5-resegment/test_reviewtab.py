"""The two review tabs are the ones a person writes INTO, so they must read.

Samples Review and QA Checklist are built empty on purpose: the build fills
the left-hand columns and leaves the reviewer's own columns blank. That makes
row 2 — the standfirst — the whole of the instruction. It says what to check
and against what, and on QA Checklist it says the thing that matters most:
check the breakdown against this workbook's Teaching Calendar, not against an
assumed split. A clipped last line there is a checklist that quietly stops
saying what to check it against.

The clip was small and therefore easy to miss: `_shell` sizes row 2 with a
10pt estimate while `format_review` paints it at `house.SUB_PT` (11pt). The
line count was right; every line was a few pixels short, so the last one was
cut. Measured on the live workbook, 18 Sep 2026.
"""
import unittest

import house
import reviewtab
import sheetio
import standfirst


class Recorder:
    """The narrowest thing that looks like the Sheets client to a painter."""

    def __init__(self):
        self.requests = []

    def spreadsheets(self):
        return self

    def batchUpdate(self, spreadsheetId=None, body=None):
        self.requests.extend(body["requests"])
        return self

    def execute(self):
        return {}


def painted(rows, plan):
    rec = Recorder()
    reviewtab.format_review(rec, sheetio, 777, rows, plan)
    return rec.requests


def row_heights(reqs, row):
    """Every ROWS pixelSize request covering `row`, in the order they land."""
    out = []
    for q in reqs:
        d = q.get("updateDimensionProperties")
        if not d or d["range"]["dimension"] != "ROWS":
            continue
        if d["range"]["startIndex"] <= row < d["range"]["endIndex"]:
            out.append(d["properties"]["pixelSize"])
    return out


BUILDERS = {"Samples Review": reviewtab.samples_review,
            "QA Checklist": reviewtab.qa_checklist}


class TheStandfirstFitsItsOwnText(unittest.TestCase):

    def test_the_plan_alone_is_too_short_for_both_tabs(self):
        # The defect, stated as arithmetic rather than as a screenshot: what
        # the plan pins is less than the text needs at the size it is drawn.
        # If this ever stops being true the fix below is dead weight — delete
        # it rather than leaving a request nothing needs.
        for name, build in BUILDERS.items():
            rows, plan = build()
            need = standfirst.row_px(rows, 1, plan["widths"],
                                     plan["n_cols"], 0, 0)
            self.assertGreater(need, plan["heights"][1], name)

    def test_the_last_word_on_row_2_is_the_computed_height(self):
        # _heights emits the plan's pinned value first; Sheets applies
        # requests in order, so the computed one has to come after it.
        for name, build in BUILDERS.items():
            rows, plan = build()
            want = standfirst.row_px(rows, 1, plan["widths"],
                                     plan["n_cols"], 0, plan["heights"][1])
            self.assertEqual(row_heights(painted(rows, plan), 1)[-1], want,
                             name)

    def test_row_2_is_never_shrunk_below_what_the_plan_asked_for(self):
        for name, build in BUILDERS.items():
            rows, plan = build()
            got = row_heights(painted(rows, plan), 1)[-1]
            self.assertGreaterEqual(got, plan["heights"][1], name)

    def test_no_other_row_is_re_heighted(self):
        # The fix is one row wide. A painter that started resizing rows the
        # plan had settled would be changing the tab's shape, not fixing it.
        for name, build in BUILDERS.items():
            rows, plan = build()
            reqs = painted(rows, plan)
            for row, px in plan["heights"].items():
                if row != 1:
                    self.assertEqual(row_heights(reqs, row)[-1], px,
                                     f"{name} row {row}")


class TheStandfirstIsDrawnAtTheSizeItIsMeasuredAt(unittest.TestCase):
    """The whole bug in one sentence: measured at 10pt, painted at 11pt."""

    def test_row_2_is_painted_at_the_house_subtitle_size(self):
        rows, plan = reviewtab.qa_checklist()
        sizes = [q["repeatCell"]["cell"]["userEnteredFormat"]["textFormat"]
                 ["fontSize"]
                 for q in painted(rows, plan)
                 if q.get("repeatCell")
                 and q["repeatCell"]["range"]["startRowIndex"] == 1
                 and q["repeatCell"]["range"]["endRowIndex"] == 2]
        self.assertEqual(sizes, [house.SUB_PT])

    def test_the_measurement_uses_that_same_size(self):
        # standfirst.height defaults to house.SUB_PT. Pinned here because the
        # default is the only thing keeping the two halves in step.
        self.assertEqual(standfirst.height("y" * 300, 900, floor=0),
                         standfirst.height("y" * 300, 900, floor=0,
                                           pt=house.SUB_PT))


class TheReviewerColumnsStayEmpty(unittest.TestCase):
    """Built empty is the point: a pre-filled verdict is not a review."""

    def test_the_hand_entry_columns_hold_nothing(self):
        for name, build in BUILDERS.items():
            rows, plan = build()
            c0, c1 = plan["entry_cols"]
            for r0, r1 in plan["entry_rows"]:
                for row in rows[r0:r1]:
                    filled = [c for c in row[c0:c1] if str(c).strip()]
                    self.assertEqual(filled, [], f"{name} row {row[0]!r}")

    def test_the_verdict_dropdown_offers_a_way_to_say_no(self):
        _rows, plan = reviewtab.samples_review()
        _col, values = plan["dropdown"]
        self.assertIn("revise", [v.lower() for v in values])
        self.assertIn("reject", [v.lower() for v in values])


if __name__ == "__main__":
    unittest.main()
