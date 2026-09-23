"""Painting Navigation — the standfirst has to fit the text it is given.

Moved here with `format_navigation` when `navtab` was split. The row it
guards is row 2, the one line every reader meets first: a row is a teaching
day is a segment is a lesson plan -- the one equivalence every other tab
assumes. `navtab.build` sizes that row with a 10pt estimate and the painter
draws it at house.SUB_PT (11), so the line count was right, every line was a
few pixels short, and the last one was cut off. The fix is the last request
to land on that row, which is the only reason it wins.
"""
import unittest

import navpaint
import navtab
import sheetio
import standfirst


class TheStandfirstFitsItsOwnText(unittest.TestCase):
    """Row 2 is the only place the workbook explains itself to a first reader.

    It says a row is a teaching day is a segment is a lesson plan — the one
    equivalence everything else on every tab assumes. `build` sizes that row
    with a 10pt estimate; `format_navigation` paints it at house.SUB_PT (11),
    so the line count was right and each line was short, cutting the last.
    """

    class Recorder:
        def __init__(self):
            self.requests = []

        def spreadsheets(self):
            return self

        def batchUpdate(self, spreadsheetId=None, body=None):
            self.requests.extend(body["requests"])
            return self

        def execute(self):
            return {}

    def painted(self):
        rows, plan = navtab.build()
        rec = self.Recorder()
        navpaint.format_navigation(rec, sheetio, 777, rows, plan, {})
        return rows, plan, rec.requests

    @staticmethod
    def _heights(reqs, row):
        out = []
        for q in reqs:
            d = q.get("updateDimensionProperties")
            if d and d["range"]["dimension"] == "ROWS" \
                    and d["range"]["startIndex"] <= row < d["range"]["endIndex"]:
                out.append(d["properties"]["pixelSize"])
        return out

    def test_the_plan_alone_is_too_short(self):
        rows, plan = navtab.build()
        need = standfirst.row_px(rows, 1, plan["widths"], plan["n_cols"], 0, 0)
        self.assertGreater(need, plan["heights"][1])

    def test_the_last_word_on_row_2_is_the_computed_height(self):
        rows, plan, reqs = self.painted()
        want = standfirst.row_px(rows, 1, plan["widths"], plan["n_cols"], 0,
                                 plan["heights"][1])
        self.assertEqual(self._heights(reqs, 1)[-1], want)

    def test_no_other_row_is_re_heighted(self):
        _rows, plan, reqs = self.painted()
        for row, px in plan["heights"].items():
            if row != 1:
                self.assertEqual(self._heights(reqs, row)[-1], px, f"row {row}")


if __name__ == "__main__":
    unittest.main()
